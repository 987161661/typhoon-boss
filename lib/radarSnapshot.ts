import { buildBossProfiles } from "@/lib/bossEngine";
import type { BossProfile } from "@/lib/bossEngine/types";
import { getImpactArea, getSatelliteLayer, getWindField } from "@/lib/environmentData";
import { getCurrentStorms, getDataSourceLabel } from "@/lib/realTyphoonData";
import type { ImpactAreaPayload, SatelliteLayerPayload, Storm, WindFieldPayload } from "@/lib/types";

const DERIVED_CACHE_TTL_MS = 4 * 60 * 1000;
const STALE_DERIVED_CACHE_TTL_MS = 10 * 60 * 1000;

export interface RadarSnapshotEnvironment {
  satellite: SatelliteLayerPayload;
  windField: WindFieldPayload;
  impactArea: ImpactAreaPayload;
}

export interface RadarSnapshot {
  source: string;
  updatedAt: string;
  activeStormId: string | null;
  storms: Storm[];
  bosses: BossProfile[];
  environment: RadarSnapshotEnvironment;
  warnings: string[];
  cache: {
    stormUpdatedAt: string | null;
    derivedGeneratedAt: string;
    derivedExpiresAt: string;
    stale: boolean;
  };
}

interface DerivedSnapshot {
  bosses: BossProfile[];
  environment: RadarSnapshotEnvironment;
  generatedAt: string;
  expiresAt: number;
  staleUntil: number;
  warnings: string[];
}

const derivedCache = new Map<string, DerivedSnapshot>();
const derivedInFlight = new Map<string, Promise<DerivedSnapshot>>();

export async function getRadarSnapshot(stormId?: string | null): Promise<RadarSnapshot> {
  const storms = await getCurrentStorms();
  const selectedStorm = storms.find((storm) => storm.id === stormId) ?? storms[0] ?? null;
  const activeStormId = selectedStorm?.id ?? null;
  const derived = await getDerivedSnapshot(storms, activeStormId);

  return {
    source: getDataSourceLabel(),
    updatedAt: new Date().toISOString(),
    activeStormId,
    storms,
    bosses: derived.bosses,
    environment: derived.environment,
    warnings: derived.warnings,
    cache: {
      stormUpdatedAt: selectedStorm?.updatedAt ?? storms[0]?.updatedAt ?? null,
      derivedGeneratedAt: derived.generatedAt,
      derivedExpiresAt: new Date(derived.expiresAt).toISOString(),
      stale: derived.expiresAt <= Date.now()
    }
  };
}

async function getDerivedSnapshot(storms: Storm[], activeStormId: string | null) {
  const key = derivedCacheKey(storms, activeStormId);
  const now = Date.now();
  const cached = derivedCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached;
  }

  const inFlight = derivedInFlight.get(key);
  if (inFlight) {
    return inFlight;
  }

  if (cached && cached.staleUntil > now) {
    void refreshDerivedSnapshot(key, storms, activeStormId);
    return cached;
  }

  return refreshDerivedSnapshot(key, storms, activeStormId);
}

function refreshDerivedSnapshot(key: string, storms: Storm[], activeStormId: string | null) {
  const request = loadDerivedSnapshot(storms, activeStormId).then(
    (snapshot) => {
      derivedCache.set(key, snapshot);
      derivedInFlight.delete(key);
      pruneDerivedCache();
      return snapshot;
    },
    (error) => {
      derivedInFlight.delete(key);
      const stale = derivedCache.get(key);
      if (stale) {
        return {
          ...stale,
          warnings: [...stale.warnings, error instanceof Error ? error.message : "Derived radar data refresh failed."]
        };
      }
      throw error;
    }
  );
  derivedInFlight.set(key, request);
  return request;
}

