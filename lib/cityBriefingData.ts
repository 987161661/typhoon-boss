/**
 * City-scale evidence bundle for the live-room city card.
 *
 * All values remain labelled by their source and evidence level. This module
 * deliberately emits risk levels, never an uncalibrated event probability.
 */

export type CityRiskLevel = "low" | "moderate" | "high" | "severe" | "unavailable";
export type CityEvidenceLevel = "confirmed" | "observed" | "model" | "unavailable";

export interface CityBriefingSource {
  id: "open-meteo" | "qweather-now" | "qweather-hourly" | "qweather-minutely" | "qweather-warning";
  label: string;
  evidenceLevel: CityEvidenceLevel;
  updatedAt: string | null;
  status: "available" | "not-configured" | "unavailable";
  limitation: string;
}

export interface CityRisk {
  kind: "rain" | "wind" | "convection";
  level: CityRiskLevel;
  label: string;
  summary: string;
  evidenceLevel: CityEvidenceLevel;
  sourceIds: CityBriefingSource["id"][];
}

export interface CityBriefingNarrative {
  engine: "template";
  summary: string;
  actions: string[];
}

export interface CityBriefing {
  city: {
    name: string;
    province: string | null;
    country: string | null;
    latitude: number;
    longitude: number;
    timezone: string;
  };
  generatedAt: string;
  status: "available" | "degraded" | "unavailable";
  headline: string;
  current: {
    sourceId: "open-meteo" | "qweather-now" | null;
    evidenceLevel: CityEvidenceLevel;
    observedAt: string | null;
    temperatureC: number | null;
    apparentTemperatureC: number | null;
    relativeHumidityPct: number | null;
    precipitationMm: number | null;
    windSpeedMps: number | null;
    windGustMps: number | null;
    weatherCode: number | null;
  };
  nextSixHours: {
    sourceId: "open-meteo" | "qweather-hourly" | null;
    startsAt: string | null;
    endsAt: string | null;
    precipitationMm: number | null;
    maxHourlyPrecipitationMm: number | null;
    maxPrecipitationProbabilityPct: number | null;
    maxWindGustMps: number | null;
    maxCapeJkg: number | null;
  };
  minutelyRain: {
    available: boolean;
    updatedAt: string | null;
    summary: string | null;
    maxFiveMinutePrecipitationMm: number | null;
    precipitationNextTwoHoursMm: number | null;
  };
  officialWarnings: Array<{ title: string; severity: string | null; issuedAt: string | null }>;
  risks: CityRisk[];
  narrative: CityBriefingNarrative;
  sources: CityBriefingSource[];
  warnings: string[];
}

interface GeocodingResult {
  name?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
  country?: string;
  admin1?: string;
  feature_code?: string;
  population?: number;
}

interface OpenMeteoPayload {
  timezone?: string;
  current?: Record<string, number | string | null>;
  hourly?: Record<string, Array<number | string | null>>;
}

interface QWeatherPayload {
  code?: string;
  updateTime?: string;
  now?: Record<string, string | undefined>;
  hourly?: Array<Record<string, string | undefined>>;
  minutely?: Array<{ fxTime?: string; precip?: string; type?: string }>;
  summary?: string;
  warning?: Array<{ title?: string; severity?: string; startTime?: string }>;
}

const OPEN_METEO_FORECAST = "https://api.open-meteo.com/v1/forecast";
const OPEN_METEO_GEOCODING = "https://geocoding-api.open-meteo.com/v1/search";

const CURRENT_FIELDS = [
  "temperature_2m", "relative_humidity_2m", "apparent_temperature", "precipitation", "rain",
  "weather_code", "wind_speed_10m", "wind_gusts_10m"
].join(",");
const HOURLY_FIELDS = [
  "temperature_2m", "precipitation_probability", "precipitation", "rain", "weather_code",
  "wind_speed_10m", "wind_gusts_10m", "cape", "convective_inhibition", "pressure_msl",
  "total_column_integrated_water_vapour"
].join(",");

