export type BossEvidenceLevel = "confirmed" | "inferred" | "visualHint";

export type BossArchetype =
  | "wind-core"
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

export interface BossSkillEvidence {
  source: "canonical-authority" | "zhejiang-typhoon" | "open-meteo" | "jma-himawari";
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
  rating: string;
  energy: number;
  riskSummary: string;
  primarySkillIds: string[];
  skills: BossSkill[];
  events: BossEvent[];
  evidenceSummary: BossSkillEvidence[];
  environment: BossEnvironmentSummary;
  satellite: BossSatelliteSummary;
  sourcePolicy: {
    canonicalAuthority: string;
    machineReadableTrackSource: string;
    regionalWarningAuthority: string;
  };
  generatedAt: string;
}
