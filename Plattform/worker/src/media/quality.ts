import type { AssetProcessingStatus, FileProbe, TriggerQualityReport, TriggerQualityStatus } from "../contracts/types.js";
import type { OpenCvReport } from "../tools/opencv.js";

export interface TriggerQualityDecision {
  processingStatus: AssetProcessingStatus;
  qualityStatus: TriggerQualityStatus;
  report: TriggerQualityReport;
}

export function evaluateTriggerQuality(input: {
  probe: FileProbe;
  opencv?: OpenCvReport | null;
  arcoreScore?: number | null;
  toolWarnings?: string[];
}): TriggerQualityDecision {
  const warnings = [...(input.toolWarnings ?? [])];
  const width = input.probe.width ?? 0;
  const height = input.probe.height ?? 0;
  const shortSide = Math.min(width, height);
  const longSide = Math.max(width, height);
  const aspectRatio = shortSide > 0 ? longSide / shortSide : Number.POSITIVE_INFINITY;

  if (!input.probe.contentType.startsWith("image/")) {
    return failed("trigger_not_image", input);
  }
  if (!width || !height) {
    return failed("trigger_dimensions_unreadable", input);
  }
  if (shortSide < 640) {
    return failed("trigger_short_side_below_640", input);
  }
  if (longSide > 4096) {
    return failed("trigger_long_side_above_4096", input);
  }
  if (aspectRatio > 3) {
    return failed("trigger_aspect_ratio_extreme", input);
  }

  const blurScore = input.opencv?.blurScore ?? null;
  const contrastScore = input.opencv?.contrastScore ?? null;
  const featureCount = input.opencv?.featureCount ?? null;
  const arcoreScore = input.arcoreScore ?? null;

  if (blurScore !== null && blurScore < 60) {
    warnings.push("trigger_blur_low");
  }
  if (contrastScore !== null && contrastScore < 18) {
    warnings.push("trigger_contrast_low");
  }
  if (featureCount !== null && featureCount < 120) {
    warnings.push("trigger_feature_count_low");
  }

  if (arcoreScore !== null) {
    if (arcoreScore >= 75 && warnings.length === 0) {
      return decision("ready", "passed", arcoreScore / 100, input, warnings);
    }
    if (arcoreScore >= 50) {
      return decision("needs_manual_review", "warning", arcoreScore / 100, input, warnings);
    }
    return decision("rejected", "failed", arcoreScore / 100, input, [...warnings, "trigger_arcore_score_too_low"]);
  }

  const heuristicScore = calculateHeuristicScore({ blurScore, contrastScore, featureCount });
  if (heuristicScore >= 0.75 && warnings.length === 0) {
    return decision("ready", "passed", heuristicScore, input, warnings);
  }
  if (heuristicScore >= 0.5) {
    return decision("needs_manual_review", "warning", heuristicScore, input, warnings);
  }
  return decision("rejected", "failed", heuristicScore, input, [...warnings, "trigger_heuristic_score_too_low"]);
}

function failed(code: string, input: { arcoreScore?: number | null; opencv?: OpenCvReport | null }): TriggerQualityDecision {
  return decision("rejected", "failed", 0, input, [code]);
}

function decision(
  processingStatus: AssetProcessingStatus,
  qualityStatus: TriggerQualityStatus,
  score: number,
  input: { arcoreScore?: number | null; opencv?: OpenCvReport | null },
  warnings: string[]
): TriggerQualityDecision {
  return {
    processingStatus,
    qualityStatus,
    report: {
      status: qualityStatus,
      score: round(score),
      warnings,
      arcoreScore: input.arcoreScore ?? null,
      blurScore: input.opencv?.blurScore ?? null,
      contrastScore: input.opencv?.contrastScore ?? null,
      featureCount: input.opencv?.featureCount ?? null
    }
  };
}

function calculateHeuristicScore(input: {
  blurScore: number | null;
  contrastScore: number | null;
  featureCount: number | null;
}): number {
  const blur = input.blurScore === null ? 0.45 : Math.min(input.blurScore / 250, 1);
  const contrast = input.contrastScore === null ? 0.45 : Math.min(input.contrastScore / 60, 1);
  const features = input.featureCount === null ? 0.45 : Math.min(input.featureCount / 750, 1);
  return round(blur * 0.25 + contrast * 0.25 + features * 0.5);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
