import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { AssetDerivativeInsert, ProcessingJobPayload } from "../contracts/types.js";
import { mediaDerivativeKey } from "../contracts/objectKeys.js";
import { probeFile } from "../media/fileInfo.js";
import { transcodeVideo } from "../tools/ffmpeg.js";
import type { WorkerDeps } from "./deps.js";
import { WorkerJobError, jobFailureMessage, jobFailureOutput, jobFailureStatus } from "./deps.js";

export async function runVideoTranscodeJob(payload: ProcessingJobPayload, deps: WorkerDeps): Promise<void> {
  await deps.db.updateProcessingJob(payload.processingJobId, { status: "running", started_at: new Date().toISOString() });
  let asset: Awaited<ReturnType<WorkerDeps["db"]["getMediaAsset"]>> | undefined;

  const workDir = join(deps.tmpDir, payload.processingJobId);
  const rawPath = join(workDir, "original");
  const mp4Path = join(workDir, "video_1080p.mp4");
  const thumbnailPath = join(workDir, "thumb_512.webp");

  try {
    if (payload.targetType !== "media_asset") {
      throw new WorkerJobError("video.transcode received non-media_asset target", "failed_permanent", {
        targetType: payload.targetType
      });
    }

    asset = await deps.db.getMediaAsset(payload.targetId);
    if (asset.asset_type !== "video") {
      throw new WorkerJobError("video.transcode received non-video media asset", "failed_permanent", {
        assetType: asset.asset_type
      });
    }

    await deps.db.updateMediaAsset(asset.id, { processing_status: "processing" });

    await mkdir(workDir, { recursive: true });
    await deps.storage.downloadToFile(asset.storage_key_original, rawPath);
    const rawProbe = await probeFile(rawPath);

    const plan = await transcodeVideo(rawPath, mp4Path, thumbnailPath);
    const [videoProbe, thumbnailProbe] = await Promise.all([probeFile(mp4Path), probeFile(thumbnailPath)]);

    const videoKey = mediaDerivativeKey(asset, "video.mp4_1080p");
    const thumbKey = mediaDerivativeKey(asset, "video.thumbnail_512");

    await deps.storage.uploadFile(mp4Path, videoKey, videoProbe.contentType);
    await deps.storage.uploadFile(thumbnailPath, thumbKey, thumbnailProbe.contentType);

    const derivatives: AssetDerivativeInsert[] = [
      {
        org_id: asset.org_id,
        group_id: asset.group_id,
        trigger_image_id: null,
        media_asset_id: asset.id,
        kind: "video.mp4_1080p",
        storage_key: videoKey,
        cdn_url: deps.storage.publicUrl(videoKey),
        mime_type: videoProbe.contentType,
        width: videoProbe.width ?? null,
        height: videoProbe.height ?? null,
        duration_seconds: videoProbe.durationSeconds ?? null,
        bytes: videoProbe.bytes,
        sha256: videoProbe.sha256,
        metadata: { sourceSha256: rawProbe.sha256, ffmpegArgs: plan.ffmpegArgs },
        processing_status: "ready"
      },
      {
        org_id: asset.org_id,
        group_id: asset.group_id,
        trigger_image_id: null,
        media_asset_id: asset.id,
        kind: "video.thumbnail_512",
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
      processing_report: { derivatives, ffmpeg: plan },
      storage_key_processed: null,
      cdn_url: null,
      mime_type: rawProbe.contentType,
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