export async function getCityBriefing(cityQuery: string): Promise<CityBriefing> {
  const city = await getCityLocation(cityQuery);
  const [openMeteoResult, qWeatherResult] = await Promise.allSettled([
    loadOpenMeteo(city),
    loadQWeather(city)
  ]);
  const now = new Date().toISOString();
  const warnings: string[] = [];
  const sources: CityBriefingSource[] = [];

  const openMeteo = openMeteoResult.status === "fulfilled" ? openMeteoResult.value : null;
  if (openMeteoResult.status === "rejected") warnings.push(`城市数值天气数据不可用：${errorText(openMeteoResult.reason)}`);
  sources.push({
    id: "open-meteo",
    label: "Open-Meteo 城市数值天气",
    evidenceLevel: openMeteo ? "model" : "unavailable",
    updatedAt: openMeteo?.current.observedAt ?? null,
    status: openMeteo ? "available" : "unavailable",
    limitation: "当前条件和未来时段为数值模式/分析场，不等同于本地人工站实测。"
  });

  const qWeather = qWeatherResult.status === "fulfilled"
    ? qWeatherResult.value
    : unavailableQWeather(`和风天气数据不可用：${errorText(qWeatherResult.reason)}`);
  if (qWeatherResult.status === "rejected") warnings.push(`和风天气数据不可用：${errorText(qWeatherResult.reason)}`);
  sources.push(...qWeather.sources);
  warnings.push(...qWeather.warnings);

  const current = qWeather.current ?? openMeteo?.current ?? emptyCurrent();
  const nextSixHours = mergeNextSixHours(openMeteo?.nextSixHours ?? emptySixHours(), qWeather.nextSixHours);
  const risks = buildRisks(nextSixHours, qWeather.minutelyRain, qWeather.officialWarnings);
  const status = openMeteo ? (qWeather.available ? "available" : "degraded") : "unavailable";

  const briefing: Omit<CityBriefing, "narrative"> = {
    city,
    generatedAt: now,
    status,
    headline: buildHeadline(risks, qWeather.officialWarnings),
    current,
    nextSixHours,
    minutelyRain: qWeather.minutelyRain,
    officialWarnings: qWeather.officialWarnings,
    risks,
    sources,
    warnings
  };
  // City cards are an operational readout, not a creative-writing task. Keep
  // this on the data path: it returns as soon as the weather sources do and
  // never waits for an LLM round trip.
  return { ...briefing, narrative: templateNarrative(briefing) };
}

function templateNarrative(briefing: Omit<CityBriefing, "narrative">): CityBriefingNarrative {
  const primary = [...briefing.risks].sort((a, b) => riskWeight(b.level) - riskWeight(a.level))[0];
  const current = briefing.current;
  const next = briefing.nextSixHours;
  const now = current.temperatureC === null
    ? "当前实况待同步"
    : `当前 ${current.temperatureC.toFixed(current.temperatureC >= 10 ? 0 : 1)}°C`;
  const trend = primary?.level === "unavailable"
    ? "关键数据缺口已标注"
    : primary?.kind === "rain"
      ? `未来六小时优先盯防降水 ${numberText(next.precipitationMm, "mm")}`
      : primary?.kind === "wind"
        ? `未来六小时阵风峰值 ${numberText(next.maxWindGustMps, "m/s")}`
        : "未来六小时持续监视对流条件";
  return {
    engine: "template",
    summary: `${now}；${trend}。`,
    actions: templateActions(primary)
  };
}

