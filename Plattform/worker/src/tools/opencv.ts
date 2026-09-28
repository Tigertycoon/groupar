import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { execFileWithTimeout } from "./process.js";

export interface OpenCvReport {
  blurScore: number;
  contrastScore: number;
  featureCount: number;
  warnings: string[];
}

export async function analyzeWithOpenCv(imagePath: string, pythonCommand = process.env.PYTHON ?? "python"): Promise<OpenCvReport | null> {
  const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../scripts/opencv_analyze.py");

  try {
    const result = await execFileWithTimeout(pythonCommand, [scriptPath, imagePath], 15000);
    return JSON.parse(result.stdout) as OpenCvReport;
  } catch {
    return null;
  }
}
