import type {
  BossRating,
  DexEntry,
  ForecastPoint,
  ProvinceDefenseStatus,
  Storm,
  StormSkill,
  StormStage,
  TrackPoint
} from "@/lib/types";

const ZJ_API = "https://typhoon.slt.zj.gov.cn/Api";
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
  land?: string;
  points?: ZjPoint[];
}

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

const provinceCenters: Record<string, [number, number]> = {
  北京: [116.4, 39.9],
  天津: [117.2, 39.1],
  河北: [114.5, 38.0],
  山西: [112.5, 37.9],
  内蒙古: [111.7, 40.8],
  辽宁: [123.4, 41.8],
  吉林: [125.3, 43.9],
  黑龙江: [126.6, 45.8],
  上海: [121.5, 31.2],
  江苏: [118.8, 32.1],
  浙江: [120.2, 30.3],
  安徽: [117.3, 31.9],
  福建: [119.3, 26.1],
  江西: [115.9, 28.7],
  山东: [117.0, 36.7],
  河南: [113.6, 34.8],
  湖北: [114.3, 30.6],
  湖南: [112.9, 28.2],
  广东: [113.3, 23.1],
  广西: [108.3, 22.8],
  海南: [110.3, 20.0],
  重庆: [106.5, 29.6],
  四川: [104.1, 30.7],
  贵州: [106.7, 26.6],
  云南: [102.7, 25.0],
  西藏: [91.1, 29.7],
  陕西: [108.9, 34.3],
  甘肃: [103.8, 36.1],
  青海: [101.8, 36.6],
  宁夏: [106.2, 38.5],
  新疆: [87.6, 43.8],
  台湾: [121.0, 23.7],
  香港: [114.2, 22.3],
  澳门: [113.5, 22.2]
};

export async function getCurrentStorms(): Promise<Storm[]> {
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

  const center = provinceCenters[province] ?? provinceCenters.浙江;
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

function convertStorm(info: ZjTyphoonInfo | ZjTyphoonListItem): Storm | null {
  const points = "points" in info ? info.points ?? [] : [];
  const validPoints = points.filter(isUsablePoint);
  const latest = validPoints.at(-1);
  if (!latest) return null;

  const track = validPoints.map(convertTrackPoint);
  const stage = normalizeStage(latest.strong);
  const rating = ratingFromWind(toNumber(latest.speed), stage);
  const forecast = convertForecast(latest);
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
    ]
  };
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

function convertForecast(point: ZjPoint): ForecastPoint[] {
  const groups = point.forecast ?? [];
  const group = groups.find((item) => item.tm === "中国") ?? groups[0];
  const forecastPoints = group?.forecastpoints ?? [];

  return forecastPoints.filter(isUsableForecastPoint).map((item, index) => ({
    ...convertTrackPoint(item),
    probability: Math.max(42, 92 - index * 8)
  }));
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

function normalizeProvinceName(name: string) {
  return name
    .replace(/特别行政区|壮族自治区|回族自治区|维吾尔自治区|自治区|省|市/g, "")
    .trim();
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
