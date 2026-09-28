import { execFileWithTimeout } from "./process.js";

export interface ArcoreImgResult {
  score: number;
  rawOutput: string;
}

export async function evaluateWithArcoreImg(
  imagePath: string,
  command = process.env.ARCOREIMG_PATH ?? "arcoreimg"
): Promise<ArcoreImgResult | null> {
  try {
    const result = await execFileWithTimeout(command, ["eval-img", "--input_image_path", imagePath], 20000);
    const output = `${result.stdout}\n${result.stderr}`;
    const match = output.match(/score[^0-9]*([0-9]+(?:\.[0-9]+)?)/i) ?? output.match(/\b([0-9]{1,3})(?:\.[0-9]+)?\b/);
    if (!match) {
      return null;
    }
    return { score: Math.max(0, Math.min(100, Number(match[1]))), rawOutput: output.trim() };
  } catch {
    return null;
  }
}
