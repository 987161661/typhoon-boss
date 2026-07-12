export type BossEvidenceLevel = "confirmed" | "inferred" | "visualHint";

export type BossArchetype =
  | "wind-core"
  | "eyewall-shifter"
  | "rain-bulk"
  | "giant-radius"
  | "track-trickster"
  | "landfall-siege"
  | "weak-remnant"
  | "balanced-threat";

export type BossPhase =
  | "forming"
  | "intensifying"
  | "mature"
  | "restructuring-hint"
  | "landfall-pressure"
  | "weakening"
  | "archived";

export type BossSkillCategory = "wind" | "rain" | "track" | "structure" | "landfall" | "environment";

export type CoreStructureState =
  | "unknown"
  | "stable-eye"
  | "secondary-ring-forming"
  | "replacement-active"
  | "replacement-stalled"
  | "replacement-completed"
  | "replacement-collapsed";

export type BossIntensityPhase = "forming" | "intensifying" | "mature" | "weakening" | "archived";
export type BossThreatPhase = "open-ocean" | "landfall-pressure" | "archived";

export interface BossStructureSignals {
  innerEyewall: "unknown" | "intact" | "partial" | "collapsed";
  outerEyewall: "unknown" | "forming" | "closed" | "fragmented";
  innerRadiusNm: number | null;
  outerRadiusNm: number | null;
}

export interface BossStructureSummary {
  state: CoreStructureState;
  stateLabel: string;
  cycleOrdinal: number | null;
  monitoredCycle: number | null;
  cycleLabel: string;
  confidence: number;
  evidenceLevel: BossEvidenceLevel;
  source: "jtwc" | "track-inference" | "unavailable";
  sourceLabel: string;
  sourceUrl: string | null;
  bulletinId: string | null;
  observedAt: string;
  detail: string;
  signals: BossStructureSignals;
  stale: boolean;
  warnings: string[];
}

export interface BossPhaseAxes {
  intensity: { value: BossIntensityPhase; label: string };
  threat: { value: BossThreatPhase; label: string };
  structure: { value: CoreStructureState; label: string };
}

export interface BossLandfallSummary {
  status: "forecast-landfall" | "approaching" | "overland" | "open-ocean";
  targetProvince: string | null;
  estimatedAt: string | null;
  nearestDistanceKm: number | null;
  evidenceLevel: "inferred";
  detail: string;
}

export interface BossProvinceCurrentConditions {
  averageWindSpeedMs: number | null;
  windForceLevel: string;
  windDirection: string | null;
  windSampleCount: number;
  windObservedAt: string | null;
  windDataStale: boolean;
  windDataReason: string | null;
  distanceToStormKm: number | null;
  source: string;
}

export interface BossProvinceBriefing {
  province: string;
  headlineLabel: "预计登陆" | "预计最接近" | "影响判断";
  impactStatus: "landfall" | "direct" | "watch" | "unaffected" | "unavailable";
  impactLabel: string;
  estimatedAt: string | null;
  stormWindSpeedMs: number | null;
  stormWindForceLevel: string;
  closestApproachKm: number | null;
  agencySupport: number;
  agencyTotal: number;
  displayDurationMs: 1500 | 2500;
  currentConditions: BossProvinceCurrentConditions;
}

export interface BossLandfallScenario {
  province: string;
  relativeWeight: number;
  estimatedAt: string | null;
  windSpeedMs: number | null;
  windForceLevel: string;
  agencySupport: number;
  agencyTotal: number;
  evidenceLevel: "inferred";
  basis: string;
  generatedAt: string;
  limitations: string;
  currentConditions?: BossProvinceCurrentConditions;
}

export interface BossSkillEvidence {
  source:
    | "canonical-authority"
    | "zhejiang-typhoon"
    | "open-meteo"
    | "jma-himawari"
    | "noaa-himawari-ahi"
    | "jtwc"
    | "jaxa-microwave"
    | "noaa-ospo";
  level: BossEvidenceLevel;
  fields: string[];
  summary: string;
}

export interface BossSkill {
  id: string;
  name: string;
  category: BossSkillCategory;
  severity: number;
  confidence: number;
  evidenceLevel: BossEvidenceLevel;
  detail: string;
  evidence: BossSkillEvidence[];
}

export interface BossEvent {
  id: string;
  time: string;
  title: string;
  detail: string;
  evidenceLevel: BossEvidenceLevel;
  category?: "intensity" | "structure" | "landfall" | "environment";
  sourceLabel?: string;
}

export interface BossEnvironmentSummary {
  source: "open-meteo";
  status: "available" | "unavailable";
  updatedAt: string;
  sampleCount: number;
  maxTcwvKgM2: number | null;
  maxPrecipMm: number | null;
  maxCapeJkg: number | null;
  warnings: string[];
}

export interface BossSatelliteProductSummary {
  product: "dnc" | "b13" | "b08" | "tre" | "hrp";
  status: "available" | "unavailable";
  imageUrl: string | null;
  label: string;
  use: string;
}

export interface BossSatelliteSummary {
  source: "jma-himawari";
  status: "available" | "degraded" | "unavailable";
  updatedAt: string;
  area: "se2" | "r2w" | "r5w";
  availableProducts: Array<"dnc" | "b13" | "b08" | "tre" | "hrp">;
  products: BossSatelliteProductSummary[];
  warnings: string[];
}

export interface BossAhiBandSummary {
  band: "B03" | "B08" | "B13";
  label: string;
  use: string;
  resolution: "R05" | "R10" | "R20";
  status: "available" | "unavailable";
  segmentCount: number;
  sampleKey: string | null;
  sampleUrl: string | null;
}

export interface BossAhiSummary {
  source: "noaa-himawari-ahi";
  status: "available" | "degraded" | "unavailable";
  sensor: "Himawari-9 AHI";
  dataset: "AHI-L1b-FLDK";
  bucket: "noaa-himawari9";
  slot: string | null;
  updatedAt: string;
  availableBands: Array<"B03" | "B08" | "B13">;
  bands: BossAhiBandSummary[];
  attribution: string;
  warnings: string[];
}

export interface BossProfile {
  stormId: string;
  code: string;
  nameZh: string;
  nameEn: string;
  title: string;
  subtitle: string;
  archetype: BossArchetype;
  archetypeLabel: string;
  phase: BossPhase;
  phaseLabel: string;
  phaseAxes: BossPhaseAxes;
  rating: string;
  energy: number;
  landfall: BossLandfallSummary;
  landfallScenarios: BossLandfallScenario[];
  provinceBriefings?: BossProvinceBriefing[];
  riskSummary: string;
  primarySkillIds: string[];
  skills: BossSkill[];
  events: BossEvent[];
  evidenceSummary: BossSkillEvidence[];
  environment: BossEnvironmentSummary;
  satellite: BossSatelliteSummary;
  ahi: BossAhiSummary;
  structure: BossStructureSummary;
  sourcePolicy: {
    canonicalAuthority: string;
    machineReadableTrackSource: string;
    regionalWarningAuthority: string;
    structureAnalysisSource: string;
  };
  generatedAt: string;
}
