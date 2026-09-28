import { Queue, Worker } from "bullmq";
import type { ProcessingJobPayload } from "../contracts/types.js";
import type { WorkerDeps } from "../jobs/deps.js";
import { runProcessingJob } from "../jobs/router.js";

export const queueNames = {
  mediaLight: "media-light",
  mediaHeavy: "media-heavy",
  manifest: "manifest"
} as const;

export function connectionFromEnv(): {
  host: string;
  port: number;
  username?: string;
  password?: string;
  maxRetriesPerRequest: null;
} {
  const url = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    maxRetriesPerRequest: null
  };
}

export function queueForJobType(jobType: ProcessingJobPayload["jobType"]): string {
  switch (jobType) {
    case "trigger.validate":
    case "image.optimize":
    case "model.validate":
      return queueNames.mediaLight;
    case "video.transcode":
      return queueNames.mediaHeavy;
    case "manifest.rebuild":
      return queueNames.manifest;
  }
}

export async function enqueueProcessingJob(payload: ProcessingJobPayload): Promise<void> {
  const connection = connectionFromEnv();
  const queue = new Queue<ProcessingJobPayload, void, ProcessingJobPayload["jobType"]>(queueForJobType(payload.jobType), { connection });
  await queue.add(payload.jobType, payload, {
    jobId: payload.jobId,
    attempts: payload.jobType === "video.transcode" ? 2 : 3,
    backoff: { type: "exponential", delay: payload.jobType === "video.transcode" ? 120000 : 30000 },
    removeOnComplete: { age: 86400, count: 10000 },
    removeOnFail: false
  });
  await queue.close();
}

export function startBullWorker(queueName: string, deps: WorkerDeps): Worker<ProcessingJobPayload, void, ProcessingJobPayload["jobType"]> {
  const connection = connectionFromEnv();
  return new Worker<ProcessingJobPayload, void, ProcessingJobPayload["jobType"]>(
    queueName,
    async (job) => {
      await runProcessingJob(job.data, deps);
    },
    { connection, concurrency: Number(process.env.WORKER_CONCURRENCY ?? "2") }
  );
}
