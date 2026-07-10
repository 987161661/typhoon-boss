import type {
  BossRating,
  DexEntry,
  ForecastScenario,
  ProvinceDefenseStatus,
  Storm,
  StormSkill,
  StormStage,
  TrackPoint
} from "@/lib/types";
import { findProvinceReferencePoint, normalizeProvinceName } from "@/lib/provinceGeo";

const ZJ_API = "https://typhoon.slt.zj.gov.cn/Api";
const GDACS_SEARCH_API = "https://gdacs.org/gdacsapi/api/events/geteventlist/SEARCH";
const CURRENT_STORMS_CACHE_TTL_MS = 20 * 1000;
const DATA_SOURCE = "浙江省水利厅台风路径公开接口";
const NOTICE =
  "本系统用于台风路径可视化与创意大屏演示，真实预警以中央气象台、海洋预报台和属地应急部门发布为准。";

interface ZjTyphoonListItem {
  tfid: string;
  name: string;
  enname: string;
  starttime: string;
  endtime: string;
  warnlevel?: string;
  isactive: string;
}

interface ZjPoint {
  time: string;
  lng: string;
  lat: string;
  strong?: string;
  power?: string;
  speed?: string;
  pressure?: string;
  movespeed?: string;
  movedirection?: string;
  radius7?: string;
  radius10?: string;
  radius12?: string;
  forecast?: ZjForecastGroup[];
  jl?: string;
}

interface ZjForecastGroup {
  tm: string;
  forecastpoints: ZjForecastPoint[];
}

interface ZjForecastPoint {
  time: string;
  lng: string;
  lat: string;
  strong?: string;
  power?: string;
  speed?: string;
  pressure?: string;
}

interface ZjTyphoonInfo extends ZjTyphoonListItem {
  centerlng?: string;
  centerlat?: string;
  land?: ZjLandfall[];
  points?: ZjPoint[];
}

interface ZjLandfall {
  landaddress?: string;
  landtime?: string;
  lng?: string;
  lat?: string;
  info?: string;
}

interface GdacsEventFeature {
  properties?: {
    eventtype?: string;
    eventname?: string;
    alertlevel?: string;
    country?: string;
    fromdate?: string;
    todate?: string;
    severitydata?: { severitytext?: string };
    url?: { report?: string };
    affectedcountries?: Array<{ countryname?: string }>;
  };
}

interface GdacsEventCollection {
  features?: GdacsEventFeature[];
}

const gdacsEvidenceCache = new Map<string, Promise<NonNullable<DexEntry["impactData"]["gdacs"]> | null>>();

const retiredNameMap: Record<string, string> = {
  BILIS: "马力斯",
  CHANCHU: "三巴",
  DURIAN: "山竹",
  LONGWANG: "海葵",
  MORAKOT: "艾莎尼",
  KETSANA: "蔷薇",
  PARMA: "烟花",
  FANAPI: "雷伊",
  WASHI: "天鸽",
  BOPHA: "安比",
  VICENTE: "兰恩",
  HAIYAN: "白鹿",
  UTOR: "百里嘉",
  FITOW: "木恩",
  RAMMASUN: "博罗依",
  MATMO: "布拉万",
  SOUDELOR: "沙德尔",
  MUJIGAE: "小熊",
  MERANTI: "妮亚图",
  SARIKA: "翠丝",
  HAIMA: "木兰",
  HATO: "山猫",
  TEMBIN: "小犬",
  RUMBIA: "普拉桑",
  MANGKHUT: "山陀儿",
  YUTU: "银杏",
  LEKIMA: "竹节草",
  FAXAI: "琵琶",
  HAGIBIS: "桦加沙",
  VONGFONG: "佩娃",
  MOLAVE: "纳沙",
  GONI: "彩云",
  VAMCO: "班朗",
  RAI: "马鞍",
  NORU: "奥鹿",
  NALGAE: "待更名",
  DOKSURI: "待公布",
  SAOLA: "待公布"
};

let currentStormsCache: { expiresAt: number; storms: Storm[] } | null = null;
let currentStormsInFlight: Promise<Storm[]> | null = null;

