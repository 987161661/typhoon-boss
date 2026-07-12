export type LiveControlSettings = {
  version: 1;
  sceneRotationEnabled: boolean;
  briefingDurationSeconds: number;
  analysisDurationSeconds: number;
  evolutionAgentEnabled: boolean;
  evolutionAgentIntervalMinutes: number;
  updatedAt?: string;
};

export const DEFAULT_LIVE_CONTROL_SETTINGS: LiveControlSettings = {
  version: 1,
  sceneRotationEnabled: true,
  briefingDurationSeconds: 7,
  analysisDurationSeconds: 5,
  evolutionAgentEnabled: true,
  evolutionAgentIntervalMinutes: 30
};

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.min(maximum, Math.max(minimum, Math.round(numeric)))
    : fallback;
}

export function normalizeLiveControlSettings(
  value: Partial<LiveControlSettings> | null | undefined,
  current: LiveControlSettings = DEFAULT_LIVE_CONTROL_SETTINGS
): LiveControlSettings {
  return {
    version: 1,
    sceneRotationEnabled:
      typeof value?.sceneRotationEnabled === "boolean"
        ? value.sceneRotationEnabled
        : current.sceneRotationEnabled,
    briefingDurationSeconds: boundedNumber(
      value?.briefingDurationSeconds,
      current.briefingDurationSeconds,
      3,
      120
    ),
    analysisDurationSeconds: boundedNumber(
      value?.analysisDurationSeconds,
      current.analysisDurationSeconds,
      3,
      120
    ),
    evolutionAgentEnabled:
      typeof value?.evolutionAgentEnabled === "boolean"
        ? value.evolutionAgentEnabled
        : current.evolutionAgentEnabled,
    evolutionAgentIntervalMinutes: boundedNumber(
      value?.evolutionAgentIntervalMinutes,
      current.evolutionAgentIntervalMinutes,
      5,
      360
    ),
    updatedAt: typeof value?.updatedAt === "string" ? value.updatedAt : current.updatedAt
  };
}
