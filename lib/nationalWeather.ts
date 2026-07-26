import {
  canEnterCitySituation,
  resolveAdministrativeWarningIdentity,
  type AdministrativeHierarchy
} from "@/lib/administrativeMapping";
import type { ChinaWeatherProductSnapshot } from "@/lib/chinaWeatherProductFeed";
import type { ChinaWeatherVisualSnapshot } from "@/lib/chinaWeatherVisualFeed";
import type { ChinaWeatherWarning, ChinaWeatherWarningSnapshot } from "@/lib/chinaWeatherWarningFeed";
import type {
  CityRankSnapshotSummary,
  NationalSituationSnapshot,
  NationalWeatherEvent,
  OfficialProductSummary,
  SourceFreshness,
  SourceHealth,
  VisualLayerSummary,
  WeatherEvidenceLevel,
  WeatherEventLevel,
  WeatherHazard
} from "@/lib/nationalWeatherTypes";
import type { TrackSnapshot } from "@/lib/realTyphoonData";
import type { Storm } from "@/lib/types";

export const NATIONAL_SOURCE_IDS = {
  warnings: "china-weather-national-warnings",
  radar: "china-weather-national-radar-index",
  satellite: "china-weather-satellite-index",
  products: "china-weather-product-directory",
  storms: "zhejiang-water-typhoon-track",
  administrative: "qweather-administrative-hierarchy"
} as const;

const WARNING_REFRESH_MINUTES = 5;
const VISUAL_REFRESH_MINUTES = 5;
const PRODUCT_REFRESH_MINUTES = 30;
const TRACK_REFRESH_MINUTES = 10;
const ADMINISTRATIVE_REFRESH_MINUTES = 30 * 24 * 60;

export interface FreshnessInput {
  now: string | number | Date;
  refreshIntervalMinutes: number;
  lastSuccessfulAt: string | null;
  hasRecords: boolean;
  available: boolean;
  error?: string | null;
}

export interface NationalSituationInputs {
  warnings: ChinaWeatherWarningSnapshot | null;
  visuals: ChinaWeatherVisualSnapshot | null;
  products: ChinaWeatherProductSnapshot | null;
  track: TrackSnapshot;
  administrativeHierarchy: AdministrativeHierarchy | null;
  administrativeHierarchyError: string | null;
  cityRankSnapshot?: CityRankSnapshotSummary | null;
}

/**
 * A successful empty response is no-record. A failed source without a last
 * success is unavailable. Cached records survive failures and age through
 * delayed to expired; failure never means "no risk".
 */
export function evaluateSourceFreshness(input: FreshnessInput): SourceFreshness {
  if (input.available && !input.hasRecords) return "no-record";
  const successAt = parseTime(input.lastSuccessfulAt);
  if (successAt === null) return "unavailable";

  const now = parseNow(input.now);
  const intervalMs = Math.max(1, input.refreshIntervalMinutes) * 60_000;
  const age = Math.max(0, now - successAt);
  let status: SourceFreshness = age <= intervalMs * 2
    ? "fresh"
    : age <= intervalMs * 6
      ? "delayed"
      : "expired";
  if ((!input.available || input.error) && status === "fresh") status = "delayed";
  return status;
}

export function evidenceLevelForEventKind(kind: NationalWeatherEvent["kind"]): WeatherEvidenceLevel {
  switch (kind) {
    case "official-warning":
    case "official-risk":
    case "typhoon":
      return "official";
    case "radar-watch":
      return "metadata";
    case "model-watch":
      return "model";
  }
}

export function isEvidenceLevelAllowed(event: Pick<NationalWeatherEvent, "kind" | "evidenceLevel">) {
  if (event.kind === "radar-watch") return event.evidenceLevel === "metadata" || event.evidenceLevel === "observed";
  return event.evidenceLevel === evidenceLevelForEventKind(event.kind);
}

/** Pure comparator implementing the frozen official-first event contract. */
export function compareNationalWeatherEvents(a: NationalWeatherEvent, b: NationalWeatherEvent) {
  const priorityDelta = eventPriority(b) - eventPriority(a);
  if (priorityDelta) return priorityDelta;
  const issuedDelta = eventTime(b) - eventTime(a);
  if (issuedDelta) return issuedDelta;
  const extentDelta = geographyExtent(b) - geographyExtent(a);
  if (extentDelta) return extentDelta;
  const freshnessDelta = timeValue(b.updatedAt) - timeValue(a.updatedAt);
  if (freshnessDelta) return freshnessDelta;
  return a.id.localeCompare(b.id);
}