export async function getCurrentStorms(): Promise<Storm[]> {
  const now = Date.now();
  if (currentStormsCache && currentStormsCache.expiresAt > now) {
    return currentStormsCache.storms;
  }
  if (currentStormsInFlight) {
    return currentStormsInFlight;
  }

  currentStormsInFlight = loadCurrentStorms().then(
    (storms) => {
      currentStormsCache = {
        expiresAt: Date.now() + CURRENT_STORMS_CACHE_TTL_MS,
        storms
      };
      currentStormsInFlight = null;
      return storms;
    },
    (error) => {
      currentStormsInFlight = null;
      throw error;
    }
  );

  return currentStormsInFlight;
}

async function loadCurrentStorms(): Promise<Storm[]> {
  const year = new Date().getFullYear();
  const list = await getTyphoonList(year);
  const activeItems = list.filter((item) => item.isactive === "1");
  const storms = await Promise.all(
    activeItems.map(async (item) => {
      const detail = await getTyphoonInfo(item.tfid);
      return convertStorm(detail ?? item);
    })
  );

  return storms.filter((storm): storm is Storm => Boolean(storm));
}

export async function getDexEntries(limit = 100): Promise<DexEntry[]> {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: currentYear - 2010 + 1 }, (_, index) => currentYear - index);
  const yearlyLists = await Promise.allSettled(years.map((year) => getTyphoonList(year)));
  const listItems = yearlyLists
    .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    .sort((a, b) => b.tfid.localeCompare(a.tfid))
    .slice(0, limit);

  return mapWithConcurrency(listItems, 8, async (item) => {
    const detail = await getTyphoonInfo(item.tfid);
    return convertDexEntry(detail ?? item);
  });
}

export async function getProvinceDefenseStatus(provinceName: string, stormId?: string): Promise<ProvinceDefenseStatus> {
  const storms = await getCurrentStorms();
  const storm = storms.find((item) => item.id === stormId) ?? storms[0];
  const province = normalizeProvinceName(provinceName);

  if (!storm) {
    return {
      province,
      status: "安全区",
      rating: "微风级",
      distanceKm: 0,
      riskLine: "当前没有活跃台风，雷达保持待机监测。",
      advice: "保持关注官方预警即可，暂不需要进入防台应急状态。",
      banter: "Boss 尚未刷新，雷达进入巡航待机。"
    };
  }

  const provincePoint = findProvinceReferencePoint(province) ?? findProvinceReferencePoint("浙江");
  if (!provincePoint) {
    throw new Error(`Province center unavailable: ${province}`);
  }
  const center = provincePoint.center;
  const distanceKm = Math.round(distanceBetweenKm(storm.position, { lon: center[0], lat: center[1] }));
  const coreRange = Math.max(storm.windRadiiKm.r12, 40);
  const rainBandRange = Math.max(storm.windRadiiKm.r7, storm.windRadiiKm.r10, 160);
  const watchRange = Math.max(rainBandRange * 2.2, 650);

  if (distanceKm <= coreRange) {
    return buildDefense(
      province,
      "核心风圈区",
      storm.rating,
      distanceKm,
      storm,
      "已接近高强度风圈，请优先执行属地停航、停课、停工和避险指令。",
      "这不是擦边，是 Boss 把技能圈画到脚下了。"
    );
  }

  if (distanceKm <= rainBandRange) {
    return buildDefense(
      province,
      "外围雨带区",
      downgradeRating(storm.rating),
      distanceKm,
      storm,
      "关注强降雨、阵风和城市内涝风险，提前整理阳台与低洼处物品。",
      "外围技能也是真伤，不要把雨带当背景板。"
    );
  }

  if (distanceKm <= watchRange) {
    return buildDefense(
      province,
      "观察区",
      "暴雨级",
      distanceKm,
      storm,
      "建议持续查看官方路径更新，留意后续路径调整和本地预警升级。",
      "Boss 还在远处读条，但雷达边缘已经亮起红点。"
    );
  }

  return buildDefense(
    province,
    "安全区",
    "微风级",
    distanceKm,
    storm,
    "当前距离较远，保持普通关注，不传播未经证实的路径截图。",
    "安全区不是免疫区，是可以冷静看雷达的区域。"
  );
}

export function getDataSourceLabel() {
  return DATA_SOURCE;
}

async function getTyphoonList(year: number): Promise<ZjTyphoonListItem[]> {
  return fetchJson<ZjTyphoonListItem[]>(`${ZJ_API}/TyphoonList/${year}`);
}

