export type AssetProcessingStatus =
  | "upload_pending"
  | "uploaded"
  | "queued"
  | "processing"
  | "ready"
  | "needs_manual_review"
  | "rejected"
  | "failed_retryable"
  | "failed_permanent"
  | "superseded"
  | "deleted";

export type TriggerQualityStatus = "pending" | "passed" | "warning" | "failed";

export type JobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed_retryable"
  | "failed_permanent"
  | "cancelled"
  | "dead_letter";

export type JobType =
  | "trigger.validate"
  | "image.optimize"
  | "video.transcode"
  | "model.validate"
  | "manifest.rebuild";

export type MediaAssetType = "image" | "video" | "model3d" | "audio" | "thumbnail";

export type DerivativeKind =
  | "trigger.normalized"
  | "trigger.thumbnail"
  | "image.optimized_2048"
  | "image.optimized_1024"
  | "image.thumbnail_512"
  | "video.mp4_1080p"
  | "video.thumbnail_512"
  | "model.glb_validated";

export type TargetType = "trigger_image" | "media_asset" | "group";

export interface ProcessingJobPayload {
  jobId: string;
  processingJobId: string;
  jobType: JobType;
  orgId: string;
  groupId: string;
  targetType: TargetType;
  targetId: string;
  requestedBy?: string;
}

export interface TriggerImageRow {
  id: string;
  artwork_revision_id: string;
  artwork_id: string;
  org_id: string;
  group_id: string;
  storage_key_original: string;
  /**
   * Worker jobs keep the source-row file metadata below tied to
   * storage_key_original. Processed output metadata is canonical in
   * asset_derivatives.
   */
  storage_key_processed?: string | null;
  cdn_url?: string | null;
  mime_type?: string | null;
  width?: number | null;
  height?: number | null;
  bytes?: number | null;
  sha256?: string | null;
  physical_width_m?: number | null;
  target_key: string;
  quality_status: TriggerQualityStatus;
  quality_score?: number | null;
  quality_report: Record<string, unknown>;
  processing_status: AssetProcessingStatus;
}

export interface MediaAssetRow {
  id: string;
  artwork_revision_id: string;
  artwork_id: string;
  org_id: string;
  group_id: string;
  asset_type: MediaAssetType;
  content_role?: string | null;
  storage_key_original: string;
  /**
   * Worker jobs keep the source-row file metadata below tied to
   * storage_key_original. Processed output metadata is canonical in
   * asset_derivatives.
   */
  storage_key_processed?: string | null;
  cdn_url?: string | null;
  mime_type?: string | null;
  bytes?: number | null;
  sha256?: string | null;
  width?: number | null;
  height?: number | null;
  duration_seconds?: number | null;
  processing_status: AssetProcessingStatus;
  processing_report: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface AssetDerivativeInsert {
  org_id: string;
  group_id: string;
  trigger_image_id?: string | null;
  media_asset_id?: string | null;
  kind: DerivativeKind;
  storage_key: string;
  cdn_url?: string | null;
  /** Metadata for the processed worker output at storage_key/cdn_url. */
  mime_type: string;
  width?: number | null;
  height?: number | null;
  duration_seconds?: number | null;
  bytes: number;
  sha256: string;
  metadata: Record<string, unknown>;
  processing_status: AssetProcessingStatus;
}

export interface FileProbe {
  path: string;
  bytes: number;
  sha256: string;
  contentType: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
}

export interface TriggerQualityReport {
  status: TriggerQualityStatus;
  score: number;
  warnings: string[];
  arcoreScore?: number | null;
  blurScore?: number | null;
  contrastScore?: number | null;
  featureCount?: number | null;
}
