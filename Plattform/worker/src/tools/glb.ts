import { readFile, stat } from "node:fs/promises";

export interface GlbValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
  version?: number;
  declaredLength?: number;
}

export async function validateGlbBasic(path: string, maxBytes = 50 * 1024 * 1024): Promise<GlbValidationResult> {
  const fileStat = await stat(path);
  const header = await readFile(path).then((buffer) => buffer.subarray(0, 12));
  const errors: string[] = [];
  const warnings: string[] = [];

  if (fileStat.size > maxBytes) {
    errors.push("model_size_above_limit");
  }
  if (header.subarray(0, 4).toString("ascii") !== "glTF") {
    errors.push("model_not_glb_magic");
  }

  const version = header.length >= 8 ? header.readUInt32LE(4) : undefined;
  const declaredLength = header.length >= 12 ? header.readUInt32LE(8) : undefined;

  if (version !== 2) {
    errors.push("model_glb_version_not_2");
  }
  if (declaredLength !== undefined && declaredLength !== fileStat.size) {
    warnings.push("model_declared_length_mismatch");
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
    version,
    declaredLength
  };
}
