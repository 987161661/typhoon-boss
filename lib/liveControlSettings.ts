export type LiveControlSettings = {
  version: 1;
  sceneRotationEnabled: boolean;
  briefingDurationSeconds: number;
  analysisDurationSeconds: number;
  evolutionAgentEnabled: boolean;
  evolutionAgentIntervalMinutes: number;
  typhoonOutlookVisible: boolean;
  conversationPanelVisible: boolean;
  cityReportEffectsEnabled: boolean;
  cityReportEffectsVolume: LiveCityReportEffectsVolume;
  updatedAt?: string;
};

export type LiveCityReportEffectsVolume = "low" | "standard" | "high";

export const DEFAULT_LIVE_CONTROL_SETTINGS: LiveControlSettings = {
  version: 1,
  sceneRotationEnabled: true,
  briefingDurationSeconds: 7,
  analysisDurationSeconds: 5,
  // Generating an evolution report can write runtime state and invoke the
  // configured document model. It must be explicitly enabled by an operator.
  evolutionAgentEnabled: false,
  evolutionAgentIntervalMinutes: 30,
  typhoonOutlookVisible: true,
  conversationPanelVisible: true,
  cityReportEffectsEnabled: true,
  cityReportEffectsVolume: "standard"
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
    typhoonOutlookVisible:
      typeof value?.typhoonOutlookVisible === "boolean"
        ? value.typhoonOutlookVisible
        : current.typhoonOutlookVisible,
    conversationPanelVisible:
      typeof value?.conversationPanelVisible === "boolean"
        ? value.conversationPanelVisible
        : current.conversationPanelVisible,
    cityReportEffectsEnabled:
      typeof value?.cityReportEffectsEnabled === "boolean"
        ? value.cityReportEffectsEnabled
        : current.cityReportEffectsEnabled,
    cityReportEffectsVolume: isEffectsVolume(value?.cityReportEffectsVolume)
      ? value.cityReportEffectsVolume
      : current.cityReportEffectsVolume,
    updatedAt: typeof value?.updatedAt === "string" ? value.updatedAt : current.updatedAt
  };
}

function isEffectsVolume(value: unknown): value is LiveCityReportEffectsVolume {
  return value === "low" || value === "standard" || value === "high";
}
