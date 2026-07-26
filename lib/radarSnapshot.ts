import { buildBossProfiles } from "@/lib/bossEngine";
import type { BossProfile, BossProvinceBriefing, BossProvinceCurrentConditions } from "@/lib/bossEngine/types";
import { getImpactArea, getSatelliteLayer, getWindField } from "@/lib/environmentData";
import { findProvinceReferencePoint, getProvinceBoundaryCoordinates, getProvinceReferencePoints, getProvinceSampleCoordinates, normalizeProvinceName } from "@/lib/provinceGeo";
import { distanceBetweenKm, distanceToPathKm, windForceFromSpeed } from "@/lib/meteorology";
import { getDataSourceLabel, getTrackSnapshot, type LastTrackedStorm } from "@/lib/realTyphoonData";
import { retainAvailableRadarPayload, retainUsableBossProfiles } from "@/lib/radarDataContinuity";
import type { ImpactAreaPayload, SatelliteLayerPayload, Storm, WindFieldPayload } from "@/lib/types";

const DERIVED_CACHE_TTL_MS = 4 * 60 * 1000;
const DEGRADED_DERIVED_CACHE_TTL_MS = 2 * 60 * 1000;
const STALE_DERIVED_CACHE_TTL_MS = 10 * 60 * 1000;
const BOOTSTRAP_DERIVED_CACHE_TTL_MS = 1_000;
// A decorative or analytical layer must never prevent the live path feed from
// reaching the broadcast page. Timed-out layers fall back independently.
const DERIVED_REQUEST_TIMEOUT_MS = 7_000;
const WIND_DERIVED_TIMEOUT_MS = 20_000;
const CHINA_WIND_BOUNDS = { west: 73, east: 135, south: 18, north: 54 };
const MODEL_WIND_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const FAST_PROVINCE_BRIEFINGS = new Set(["西藏", "青海", "宁夏", "海南", "香港", "澳门"]);

export interface RadarSnapshotEnvironment {
  satellite: SatelliteLayerPayload;
  windField: WindFieldPayload;
  windCenters: Record<string, StormWindCenter>;
  impactArea: ImpactAreaPayload;
}

export interface StormWindCenter {
  stormId: string;
  status: WindFieldPayload["status"];
  source: string;
  updatedAt: string;
  analysisCenter: WindFieldPayload["analysisCenter"] | null;
}

