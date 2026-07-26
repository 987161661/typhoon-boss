import { revealDelayFor, splitRevealText } from "./cityBattleShowModel";

export const LIVE_CITY_BROADCAST_TIMELINE = {
  battleImpactMs: 230,
  summaryStartMs: 300,
  infoStartMs: 800,
  infoCueMs: 1_000,
  rankStampMs: 1_800,
  settledMs: 2_450,
  archiveDelayMs: 220
} as const;

// React only needs to observe semantic scene changes. CSS owns the motion
// between them, so the large dual-panel tree is not reconciled every frame.
export const LIVE_CITY_BROADCAST_RENDER_MILESTONES = [
  LIVE_CITY_BROADCAST_TIMELINE.summaryStartMs,
  LIVE_CITY_BROADCAST_TIMELINE.infoStartMs,
  LIVE_CITY_BROADCAST_TIMELINE.rankStampMs,
  LIVE_CITY_BROADCAST_TIMELINE.settledMs
] as const;

export type LiveCityBroadcastAct = "battle" | "info" | "stamp" | "settled";

export function resolveLiveCityBroadcastAct(
  elapsedMs: number,
  reducedMotion = false
): LiveCityBroadcastAct {
  if (reducedMotion || elapsedMs >= LIVE_CITY_BROADCAST_TIMELINE.settledMs) return "settled";
  if (elapsedMs >= LIVE_CITY_BROADCAST_TIMELINE.rankStampMs) return "stamp";
  if (elapsedMs >= LIVE_CITY_BROADCAST_TIMELINE.infoStartMs) return "info";
  return "battle";
}

export function resolveLiveSummarySpeed(text: string, budgetMs = 2_000) {
  const units = splitRevealText(text);
  if (units.length <= 1) return 34;
  const weightedUnits = units.reduce((total, character) => {
    return total + revealDelayFor(character, 1);
  }, 0);
  return clamp(Math.round(budgetMs / Math.max(1, weightedUnits)), 34, 58);
}

export function resolveLiveScoreAt(elapsedMs: number, target: number) {
  const progress = clamp((elapsedMs - LIVE_CITY_BROADCAST_TIMELINE.summaryStartMs) / 600, 0, 1);
  const eased = 1 - Math.pow(1 - progress, 3);
  return Math.round(clamp(target, 0, 100) * eased);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
