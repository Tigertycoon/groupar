import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { AssetDerivativeInsert, ProcessingJobPayload } from "../contracts/types.js";
import { triggerDerivativeKey } from "../contracts/objectKeys.js";
import { probeFile } from "../media/fileInfo.js";
import { evaluateTriggerQuality } from "../media/quality.js";
import { analyzeWithOpenCv } from "../tools/opencv.js";
import { evaluateWithArcoreImg } from "../tools/arcoreimg.js";
import type { WorkerDeps } from "./deps.js";
import { WorkerJobError, jobFailureMessage, jobFailureOutput, jobFailureStatus } from "./deps.js";

export async function runTriggerValidateJob(payload: ProcessingJobPayload, deps: WorkerDeps): Promise<void> {
  const startedAt = new Date().toISOString();
  await deps.db.updateProcessingJob(payload.processingJobId, { status: "running", started_at: startedAt });

  let trigger: Awaited<ReturnType<WorkerDeps["db"]["getTriggerImage"]>> | undefined;

  const workDir = join(deps.tmpDir, payload.processingJobId);
  const rawPath = join(workDir, "original");
  const normalizedPath = join(workDir, "trigger_normalized.jpg");
  const thumbnailPath = join(workDir, "thumb_512.webp");

  try {
    if (payload.targetType !== "trigger_image") {
      throw new WorkerJobError("trigger.validate received non-trigger_image target", "failed_permanent", {
        targetType: payload.targetType
      });
    }

    trigger = await deps.db.getTriggerImage(payload.targetId);
    await deps.db.updateTriggerImage(trigger.id, { processing_status: "processing" });

    await mkdir(workDir, { recursive: true });
    await deps.storage.downloadToFile(trigger.storage_key_original, rawPath);

    const rawProbe = await probeFile(rawPath);
    await deps.imageProcessor.normalizeTrigger(rawPath, normalizedPath);
    await deps.imageProcessor.createThumbnail(rawPath, thumbnailPath, 512);

    const [normalizedProbe, thumbnailProbe, opencv, arcore] = await Promise.all([
      probeFile(normalizedPath),
      probeFile(thumbnailPath),
      analyzeWithOpenCv(rawPath),
      evaluateWithArcoreImg(rawPath)
    ]);

    const toolWarnings: string[] = [];
    if (!opencv) {
      toolWarnings.push("opencv_unavailable");
    }
    if (!arcore) {
      toolWarnings.push("arcoreimg_unavailable");
    }

    const quality = evaluateTriggerQuality({
      probe: normalizedProbe,
      opencv,
      arcoreScore: arcore?.score ?? null,
      toolWarnings
    });

    const normalizedKey = triggerDerivativeKey(trigger, "trigger.normalized");
    const thumbKey = triggerDerivativeKey(trigger, "trigger.thumbnail");

    await deps.storage.uploadFile(normalizedPath, normalizedKey, normalizedProbe.contentType);
    await deps.storage.uploadFile(thumbnailPath, thumbKey, thumbnailProbe.contentType);

    const derivatives: AssetDerivativeInsert[] = [
      {
        org_id: trigger.org_id,
        group_id: trigger.group_id,
        trigger_image_id: trigger.id,
        media_asset_id: null,
        kind: "trigger.normalized",
        storage_key: normalizedKey,
        cdn_url: deps.storage.publicUrl(normalizedKey),
        mime_type: normalizedProbe.contentType,
        width: normalizedProbe.width ?? null,
        height: normalizedProbe.height ?? null,
        bytes: normalizedProbe.bytes,
        sha256: normalizedProbe.sha256,
        metadata: { sourceSha256: rawProbe.sha256 },
        processing_status: "ready"
      },
      {
        org_id: trigger.org_id,
        group_id: trigger.group_id,
        trigger_image_id: trigger.id,
        media_asset_id: null,
        kind: "trigger.thumbnail",
        storage_key: thumbKey,
        cdn_url: deps.storage.publicUrl(thumbKey),
        mime_type: thumbnailProbe.contentType,
        width: thumbnailProbe.width ?? null,
        height: thumbnailProbe.height ?? null,
        bytes: thumbnailProbe.bytes,
        sha256: thumbnailProbe.sha256,
        metadata: { sourceSha256: rawProbe.sha256 },
        processing_status: "ready"
      }
    ];

    await Promise.all(derivatives.map((derivative) => deps.db.upsertAssetDerivative(derivative)));
    await deps.db.updateTriggerImage(trigger.id, {
      processing_status: quality.processingStatus,
      quality_status: quality.qualityStatus,
      quality_score: quality.report.score,
      quality_report: { ...quality.report },
      storage_key_processed: null,
      cdn_url: null,
      mime_type: rawProbe.contentType,
      width: rawProbe.width ?? null,
      height: rawProbe.height ?? null,
      bytes: rawProbe.bytes,
      sha256: rawProbe.sha256
    });

    await deps.db.updateProcessingJob(payload.processingJobId, {
      status: "succeeded",
      finished_at: new Date().toISOString(),
      output: { quality: quality.report, derivatives }
    });
  } catch (error) {
    const failureStatus = jobFailureStatus(error);
    const failureOutput = jobFailureOutput(error);
    if (trigger) {
      await deps.db.updateTriggerImage(trigger.id, { processing_status: failureStatus });
    }
    await deps.db.updateProcessingJob(payload.processingJobId, {
      status: failureStatus,
      finished_at: new Date().toISOString(),
      error_message: jobFailureMessage(error),
      ...(failureOutput ? { output: failureOutput } : {})
    });
    throw error;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
