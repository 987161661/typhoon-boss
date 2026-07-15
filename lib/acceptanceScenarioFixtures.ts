import type { CityBriefing } from "@/lib/cityBriefingData";
import type { RadarSnapshot } from "@/lib/radarSnapshot";
import type {
  NationalSituationSnapshot,
  NationalWeatherEvent,
  SourceHealth,
  WeatherEventLevel
} from "@/lib/nationalWeatherTypes";
import type { Storm } from "@/lib/types";
import type { AcceptanceScenario } from "@/lib/acceptanceScenario";

const GENERATED_AT = "2026-07-15T08:00:00.000Z";
const PREVIOUS_SUCCESS_AT = "2026-07-15T07:55:00.000Z";

export function createAcceptanceStorms(scenario: AcceptanceScenario): Storm[] {
  if (scenario === "no-storm" || scenario === "official-red" || scenario === "ordinary-city" || scenario === "source-failure") return [];
  const first = createStorm({
    id: "acceptance-typhoon-01",
    nameZh: "验收一号",
    nameEn: "ACCEPTANCE ONE",
    lon: 124.2,
    lat: 22.4,
    movement: "西北",
    trackOffset: 0
  });
  if (scenario === "single-storm") return [first];
  return [
    first,
    createStorm({
      id: "acceptance-typhoon-02",
      nameZh: "验收二号",
      nameEn: "ACCEPTANCE TWO",
      lon: 137.5,
      lat: 18.7,
      movement: "东北",
      trackOffset: 1.8
    })
  ];
}

export function createAcceptanceNationalSituation(scenario: AcceptanceScenario): NationalSituationSnapshot {
  const storms = createAcceptanceStorms(scenario);
  const warningLevel: WeatherEventLevel | null = scenario === "official-red" || scenario === "source-failure" ? "red" : null;
  const retainedFailure = scenario === "source-failure";
  const events: NationalWeatherEvent[] = [
    ...storms.map((storm) => createTyphoonEvent(storm)),
    ...(warningLevel ? [createOfficialWarningEvent(warningLevel, retainedFailure)] : [])
  ];

  return {
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    sourceHealth: createSourceHealth(retainedFailure),
    events,
    warnings: {
      total: warningLevel ? 1 : 0,
      byLevel: { red: warningLevel === "red" ? 1 : 0, orange: 0, yellow: 0, blue: 0 },
      highestLevel: warningLevel,
      updatedAt: warningLevel ? PREVIOUS_SUCCESS_AT : GENERATED_AT,
      sourceId: "china-weather-alert"
    },
    radar: {
      sourceId: "china-radar-mosaic",
      status: retainedFailure ? "delayed" : "fresh",
      updatedAt: retainedFailure ? PREVIOUS_SUCCESS_AT : GENERATED_AT,
      georeferenced: false,
      frames: [],
      limitations: retainedFailure ? ["验收夹具：雷达来源失败，保留最近成功快照。"] : ["验收夹具不提供雷达影像。"]
    },
    satellite: {
      sourceId: "himawari-satellite",
      status: "fresh",
      updatedAt: GENERATED_AT,
      georeferenced: false,
      frames: [],
      limitations: ["验收夹具不提供卫星影像。"]
    },
    products: [],
    storms,
    cityRankSnapshot: null
  };
}