export function sortNationalWeatherEvents(events: readonly NationalWeatherEvent[]) {
  return [...events].sort(compareNationalWeatherEvents);
}

export function buildNationalSituationSnapshot(
  inputs: NationalSituationInputs,
  now: string | number | Date = new Date()
): NationalSituationSnapshot {
  const generatedAt = new Date(parseNow(now)).toISOString();
  const warningEvents = inputs.warnings?.warnings.flatMap((warning) => warningEvent(
    warning,
    inputs.warnings!.fetchedAt,
    inputs.administrativeHierarchy
  )) ?? [];
  const stormEvents = inputs.track.storms.map(stormEvent);
  const radar = visualLayer(inputs.visuals, "radar", now);
  const satellite = visualLayer(inputs.visuals, "satellite", now);
  const radarEvents = radar.frames.length > 0 ? [radarMetadataEvent(radar, generatedAt)] : [];
  const products = productSummaries(inputs.products, now);
  const sourceHealth = buildSourceHealth(inputs, now);

  const warningCounts = warningEvents.reduce(
    (counts, event) => event.level === "watch" ? counts : { ...counts, [event.level]: counts[event.level] + 1 },
    { red: 0, orange: 0, yellow: 0, blue: 0 }
  );
  const highestLevel = (["red", "orange", "yellow", "blue"] as const).find((level) => warningCounts[level] > 0) ?? null;

  return {
    schemaVersion: 1,
    generatedAt,
    sourceHealth,
    events: sortNationalWeatherEvents([...warningEvents, ...stormEvents, ...radarEvents]),
    warnings: {
      total: warningEvents.length,
      byLevel: warningCounts,
      highestLevel,
      updatedAt: inputs.warnings?.fetchedAt ?? null,
      sourceId: NATIONAL_SOURCE_IDS.warnings
    },
    radar,
    satellite,
    products,
    // Never project or rebuild Storm: consumers receive the track contract intact.
    storms: inputs.track.storms,
    cityRankSnapshot: inputs.cityRankSnapshot ?? null
  };
}

export function retainLastValidSources(
  current: NationalSituationSnapshot,
  previous: NationalSituationSnapshot,
  now: string | number | Date
): NationalSituationSnapshot {
  let events = current.events;
  let warnings = current.warnings;
  let radar = current.radar;
  let satellite = current.satellite;
  let products = current.products;
  let storms = current.storms;

  const sourceHealth = current.sourceHealth.map((health) => {
    if (health.status !== "unavailable") return health;
    const previousHealth = previous.sourceHealth.find((item) => item.sourceId === health.sourceId);
    if (!previousHealth?.lastSuccessfulAt) return health;
    const retainedStatus = evaluateSourceFreshness({
      now,
      refreshIntervalMinutes: health.refreshIntervalMinutes,
      lastSuccessfulAt: previousHealth.lastSuccessfulAt,
      hasRecords: true,
      available: false,
      error: health.error
    });
    return {
      ...health,
      status: retainedStatus,
      updatedAt: previousHealth.updatedAt,
      lastSuccessfulAt: previousHealth.lastSuccessfulAt,
      limitations: [...health.limitations, "当前读取失败，继续保留统一快照中的最近有效数据。"]
    };
  });

  if (isRetained(current, sourceHealth, NATIONAL_SOURCE_IDS.warnings)) {
    events = replaceEvents(events, previous.events, "official-warning");
    warnings = previous.warnings;
  }
  if (isRetained(current, sourceHealth, NATIONAL_SOURCE_IDS.radar)) {
    events = replaceEvents(events, previous.events, "radar-watch");
    radar = retainedLayer(previous.radar, sourceHealth, NATIONAL_SOURCE_IDS.radar);
  }
  if (isRetained(current, sourceHealth, NATIONAL_SOURCE_IDS.satellite)) {
    satellite = retainedLayer(previous.satellite, sourceHealth, NATIONAL_SOURCE_IDS.satellite);
  }
  if (isRetained(current, sourceHealth, NATIONAL_SOURCE_IDS.products)) {
    products = previous.products.map((product) => ({ ...product, status: retainedProductStatus(product, now) }));
  } else {
    const priorById = new Map(previous.products.map((product) => [product.id, product]));
    products = products.map((product) => product.status === "unavailable" && priorById.has(product.id)
      ? { ...priorById.get(product.id)!, status: retainedProductStatus(priorById.get(product.id)!, now) }
      : product);
  }
  if (isRetained(current, sourceHealth, NATIONAL_SOURCE_IDS.storms)) {
    events = replaceEvents(events, previous.events, "typhoon");
    storms = previous.storms;
  }
  if (isRetained(current, sourceHealth, NATIONAL_SOURCE_IDS.administrative)) {
    const previousWarnings = new Map(previous.events.filter((event) => event.kind === "official-warning").map((event) => [event.id, event]));
    events = events.map((event) => {
      const prior = event.kind === "official-warning" ? previousWarnings.get(event.id) : null;
      if (!prior || prior.geography.cityAttribution !== "deterministic") return event;
      return {
        ...event,
        geography: prior.geography,
        limitations: [...event.limitations, "行政层级当前不可用，沿用上一统一快照中同一预警的确定归属。"]
      };
    });
  }

  return { ...current, sourceHealth, events: sortNationalWeatherEvents(events), warnings, radar, satellite, products, storms };
}

