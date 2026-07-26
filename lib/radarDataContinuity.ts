import type { BossProfile, BossStructureSummary } from "@/lib/bossEngine/types";

export type TrackSnapshotRecoveryMode =
  | "configured-retention"
  | "forecast-window"
  | "expired";

export function evaluateTrackSnapshotRecovery(input: {
  fetchedAt: string;
  now?: number;
  retainLastGoodDataHours: number;
  active: boolean;
  forecastTimes: readonly string[];
}): {
  retain: boolean;
  mode: TrackSnapshotRecoveryMode;
  ageHours: number;
  forecastEndsAt: string | null;
} {
  const now = input.now ?? Date.now();
  const fetchedAt = Date.parse(input.fetchedAt);
  const ageHours = Number.isFinite(fetchedAt)
    ? Math.round(Math.max(0, now - fetchedAt) / 36_000) / 100
    : Number.POSITIVE_INFINITY;
  const forecastEndsAt = input.forecastTimes
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;

  if (ageHours <= Math.max(0, input.retainLastGoodDataHours)) {
    return { retain: true, mode: "configured-retention", ageHours, forecastEndsAt };
  }
  if (input.active && forecastEndsAt && Date.parse(forecastEndsAt) >= now) {
    return { retain: true, mode: "forecast-window", ageHours, forecastEndsAt };
  }
  return { retain: false, mode: "expired", ageHours, forecastEndsAt };
}

function hasUsableStructure(structure: BossStructureSummary) {
  return structure.source !== "unavailable" && structure.state !== "unknown";
}

function retainAvailable<T extends { status: string }>(
  next: T,
  previous: T | undefined
): T {
  return next.status === "unavailable" && previous && previous.status !== "unavailable"
    ? previous
    : next;
}

function mergeBossProfile(next: BossProfile, previous?: BossProfile): BossProfile {
  if (!previous) return next;
  const structure = hasUsableStructure(next.structure)
    ? next.structure
    : hasUsableStructure(previous.structure)
      ? {
          ...previous.structure,
          stale: true,
          warnings: [...previous.structure.warnings, ...next.structure.warnings]
        }
      : next.structure;

  return {
    ...next,
    structure,
    environment: retainAvailable(next.environment, previous.environment),
    satellite: retainAvailable(next.satellite, previous.satellite),
    ahi: retainAvailable(next.ahi, previous.ahi)
  };
}

/**
 * Keeps the last usable capability for each still-active storm. A partial
 * refresh may update the track and Boss profile without erasing an older
 * structure or imagery conclusion that is still the latest valid evidence.
 */
export function retainUsableBossProfiles(
  next: BossProfile[],
  previous: BossProfile[],
  activeStormIds: readonly string[]
): BossProfile[] {
  const nextById = new Map(next.map((profile) => [profile.stormId, profile]));
  const previousById = new Map(previous.map((profile) => [profile.stormId, profile]));
  return activeStormIds.flatMap((stormId) => {
    const current = nextById.get(stormId);
    const retained = previousById.get(stormId);
    if (current) return [mergeBossProfile(current, retained)];
    return retained ? [retained] : [];
  });
}

export function retainAvailableRadarPayload<T extends { status: string }>(
  next: T,
  previous: T | null | undefined
): T {
  return retainAvailable(next, previous ?? undefined);
}
