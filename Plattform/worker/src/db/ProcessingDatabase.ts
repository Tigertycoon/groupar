import type {
  AssetDerivativeInsert,
  AssetProcessingStatus,
  JobStatus,
  MediaAssetRow,
  TriggerImageRow
} from "../contracts/types.js";

export interface ProcessingDatabase {
  getTriggerImage(id: string): Promise<TriggerImageRow>;
  getMediaAsset(id: string): Promise<MediaAssetRow>;

  updateProcessingJob(
    id: string,
    patch: {
      status: JobStatus;
      output?: Record<string, unknown>;
      error_message?: string | null;
      started_at?: string;
      finished_at?: string;
    }
  ): Promise<void>;

  updateTriggerImage(
    id: string,
    patch: {
      processing_status?: AssetProcessingStatus;
      quality_status?: TriggerImageRow["quality_status"];
      quality_score?: number | null;
      quality_report?: Record<string, unknown>;
      storage_key_processed?: string | null;
      cdn_url?: string | null;
      mime_type?: string | null;
      width?: number | null;
      height?: number | null;
      bytes?: number | null;
      sha256?: string | null;
    }
  ): Promise<void>;

  updateMediaAsset(
    id: string,
    patch: {
      processing_status?: AssetProcessingStatus;
      processing_report?: Record<string, unknown>;
      storage_key_processed?: string | null;
      cdn_url?: string | null;
      mime_type?: string | null;
      width?: number | null;
      height?: number | null;
      duration_seconds?: number | null;
      bytes?: number | null;
      sha256?: string | null;
    }
  ): Promise<void>;

  upsertAssetDerivative(input: AssetDerivativeInsert): Promise<void>;
}