export interface RadarSnapshot {
  source: string;
  updatedAt: string;
  observedAt: string | null;
  fetchedAt: string;
  status: "fresh" | "stale" | "unavailable";
  activeStormId: string | null;
  storms: Storm[];
  lastTrackedStorm: LastTrackedStorm | null;
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
const lastGoodDerivedByScope = new Map<string, DerivedSnapshot>();

export async function getRadarSnapshot(stormId?: string | null): Promise<RadarSnapshot> {
  const trackSnapshot = await getTrackSnapshot();
  const storms = trackSnapshot.storms;
  const selectedStorm = storms.find((storm) => storm.id === stormId) ?? storms[0] ?? null;
  const activeStormId = selectedStorm?.id ?? null;
  const derived = await getDerivedSnapshot(storms, activeStormId);

  return {
    source: trackSnapshot.source,
    updatedAt: new Date().toISOString(),
    observedAt: trackSnapshot.observedAt,
    fetchedAt: trackSnapshot.fetchedAt,
    status: trackSnapshot.status,
    activeStormId,
    storms,
    lastTrackedStorm: trackSnapshot.lastTrackedStorm,
    bosses: derived.bosses,
    environment: derived.environment,
    warnings: [...trackSnapshot.warnings, ...derived.warnings],
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
  const scope = derivedScopeKey(activeStormId);
  const now = Date.now();
  const cached = derivedCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached;
  }

  if (cached && cached.staleUntil > now) {
    if (!derivedInFlight.has(key)) void refreshDerivedSnapshot(key, storms, activeStormId, cached);
    return cached;
  }

  const inFlight = derivedInFlight.get(key);
  if (inFlight) return inFlight;

  // Track positions are the critical path. Satellite, wind and Boss
  // enrichment depend on much slower external providers and are hydrated in
  // the background. This keeps a cold provider from delaying the first map by
  // the full derived-layer timeout budget.
  const retained = lastGoodDerivedByScope.get(scope);
  const bootstrap = buildBootstrapDerivedSnapshot(retained);
  derivedCache.set(key, bootstrap);
  void refreshDerivedSnapshot(key, storms, activeStormId, retained);
  return bootstrap;
}

function buildBootstrapDerivedSnapshot(retained?: DerivedSnapshot): DerivedSnapshot {
  const generatedAt = new Date().toISOString();
  return {
    bosses: retained?.bosses ?? [],
    environment: retained?.environment ?? {
      satellite: fallbackSatellite(generatedAt),
      windField: fallbackWindField(generatedAt),
      windCenters: {},
      impactArea: fallbackImpactArea(generatedAt)
    },
    generatedAt,
    expiresAt: Date.now() + BOOTSTRAP_DERIVED_CACHE_TTL_MS,
    staleUntil: Date.now() + STALE_DERIVED_CACHE_TTL_MS,
    warnings: retained
      ? [...retained.warnings, "台风路径已刷新；Boss 与环境图层继续使用上一份有效快照。"]
      : ["台风路径已先行加载；卫星、风场与影响区尚无可用快照。"]
  };
}

function refreshDerivedSnapshot(
  key: string,
  storms: Storm[],
  activeStormId: string | null,
  retained?: DerivedSnapshot
) {
  const scope = derivedScopeKey(activeStormId);
  const request = loadDerivedSnapshot(storms, activeStormId, retained).then(
    (snapshot) => {
      derivedCache.set(key, snapshot);
      if (storms.length === 0 || snapshot.bosses.length > 0) {
        lastGoodDerivedByScope.set(scope, snapshot);
      }
      derivedInFlight.delete(key);
      pruneDerivedCache();
      return snapshot;
    },
    (error) => {
      derivedInFlight.delete(key);
      const stale = derivedCache.get(key);
      if (stale) {
        const retainedAfterFailure = {
          ...stale,
          warnings: [...stale.warnings, error instanceof Error ? error.message : "Derived radar data refresh failed."]
        };
        derivedCache.set(key, retainedAfterFailure);
        return retainedAfterFailure;
      }
      throw error;
    }
  );
  derivedInFlight.set(key, request);
  return request;
}

async function loadDerivedSnapshot(
  storms: Storm[],
  activeStormId: string | null,
  retained?: DerivedSnapshot
): Promise<DerivedSnapshot> {
  const generatedAt = new Date().toISOString();
  const warnings: string[] = [];
  const [bossResult, satelliteResult, windResult, windCentersResult, impactResult, chinaWindResult] = await Promise.allSettled([
    withTimeout(buildBossProfiles(storms), "Boss profile"),
    withTimeout(
      getSatelliteLayer(storms.find((storm) => storm.id === activeStormId)?.updatedAt ?? storms[0]?.updatedAt),
      "Satellite layer",
      20_000
    ),
    withTimeout(getWindField(activeStormId), "Local wind field", WIND_DERIVED_TIMEOUT_MS),
    withTimeout(loadStormWindCenters(storms), "Storm wind centers", WIND_DERIVED_TIMEOUT_MS),
    withTimeout(getImpactArea(activeStormId), "Impact area"),
    withTimeout(getWindField(activeStormId, CHINA_WIND_BOUNDS), "Nationwide wind field", WIND_DERIVED_TIMEOUT_MS)
  ]);

  const nextBosses = settleValue(bossResult, [], warnings, "Boss profile generation failed.");
  const baseBosses = retainUsableBossProfiles(
    nextBosses,
    retained?.bosses ?? [],
    storms.map((storm) => storm.id)
  );
  const satellite = retainAvailableRadarPayload(settleValue(
    satelliteResult,
    fallbackSatellite(generatedAt),
    warnings,
    "Satellite layer generation failed."
  ), retained?.environment.satellite);
  const directWindField = retainAvailableRadarPayload(settleValue(
    windResult,
    fallbackWindField(generatedAt),
    warnings,
    "Wind field generation failed."
  ), retained?.environment.windField);
  const windCenters = settleValue(
    windCentersResult,
    retained?.environment.windCenters ?? {},
    warnings,
    "Storm wind center generation failed."
  );
  const impactArea = retainAvailableRadarPayload(settleValue(
    impactResult,
    fallbackImpactArea(generatedAt),
    warnings,
    "Impact area generation failed."
  ), retained?.environment.impactArea);
  const chinaWindField = settleValue(chinaWindResult, directWindField, warnings, "Nationwide province wind field generation failed.");
  const windField = directWindField.status === "available"
    ? directWindField
    : chinaWindField.status === "available"
      ? {
          ...chinaWindField,
          reason: `局地风场暂时不可用，已使用全国风场降级覆盖。${directWindField.reason ? ` ${directWindField.reason}` : ""}`
        }
      : directWindField;
  const bosses = enrichProvinceCurrentConditions(baseBosses, storms, chinaWindField);
  const windDataDegraded = chinaWindField.status !== "available" || Boolean(chinaWindField.isStale);
  const expiresAt = Date.now() + (windDataDegraded ? DEGRADED_DERIVED_CACHE_TTL_MS : DERIVED_CACHE_TTL_MS);

  return {
    bosses,
    environment: {
      satellite,
      windField: compactWindField(windField),
      windCenters,
      impactArea
    },
    generatedAt,
    expiresAt,
    staleUntil: Date.now() + STALE_DERIVED_CACHE_TTL_MS,
    warnings
  };
}

async function loadStormWindCenters(storms: Storm[]): Promise<Record<string, StormWindCenter>> {
  const entries = await Promise.all(storms.map(async (storm) => {
    try {
      const field = await getWindField(storm.id);
      return [storm.id, {
        stormId: storm.id,
        status: field.status,
        source: field.source,
        updatedAt: field.updatedAt,
        analysisCenter: field.analysisCenter ?? null
      } satisfies StormWindCenter] as const;
    } catch {
      return [storm.id, {
        stormId: storm.id,
        status: "unavailable",
        source: "Wind field unavailable",
        updatedAt: new Date().toISOString(),
        analysisCenter: null
      } satisfies StormWindCenter] as const;
    }
  }));
  return Object.fromEntries(entries);
}

function compactWindField(payload: WindFieldPayload): WindFieldPayload {
  return {
    ...payload,
    points: [],
    reason: payload.reason
      ? `${payload.reason} 完整风场请通过视口风场接口按需获取。`
      : "完整风场请通过视口风场接口按需获取。"
  };
}

function withTimeout<T>(request: Promise<T>, label: string, timeoutMs = DERIVED_REQUEST_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs / 1000}s.`)), timeoutMs);
    request.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

function enrichProvinceCurrentConditions(
  bosses: BossProfile[],
  storms: Storm[],
  windField: WindFieldPayload
): BossProfile[] {
  return bosses.map((boss) => {
    const storm = storms.find((item) => item.id === boss.stormId) ?? null;
    const currentConditions = new Map(
      getProvinceReferencePoints().map((province) => [
        province.shortName,
        buildProvinceCurrentConditions(province.shortName, storm, windField)
      ])
    );
    const landfallScenarios = boss.landfallScenarios.map((scenario) => ({
      ...scenario,
      currentConditions: currentConditions.get(normalizeProvinceName(scenario.province))
        ?? buildProvinceCurrentConditions(scenario.province, storm, windField)
    }));
    return {
      ...boss,
      landfallScenarios,
      provinceBriefings: buildProvinceBriefings(boss, storm, currentConditions)
    };
  });
}

function buildProvinceCurrentConditions(
  province: string,
  storm: Storm | null,
  windField: WindFieldPayload
): BossProvinceCurrentConditions {
  const samples = windField.status === "available"
    ? getProvinceSampleCoordinates(province).map((point) => interpolateWindAt(windField, point)).filter(isWindSample)
    : [];
  const averageWindSpeedMs = samples.length > 0
    ? samples.reduce((total, point) => total + point.speed, 0) / samples.length
    : null;
  const reference = findProvinceReferencePoint(province);
  const boundary = getProvinceBoundaryCoordinates(province);
  const distanceToStormKm = storm && reference
    ? Math.round(Math.min(...(boundary.length ? boundary : [{ lon: reference.center[0], lat: reference.center[1] }]).map((point) => distanceBetweenKm(storm.position, point))))
    : null;
  const windSourceAgeMs = windField.status === "available"
    ? Date.now() - Date.parse(windField.updatedAt)
    : Number.POSITIVE_INFINITY;
  return {
    averageWindSpeedMs: averageWindSpeedMs === null ? null : Math.round(averageWindSpeedMs * 10) / 10,
    windForceLevel: averageWindSpeedMs === null ? "--" : windForceFromSpeed(averageWindSpeedMs),
    windDirection: averageWindDirection(samples),
    windSampleCount: samples.length,
    windObservedAt: windField.status === "available" ? windField.updatedAt : null,
    // This is an NWP analysis field, not a station observation. Mark it stale
    // both when retrieval failed and when its valid time is no longer recent.
    windDataStale: Boolean(windField.isStale) || !Number.isFinite(windSourceAgeMs) || windSourceAgeMs > MODEL_WIND_MAX_AGE_MS,
    windDataReason: windField.reason ?? null,
    distanceToStormKm,
    source: windField.attribution
  };
}

function buildProvinceBriefings(
  boss: BossProfile,
  storm: Storm | null,
  currentConditions: Map<string, BossProvinceCurrentConditions>
): BossProvinceBriefing[] {
  if (!storm) return [];
  const nowMs = Date.now();
  const futurePoints = (points: Storm["forecast"]) => points.filter((point) => {
    const time = Date.parse(point.time);
    return Number.isFinite(time) && time >= nowMs;
  });
  const primaryForecast = futurePoints(storm.forecastScenarios.find((scenario) => scenario.isPrimary)?.points ?? storm.forecast);
  const agencyTotal = storm.forecastScenarios.length;
  const briefings = getProvinceReferencePoints().map((province) => {
    const pathScenario = boss.landfallScenarios.find(
      (scenario) => normalizeProvinceName(scenario.province) === province.shortName
    );
    const nearest = closestForecastPoint(primaryForecast, province.shortName, province.center);
    const supportDistanceKm = Math.max(storm.windRadiiKm.r7 || 0, 380);
    const agencySupport = storm.forecastScenarios.filter((scenario) => {
      const closest = closestForecastPoint(futurePoints(scenario.points), province.shortName, province.center);
      return closest !== null && closest.distanceKm <= supportDistanceKm;
    }).length;
    const timedPathEntry = pathScenario?.pathRelation === "future-entry" && pathScenario.estimatedAt
      ? pathScenario
      : null;
    const currentProvince = pathScenario?.pathRelation === "current-position" ? pathScenario : null;
    const closestApproachKm = timedPathEntry || currentProvince ? 0 : nearest?.distanceKm ?? null;
    const assessment = timedPathEntry
      ? { status: "direct" as const, label: "机构未来路径进入该省范围（模式推演）" }
      : currentProvince
        ? { status: "direct" as const, label: "台风中心当前位于该省范围（不等同官方登陆确认）" }
      : provinceImpactAssessment(closestApproachKm, storm.windRadiiKm.r7);
    const noImpactTiming = assessment.status === "unaffected" || assessment.status === "unavailable";
    return {
      province: province.shortName,
      headlineLabel: timedPathEntry
        ? "路径入省推演" as const
        : currentProvince
          ? "中心位置" as const
        : noImpactTiming ? "影响判断" as const : "预计最接近" as const,
      impactStatus: assessment.status,
      impactLabel: assessment.label,
      estimatedAt: noImpactTiming ? null : timedPathEntry?.estimatedAt ?? nearest?.point.time ?? null,
      stormWindSpeedMs: noImpactTiming ? null : timedPathEntry?.windSpeedMs ?? nearest?.point.wind ?? null,
      stormWindForceLevel: noImpactTiming
        ? "--"
        : timedPathEntry?.windForceLevel ?? (nearest?.point.wind ? windForceFromSpeed(nearest.point.wind) : "--"),
      closestApproachKm,
      agencySupport: timedPathEntry?.agencySupport ?? agencySupport,
      agencyTotal: timedPathEntry?.agencyTotal ?? agencyTotal,
      displayDurationMs: FAST_PROVINCE_BRIEFINGS.has(province.shortName) ? 1500 as const : 2500 as const,
      currentConditions: currentConditions.get(province.shortName)
        ?? buildProvinceCurrentConditions(province.shortName, storm, fallbackWindField(new Date().toISOString()))
    };
  });
  return briefings.sort((left, right) => {
    const leftPriority = left.headlineLabel === "路径入省推演" ? -1 : left.closestApproachKm ?? Number.POSITIVE_INFINITY;
    const rightPriority = right.headlineLabel === "路径入省推演" ? -1 : right.closestApproachKm ?? Number.POSITIVE_INFINITY;
    return leftPriority - rightPriority;
  });
}

function closestForecastPoint(points: Storm["forecast"], province: string, center: [number, number]) {
  if (points.length === 0) return null;
  const boundary = getProvinceBoundaryCoordinates(province);
  const targets = boundary.length ? boundary : [{ lon: center[0], lat: center[1] }];
  const pathDistance = Math.round(Math.min(...targets.map((target) => distanceToPathKm(target, points) ?? Number.POSITIVE_INFINITY)));
  const nearest = points.reduce<{ point: Storm["forecast"][number]; distanceKm: number } | null>((best, point) => {
    const distanceKm = Math.round(Math.min(...targets.map((target) => distanceBetweenKm(point, target))));
    return !best || distanceKm < best.distanceKm ? { point, distanceKm } : best;
  }, null);
  return nearest ? { ...nearest, distanceKm: Math.min(nearest.distanceKm, pathDistance) } : null;
}

function provinceImpactAssessment(distanceKm: number | null, windRadiusKm: number) {
  if (distanceKm === null) return { status: "unavailable" as const, label: "路径时次不可用" };
  if (distanceKm <= Math.max(windRadiusKm, 260)) {
    return { status: "direct" as const, label: "可能进入七级风圈" };
  }
  if (distanceKm <= Math.max(windRadiusKm * 1.8, 520)) {
    return { status: "direct" as const, label: "可能受外围风雨影响" };
  }
  if (distanceKm <= 900) return { status: "watch" as const, label: "需要留意路径变化" };
  return { status: "unaffected" as const, label: "当前已载入预报时段未显示直接影响" };
}

function averageWindDirection(points: WindFieldPayload["points"]) {
  if (points.length === 0) return null;
  const meanU = points.reduce((total, point) => total + point.u, 0) / points.length;
  const meanV = points.reduce((total, point) => total + point.v, 0) / points.length;
  const degrees = (Math.atan2(-meanU, -meanV) * 180 / Math.PI + 360) % 360;
  const labels = ["北风", "东北风", "东风", "东南风", "南风", "西南风", "西风", "西北风"];
  return labels[Math.round(degrees / 45) % labels.length];
}

function interpolateWindAt(windField: WindFieldPayload, target: { lon: number; lat: number }) {
  const nearest = windField.points
    .map((point) => ({ point, distance: distanceBetweenKm(point, target) }))
    .sort((left, right) => left.distance - right.distance)
    .slice(0, 6);
  if (nearest.length === 0 || nearest[0].distance > 1_000) return null;
  let weightTotal = 0;
  let u = 0;
  let v = 0;
  for (const item of nearest) {
    const weight = 1 / Math.max(25, item.distance) ** 2;
    weightTotal += weight;
    u += item.point.u * weight;
    v += item.point.v * weight;
  }
  if (weightTotal <= 0) return null;
  u /= weightTotal;
  v /= weightTotal;
  return { lon: target.lon, lat: target.lat, u, v, speed: Math.hypot(u, v), direction: 0 };
}

function isWindSample(point: WindFieldPayload["points"][number] | null): point is WindFieldPayload["points"][number] {
  return point !== null;
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

function derivedScopeKey(activeStormId: string | null) {
  return activeStormId ?? "no-storms";
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
