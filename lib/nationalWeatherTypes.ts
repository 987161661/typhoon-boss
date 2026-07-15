import type { Storm } from "@/lib/types";

/**
 * Frozen shared contract for the national-weather refactor.
 *
 * Consumers must use these domain types instead of parsing upstream payloads.
 * Data adapters may grow behind this boundary, but fields may only be removed or
 * reinterpreted through an explicit migration.
 */
export type SourceFreshness = "fresh" | "delayed" | "expired" | "unavailable" | "no-record";

export type WeatherEvidenceLevel = "official" | "observed" | "model" | "metadata";

export type NationalEventKind =
  | "typhoon"
  | "official-warning"
  | "official-risk"
  | "radar-watch"
  | "model-watch";

export type WeatherHazard =
  | "typhoon"
  | "rain"
  | "convection"
  | "heat"
  | "wind"
  | "dust"
  | "visibility"
  | "flood"
  | "geological"
  | "other";

export type WeatherEventLevel = "red" | "orange" | "yellow" | "blue" | "watch";

export interface SourceHealth {
  sourceId: string;
  label: string;
  status: SourceFreshness;
  updatedAt: string | null;
  lastSuccessfulAt: string | null;
  refreshIntervalMinutes: number;
  error: string | null;
  limitations: string[];
}

export interface EventGeography {
  scope: "national" | "province" | "city" | "county" | "point" | "storm-track";
  locationIds: string[];
  provinceCode: string | null;
  cityCode: string | null;
  countyCode: string | null;
  names: string[];
  centroid: { longitude: number; latitude: number } | null;
  /** True only when a deterministic administrative parent relationship exists. */
  cityAttribution: "deterministic" | "ambiguous" | "not-applicable";
}

export interface NationalWeatherEvent {
  id: string;
  kind: NationalEventKind;
  hazard: WeatherHazard;
  title: string;
  level: WeatherEventLevel;
  evidenceLevel: WeatherEvidenceLevel;
  issuedAt: string | null;
  /** Observation/product valid time. It is distinct from retrieval time. */
  dataTime: string | null;
  updatedAt: string;
  expiresAt: string | null;
  geography: EventGeography;
  sourceIds: string[];
  factSummary: string;
  limitations: string[];
}

export interface NationalWarningSummary {
  total: number;
  byLevel: Record<Exclude<WeatherEventLevel, "watch">, number>;
  highestLevel: Exclude<WeatherEventLevel, "watch"> | null;
  updatedAt: string | null;
  sourceId: string;
}

export interface VisualLayerFrameSummary {
  id: string;
  observedAt: string | null;
  imageUrl: string | null;
}

export interface VisualLayerSummary {
  sourceId: string;
  status: SourceFreshness;
  updatedAt: string | null;
  georeferenced: boolean;
  frames: VisualLayerFrameSummary[];
  limitations: string[];
}

export interface OfficialProductSummary {
  id: string;
  label: string;
  kind: "observed" | "forecast" | "risk" | "analysis" | "marine";
  status: SourceFreshness;
  productTime: string | null;
  /** Catalog metadata is never promoted to a numerical weather fact. */
  evidenceLevel: "metadata";
  limitations: string[];
}

export interface CityRankSnapshotSummary {
  generatedAt: string;
  sourceIds: string[];
  cityCount: number;
  status: SourceFreshness;
}

export interface NationalSituationSnapshot {
  schemaVersion: 1;
  generatedAt: string;
  sourceHealth: SourceHealth[];
  events: NationalWeatherEvent[];
  warnings: NationalWarningSummary;
  radar: VisualLayerSummary;
  satellite: VisualLayerSummary;
  products: OfficialProductSummary[];
  storms: Storm[];
  cityRankSnapshot: CityRankSnapshotSummary | null;
}