export function createAcceptanceRadarSnapshot(scenario: AcceptanceScenario): RadarSnapshot {
  const storms = createAcceptanceStorms(scenario);
  const retainedFailure = scenario === "source-failure";
  const activeStormId = storms[0]?.id ?? null;
  const emptyFeatureCollection: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
  return {
    source: "Weather Boss Radar acceptance fixture",
    updatedAt: GENERATED_AT,
    observedAt: retainedFailure ? PREVIOUS_SUCCESS_AT : GENERATED_AT,
    fetchedAt: GENERATED_AT,
    status: retainedFailure ? "stale" : "fresh",
    activeStormId,
    storms,
    lastTrackedStorm: null,
    bosses: [],
    environment: {
      satellite: {
        source: "acceptance-fixture",
        updatedAt: GENERATED_AT,
        status: "unavailable",
        attribution: "Deterministic acceptance fixture",
        reason: "验收夹具不加载外部卫星影像。",
        imageUrl: null,
        product: "acceptance-none",
        isStale: retainedFailure,
        bounds: { west: 73, south: 3, east: 136, north: 54 }
      },
      windField: {
        source: "acceptance-fixture",
        updatedAt: retainedFailure ? PREVIOUS_SUCCESS_AT : GENERATED_AT,
        status: "unavailable",
        attribution: "Deterministic acceptance fixture",
        reason: retainedFailure ? "验收夹具：风场来源失败，保留最近成功台风快照。" : "验收夹具不加载外部风场。",
        stormId: activeStormId,
        model: "acceptance-none",
        unit: "m/s",
        points: [],
        isStale: retainedFailure
      },
      windCenters: Object.fromEntries(storms.map((storm) => [storm.id, {
        stormId: storm.id,
        status: "available" as const,
        source: "acceptance-fixture",
        updatedAt: GENERATED_AT,
        analysisCenter: {
          lon: storm.position.lon,
          lat: storm.position.lat,
          method: "peak-cyclonic-vorticity" as const,
          confidence: "high" as const,
          referenceAt: GENERATED_AT,
          referenceMethod: "current-position" as const,
          referencePosition: { lon: storm.position.lon, lat: storm.position.lat },
          offsetKm: 0,
          vorticityPerSecond: 0.001,
          circulationMs: 24,
          circulationBalance: 1
        }
      }])),
      impactArea: {
        source: "acceptance-fixture",
        updatedAt: GENERATED_AT,
        status: "available",
        attribution: "Deterministic acceptance fixture",
        stormId: activeStormId,
        stormName: storms[0]?.nameZh ?? null,
        featureCount: 0,
        areas: emptyFeatureCollection
      }
    },
    warnings: retainedFailure ? ["验收夹具：上游来源失败；继续显示最近成功快照，不能据此表述为无风险。"] : [],
    cache: {
      stormUpdatedAt: storms[0]?.updatedAt ?? null,
      derivedGeneratedAt: retainedFailure ? PREVIOUS_SUCCESS_AT : GENERATED_AT,
      derivedExpiresAt: GENERATED_AT,
      stale: retainedFailure
    }
  };
}