async function getTyphoonInfo(tfid: string): Promise<ZjTyphoonInfo | null> {
  try {
    return await fetchJson<ZjTyphoonInfo>(`${ZJ_API}/TyphoonInfo/${tfid}`);
  } catch {
    return null;
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "TyphoonBossRadar/1.0"
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Typhoon API request failed: ${response.status} ${url}`);
  }

  return response.json() as Promise<T>;
}

export async function getGdacsEvidence(name: string, startedAt: string | null, endedAt: string | null): Promise<NonNullable<DexEntry["impactData"]["gdacs"]> | null> {
  if (!name || !startedAt) return null;
  const start = new Date(startedAt.replace(" ", "T"));
  const end = endedAt ? new Date(endedAt.replace(" ", "T")) : new Date(start.getTime() + 5 * 24 * 60 * 60 * 1000);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return null;
  const fromdate = formatDate(start);
  const todate = formatDate(new Date(end.getTime() + 4 * 24 * 60 * 60 * 1000));
  const cacheKey = `${name.toUpperCase()}-${fromdate}-${todate}`;
  const cached = gdacsEvidenceCache.get(cacheKey);
  if (cached) return cached;
  const request = (async () => {
    try {
      const response = await fetch(`${GDACS_SEARCH_API}?eventlist=TC&fromdate=${fromdate}&todate=${todate}`, { cache: "no-store" });
      if (!response.ok) return null;
      const payload = (await response.json()) as GdacsEventCollection;
      const canonicalName = name.trim().toUpperCase();
      const match = (payload.features ?? []).find((feature) => {
        const eventName = feature.properties?.eventname?.toUpperCase() ?? "";
        return feature.properties?.eventtype === "TC" && (eventName === canonicalName || eventName.startsWith(`${canonicalName}-`));
      });
      if (!match?.properties) return null;
      const props = match.properties;
      const countries = (props.affectedcountries ?? []).map((country) => country.countryname).filter((country): country is string => Boolean(country));
      return {
        alertLevel: props.alertlevel ?? "Unknown",
        countries: countries.length ? countries : (props.country ? props.country.split(",").map((item) => item.trim()).filter(Boolean) : []),
        severity: props.severitydata?.severitytext ?? "未提供强度文本",
        sourceUrl: props.url?.report ?? "https://www.gdacs.org/",
        from: props.fromdate ?? "",
        to: props.todate ?? ""
      };
    } catch {
      return null;
    }
  })();
  const cachedRequest = request.then((evidence) => {
    if (!evidence) gdacsEvidenceCache.delete(cacheKey);
    return evidence;
  });
  gdacsEvidenceCache.set(cacheKey, cachedRequest);
  return cachedRequest;
}

function formatDate(value: Date) { return value.toISOString().slice(0, 10); }

function convertStorm(info: ZjTyphoonInfo | ZjTyphoonListItem): Storm | null {
  const points = "points" in info ? info.points ?? [] : [];
  const validPoints = points.filter(isUsablePoint);
  const latest = validPoints.at(-1);
  if (!latest) return null;

  const track = validPoints.map(convertTrackPoint);
  const stage = normalizeStage(latest.strong);
  const rating = ratingFromWind(toNumber(latest.speed), stage);
  const forecastScenarios = convertForecastScenarios(latest);
  const forecast = forecastScenarios.find((scenario) => scenario.isPrimary)?.points ?? forecastScenarios[0]?.points ?? [];
  const windRadiiKm = {
    r7: parseRadius(latest.radius7),
    r10: parseRadius(latest.radius10),
    r12: parseRadius(latest.radius12)
  };

  return {
    id: info.tfid,
    code: info.tfid,
    nameZh: info.name || `编号 ${info.tfid}`,
    nameEn: info.enname,
    stage,
    rating,
    status: info.isactive === "1" ? "实时监测中" : "已停止编号",
    position: {
      lon: toNumber(latest.lng),
      lat: toNumber(latest.lat)
    },
    maxWind: toNumber(latest.speed),
    minPressure: toNumber(latest.pressure),
    moveDirection: normalizeDirection(latest.movedirection),
    moveSpeed: toNumber(latest.movespeed),
    updatedAt: latest.time,
    windRadiiKm,
    track,
    forecast,
    forecastScenarios,
    skills: buildSkills(latest, windRadiiKm),
    notice: NOTICE
  };
}

function convertDexEntry(info: ZjTyphoonInfo | ZjTyphoonListItem): DexEntry {
  const points = "points" in info ? info.points ?? [] : [];
  const usablePoints = points.filter(isUsablePoint);
  const peak = usablePoints.reduce<ZjPoint | null>((best, point) => {
    if (!best) return point;
    return toNumber(point.speed) > toNumber(best.speed) ? point : best;
  }, null);
  const minPressurePoint = usablePoints.reduce<ZjPoint | null>((best, point) => {
    if (!best) return point;
    const pressure = toNumber(point.pressure);
    return pressure > 0 && pressure < toNumber(best.pressure) ? point : best;
  }, null);
  const year = Number(info.tfid.slice(0, 4)) || new Date(info.starttime).getFullYear();
  const stage = normalizeStage(peak?.strong);
  const maxWind = toNumber(peak?.speed);
  const minPressure = toNumber(minPressurePoint?.pressure);
  const retiredKey = info.enname.toUpperCase();
  const retired = retiredKey in retiredNameMap;
  const track = usablePoints.map((point) => ({
    time: point.time,
    lat: toNumber(point.lat),
    lon: toNumber(point.lng),
    wind: toNumber(point.speed),
    pressure: toNumber(point.pressure),
    windRadiusKm: parseRadius(point.radius7)
  }));
  const startedAt = info.starttime || track[0]?.time || null;
  const endedAt = info.endtime || null;
  const durationHours = startedAt && endedAt ? durationBetweenHours(startedAt, endedAt) : null;
  const rawLandfalls = "land" in info && Array.isArray(info.land) ? info.land : [];
  const landfalls = rawLandfalls.map((land) => ({
    time: land.landtime ?? "",
    place: land.landaddress ?? "公开路径档案未注明地点",
    lat: toNumber(land.lat),
    lon: toNumber(land.lng),
    note: land.info
  }));

  return {
    id: info.tfid,
    year,
    nameZh: info.name || `编号 ${info.tfid}`,
    nameEn: info.enname,
    rating: ratingFromWind(maxWind, stage),
    stage,
    retired,
    replacement: retiredNameMap[retiredKey],
    maxWind,
    minPressure,
    summary: buildDexSummary(info, stage, maxWind, minPressure),
    tags: [
      info.isactive === "1" ? "当前活跃" : "历史个体",
      retired ? "已除名" : "未除名",
      info.warnlevel ? `${info.warnlevel}预警` : "路径档案"
    ],
    lifecycle: {
      startedAt,
      endedAt,
      durationHours,
      origin: track[0] ?? null,
      finalPosition: track.at(-1) ?? null
    },
    track,
    landfalls,
    impactData: {
      formationCause: null,
      affectedWindow: landfalls.length ? `${landfalls[0].time} 起有公开登陆记录` : null,
      directEconomicLoss: null,
      sourceNote: "出生、终止、路径、风圈与登陆记录：浙江省水利厅台风路径公开接口。成因与直接经济损失仅在接入逐台风、可核验的官方灾情报告后显示。"
    }
  };
}

function durationBetweenHours(start: string, end: string) {
  const startAt = new Date(start.replace(" ", "T")).getTime();
  const endAt = new Date(end.replace(" ", "T")).getTime();
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt < startAt) return null;
  return Math.round((endAt - startAt) / (60 * 60 * 1000));
}

function convertTrackPoint(point: ZjPoint | ZjForecastPoint): TrackPoint {
  return {
    time: point.time,
    lon: toNumber(point.lng),
    lat: toNumber(point.lat),
    wind: toNumber(point.speed),
    pressure: toNumber(point.pressure)
  };
}

function convertForecastScenarios(point: ZjPoint): ForecastScenario[] {
  const preferredOrder = ["中国", "日本", "美国", "中国台湾", "中国香港"];
  const agencyCodes: Record<string, string> = {
    中国: "CMA",
    日本: "JMA",
    美国: "JTWC",
    中国台湾: "CWA",
    中国香港: "HKO"
  };

  return (point.forecast ?? [])
    .map((group) => ({
      id: `${agencyCodes[group.tm] ?? group.tm}-${point.time}`,
      agency: group.tm,
      agencyCode: agencyCodes[group.tm] ?? group.tm.slice(0, 4).toUpperCase(),
      points: group.forecastpoints.filter(isUsableForecastPoint).map((item, index) => ({
        ...convertTrackPoint(item),
        probability: Math.max(42, 92 - index * 8)
      })),
      isPrimary: group.tm === "中国"
    }))
    .filter((scenario) => scenario.points.length >= 2)
    .sort((a, b) => {
      const aRank = preferredOrder.indexOf(a.agency);
      const bRank = preferredOrder.indexOf(b.agency);
      return (aRank < 0 ? 99 : aRank) - (bRank < 0 ? 99 : bRank);
    });
}

function normalizeStage(strong?: string): StormStage {
  if (!strong) return "热带风暴";
  if (strong.includes("超强")) return "超强台风";
  if (strong.includes("强台风")) return "强台风";
  if (strong.includes("台风")) return "台风";
  if (strong.includes("强热带")) return "强热带风暴";
  if (strong.includes("低压")) return "热带低压";
  return "热带风暴";
}

function ratingFromWind(wind: number, stage: StormStage): BossRating {
  if (wind >= 58 || stage === "超强台风") return "天灾级";
  if (wind >= 51 || stage === "强台风") return "强台风级";
  if (wind >= 33 || stage === "台风") return "台风级";
  if (wind >= 24 || stage === "强热带风暴") return "暴雨级";
  return "微风级";
}

function downgradeRating(rating: BossRating): BossRating {
  if (rating === "天灾级") return "强台风级";
  if (rating === "强台风级") return "台风级";
  if (rating === "台风级") return "暴雨级";
  return "微风级";
}

function normalizeDirection(direction?: string) {
  return direction?.trim() || "暂无";
}

function parseRadius(value?: string): number {
  if (!value) return 0;
  const radii = value
    .split("|")
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > 0);
  return radii.length ? Math.max(...radii) : 0;
}

function buildSkills(point: ZjPoint, radii: Storm["windRadiiKm"]): StormSkill[] {
  const wind = toNumber(point.speed);
  const direction = normalizeDirection(point.movedirection);
  const moveSpeed = toNumber(point.movespeed);

  return [
    {
      name: "风圈压制",
      detail: `七级风圈最大半径约 ${radii.r7 || "暂无"} 公里，核心风圈随路径实时刷新。`,
      severity: clampSeverity(Math.round(wind / 8))
    },
    {
      name: "路径读条",
      detail: `当前向${direction}移动，速度约 ${moveSpeed || "暂无"} 公里/小时，预测路径来自公开预报机构数据。`,
      severity: clampSeverity(Math.round(moveSpeed / 5))
    },
    {
      name: "雨带扩散",
      detail: point.jl?.trim() || "外围雨带影响需要结合本地短临预报判断。",
      severity: clampSeverity(Math.round((radii.r7 || 120) / 70))
    }
  ];
}

function buildDefense(
  province: string,
  status: ProvinceDefenseStatus["status"],
  rating: BossRating,
  distanceKm: number,
  storm: Storm,
  advice: string,
  banter: string
): ProvinceDefenseStatus {
  return {
    province,
    status,
    rating,
    distanceKm,
    riskLine: `${province}距离${storm.nameZh}中心约 ${distanceKm} 公里，当前 Boss 等级为 ${storm.rating}。`,
    advice: `${advice} 真实预警以中央气象台和属地应急部门为准。`,
    banter
  };
}

function buildDexSummary(info: ZjTyphoonListItem, stage: StormStage, maxWind: number, minPressure: number) {
  const start = info.starttime ? info.starttime.slice(0, 10) : "时间未明";
  const windText = maxWind > 0 ? `峰值风速约 ${maxWind} 米/秒` : "峰值风速暂无详报";
  const pressureText = minPressure > 0 ? `最低气压约 ${minPressure} 百帕` : "最低气压暂无详报";
  return `${start} 编号，最高强度为${stage}，${windText}，${pressureText}。`;
}

function isUsablePoint(point: ZjPoint): boolean {
  return Number.isFinite(toNumber(point.lng)) && Number.isFinite(toNumber(point.lat));
}

function isUsableForecastPoint(point: ZjForecastPoint): boolean {
  return Number.isFinite(toNumber(point.lng)) && Number.isFinite(toNumber(point.lat));
}

function toNumber(value: string | number | undefined): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function clampSeverity(value: number) {
  return Math.max(1, Math.min(9, value));
}

function distanceBetweenKm(a: { lon: number; lat: number }, b: { lon: number; lat: number }) {
  const earthRadiusKm = 6371;
  const dLat = degToRad(b.lat - a.lat);
  const dLon = degToRad(b.lon - a.lon);
  const lat1 = degToRad(a.lat);
  const lat2 = degToRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(h));
}

function degToRad(deg: number) {
  return (deg * Math.PI) / 180;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}
