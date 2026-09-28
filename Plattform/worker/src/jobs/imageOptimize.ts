import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { AssetDerivativeInsert, ProcessingJobPayload } from "../contracts/types.js";
import { mediaDerivativeKey } from "../contracts/objectKeys.js";
import { probeFile } from "../media/fileInfo.js";
import type { WorkerDeps } from "./deps.js";
import { WorkerJobError, jobFailureMessage, jobFailureOutput, jobFailureStatus } from "./deps.js";

export async function runImageOptimizeJob(payload: ProcessingJobPayload, deps: WorkerDeps): Promise<void> {
  await deps.db.updateProcessingJob(payload.processingJobId, { status: "running", started_at: new Date().toISOString() });
  let asset: Awaited<ReturnType<WorkerDeps["db"]["getMediaAsset"]>> | undefined;

  const workDir = join(deps.tmpDir, payload.processingJobId);
  const rawPath = join(workDir, "original");
  const optimizedPath = join(workDir, "image_2048.webp");
  const thumbnailPath = join(workDir, "thumb_512.webp");

  try {
    if (payload.targetType !== "media_asset") {
      throw new WorkerJobError("image.optimize received non-media_asset target", "failed_permanent", {
        targetType: payload.targetType
      });
    }

    asset = await deps.db.getMediaAsset(payload.targetId);
    if (asset.asset_type !== "image") {
      throw new WorkerJobError("image.optimize received non-image media asset", "failed_permanent", {
        assetType: asset.asset_type
      });
    }

    await deps.db.updateMediaAsset(asset.id, { processing_status: "processing" });

    await mkdir(workDir, { recursive: true });
    await deps.storage.downloadToFile(asset.storage_key_original, rawPath);
    const rawProbe = await probeFile(rawPath);

    await deps.imageProcessor.optimizeImage(rawPath, optimizedPath, 2048);
    await deps.imageProcessor.createThumbnail(rawPath, thumbnailPath, 512);

    const [optimizedProbe, thumbnailProbe] = await Promise.all([probeFile(optimizedPath), probeFile(thumbnailPath)]);
    const optimizedKey = mediaDerivativeKey(asset, "image.optimized_2048");
    const thumbKey = mediaDerivativeKey(asset, "image.thumbnail_512");

    await deps.storage.uploadFile(optimizedPath, optimizedKey, optimizedProbe.contentType);
    await deps.storage.uploadFile(thumbnailPath, thumbKey, thumbnailProbe.contentType);

    const derivatives: AssetDerivativeInsert[] = [
      {
        org_id: asset.org_id,
        group_id: asset.group_id,
        trigger_image_id: null,
        media_asset_id: asset.id,
        kind: "image.optimized_2048",
        storage_key: optimizedKey,
        cdn_url: deps.storage.publicUrl(optimizedKey),
        mime_type: optimizedProbe.contentType,
        width: optimizedProbe.width ?? null,
        height: optimizedProbe.height ?? null,
        bytes: optimizedProbe.bytes,
        sha256: optimizedProbe.sha256,
        metadata: { sourceSha256: rawProbe.sha256 },
        processing_status: "ready"
      },
      {
        org_id: asset.org_id,
        group_id: asset.group_id,
        trigger_image_id: null,
        media_asset_id: asset.id,
        kind: "image.thumbnail_512",
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
    await deps.db.updateMediaAsset(asset.id, {
      processing_status: "ready",
      processing_report: { derivatives },
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
      output: { derivatives }
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