export function createOrdinaryCityBriefing(): CityBriefing {
  return {
    city: {
      name: "合肥",
      province: "安徽",
      country: "中国",
      latitude: 31.82,
      longitude: 117.23,
      timezone: "Asia/Shanghai",
      locationId: "101220101",
      cityCode: "340100",
      cityAttribution: "deterministic"
    },
    generatedAt: GENERATED_AT,
    status: "available",
    headline: "未来 6 小时未见突出风雨信号，仍请留意属地预警变化。",
    current: {
      sourceId: "qweather-now",
      evidenceLevel: "observed",
      observedAt: GENERATED_AT,
      temperatureC: 27,
      apparentTemperatureC: 29,
      relativeHumidityPct: 66,
      precipitationMm: 0,
      windSpeedMps: 2.4,
      windGustMps: null,
      weatherCode: null
    },
    nextSixHours: {
      sourceId: "qweather-hourly",
      startsAt: GENERATED_AT,
      endsAt: "2026-07-15T14:00:00.000Z",
      precipitationMm: 0.4,
      maxHourlyPrecipitationMm: 0.2,
      maxPrecipitationProbabilityPct: 20,
      maxWindGustMps: 5,
      maxCapeJkg: 180
    },
    minutelyRain: {
      available: true,
      updatedAt: GENERATED_AT,
      summary: "短临资料未显示明显降水增强。",
      maxFiveMinutePrecipitationMm: 0,
      precipitationNextTwoHoursMm: 0
    },
    comparison: null,
    officialWarnings: [],
    risks: [
      { kind: "rain", level: "low", label: "降雨", summary: "短时降雨信号较弱。", evidenceLevel: "model", sourceIds: ["qweather-hourly"] },
      { kind: "wind", level: "low", label: "阵风", summary: "近地风速普通。", evidenceLevel: "model", sourceIds: ["qweather-hourly"] },
      { kind: "convection", level: "low", label: "对流条件", summary: "当前模式未显示突出强对流条件。", evidenceLevel: "model", sourceIds: ["qweather-hourly"] },
      { kind: "heat", level: "low", label: "高温体感", summary: "当前体感温度未达突出等级。", evidenceLevel: "observed", sourceIds: ["qweather-now"] }
    ],
    narrative: {
      engine: "template",
      stage: "ordinary_weather",
      template: "calm",
      primaryKind: "calm",
      timeWindow: { startsAt: GENERATED_AT, endsAt: "2026-07-15T14:00:00.000Z" },
      summary: "合肥当前是普通天气观察，不升级为灾害叙事。",
      actions: ["按日常节奏出行", "继续关注属地气象台后续更新"],
      caveat: "没有预警记录不等于未来始终无风险。",
      factRefs: ["qweather-now", "qweather-hourly"]
    },
    sources: [
      { id: "qweather-now", label: "和风天气实况", evidenceLevel: "observed", updatedAt: GENERATED_AT, status: "available", limitation: "单站近实时资料。" },
      { id: "qweather-hourly", label: "和风天气逐小时", evidenceLevel: "model", updatedAt: GENERATED_AT, status: "available", limitation: "预报资料不是已发生事实。" },
      { id: "qweather-warning", label: "和风天气官方预警", evidenceLevel: "confirmed", updatedAt: GENERATED_AT, status: "available", limitation: "当前没有匹配预警记录。" }
    ],
    warnings: []
  };
}

function createStorm(input: {
  id: string;
  nameZh: string;
  nameEn: string;
  lon: number;
  lat: number;
  movement: string;
  trackOffset: number;
}): Storm {
  const point = (hours: number, lon: number, lat: number, wind: number, pressure: number) => ({
    time: new Date(Date.parse(GENERATED_AT) + hours * 60 * 60 * 1000).toISOString(),
    lon,
    lat,
    wind,
    pressure
  });
  const quadrants = { ne: 220, se: 180, sw: 160, nw: 200, max: 220 };
  return {
    id: input.id,
    code: input.id.endsWith("01") ? "2601" : "2602",
    nameZh: input.nameZh,
    nameEn: input.nameEn,
    stage: "台风",
    rating: "龙级",
    status: "验收夹具 · 活动",
    position: { lon: input.lon, lat: input.lat },
    maxWind: 38,
    minPressure: 965,
    moveDirection: input.movement,
    moveSpeed: 18,
    updatedAt: GENERATED_AT,
    windRadiiKm: {
      r7: 220,
      r10: 110,
      r12: 55,
      quadrants: { r7: quadrants, r10: { ne: 110, se: 90, sw: 80, nw: 100, max: 110 }, r12: { ne: 55, se: 45, sw: 40, nw: 50, max: 55 } }
    },
    track: [
      point(-6, input.lon - 1.6, input.lat - 0.8 + input.trackOffset, 31, 980),
      point(-3, input.lon - 0.8, input.lat - 0.4 + input.trackOffset / 2, 35, 972),
      point(0, input.lon, input.lat, 38, 965)
    ],
    forecast: [
      point(6, input.lon + 1.2, input.lat + 0.8, 40, 960),
      point(12, input.lon + 2.5, input.lat + 1.5, 37, 970)
    ],
    forecastScenarios: [{
      id: `${input.id}-cma`,
      agency: "中国",
      agencyCode: "CMA",
      isPrimary: true,
      points: [point(6, input.lon + 1.2, input.lat + 0.8, 40, 960), point(12, input.lon + 2.5, input.lat + 1.5, 37, 970)]
    }],
    landfalls: [],
    skills: [{ name: "验收路径", detail: `路径数据只属于 ${input.id}。`, severity: 5 }],
    notice: "确定性验收夹具；不代表真实气象信息。"
  };
}