function buildSourceHealth(inputs: NationalSituationInputs, now: string | number | Date): SourceHealth[] {
  const warningAvailable = inputs.warnings !== null;
  const radarAvailable = inputs.visuals?.radar.status === "available";
  const satelliteAvailable = inputs.visuals?.satellite.status === "available";
  const availableProducts = inputs.products?.products.filter((product) => product.status === "available") ?? [];
  const trackAvailable = inputs.track.status !== "unavailable";
  return [
    sourceHealth({
      sourceId: NATIONAL_SOURCE_IDS.warnings,
      label: "中国天气全国预警",
      updatedAt: inputs.warnings?.fetchedAt ?? null,
      lastSuccessfulAt: warningAvailable ? inputs.warnings!.fetchedAt : null,
      refreshIntervalMinutes: WARNING_REFRESH_MINUTES,
      available: warningAvailable,
      hasRecords: Boolean(inputs.warnings?.warnings.length),
      error: warningAvailable ? null : "全国预警最近有效快照不可用",
      limitations: ["预警详情以发布机构原文为准；未确定行政父级的预警不进入城市战况。"],
      now
    }),
    sourceHealth({
      sourceId: NATIONAL_SOURCE_IDS.radar,
      label: "中国天气全国雷达图像索引",
      updatedAt: inputs.visuals?.fetchedAt ?? null,
      lastSuccessfulAt: radarAvailable ? inputs.visuals!.fetchedAt : null,
      refreshIntervalMinutes: VISUAL_REFRESH_MINUTES,
      available: radarAvailable,
      hasRecords: Boolean(inputs.visuals?.radar.frames.length),
      error: inputs.visuals?.radar.error ?? (inputs.visuals ? null : "全国雷达最近有效快照不可用"),
      limitations: ["图像索引仅证明帧及其元数据可用，未解码回波强度和灾害事实。"],
      now
    }),
    sourceHealth({
      sourceId: NATIONAL_SOURCE_IDS.satellite,
      label: "中国天气卫星图像索引",
      updatedAt: inputs.visuals?.fetchedAt ?? null,
      lastSuccessfulAt: satelliteAvailable ? inputs.visuals!.fetchedAt : null,
      refreshIntervalMinutes: VISUAL_REFRESH_MINUTES,
      available: satelliteAvailable,
      hasRecords: Boolean(inputs.visuals?.satellite.frames.length),
      error: inputs.visuals?.satellite.error ?? (inputs.visuals ? null : "卫星索引最近有效快照不可用"),
      limitations: ["稳定图像地址和地理标定尚未同时验证，禁止作为地图叠加层或数值事实。"],
      now
    }),
    sourceHealth({
      sourceId: NATIONAL_SOURCE_IDS.products,
      label: "中国天气专业产品目录",
      updatedAt: inputs.products?.fetchedAt ?? null,
      lastSuccessfulAt: availableProducts.length > 0 ? inputs.products!.fetchedAt : null,
      refreshIntervalMinutes: inputs.products?.refreshIntervalMinutes ?? PRODUCT_REFRESH_MINUTES,
      available: availableProducts.length > 0,
      hasRecords: availableProducts.some((product) => product.frames.length > 0),
      error: productErrors(inputs.products),
      limitations: ["目录与文件时次仅作 metadata，不转写为降水量、风险等级或灾害结论。"],
      now
    }),
    sourceHealth({
      sourceId: NATIONAL_SOURCE_IDS.storms,
      label: "浙江省水利厅台风路径公开数据",
      updatedAt: inputs.track.fetchedAt,
      lastSuccessfulAt: trackAvailable ? inputs.track.fetchedAt : null,
      refreshIntervalMinutes: TRACK_REFRESH_MINUTES,
      available: trackAvailable,
      // An empty, successfully fetched active-storm list is a valid no-record state.
      hasRecords: inputs.track.storms.length > 0,
      error: inputs.track.warnings.join("；") || null,
      limitations: ["无活动台风仅表示当前路径源无活动记录，不表示全国无气象风险。"],
      now
    }),
    sourceHealth({
      sourceId: NATIONAL_SOURCE_IDS.administrative,
      label: "QWeather 行政区划层级列表",
      updatedAt: inputs.administrativeHierarchy?.fetchedAt ?? null,
      lastSuccessfulAt: inputs.administrativeHierarchy?.fetchedAt ?? null,
      refreshIntervalMinutes: ADMINISTRATIVE_REFRESH_MINUTES,
      available: inputs.administrativeHierarchy !== null,
      hasRecords: Boolean(inputs.administrativeHierarchy?.rows.length),
      error: inputs.administrativeHierarchyError ?? inputs.administrativeHierarchy?.error ?? (inputs.administrativeHierarchy ? null : "行政层级最近有效快照不可用"),
      limitations: ["仅精确 Location_ID 且 Adm2 行政根唯一时归入城市；缺失或冲突记录保持 ambiguous。"],
      now
    })
  ];
}

