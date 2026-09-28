import type { ProcessingJobPayload } from "../contracts/types.js";
import type { WorkerDeps } from "./deps.js";
import { WorkerJobError } from "./deps.js";
import { runImageOptimizeJob } from "./imageOptimize.js";
import { runModelValidateJob } from "./modelValidate.js";
import { runTriggerValidateJob } from "./triggerValidate.js";
import { runVideoTranscodeJob } from "./videoTranscode.js";

export async function runProcessingJob(payload: ProcessingJobPayload, deps: WorkerDeps): Promise<void> {
  switch (payload.jobType) {
    case "trigger.validate":
      await runTriggerValidateJob(payload, deps);
      return;
    case "image.optimize":
      await runImageOptimizeJob(payload, deps);
      return;
    case "video.transcode":
      await runVideoTranscodeJob(payload, deps);
      return;
    case "model.validate":
      await runModelValidateJob(payload, deps);
      return;
    case "manifest.rebuild":
      await failWrongWorkerJob(payload, deps, "manifest.rebuild is handled by the manifest worker, not upload media processors");
      return;
    default:
      await failWrongWorkerJob(payload, deps, `Unsupported upload worker job type: ${(payload as { jobType: string }).jobType}`);
  }
}

async function failWrongWorkerJob(payload: ProcessingJobPayload, deps: WorkerDeps, message: string): Promise<never> {
  await deps.db.updateProcessingJob(payload.processingJobId, {
    status: "failed_permanent",
    finished_at: new Date().toISOString(),
    error_message: message,
    output: { error: { details: { jobType: payload.jobType } } }
  });

  throw new WorkerJobError(message, "failed_permanent", { jobType: payload.jobType });
}
