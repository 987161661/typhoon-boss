import type { BossRating, StormStage } from "@/lib/types";

export interface TyphoonHazardInputs {
  r7: number;
  r10: number;
  r12: number;
}

/**
 * Product threat grade inspired by One-Punch Man. It intentionally combines
 * destructive potential and impact footprint, rather than relabelling wind
 * intensity as a disaster grade.
 */
export function classifyTyphoonHazard(
  wind: number,
  stage: StormStage,
  radii: TyphoonHazardInputs
): BossRating {
  // 神级 requires verified national-scale emergency evidence. That source is
  // not in this decision path, so a wind value or track alone can never claim it.
  if ((wind >= 58 && radii.r7 >= 350) || (wind >= 51 && radii.r7 >= 500)) return "龙级";
  if (wind >= 51 || radii.r7 >= 360 || radii.r10 >= 160) return "鬼级";
  if (wind >= 33 || radii.r7 >= 180 || stage === "台风" || stage === "强台风" || stage === "超强台风") return "虎级";
  return "狼级";
}

export function downgradeTyphoonHazard(rating: BossRating): BossRating {
  if (rating === "神级") return "龙级";
  if (rating === "龙级") return "鬼级";
  if (rating === "鬼级") return "虎级";
  if (rating === "虎级") return "狼级";
  return "无威胁";
}
