import { copyFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { AssetDerivativeInsert, ProcessingJobPayload } from "../contracts/types.js";
import { mediaDerivativeKey } from "../contracts/objectKeys.js";
import { probeFile } from "../media/fileInfo.js";
import { validateGlbBasic } from "../tools/glb.js";
import type { WorkerDeps } from "./deps.js";
import { WorkerJobError, jobFailureMessage, jobFailureOutput, jobFailureStatus } from "./deps.js";

export async function runModelValidateJob(payload: ProcessingJobPayload, deps: WorkerDeps): Promise<void> {
  await deps.db.updateProcessingJob(payload.processingJobId, { status: "running", started_at: new Date().toISOString() });
  let asset: Awaited<ReturnType<WorkerDeps["db"]["getMediaAsset"]>> | undefined;

  const workDir = join(deps.tmpDir, payload.processingJobId);
  const rawPath = join(workDir, "original.glb");
  const validatedPath = join(workDir, "model.glb");

  try {
    if (payload.targetType !== "media_asset") {
      throw new WorkerJobError("model.validate received non-media_asset target", "failed_permanent", {
        targetType: payload.targetType
      });
    }

    asset = await deps.db.getMediaAsset(payload.targetId);
    if (asset.asset_type !== "model3d") {
      throw new WorkerJobError("model.validate received non-model3d media asset", "failed_permanent", {
        assetType: asset.asset_type
      });
    }

    await deps.db.updateMediaAsset(asset.id, { processing_status: "processing" });

    await mkdir(workDir, { recursive: true });
    await deps.storage.downloadToFile(asset.storage_key_original, rawPath);
    const rawProbe = await probeFile(rawPath);
    const validation = await validateGlbBasic(rawPath);

    if (!validation.valid) {
      await deps.db.updateMediaAsset(asset.id, {
        processing_status: "rejected",
        processing_report: { ...validation }
      });
      await deps.db.updateProcessingJob(payload.processingJobId, {
        status: "succeeded",
        finished_at: new Date().toISOString(),
        output: { validation }
      });
      return;
    }

    await copyFile(rawPath, validatedPath);
    const validatedProbe = await probeFile(validatedPath);
    const modelKey = mediaDerivativeKey(asset, "model.glb_validated");
    await deps.storage.uploadFile(validatedPath, modelKey, "model/gltf-binary");

    const derivative: AssetDerivativeInsert = {
      org_id: asset.org_id,
      group_id: asset.group_id,
      trigger_image_id: null,
      media_asset_id: asset.id,
      kind: "model.glb_validated",
      storage_key: modelKey,
      cdn_url: deps.storage.publicUrl(modelKey),
      mime_type: validatedProbe.contentType,
      bytes: validatedProbe.bytes,
      sha256: validatedProbe.sha256,
      metadata: { sourceSha256: rawProbe.sha256, validation },
      processing_status: "ready"
    };

    await deps.db.upsertAssetDerivative(derivative);
    await deps.db.updateMediaAsset(asset.id, {
      processing_status: "ready",
      processing_report: { ...validation },
      storage_key_processed: null,
      cdn_url: null,
      mime_type: rawProbe.contentType,
      bytes: rawProbe.bytes,
      sha256: rawProbe.sha256
    });
    await deps.db.updateProcessingJob(payload.processingJobId, {
      status: "succeeded",
      finished_at: new Date().toISOString(),
      output: { derivative, validation }
    });
  } catch (error) {
    const failureStatus = jobFailureStatus(error);
    const failureOutput = jobFailureOutput(error);
    if (asset) {
      await deps.db.updateMediaAsset(asset.id, { processing_status: failureStatus });
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