function numberText(value: number | null, unit: string) {
  return value === null ? "待更新" : `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
}

function templateActions(risk: CityRisk | undefined) {
  if (!risk || risk.level === "unavailable") return ["等待下一帧数据回传"];
  if (risk.kind === "rain" && ["high", "severe"].includes(risk.level)) return ["避开低洼与易积水路段", "户外行程预留撤离余量"];
  if (risk.kind === "wind" && ["high", "severe"].includes(risk.level)) return ["远离临时搭建物", "高处物品提前加固"];
  if (risk.kind === "convection" && ["high", "severe"].includes(risk.level)) return ["减少空旷处停留", "保持短临预警可达"];
  return ["出行前复核属地预警"];
}

export async function getCityLocation(cityQuery: string): Promise<CityBriefing["city"]> {
  return resolveCity(cityQuery);
}

async function resolveCity(cityQuery: string): Promise<CityBriefing["city"]> {
  const name = normalizeCityQuery(cityQuery);
  if (!name) throw new Error("请提供至少两个字符的城市名称。");
  const query = new URLSearchParams({ name, count: "10", language: "zh", format: "json", countryCode: "CN" });
  const response = await fetch(`${OPEN_METEO_GEOCODING}?${query}`, requestInit(8_000));
  if (!response.ok) throw new Error(`城市定位 HTTP ${response.status}`);
  const payload = await response.json() as { results?: GeocodingResult[] };
  const result = chooseCity(payload.results ?? [], name);
  if (!result || !Number.isFinite(result.latitude) || !Number.isFinite(result.longitude)) throw new Error(`未找到城市“${name}”。`);
  return {
    name: result.name ?? name,
    province: result.admin1 ?? null,
    country: result.country ?? null,
    latitude: result.latitude!,
    longitude: result.longitude!,
    timezone: result.timezone ?? "Asia/Shanghai"
  };
}

function chooseCity(results: GeocodingResult[], requestedName: string) {
  const normalized = requestedName.replace(/[市区县]/g, "");
  return [...results].sort((a, b) => {
    const aExact = (a.name ?? "").replace(/[市区县]/g, "") === normalized ? 1 : 0;
    const bExact = (b.name ?? "").replace(/[市区县]/g, "") === normalized ? 1 : 0;
    const aPlace = /^PPLA?\d?$/.test(a.feature_code ?? "") ? 1 : 0;
    const bPlace = /^PPLA?\d?$/.test(b.feature_code ?? "") ? 1 : 0;
    return bExact - aExact || bPlace - aPlace || (b.population ?? 0) - (a.population ?? 0);
  })[0];
}

async function loadOpenMeteo(city: CityBriefing["city"]) {
  const query = new URLSearchParams({
    latitude: city.latitude.toFixed(4), longitude: city.longitude.toFixed(4), timezone: city.timezone,
    current: CURRENT_FIELDS, hourly: HOURLY_FIELDS, forecast_hours: "6", wind_speed_unit: "ms"
  });
  const response = await fetch(`${OPEN_METEO_FORECAST}?${query}`, requestInit(8_000));
  if (!response.ok) throw new Error(`Open-Meteo HTTP ${response.status}`);
  const payload = await response.json() as OpenMeteoPayload;
  const current = payload.current ?? {};
  const hourly = payload.hourly ?? {};
  return {
    current: {
      sourceId: "open-meteo" as const, evidenceLevel: "model" as const, observedAt: stringValue(current.time), temperatureC: numberValue(current.temperature_2m),
      apparentTemperatureC: numberValue(current.apparent_temperature), relativeHumidityPct: numberValue(current.relative_humidity_2m),
      precipitationMm: numberValue(current.precipitation), windSpeedMps: numberValue(current.wind_speed_10m),
      windGustMps: numberValue(current.wind_gusts_10m), weatherCode: numberValue(current.weather_code)
    },
    nextSixHours: summarizeSixHours(hourly)
  };
}

async function loadQWeather(city: CityBriefing["city"]) {
  const host = process.env.QWEATHER_API_HOST?.trim().replace(/\/$/, "");
  const token = process.env.QWEATHER_API_TOKEN?.trim();
  const apiKey = process.env.QWEATHER_API_KEY?.trim();
  const notConfigured = (warning: string) => ({
    available: false,
    current: null as CityBriefing["current"] | null,
    nextSixHours: null as CityBriefing["nextSixHours"] | null,
    minutelyRain: emptyMinutelyRain(),
    officialWarnings: [] as CityBriefing["officialWarnings"],
    warnings: [warning],
    sources: qWeatherSources({ now: "not-configured", hourly: "not-configured", minutely: "not-configured", warning: "not-configured" }, null)
  });
  if (!host) return notConfigured("未配置 QWEATHER_API_HOST；请使用和风天气控制台-设置中的专属 API Host。");
  if (!token && !apiKey) return notConfigured("未配置 QWEATHER_API_KEY 或 QWEATHER_API_TOKEN；分钟降水和中国官方预警未接入。");
  if (token && apiKey) return notConfigured("请只配置一种和风天气鉴权方式：API Key 或 JWT。");

  const location = `${city.longitude.toFixed(2)},${city.latitude.toFixed(2)}`;
  const headers: Record<string, string> = token
    ? { Authorization: `Bearer ${token}`, "User-Agent": process.env.WEATHER_API_USER_AGENT ?? "TyphoonBossRadar/1.0" }
    : { "X-QW-Api-Key": apiKey ?? "", "User-Agent": process.env.WEATHER_API_USER_AGENT ?? "TyphoonBossRadar/1.0" };
  // Warning access is deliberately excluded from the v1 city card. Some
  // projects do not license it, and a 403 must never downgrade current /
  // forecast evidence or look like a safety conclusion.
  const [now, hourly, minutely] = await Promise.allSettled([
    fetchQWeather(host, `/v7/weather/now?location=${encodeURIComponent(location)}&lang=zh`, headers),
    fetchQWeather(host, `/v7/weather/24h?location=${encodeURIComponent(location)}&lang=zh`, headers),
    fetchQWeather(host, `/v7/minutely/5m?location=${encodeURIComponent(location)}&lang=zh`, headers)
  ]);
  const failures = [now, hourly, minutely].filter((entry) => entry.status === "rejected").map((entry) => errorText(entry.status === "rejected" ? entry.reason : ""));
  const nowPayload = now.status === "fulfilled" ? now.value : null;
  const hourlyPayload = hourly.status === "fulfilled" ? hourly.value : null;
  const minutelyPayload = minutely.status === "fulfilled" ? minutely.value : null;
  const minutelyRain = summarizeMinutelyRain(minutelyPayload);
  const officialWarnings: CityBriefing["officialWarnings"] = [];
  const updatedAt = minutelyPayload?.updateTime ?? null;
  return {
    available: Boolean(nowPayload || hourlyPayload || minutelyPayload),
    current: summarizeQWeatherNow(nowPayload),
    nextSixHours: summarizeQWeatherHours(hourlyPayload),
    minutelyRain,
    officialWarnings,
    warnings: failures.map((failure) => `和风天气请求失败：${failure}`),
    sources: qWeatherSources({
      now: nowPayload ? "available" : "unavailable",
      hourly: hourlyPayload ? "available" : "unavailable",
      minutely: minutelyPayload ? "available" : "unavailable",
      warning: "not-configured"
    }, updatedAt)
  };
}

function unavailableQWeather(warning: string) {
  return {
    available: false,
    current: null,
    nextSixHours: null,
    minutelyRain: emptyMinutelyRain(),
    officialWarnings: [] as CityBriefing["officialWarnings"],
    warnings: [warning],
    sources: qWeatherSources({ now: "unavailable", hourly: "unavailable", minutely: "unavailable", warning: "unavailable" }, null)
  };
}

async function fetchQWeather(host: string, path: string, headers: HeadersInit) {
  const response = await fetch(`${host}${path}`, { headers, cache: "no-store", signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json() as QWeatherPayload;
  if (payload.code && payload.code !== "200") throw new Error(`API code ${payload.code}`);
  return payload;
}

function qWeatherSources(
  status: { now: CityBriefingSource["status"]; hourly: CityBriefingSource["status"]; minutely: CityBriefingSource["status"]; warning: CityBriefingSource["status"] },
  updatedAt: string | null
): CityBriefingSource[] {
  return [
    { id: "qweather-now", label: "和风天气近实时天气", evidenceLevel: status.now === "available" ? "observed" : "unavailable", updatedAt, status: status.now, limitation: "近实时数据可能有 5-20 分钟延迟，不是气象部门的即时站点电文。" },
    { id: "qweather-hourly", label: "和风天气逐小时预报", evidenceLevel: status.hourly === "available" ? "model" : "unavailable", updatedAt, status: status.hourly, limitation: "预报数据，不等同于实况或官方预警。" },
    { id: "qweather-minutely", label: "和风天气分钟级降水", evidenceLevel: status.minutely === "available" ? "model" : "unavailable", updatedAt, status: status.minutely, limitation: "未来 2 小时降水预报。" },
    { id: "qweather-warning", label: "和风天气官方预警", evidenceLevel: status.warning === "available" ? "confirmed" : "unavailable", updatedAt, status: status.warning, limitation: "转发属地政府部门预警；无预警不等于无风险。" }
  ];
}

function summarizeSixHours(hourly: Record<string, Array<number | string | null>>): CityBriefing["nextSixHours"] {
  const values = (key: string) => (hourly[key] ?? []).map(numberValue).filter((value): value is number => value !== null);
  const times = (hourly.time ?? []).map(stringValue).filter((value): value is string => Boolean(value));
  const precipitation = values("precipitation");
  return {
    sourceId: "open-meteo",
    startsAt: times[0] ?? null, endsAt: times.at(-1) ?? null,
    precipitationMm: sum(precipitation), maxHourlyPrecipitationMm: max(precipitation),
    maxPrecipitationProbabilityPct: max(values("precipitation_probability")), maxWindGustMps: max(values("wind_gusts_10m")),
    maxCapeJkg: max(values("cape"))
  };
}

function summarizeQWeatherNow(payload: QWeatherPayload | null): CityBriefing["current"] | null {
  const now = payload?.now;
  if (!now) return null;
  return {
    sourceId: "qweather-now", evidenceLevel: "observed", observedAt: now.obsTime ?? payload?.updateTime ?? null,
    temperatureC: numberValue(now.temp), apparentTemperatureC: numberValue(now.feelsLike), relativeHumidityPct: numberValue(now.humidity),
    precipitationMm: numberValue(now.precip), windSpeedMps: kmhToMps(now.windSpeed), windGustMps: null, weatherCode: null
  };
}

function summarizeQWeatherHours(payload: QWeatherPayload | null): CityBriefing["nextSixHours"] | null {
  if (!payload?.hourly?.length) return null;
  const hourly = payload.hourly.slice(0, 6);
  const precipitation = hourly.map((point) => numberValue(point.precip)).filter((value): value is number => value !== null);
  const probability = hourly.map((point) => numberValue(point.pop)).filter((value): value is number => value !== null);
  return {
    sourceId: "qweather-hourly", startsAt: hourly[0]?.fxTime ?? null, endsAt: hourly.at(-1)?.fxTime ?? null,
    precipitationMm: sum(precipitation), maxHourlyPrecipitationMm: max(precipitation), maxPrecipitationProbabilityPct: max(probability),
    // QWeather's 24-hour endpoint supplies wind speed but not gusts. Keep the
    // gust metric null here so we never relabel sustained wind as a gust.
    maxWindGustMps: null, maxCapeJkg: null
  };
}

function mergeNextSixHours(base: CityBriefing["nextSixHours"], preferred: CityBriefing["nextSixHours"] | null): CityBriefing["nextSixHours"] {
  if (!preferred) return base;
  return { ...preferred, maxWindGustMps: base.maxWindGustMps, maxCapeJkg: base.maxCapeJkg };
}

function summarizeMinutelyRain(payload: QWeatherPayload | null): CityBriefing["minutelyRain"] {
  if (!payload) return emptyMinutelyRain();
  const values = (payload.minutely ?? []).map((point) => numberValue(point.precip)).filter((value): value is number => value !== null);
  return { available: true, updatedAt: payload.updateTime ?? null, summary: payload.summary ?? null, maxFiveMinutePrecipitationMm: max(values), precipitationNextTwoHoursMm: sum(values) };
}

function buildRisks(next: CityBriefing["nextSixHours"], minutely: CityBriefing["minutelyRain"], officialWarnings: CityBriefing["officialWarnings"]): CityRisk[] {
  const hasWarning = officialWarnings.length > 0;
  const hourlyRain = next.maxHourlyPrecipitationMm ?? 0;
  const shortRain = minutely.maxFiveMinutePrecipitationMm ?? 0;
  const rainLevel: CityRiskLevel = hasWarning || hourlyRain >= 20 || shortRain >= 5 ? "severe" : hourlyRain >= 10 || shortRain >= 2 ? "high" : hourlyRain >= 3 ? "moderate" : "low";
  const gust = next.maxWindGustMps ?? 0;
  const windLevel: CityRiskLevel = gust >= 25 ? "severe" : gust >= 18 ? "high" : gust >= 11 ? "moderate" : "low";
  const cape = next.maxCapeJkg ?? 0;
  const convectionLevel: CityRiskLevel = cape >= 1800 && hourlyRain >= 5 ? "high" : cape >= 1000 && hourlyRain >= 1 ? "moderate" : "low";
  return [
    { kind: "rain", level: rainLevel, label: "强降雨", summary: rainSummary(rainLevel, next, minutely, hasWarning), evidenceLevel: hasWarning ? "confirmed" : "model", sourceIds: hasWarning ? ["qweather-warning", "open-meteo"] : minutely.available ? ["qweather-minutely", next.sourceId ?? "open-meteo"] : [next.sourceId ?? "open-meteo"] },
    { kind: "wind", level: windLevel, label: "阵风", summary: gust === 0 ? "未来 6 小时阵风模型数据不足。" : `未来 6 小时最大阵风模型值约 ${gust.toFixed(1)} m/s。`, evidenceLevel: "model", sourceIds: ["open-meteo"] },
    { kind: "convection", level: convectionLevel, label: "对流条件", summary: convectionSummary(convectionLevel, cape), evidenceLevel: "model", sourceIds: ["open-meteo"] }
  ];
}

function buildHeadline(risks: CityRisk[], officialWarnings: CityBriefing["officialWarnings"]) {
  if (officialWarnings.length) return `已发布 ${officialWarnings[0].title}，请以属地气象部门最新指引为准。`;
  const primary = [...risks].sort((a, b) => riskWeight(b.level) - riskWeight(a.level))[0];
  if (!primary || primary.level === "low") return "未来 6 小时未见突出风雨风险，仍请留意属地预警变化。";
  return `未来 6 小时优先关注${primary.label}风险；该结论来自城市数值天气推演。`;
}

function rainSummary(level: CityRiskLevel, next: CityBriefing["nextSixHours"], minutely: CityBriefing["minutelyRain"], hasWarning: boolean) {
  if (hasWarning) return "属地官方预警已发布，优先遵从预警内容和防御指引。";
  if (minutely.available && minutely.summary) return minutely.summary;
  if (next.maxHourlyPrecipitationMm === null) return "未来 6 小时降水模型数据不足。";
  const qualifier = level === "high" || level === "severe" ? "需重点防范" : level === "moderate" ? "需要关注" : "风险较低";
  return `${qualifier}，模型预计未来 6 小时累计降水约 ${(next.precipitationMm ?? 0).toFixed(1)} mm，最强小时约 ${next.maxHourlyPrecipitationMm.toFixed(1)} mm。`;
}

function convectionSummary(level: CityRiskLevel, cape: number) {
  if (cape === 0) return "对流环境模型数据不足，不作研判。";
  if (level === "high") return `CAPE 模型值约 ${Math.round(cape)} J/kg，叠加降水条件，对流发展条件较有利。`;
  if (level === "moderate") return `CAPE 模型值约 ${Math.round(cape)} J/kg，存在对流发展条件，需结合官方预警观察。`;
  return "当前模型未显示突出的强对流条件。";
}

function emptyCurrent(): CityBriefing["current"] { return { sourceId: null, evidenceLevel: "unavailable", observedAt: null, temperatureC: null, apparentTemperatureC: null, relativeHumidityPct: null, precipitationMm: null, windSpeedMps: null, windGustMps: null, weatherCode: null }; }
function emptySixHours(): CityBriefing["nextSixHours"] { return { sourceId: null, startsAt: null, endsAt: null, precipitationMm: null, maxHourlyPrecipitationMm: null, maxPrecipitationProbabilityPct: null, maxWindGustMps: null, maxCapeJkg: null }; }
function emptyMinutelyRain(): CityBriefing["minutelyRain"] { return { available: false, updatedAt: null, summary: null, maxFiveMinutePrecipitationMm: null, precipitationNextTwoHoursMm: null }; }
function requestInit(timeout: number): RequestInit { return { cache: "no-store", headers: { Accept: "application/json", "User-Agent": process.env.WEATHER_API_USER_AGENT ?? "TyphoonBossRadar/1.0" }, signal: AbortSignal.timeout(timeout) }; }
function normalizeCityQuery(value: string) { return value.trim().replace(/^@/, "").replace(/市$/, "").slice(0, 40); }
function numberValue(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function kmhToMps(value: unknown) { const kmh = numberValue(value); return kmh === null ? null : kmh / 3.6; }
function stringValue(value: unknown) { return typeof value === "string" ? value : null; }
function max(values: number[]) { return values.length ? Math.max(...values) : null; }
function sum(values: number[]) { return values.length ? values.reduce((total, value) => total + value, 0) : null; }
function riskWeight(level: CityRiskLevel) { return ({ unavailable: -1, low: 0, moderate: 1, high: 2, severe: 3 })[level]; }
function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }
