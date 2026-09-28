import { execFileWithTimeout } from "./process.js";

export interface VideoTranscodePlan {
  ffmpegArgs: string[];
  thumbnailArgs: string[];
}

export function buildVideoTranscodePlan(inputPath: string, outputMp4Path: string, thumbnailPath: string): VideoTranscodePlan {
  return {
    ffmpegArgs: [
      "-y",
      "-i",
      inputPath,
      "-vf",
      "scale='min(1920,iw)':-2",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      outputMp4Path
    ],
    thumbnailArgs: ["-y", "-ss", "1", "-i", inputPath, "-frames:v", "1", "-vf", "scale=512:-2", thumbnailPath]
  };
}

export async function transcodeVideo(inputPath: string, outputMp4Path: string, thumbnailPath: string): Promise<VideoTranscodePlan> {
  const plan = buildVideoTranscodePlan(inputPath, outputMp4Path, thumbnailPath);
  await execFileWithTimeout(process.env.FFMPEG_PATH ?? "ffmpeg", plan.ffmpegArgs, 120000);
  await execFileWithTimeout(process.env.FFMPEG_PATH ?? "ffmpeg", plan.thumbnailArgs, 30000);
  return plan;
}
