import { createPrivateKey, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

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

export type CityHazardKind = "warning" | "rain" | "wind" | "convection" | "heat" | "calm";
export type CityBriefingTemplate = "warning" | "rain" | "wind" | "convection" | "heat" | "calm";

export interface CityRisk {
  kind: CityHazardKind;
  level: CityRiskLevel;
  label: string;
  summary: string;
  evidenceLevel: CityEvidenceLevel;
  sourceIds: CityBriefingSource["id"][];
}

export interface CityBriefingNarrative {
  engine: "template";
  template: CityBriefingTemplate;
  primaryKind: CityHazardKind;
  timeWindow: { startsAt: string | null; endsAt: string | null } | null;
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
  officialWarnings: Array<{
    title: string;
    severity: string | null;
    issuedAt: string | null;
    senderName: string | null;
    effectiveAt: string | null;
    expiresAt: string | null;
    description: string | null;
    instruction: string | null;
  }>;
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

export interface CityMention {
  raw: string;
  cityQuery: string;
  province: string | null;
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
  alert?: Array<{
    senderName?: string;
    issuedTime?: string;
    event?: string;
    severity?: string;
    effectiveTime?: string;
    expireTime?: string;
    headline?: string;
    description?: string;
    instruction?: string;
  }>;
}

const OPEN_METEO_FORECAST = "https://api.open-meteo.com/v1/forecast";
const OPEN_METEO_GEOCODING = "https://geocoding-api.open-meteo.com/v1/search";
const PROVINCES = [
  ["新疆维吾尔自治区", "新疆"], ["内蒙古自治区", "内蒙古"], ["广西壮族自治区", "广西"], ["宁夏回族自治区", "宁夏"], ["西藏自治区", "西藏"],
  ["香港特别行政区", "香港"], ["澳门特别行政区", "澳门"], ["黑龙江省", "黑龙江"], ["吉林省", "吉林"], ["辽宁省", "辽宁"], ["河北省", "河北"], ["河南省", "河南"],
  ["山东省", "山东"], ["山西省", "山西"], ["陕西省", "陕西"], ["甘肃省", "甘肃"], ["青海省", "青海"], ["江苏省", "江苏"], ["浙江省", "浙江"], ["安徽省", "安徽"],
  ["福建省", "福建"], ["江西省", "江西"], ["湖北省", "湖北"], ["湖南省", "湖南"], ["广东省", "广东"], ["海南省", "海南"], ["四川省", "四川"], ["贵州省", "贵州"],
  ["云南省", "云南"], ["台湾省", "台湾"], ["北京市", "北京"], ["天津市", "天津"], ["上海市", "上海"], ["重庆市", "重庆"]
] as const;
const MUNICIPALITIES = new Set(["北京", "天津", "上海", "重庆"]);

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
  const risks = buildRisks(current, nextSixHours, qWeather.minutelyRain, qWeather.officialWarnings);
  const warningSourceAvailable = qWeather.sources.some((source) => source.id === "qweather-warning" && source.status === "available");
  const status = openMeteo && qWeather.available && warningSourceAvailable
    ? "available"
    : openMeteo
      ? "degraded"
      : "unavailable";

  const briefing: Omit<CityBriefing, "narrative"> = {
    city,
    generatedAt: now,
    status,
    headline: buildHeadline(risks, qWeather.officialWarnings, sources),
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
  return { ...briefing, narrative: buildCityPresentation(briefing) };
}

export function buildCityPresentation(briefing: Omit<CityBriefing, "narrative">): CityBriefingNarrative {
  const warning = briefing.officialWarnings[0];
  const primary = warning
    ? { kind: "warning" as const, level: "severe" as const, label: warning.title, summary: "属地官方预警已发布。", evidenceLevel: "confirmed" as const, sourceIds: ["qweather-warning" as const] }
    : [...briefing.risks].sort((a, b) => riskWeight(b.level) - riskWeight(a.level))[0];
  const current = briefing.current;
  const next = briefing.nextSixHours;
  const template: CityBriefingTemplate = warning
    ? "warning"
    : !primary || primary.level === "low" || primary.level === "unavailable"
      ? "calm"
      : primary.kind;
  const timeWindow = template === "warning" || template === "rain" || template === "wind" || template === "convection"
    ? { startsAt: next.startsAt, endsAt: next.endsAt }
    : null;
  const officialWarningUnavailable = briefing.sources.some(
    (source) => source.id === "qweather-warning" && source.status !== "available"
  );

  const baseSummary = template === "warning"
    ? `${warning!.title}已发布，先按属地气象和应急部门指引行动。`
    : template === "rain"
      ? rainHeadline(next, briefing.minutelyRain)
      : template === "wind"
        ? `未来六小时主风险是阵风，峰值约 ${numberText(next.maxWindGustMps, "m/s")}；降水不是当前首要风险。`
        : template === "convection"
          ? convectionHeadline(next)
          : template === "heat"
            ? heatHeadline(current)
            : calmHeadline(current, next);
  const summary = template === "calm" && officialWarningUnavailable
    ? `${baseSummary} 官方预警数据当前不可用，不能据此确认无风险。`
    : baseSummary;
  return {
    engine: "template",
    template,
    primaryKind: template,
    timeWindow,
    summary,
    actions: templateActions(primary, warning)
  };
}

function numberText(value: number | null, unit: string) {
  return value === null ? "待更新" : `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
}

function rainHeadline(next: CityBriefing["nextSixHours"], minutely: CityBriefing["minutelyRain"]) {
  if (minutely.available && minutely.precipitationNextTwoHoursMm !== null) {
    return `主战况是短时强降雨：未来两小时预计 ${numberText(minutely.precipitationNextTwoHoursMm, "mm")}，雨带变化优先看短临。`;
  }
  return `主战况是降水：未来六小时累计约 ${numberText(next.precipitationMm, "mm")}，最强小时约 ${numberText(next.maxHourlyPrecipitationMm, "mm")}。`;
}

function convectionHeadline(next: CityBriefing["nextSixHours"]) {
  return `当前是对流条件较活跃，不等于已发生强对流；CAPE 模型值约 ${numberText(next.maxCapeJkg, "J/kg")}，需结合属地短临预警。`;
}

function heatHeadline(current: CityBriefing["current"]) {
  const feels = current.apparentTemperatureC === null ? "" : `，体感约 ${numberText(current.apparentTemperatureC, "°C")}`;
  return `当前更值得留意体感温度：气温约 ${numberText(current.temperatureC, "°C")}${feels}，风雨不是当前主风险。`;
}

function calmHeadline(current: CityBriefing["current"], next: CityBriefing["nextSixHours"]) {
  const now = current.temperatureC === null ? "当前资料正在同步" : `当前 ${numberText(current.temperatureC, "°C")}`;
  const gust = next.maxWindGustMps === null ? "" : `，阵风峰值约 ${numberText(next.maxWindGustMps, "m/s")}`;
  return `${now}；当前模式未显示未来六小时突出的风雨信号${gust}。`;
}

function templateActions(risk: CityRisk | undefined, warning?: CityBriefing["officialWarnings"][number]) {
  if (warning) return ["优先遵从预警正文与属地应急通知", "避开风险区域和非必要出行"];
  if (!risk || risk.level === "unavailable") return ["数据正在同步，出行前复核属地预警"];
  if (risk.kind === "rain" && ["high", "severe"].includes(risk.level)) return ["避开低洼与易积水路段", "户外行程预留撤离余量"];
  if (risk.kind === "wind" && ["high", "severe"].includes(risk.level)) return ["远离临时搭建物", "高处物品提前加固"];
  if (risk.kind === "convection" && ["high", "severe"].includes(risk.level)) return ["减少空旷处停留", "保持短临预警可达"];
  if (risk.kind === "heat" && ["high", "severe"].includes(risk.level)) return ["减少高温时段户外暴露", "及时补水并留意体感变化"];
  return ["出行前复核属地预警", "按体感调整行程"];
}

export async function getCityLocation(cityQuery: string): Promise<CityBriefing["city"]> {
  return resolveCity(cityQuery);
}

async function resolveCity(cityQuery: string): Promise<CityBriefing["city"]> {
  const mention = parseCityMention(cityQuery);
  const results = (await Promise.all(cityQueryVariants(mention.cityQuery).map(async (name) => {
    const query = new URLSearchParams({ name, count: "10", language: "zh", format: "json", countryCode: "CN" });
    const response = await fetch(`${OPEN_METEO_GEOCODING}?${query}`, requestInit(8_000));
    if (!response.ok) throw new Error(`城市定位 HTTP ${response.status}`);
    const payload = await response.json() as { results?: GeocodingResult[] };
    return payload.results ?? [];
  }))).flat();
  const result = chooseCity(results, mention);
  if (!result || !Number.isFinite(result.latitude) || !Number.isFinite(result.longitude)) throw new Error(`未找到城市“${mention.raw}”。`);
  return {
    name: result.name ?? mention.cityQuery,
    province: result.admin1 ?? null,
    country: result.country ?? null,
    latitude: result.latitude!,
    longitude: result.longitude!,
    timezone: result.timezone ?? "Asia/Shanghai"
  };
}

export function parseCityMention(value: string): CityMention {
  const raw = value.trim().replace(/^@/, "").replace(/^(中华人民共和国|中国)/, "").replace(/[\s，,、·•—–－-]/g, "");
  if (!raw) throw new Error("请在 @ 后输入城市，例如 @广州 或 @广东省广州市。");
  const provinceMatch = PROVINCES.find(([longName, shortName]) => raw.startsWith(longName)
    || (raw.startsWith(shortName) && raw.slice(shortName.length) !== "市"));
  const province = provinceMatch?.[1] ?? null;
  const prefix = provinceMatch ? (raw.startsWith(provinceMatch[0]) ? provinceMatch[0] : provinceMatch[1]) : "";
  const remainder = raw.slice(prefix.length);
  if (province && !remainder && !MUNICIPALITIES.has(province)) {
    throw new Error(`“${raw}”是省级范围，请补充城市，例如 @${province}广州。`);
  }
  const cityQuery = remainder || province || raw;
  if (cityQuery.length < 2) throw new Error("请提供至少两个字符的城市名称。");
  return { raw, cityQuery, province };
}

function cityQueryVariants(cityQuery: string) {
  const plain = cityQuery.replace(/市$/, "");
  return [...new Set([cityQuery, plain, cityQuery.endsWith("市") ? cityQuery : `${cityQuery}市`].filter((value) => value.length >= 2))];
}

export function chooseCity(results: GeocodingResult[], mention: CityMention) {
  const seen = new Set<string>();
  const eligible = results.filter((result) => {
    const key = `${result.name}|${result.admin1}|${result.latitude}|${result.longitude}`;
    if (seen.has(key) || !isChineseCity(result)) return false;
    seen.add(key);
    return !mention.province || normalizeProvince(result.admin1) === mention.province;
  });
  if (!eligible.length) {
    const scope = mention.province ? `“${mention.province}”范围内的` : "";
    throw new Error(`未找到${scope}城市“${mention.raw}”；请检查省市名称。`);
  }
  const normalized = mention.cityQuery.replace(/市$/, "");
  const ranked = eligible.map((result) => ({
    result,
    score: ((result.name ?? "").replace(/市$/, "") === normalized ? 100 : 0)
      + ((result.name ?? "") === mention.cityQuery ? 20 : 0)
      + (result.feature_code === "PPLC" ? 8 : 0)
      + Math.min(7, Math.log10(Math.max(1, result.population ?? 1)))
  })).sort((a, b) => b.score - a.score || (b.result.population ?? 0) - (a.result.population ?? 0));
  const top = ranked[0];
  const tied = ranked.filter((entry) => entry.score === top.score);
  if (tied.length > 1 && new Set(tied.map((entry) => `${entry.result.name}|${entry.result.admin1}`)).size > 1) {
    throw new Error(`“${mention.raw}”存在同级城市歧义，请补充省份，例如 @省名${mention.cityQuery}。`);
  }
  return top.result;
}

function isChineseCity(result: GeocodingResult) {
  return /^PPLA\d?$/.test(result.feature_code ?? "") || result.feature_code === "PPLC";
}

function normalizeProvince(value: string | undefined) {
  const raw = value?.replace(/[省市]/g, "") ?? "";
  const match = PROVINCES.find(([longName, shortName]) => raw === longName.replace(/[省市]/g, "") || raw === shortName);
  return match?.[1] ?? raw.replace(/(壮族|回族|维吾尔|自治区|特别行政区)$/g, "");
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
  const apiKey = process.env.QWEATHER_API_KEY?.trim();
  const staticToken = process.env.QWEATHER_API_TOKEN?.trim();
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
  let headers: Record<string, string>;
  try {
    headers = await qWeatherAuthHeaders();
  } catch (error) {
    return notConfigured(`和风天气 JWT 未就绪：${errorText(error)}`);
  }
  if (!Object.keys(headers).length) return notConfigured("未配置 QWEATHER_API_KEY，或 QWEATHER_JWT_PROJECT_ID、QWEATHER_JWT_KEY_ID 与私钥；分钟降水和官方预警未接入。");
  if (staticToken && apiKey) return notConfigured("请只配置一种旧版和风天气鉴权方式：API Key 或 QWEATHER_API_TOKEN。");

  const location = `${city.longitude.toFixed(2)},${city.latitude.toFixed(2)}`;
  // The alert endpoint is v1 and coordinate-based. A failure is kept separate
  // from ordinary weather data, so it can never be misrepresented as no alert.
  const [now, hourly, minutely, warning] = await Promise.allSettled([
    fetchQWeather(host, `/v7/weather/now?location=${encodeURIComponent(location)}&lang=zh`, headers),
    fetchQWeather(host, `/v7/weather/24h?location=${encodeURIComponent(location)}&lang=zh`, headers),
    fetchQWeather(host, `/v7/minutely/5m?location=${encodeURIComponent(location)}&lang=zh`, headers),
    fetchQWeather(host, `/weatheralert/v1/current/${city.latitude.toFixed(4)}/${city.longitude.toFixed(4)}?lang=zh&localTime=true`, headers)
  ]);
  const failures = [now, hourly, minutely, warning].filter((entry) => entry.status === "rejected").map((entry) => errorText(entry.status === "rejected" ? entry.reason : ""));
  const nowPayload = now.status === "fulfilled" ? now.value : null;
  const hourlyPayload = hourly.status === "fulfilled" ? hourly.value : null;
  const minutelyPayload = minutely.status === "fulfilled" ? minutely.value : null;
  const warningPayload = warning.status === "fulfilled" ? warning.value : null;
  const minutelyRain = summarizeMinutelyRain(minutelyPayload);
  const officialWarnings = summarizeOfficialWarnings(warningPayload);
  const updatedAt = minutelyPayload?.updateTime ?? warningPayload?.updateTime ?? null;
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
      warning: warningPayload ? "available" : "unavailable"
    }, updatedAt)
  };
}

async function qWeatherAuthHeaders(): Promise<Record<string, string>> {
  const userAgent = process.env.WEATHER_API_USER_AGENT ?? "TyphoonBossRadar/1.0";
  const jwtSettings = await loadQWeatherJwtSettings();
  const { projectId, keyId } = jwtSettings;
  const privateKey = await loadQWeatherPrivateKey(jwtSettings.privateKeyPath);
  if (projectId && keyId && privateKey) {
    return { Authorization: `Bearer ${createQWeatherJwt(privateKey, keyId, projectId)}`, "User-Agent": userAgent };
  }
  const token = process.env.QWEATHER_API_TOKEN?.trim();
  if (token) return { Authorization: `Bearer ${token}`, "User-Agent": userAgent };
  const apiKey = process.env.QWEATHER_API_KEY?.trim();
  return apiKey ? { "X-QW-Api-Key": apiKey, "User-Agent": userAgent } : {};
}

async function loadQWeatherJwtSettings() {
  const fromEnvironment = {
    projectId: process.env.QWEATHER_JWT_PROJECT_ID?.trim() ?? "",
    keyId: process.env.QWEATHER_JWT_KEY_ID?.trim() ?? "",
    privateKeyPath: process.env.QWEATHER_JWT_PRIVATE_KEY_PATH?.trim() ?? ""
  };
  if (fromEnvironment.projectId || fromEnvironment.keyId || process.env.QWEATHER_JWT_PRIVATE_KEY?.trim()) return fromEnvironment;
  try {
    const local = JSON.parse(await readFile(resolve(process.cwd(), ".secrets/qweather-jwt.json"), "utf8")) as Partial<typeof fromEnvironment>;
    return {
      projectId: local.projectId?.trim() ?? "",
      keyId: local.keyId?.trim() ?? "",
      privateKeyPath: local.privateKeyPath?.trim() ?? ""
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fromEnvironment;
    throw new Error(`无法读取本地 QWeather JWT 配置：${errorText(error)}`);
  }
}

async function loadQWeatherPrivateKey(privateKeyPath: string) {
  const inline = process.env.QWEATHER_JWT_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (inline) return inline;
  return privateKeyPath ? (await readFile(privateKeyPath, "utf8")).trim() : null;
}

function createQWeatherJwt(privateKeyPem: string, keyId: string, projectId: string) {
  const now = Math.floor(Date.now() / 1_000);
  const base64Url = (value: string | Buffer) => Buffer.from(value).toString("base64url");
  const header = base64Url(JSON.stringify({ alg: "EdDSA", kid: keyId }));
  const payload = base64Url(JSON.stringify({ sub: projectId, iat: now - 30, exp: now + 900 }));
  const input = `${header}.${payload}`;
  const signature = sign(null, Buffer.from(input), createPrivateKey(privateKeyPem)).toString("base64url");
  return `${input}.${signature}`;
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

function summarizeOfficialWarnings(payload: QWeatherPayload | null): CityBriefing["officialWarnings"] {
  const alerts = payload?.alert ?? [];
  if (alerts.length) return alerts
    .map((alert) => ({
      title: alert.headline?.trim() || alert.event?.trim() || "",
      severity: alert.severity?.trim() || null,
      issuedAt: alert.issuedTime ?? payload?.updateTime ?? null,
      senderName: alert.senderName?.trim() || null,
      effectiveAt: alert.effectiveTime ?? null,
      expiresAt: alert.expireTime ?? null,
      description: alert.description?.trim() || null,
      instruction: alert.instruction?.trim() || null
    }))
    .filter((alert) => Boolean(alert.title));
  return (payload?.warning ?? [])
    .map((warning) => ({
      title: warning.title?.trim() ?? "",
      severity: warning.severity?.trim() || null,
      issuedAt: warning.startTime ?? payload?.updateTime ?? null,
      senderName: null,
      effectiveAt: null,
      expiresAt: null,
      description: null,
      instruction: null
    }))
    .filter((warning) => Boolean(warning.title));
}

function buildRisks(current: CityBriefing["current"], next: CityBriefing["nextSixHours"], minutely: CityBriefing["minutelyRain"], officialWarnings: CityBriefing["officialWarnings"]): CityRisk[] {
  const hasWarning = officialWarnings.length > 0;
  const hourlyRain = next.maxHourlyPrecipitationMm ?? 0;
  const shortRain = minutely.maxFiveMinutePrecipitationMm ?? 0;
  const rainLevel: CityRiskLevel = hasWarning || hourlyRain >= 20 || shortRain >= 5 ? "severe" : hourlyRain >= 10 || shortRain >= 2 ? "high" : hourlyRain >= 3 ? "moderate" : "low";
  const gust = next.maxWindGustMps ?? 0;
  const windLevel: CityRiskLevel = gust >= 25 ? "severe" : gust >= 18 ? "high" : gust >= 11 ? "moderate" : "low";
  const cape = next.maxCapeJkg ?? 0;
  const convectionLevel: CityRiskLevel = cape >= 1800 && hourlyRain >= 5 ? "high" : cape >= 1000 && hourlyRain >= 1 ? "moderate" : "low";
  const apparent = current.apparentTemperatureC ?? current.temperatureC ?? 0;
  const heatLevel: CityRiskLevel = apparent >= 40 ? "severe" : apparent >= 35 ? "high" : apparent >= 32 ? "moderate" : "low";
  return [
    { kind: "rain", level: rainLevel, label: "强降雨", summary: rainSummary(rainLevel, next, minutely, hasWarning), evidenceLevel: hasWarning ? "confirmed" : "model", sourceIds: hasWarning ? ["qweather-warning", "open-meteo"] : minutely.available ? ["qweather-minutely", next.sourceId ?? "open-meteo"] : [next.sourceId ?? "open-meteo"] },
    { kind: "wind", level: windLevel, label: "阵风", summary: gust === 0 ? "未来 6 小时阵风模型数据不足。" : `未来 6 小时最大阵风模型值约 ${gust.toFixed(1)} m/s。`, evidenceLevel: "model", sourceIds: ["open-meteo"] },
    { kind: "convection", level: convectionLevel, label: "对流条件", summary: convectionSummary(convectionLevel, cape), evidenceLevel: "model", sourceIds: ["open-meteo"] },
    { kind: "heat", level: heatLevel, label: "高温体感", summary: heatSummary(heatLevel, current), evidenceLevel: current.evidenceLevel, sourceIds: current.sourceId ? [current.sourceId] : [] }
  ];
}

function buildHeadline(risks: CityRisk[], officialWarnings: CityBriefing["officialWarnings"], sources: CityBriefingSource[]) {
  if (officialWarnings.length) return `已发布 ${officialWarnings[0].title}，请以属地气象部门最新指引为准。`;
  const warningSource = sources.find((source) => source.id === "qweather-warning");
  if (!warningSource || warningSource.status !== "available") {
    return "官方预警数据当前不可用；风雨模型未显示突出信号，但不能据此确认无风险。";
  }
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

function heatSummary(level: CityRiskLevel, current: CityBriefing["current"]) {
  const apparent = current.apparentTemperatureC ?? current.temperatureC;
  if (apparent === null) return "体感温度资料不足。";
  if (level === "high" || level === "severe") return `体感温度约 ${apparent.toFixed(1)}°C，高温暴露风险突出。`;
  if (level === "moderate") return `体感温度约 ${apparent.toFixed(1)}°C，户外活动需留意补水和暴晒。`;
  return "当前体感温度未见突出高温风险。";
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