function sourceHealth(input: Omit<SourceHealth, "status"> & Pick<FreshnessInput, "now" | "available" | "hasRecords">): SourceHealth {
  const { now, available, hasRecords, ...health } = input;
  return {
    ...health,
    status: evaluateSourceFreshness({
      now,
      refreshIntervalMinutes: health.refreshIntervalMinutes,
      lastSuccessfulAt: health.lastSuccessfulAt,
      hasRecords,
      available,
      error: health.error
    })
  };
}

function warningEvent(
  warning: ChinaWeatherWarning,
  fetchedAt: string,
  administrativeHierarchy: AdministrativeHierarchy | null
): NationalWeatherEvent[] {
  const level = warningLevel(warning.grade);
  if (!level) return [];
  const administrative = resolveAdministrativeWarningIdentity(
    warning.locationId,
    warning.issuer,
    warning.title,
    administrativeHierarchy
  );
  const cityEligible = canEnterCitySituation(administrative);
  const locationLength = warning.locationId.length;
  return [{
    id: `warning:${warning.id}`,
    kind: "official-warning",
    hazard: warningHazard(warning.typeCode),
    title: warning.title,
    level,
    evidenceLevel: "official",
    issuedAt: warning.issuedAt,
    dataTime: warning.issuedAt,
    updatedAt: fetchedAt,
    expiresAt: null,
    geography: {
      scope: locationLength === 5 ? "province" : cityEligible && administrative.countyCode === null ? "city" : "county",
      locationIds: [warning.locationId],
      provinceCode: administrative.provinceCode,
      cityCode: cityEligible ? administrative.cityCode : null,
      countyCode: cityEligible ? administrative.countyCode : null,
      names: [warning.issuer, administrative.cityName].filter((name): name is string => Boolean(name)),
      centroid: warning.longitude === null || warning.latitude === null
        ? null
        : { longitude: warning.longitude, latitude: warning.latitude },
      cityAttribution: administrative.cityAttribution
    },
    sourceIds: [NATIONAL_SOURCE_IDS.warnings],
    factSummary: warning.title,
    limitations: [
      "预警有效期和防御指引以发布机构详情原文为准。",
      ...(cityEligible ? [] : [`${administrative.reason}，该事件不进入城市战况。`])
    ]
  }];
}

