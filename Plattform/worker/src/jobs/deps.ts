import type { ProcessingDatabase } from "../db/ProcessingDatabase.js";
import type { ImageProcessor } from "../media/ImageProcessor.js";
import type { ObjectStorage } from "../storage/Storage.js";

export interface WorkerDeps {
  db: ProcessingDatabase;
  storage: ObjectStorage;
  imageProcessor: ImageProcessor;
  tmpDir: string;
}

export class WorkerJobError extends Error {
  constructor(
    message: string,
    readonly status: "failed_retryable" | "failed_permanent",
    readonly details: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

export function jobFailureStatus(error: unknown): "failed_retryable" | "failed_permanent" {
  return error instanceof WorkerJobError ? error.status : "failed_retryable";
}

export function jobFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function jobFailureOutput(error: unknown): Record<string, unknown> | undefined {
  if (!(error instanceof WorkerJobError) || Object.keys(error.details).length === 0) {
    return undefined;
  }

  return { error: { details: error.details } };
}