function createTyphoonEvent(storm: Storm): NationalWeatherEvent {
  return {
    id: `event-${storm.id}`,
    kind: "typhoon",
    hazard: "typhoon",
    title: `${storm.nameZh}活动台风`,
    level: "blue",
    evidenceLevel: "official",
    issuedAt: GENERATED_AT,
    dataTime: GENERATED_AT,
    updatedAt: GENERATED_AT,
    expiresAt: null,
    geography: {
      scope: "storm-track",
      locationIds: [],
      provinceCode: null,
      cityCode: null,
      countyCode: null,
      names: [storm.nameZh],
      centroid: { longitude: storm.position.lon, latitude: storm.position.lat },
      cityAttribution: "not-applicable"
    },
    sourceIds: ["zhejiang-typhoon"],
    factSummary: `${storm.nameZh}处于验收路径清单。`,
    limitations: ["确定性验收夹具，不代表真实气象信息。"]
  };
}

function createOfficialWarningEvent(level: WeatherEventLevel, retained: boolean): NationalWeatherEvent {
  return {
    id: "acceptance-official-red-hefei",
    kind: "official-warning",
    hazard: "rain",
    title: "合肥市暴雨红色预警验收记录",
    level,
    evidenceLevel: "official",
    issuedAt: PREVIOUS_SUCCESS_AT,
    dataTime: PREVIOUS_SUCCESS_AT,
    updatedAt: PREVIOUS_SUCCESS_AT,
    expiresAt: "2026-07-15T10:00:00.000Z",
    geography: {
      scope: "city",
      locationIds: ["101220101"],
      provinceCode: "340000",
      cityCode: "340100",
      countyCode: null,
      names: ["安徽", "合肥"],
      centroid: { longitude: 117.23, latitude: 31.82 },
      cityAttribution: "deterministic"
    },
    sourceIds: ["china-weather-alert"],
    factSummary: retained ? "来源刷新失败；此红色预警为最近成功快照中的保留记录。" : "官方红色预警验收记录。",
    limitations: ["确定性验收夹具，不代表真实气象信息。"]
  };
}

function createSourceHealth(retainedFailure: boolean): SourceHealth[] {
  return [
    {
      sourceId: "china-weather-alert",
      label: "国家突发事件预警信息",
      status: retainedFailure ? "delayed" : "fresh",
      updatedAt: PREVIOUS_SUCCESS_AT,
      lastSuccessfulAt: PREVIOUS_SUCCESS_AT,
      refreshIntervalMinutes: 5,
      error: retainedFailure ? "验收夹具：上游 HTTP 503，保留最近成功快照。" : null,
      limitations: retainedFailure ? ["来源失败不等于无预警或无风险。"] : []
    },
    {
      sourceId: "zhejiang-typhoon",
      label: "台风路径公开资料",
      status: "fresh",
      updatedAt: GENERATED_AT,
      lastSuccessfulAt: GENERATED_AT,
      refreshIntervalMinutes: 5,
      error: null,
      limitations: []
    },
    {
      sourceId: "acceptance-fixture",
      label: "确定性验收夹具",
      status: "fresh",
      updatedAt: GENERATED_AT,
      lastSuccessfulAt: GENERATED_AT,
      refreshIntervalMinutes: 0,
      error: null,
      limitations: ["仅在显式验收开关下启用，不代表实时天气。"]
    }
  ];
}