function stormEvent(storm: Storm): NationalWeatherEvent {
  const pressureFact = Number.isFinite(storm.minPressure) && storm.minPressure > 0
    ? `，中心气压 ${storm.minPressure} 百帕`
    : "，中心气压未提供";
  return {
    id: `typhoon:${storm.id}`,
    kind: "typhoon",
    hazard: "typhoon",
    title: `${storm.nameZh}（${storm.nameEn}）台风路径事件`,
    level: stormLevel(storm),
    evidenceLevel: "official",
    issuedAt: null,
    dataTime: storm.updatedAt,
    updatedAt: storm.updatedAt,
    expiresAt: null,
    geography: {
      scope: "storm-track",
      locationIds: [storm.id],
      provinceCode: null,
      cityCode: null,
      countyCode: null,
      names: [storm.nameZh, storm.nameEn],
      centroid: { longitude: storm.position.lon, latitude: storm.position.lat },
      cityAttribution: "not-applicable"
    },
    sourceIds: [NATIONAL_SOURCE_IDS.storms],
    factSummary: `${storm.status}；${storm.stage}；中心风速 ${storm.maxWind} 米/秒${pressureFact}。`,
    limitations: ["台风中心、路径、预报与风圈完整沿用路径源；全国事件层不得移动或重写。"]
  };
}

function visualLayer(
  snapshot: ChinaWeatherVisualSnapshot | null,
  layer: "radar" | "satellite",
  now: string | number | Date
): VisualLayerSummary {
  const sourceId = NATIONAL_SOURCE_IDS[layer];
  const value = snapshot?.[layer] ?? null;
  const available = value?.status === "available";
  const status = evaluateSourceFreshness({
    now,
    refreshIntervalMinutes: VISUAL_REFRESH_MINUTES,
    lastSuccessfulAt: available ? snapshot!.fetchedAt : null,
    hasRecords: Boolean(value?.frames.length),
    available,
    error: value?.error ?? null
  });
  return {
    sourceId,
    status,
    updatedAt: snapshot?.fetchedAt ?? null,
    // Neither index currently carries an independently verified calibration.
    georeferenced: false,
    frames: (value?.frames ?? []).map((frame) => ({
      id: frame.filename,
      observedAt: normalizeProviderTime(frame.observedAt),
      imageUrl: layer === "satellite" ? null : frame.imageUrl
    })),
    limitations: layer === "satellite"
      ? ["当前仅接入卫星帧索引；稳定图像 URL 与地理标定未验证，georeferenced 固定为 false。"]
      : ["雷达图像与帧时次仅作 metadata；未解码回波强度，不据此宣称灾害已发生。"]
  };
}

function radarMetadataEvent(radar: VisualLayerSummary, generatedAt: string): NationalWeatherEvent {
  const latest = radar.frames[0];
  return {
    id: `radar-index:${latest.id}`,
    kind: "radar-watch",
    hazard: "other",
    title: "全国雷达图像索引已有可用帧",
    level: "watch",
    evidenceLevel: "metadata",
    issuedAt: null,
    dataTime: latest.observedAt,
    updatedAt: radar.updatedAt ?? generatedAt,
    expiresAt: null,
    geography: {
      scope: "national",
      locationIds: [],
      provinceCode: null,
      cityCode: null,
      countyCode: null,
      names: ["全国"],
      centroid: null,
      cityAttribution: "not-applicable"
    },
    sourceIds: [NATIONAL_SOURCE_IDS.radar],
    factSummary: "雷达索引提供了图像帧和时次元数据。",
    limitations: ["未解码具体回波强度；该观察事件不能作为灾害、降水量或官方预警结论。"]
  };
}

function productSummaries(snapshot: ChinaWeatherProductSnapshot | null, now: string | number | Date): OfficialProductSummary[] {
  if (!snapshot) return [];
  return snapshot.products.map((product) => {
    const productTime = normalizeProviderTime(product.frames[0]?.productTime ?? null);
    return {
      id: product.id,
      label: product.label,
      kind: product.kind,
      status: evaluateSourceFreshness({
        now,
        refreshIntervalMinutes: snapshot.refreshIntervalMinutes,
        lastSuccessfulAt: product.status === "available" ? productTime ?? snapshot.fetchedAt : null,
        hasRecords: product.frames.length > 0,
        available: product.status === "available",
        error: product.error ?? null
      }),
      productTime,
      evidenceLevel: "metadata",
      limitations: ["产品目录、文件名和产品时次仅作 metadata；未读取产品内容，不生成数值事实或风险结论。"]
    };
  });
}