async function loadDerivedSnapshot(storms: Storm[], activeStormId: string | null): Promise<DerivedSnapshot> {
  const generatedAt = new Date().toISOString();
  const warnings: string[] = [];
  const [bossResult, satelliteResult, windResult, impactResult] = await Promise.allSettled([
    buildBossProfiles(storms),
    getSatelliteLayer(storms.find((storm) => storm.id === activeStormId)?.updatedAt ?? storms[0]?.updatedAt),
    getWindField(activeStormId),
    getImpactArea(activeStormId)
  ]);

  const bosses = settleValue(bossResult, [], warnings, "Boss profile generation failed.");
  const satellite = settleValue(satelliteResult, fallbackSatellite(generatedAt), warnings, "Satellite layer generation failed.");
  const windField = settleValue(windResult, fallbackWindField(generatedAt), warnings, "Wind field generation failed.");
  const impactArea = settleValue(impactResult, fallbackImpactArea(generatedAt), warnings, "Impact area generation failed.");
  const expiresAt = Date.now() + DERIVED_CACHE_TTL_MS;

  return {
    bosses,
    environment: {
      satellite,
      windField,
      impactArea
    },
    generatedAt,
    expiresAt,
    staleUntil: Date.now() + STALE_DERIVED_CACHE_TTL_MS,
    warnings
  };
}

function settleValue<T>(result: PromiseSettledResult<T>, fallback: T, warnings: string[], message: string) {
  if (result.status === "fulfilled") return result.value;
  warnings.push(`${message} ${result.reason instanceof Error ? result.reason.message : ""}`.trim());
  return fallback;
}

function derivedCacheKey(storms: Storm[], activeStormId: string | null) {
  if (storms.length === 0) return "no-storms";
  return [
    activeStormId ?? "default",
    ...storms.map((storm) => `${storm.id}:${storm.updatedAt}:${storm.maxWind}:${storm.minPressure}`)
  ].join("|");
}

function pruneDerivedCache() {
  if (derivedCache.size <= 8) return;
  const now = Date.now();
  for (const [key, snapshot] of derivedCache) {
    if (snapshot.staleUntil <= now || derivedCache.size > 8) {
      derivedCache.delete(key);
    }
  }
}

function fallbackSatellite(updatedAt: string): SatelliteLayerPayload {
  return {
    source: "NOAA OSPO synchronized geostationary satellite imagery",
    updatedAt,
    status: "unavailable",
    attribution: "NOAA OSPO GMGSI + JMA/Himawari",
    reason: "Satellite layer unavailable.",
    imageUrl: null,
    product: "Himawari Tropical Southeast Asia RGB",
    globalTileUrl: null,
    globalImageUrl: null,
    globalProduct: "NOAA OSPO GMGSI Global Longwave Infrared Cloud Mosaic",
    globalUpdatedAt: updatedAt,
    globalBounds: {
      west: -180,
      south: -60,
      east: 180,
      north: 60
    },
    synchronizedAt: updatedAt,
    synchronizationSkewMinutes: 0,
    referenceUpdatedAt: updatedAt,
    referenceSkewMinutes: 0,
    refreshIntervalMinutes: 30,
    isStale: true,
    bounds: {
      west: 69.8,
      south: 0,
      east: 150.4,
      north: 40.1
    }
  };
}

function fallbackWindField(updatedAt: string): WindFieldPayload {
  return {
    source: "Open-Meteo Forecast API",
    updatedAt,
    status: "unavailable",
    attribution: "Open-Meteo weather forecast model blend",
    reason: "Wind field unavailable.",
    model: "Open-Meteo best match, 10m wind",
    unit: "m/s",
    points: []
  };
}

function fallbackImpactArea(updatedAt: string): ImpactAreaPayload {
  return {
    source: getDataSourceLabel(),
    updatedAt,
    status: "unavailable",
    attribution: getDataSourceLabel(),
    reason: "Impact area unavailable.",
    stormId: null,
    stormName: null,
    featureCount: 0,
    areas: {
      type: "FeatureCollection",
      features: []
    }
  };
}
