export type SourceStatus = "fresh" | "stale" | "unknown" | "unavailable";
export type EvidenceStatus = "available" | "degraded" | "unavailable";

export interface TropicalDisturbanceOutlook {
  schemaVersion: 1;
  generatedAt: string;
  basin: "western-north-pacific";
  evidenceStatus: EvidenceStatus;
  coverage: { nearTerm: EvidenceStatus; week2: EvidenceStatus; week3: EvidenceStatus };
  summary: string;
  sources: Record<string, { url: string; updatedAt: string | null; status: SourceStatus; error: string | null }>;
  nearTermDisturbances: Array<{
    factRef: string; id: string; latitude: number; longitude: number;
    potential: "low" | "medium" | "high"; timeWindowHours: number;
    numericProbability: null; maximumWindKt: number | null; minimumPressureHpa: number | null;
    favorableSignals: string[]; limitingSignals: string[]; sourceText: string;
  }>;
  extendedRangeAreas: Array<{
    factRef: string; week: 2 | 3; probabilityPercent: 20 | 40 | 60; validPeriod: string | null;
    center: { latitude: number; longitude: number };
    bounds: { south: number; north: number; west: number; east: number };
    sourceUrl: string;
  }>;
  limitations: string[];
}

export const JTWC_WESTERN_PACIFIC_ADVISORY_URL: string;
export const CPC_WEEK2_TC_KML_URL: string;
export const CPC_WEEK3_TC_KML_URL: string;

export function buildTropicalDisturbanceOutlook(
  inputs: { jtwcAdvisory: string | null; cpcWeek2Kml: string | null; cpcWeek3Kml: string | null },
  options?: { now?: string | number | Date }
): TropicalDisturbanceOutlook;

export function assessTropicalDisturbanceOutlook(
  outlook: Pick<TropicalDisturbanceOutlook, "sources">
): { status: EvidenceStatus; coverage: TropicalDisturbanceOutlook["coverage"] };

export function renderTropicalDisturbanceReport(outlook: TropicalDisturbanceOutlook): string;