function eventPriority(event: NationalWeatherEvent) {
  // These are mutually exclusive product categories, not additive severity
  // scores: a typhoon rating must never promote it above official risk, while
  // a blue warning remains below an active typhoon impact event.
  if (event.kind === "official-warning" && event.level === "red") return 700;
  if (event.kind === "official-warning" && event.level === "orange") return 600;
  if (event.kind === "official-risk") return 500;
  if (event.kind === "official-warning" && event.level === "yellow" && hasOfficialRiskSupport(event)) return 500;
  if (event.kind === "typhoon") return 400;
  if (event.kind === "official-warning" && event.level === "yellow") return 350;
  if (event.kind === "official-warning" && event.level === "blue") return 300;
  if (event.kind === "radar-watch") return 100;
  return 90;
}

function hasOfficialRiskSupport(event: NationalWeatherEvent) {
  return event.sourceIds.some((sourceId) => sourceId === NATIONAL_SOURCE_IDS.products || sourceId.startsWith("official-risk:"));
}

function eventTime(event: NationalWeatherEvent) {
  return timeValue(event.issuedAt ?? event.dataTime ?? event.updatedAt);
}

function geographyExtent(event: NationalWeatherEvent) {
  const scopeWeight: Record<NationalWeatherEvent["geography"]["scope"], number> = {
    national: 6,
    province: 5,
    "storm-track": 4,
    city: 3,
    county: 2,
    point: 1
  };
  return scopeWeight[event.geography.scope] * 1_000 + event.geography.locationIds.length;
}

function warningLevel(grade: string): Exclude<WeatherEventLevel, "watch"> | null {
  return grade === "red" || grade === "orange" || grade === "yellow" || grade === "blue" ? grade : null;
}

function warningHazard(typeCode: string): WeatherHazard {
  if (typeCode === "01") return "typhoon";
  if (typeCode === "02") return "rain";
  if (["05", "52"].includes(typeCode)) return "wind";
  if (typeCode === "06") return "dust";
  if (typeCode === "07") return "heat";
  if (["09", "10", "59"].includes(typeCode)) return "convection";
  if (["12", "13"].includes(typeCode)) return "visibility";
  return "other";
}

function stormLevel(storm: Storm): Exclude<WeatherEventLevel, "watch"> {
  if (storm.rating === "神级" || storm.rating === "龙级") return "red";
  if (storm.rating === "鬼级") return "orange";
  if (storm.rating === "虎级") return "yellow";
  return "blue";
}

function normalizeProviderTime(value: string | null) {
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?$/.test(value)
    ? `${value.replace(" ", "T")}${value.length === 16 ? ":00" : ""}+08:00`
    : value;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function parseNow(value: string | number | Date) {
  const parsed = value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("Invalid reference time");
  return parsed;
}

function parseTime(value: string | null) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function timeValue(value: string | null) {
  return parseTime(value) ?? 0;
}

function productErrors(snapshot: ChinaWeatherProductSnapshot | null) {
  if (!snapshot) return "专业产品目录最近有效快照不可用";
  const failed = snapshot.products.filter((product) => product.status === "unavailable");
  if (!failed.length) return null;
  return `${failed.length} 个产品目录读取失败：${failed.slice(0, 3).map((product) => `${product.id} ${product.error ?? "unknown"}`).join("；")}`;
}

function isRetained(current: NationalSituationSnapshot, mergedHealth: SourceHealth[], sourceId: string) {
  const before = current.sourceHealth.find((health) => health.sourceId === sourceId);
  const after = mergedHealth.find((health) => health.sourceId === sourceId);
  return before?.status === "unavailable" && after?.status !== "unavailable";
}

function replaceEvents(
  current: NationalWeatherEvent[],
  previous: NationalWeatherEvent[],
  kind: NationalWeatherEvent["kind"]
) {
  return [...current.filter((event) => event.kind !== kind), ...previous.filter((event) => event.kind === kind)];
}

function retainedLayer(layer: VisualLayerSummary, health: SourceHealth[], sourceId: string): VisualLayerSummary {
  return { ...layer, status: health.find((item) => item.sourceId === sourceId)?.status ?? "expired" };
}

function retainedProductStatus(product: OfficialProductSummary, now: string | number | Date) {
  return evaluateSourceFreshness({
    now,
    refreshIntervalMinutes: PRODUCT_REFRESH_MINUTES,
    lastSuccessfulAt: product.productTime,
    hasRecords: product.productTime !== null,
    available: false,
    error: "当前产品目录读取失败"
  });
}
