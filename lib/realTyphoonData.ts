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
import { classifyTyphoonHazard, downgradeTyphoonHazard } from "@/lib/typhoonHazardRating";
import { findProvinceReferencePoint, getProvinceBoundaryCoordinates, normalizeProvinceName } from "@/lib/provinceGeo";
import { readControlConsoleSettings } from "@/lib/controlConsoleSettingsStore";
import { evaluateTrackSnapshotRecovery, type TrackSnapshotRecoveryMode } from "@/lib/radarDataContinuity";
import {
  fetchHkoTyphoonTrack,
  HKO_TRACK_SOURCE,
  mergeHkoForecastScenarios,
  normalizeHkoName,
  type HkoTyphoonTrack
} from "@/lib/hkoTyphoonTrack";
import { distanceBetweenKm, distanceToPathKm, maxWindRadius, parseBeijingTime, parseWindRadii, toBeijingIso } from "@/lib/meteorology";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "@/lib/atomicFile";
import { resolveTrackSnapshotStatus } from "@/lib/trackSnapshotStatus";

const GDACS_SEARCH_API = "https://gdacs.org/gdacsapi/api/events/geteventlist/SEARCH";
// The radar client polls every 10 seconds. Do not keep a second server-side
// freshness window here: the latest point must come from the upstream source
// on every polling cycle, even if that source has not published a new fix yet.
const CURRENT_STORMS_CACHE_TTL_MS = 0;
const RELAYED_STORMS_CACHE_TTL_MS = 60 * 1000;
const TRACK_SNAPSHOT_PATH = path.join(process.cwd(), ".runtime", "track-snapshot.json");
const DATA_SOURCE = "浙江省水利厅台风路径公开接口";
const RELAYED_DATA_SOURCE = `${DATA_SOURCE}（经 Jina Reader 只读传输中继）`;
const COMBINED_TRACK_SOURCE = `${HKO_TRACK_SOURCE}（最新中心）+ ${DATA_SOURCE}（历史档案）`;
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
  ckposition?: string;
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
const yearlyTyphoonListCache = new Map<number, { expiresAt: number; items: ZjTyphoonListItem[] }>();

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
let lastTrackWarning: string | null = null;
let lastTrackFetchedAt: string | null = null;
let lastTrackSource = DATA_SOURCE;
let currentLoadUsedReaderRelay = false;
let lastTrackedStorm: LastTrackedStorm | null | undefined;

export interface LastTrackedStorm {
  id: string;
  nameZh: string;
  nameEn: string;
  lastObservedAt: string;
  status: "active" | "exited-live-track";
  exitedLiveTrackAt: string | null;
}

export interface TrackSnapshot {
  source: string;
  observedAt: string | null;
  fetchedAt: string;
  status: "fresh" | "stale" | "unavailable";
  storms: Storm[];
  lastTrackedStorm: LastTrackedStorm | null;
  warnings: string[];
}

export interface TyphoonLifecycleRecord {
  id: string;
  nameZh: string;
  nameEn: string;
  aliases: string[];
  status: "active" | "ceased-numbering";
  finalStage: StormStage | null;
  lastObservedAt: string | null;
  endedAt: string | null;
  source: string;
}

export type TyphoonEntityLookup =
  | { status: "found"; record: TyphoonLifecycleRecord }
  | { status: "not-found"; query: string };

export async function getTrackSnapshot(): Promise<TrackSnapshot> {
  try {
    const storms = await getCurrentStorms();
    const fetchedAt = lastTrackFetchedAt ?? new Date().toISOString();
    const lifecycle = await reconcileLastTrackedStorm(storms, fetchedAt);
    void persistTrackSnapshot(storms, fetchedAt, lifecycle, lastTrackSource);
    return {
      source: lastTrackSource,
      observedAt: storms[0]?.updatedAt ?? null,
      fetchedAt,
      status: resolveTrackSnapshotStatus({
        warning: lastTrackWarning,
        relayedOfficialPayload: lastTrackSource === RELAYED_DATA_SOURCE,
        observedAt: storms[0]?.updatedAt ?? null
      }),
      storms,
      lastTrackedStorm: lifecycle,
      warnings: lastTrackWarning ? [lastTrackWarning] : []
    };
  } catch (error) {
    return {
      source: DATA_SOURCE,
      observedAt: null,
      fetchedAt: new Date().toISOString(),
      status: "unavailable",
      storms: [],
      lastTrackedStorm: lastTrackedStorm ?? null,
      warnings: [error instanceof Error ? error.message : "台风路径源暂时不可用。"]
    };
  }
}

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
      lastTrackWarning = currentLoadUsedReaderRelay
        ? "浙江台风路径官方接口直连 TLS 失败；本轮官方 JSON 经 Jina Reader 只读传输中继取得。机构名称、路径点和数据时次均保留官方原值。"
        : null;
      lastTrackFetchedAt = new Date().toISOString();
      lastTrackSource = currentLoadUsedReaderRelay ? RELAYED_DATA_SOURCE : DATA_SOURCE;
      currentStormsCache = {
        expiresAt: Date.now() + (currentLoadUsedReaderRelay ? RELAYED_STORMS_CACHE_TTL_MS : CURRENT_STORMS_CACHE_TTL_MS),
        storms
      };
      currentStormsInFlight = null;
      return storms;
    },
    async (error) => {
      currentStormsInFlight = null;
      const fallback = await readLastTrackSnapshot();
      if (fallback) {
        const failure = error instanceof Error ? error.message : String(error);
        const hkoRecovery = await recoverLatestCenterFromHko(fallback.storms);
        if (hkoRecovery) {
          currentStormsCache = { expiresAt: 0, storms: hkoRecovery.storms };
          lastTrackFetchedAt = new Date().toISOString();
          lastTrackSource = COMBINED_TRACK_SOURCE;
          lastTrackWarning =
            `${HKO_TRACK_SOURCE}已补入 ${hkoRecovery.observedAt} 的最新中心和强度；` +
            `该来源未发布的中心气压、风圈和移速已显示为暂无，不沿用旧实况。浙江路径源仍刷新失败：${failure}`;
          return hkoRecovery.storms;
        }
        currentStormsCache = { expiresAt: 0, storms: fallback.storms };
        lastTrackFetchedAt = fallback.fetchedAt;
        lastTrackSource = fallback.source;
        lastTrackWarning = fallback.source === COMBINED_TRACK_SOURCE
          ? `${HKO_TRACK_SOURCE}最近一次成功中心为 ${fallback.storms[0]?.updatedAt ?? fallback.fetchedAt}；本轮权威源刷新失败，继续显示该中心。中心气压、风圈和移速仍为暂无：${failure}`
          : fallback.recoveryMode === "forecast-window"
          ? `路径源刷新失败；最后有效实况已超过配置保留期，仅因已发布预报仍覆盖至 ${fallback.forecastEndsAt} 而继续展示。当前位置不是实时位置，请以 ${fallback.storms[0]?.updatedAt ?? fallback.fetchedAt} 的数据时次为准：${failure}`
          : `路径源刷新失败，继续使用最后有效数据：${failure}`;
        return fallback.storms;
      }
      throw error;
    }
  );

  return currentStormsInFlight;
}

async function loadCurrentStorms(): Promise<Storm[]> {
  currentLoadUsedReaderRelay = false;
  const year = new Date().getFullYear();
  const list = await getTyphoonList(year);
  const activeItems = list.filter((item) => item.isactive === "1");
  const storms = await Promise.all(
    activeItems.map(async (item) => {
      const detail = await getTyphoonInfo(item.tfid);
      if (!detail) {
        throw new Error(`Active typhoon detail unavailable: ${item.tfid}`);
      }
      return convertStorm(detail);
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

  return listItems.map(convertDexEntry);
}

/**
 * Resolve a named system from the same upstream archive used by the live
 * radar. This is intentionally separate from the active-track snapshot:
 * a system that has stopped being numbered must not disappear from answers.
 */
export async function findTyphoonLifecycle(query: string): Promise<TyphoonEntityLookup> {
  const normalizedQuery = normalizeTyphoonName(query);
  if (!normalizedQuery) return { status: "not-found", query };

  const currentYear = new Date().getFullYear();
  for (let year = currentYear; year >= 2010; year -= 1) {
    const items = await getTyphoonList(year);
    const item = items.find((candidate) => typhoonNameMatches(normalizedQuery, candidate));
    if (!item) continue;

    const detail = await getTyphoonInfo(item.tfid);
    return {
      status: "found",
      record: buildTyphoonLifecycleRecord(detail ?? item)
    };
  }

  return { status: "not-found", query };
}

export function buildTyphoonLifecycleRecord(info: ZjTyphoonInfo | ZjTyphoonListItem): TyphoonLifecycleRecord {
  const points = "points" in info ? (info.points ?? []).filter(isUsablePoint) : [];
  const latest = points.at(-1);
  const nameZh = info.name || `编号 ${info.tfid}`;
  const nameEn = info.enname || "";
  return {
    id: info.tfid,
    nameZh,
    nameEn,
    aliases: [...new Set([nameZh, nameEn].filter(Boolean))],
    status: info.isactive === "1" ? "active" : "ceased-numbering",
    // The archive gives us the last observed classification, not a guessed
    // post-analysis. Keep that boundary explicit for downstream narration.
    finalStage: latest ? normalizeStage(latest.strong) : null,
    lastObservedAt: latest ? (toBeijingIso(latest.time) ?? latest.time) : null,
    endedAt: info.endtime ? (toBeijingIso(info.endtime) ?? info.endtime) : null,
    source: DATA_SOURCE
  };
}

export async function getDexEntry(id: string): Promise<DexEntry | null> {
  if (!/^\d{6}$/.test(id)) return null;
  const detail = await getTyphoonInfo(id);
  return detail ? convertDexEntry(detail) : null;
}

export async function getProvinceDefenseStatus(provinceName: string, stormId?: string): Promise<ProvinceDefenseStatus> {
  const storms = await getCurrentStorms();
  const storm = storms.find((item) => item.id === stormId) ?? storms[0];
  const province = normalizeProvinceName(provinceName);

  if (!storm) {
    return {
      province,
      status: "安全区",
      rating: "无威胁",
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
  const boundary = getProvinceBoundaryCoordinates(province);
  const targets = boundary.length ? boundary : [{ lon: center[0], lat: center[1] }];
  const path = [storm.position, ...storm.forecast];
  const distanceKm = Math.round(Math.min(...targets.map((target) => distanceToPathKm(target, path) ?? distanceBetweenKm(storm.position, target))));
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
      "当前路径资料显示中心距离较近，请立即查看并遵循属地气象与应急部门发布。",
      "这不是擦边，是 Boss 把技能圈画到脚下了。"
    );
  }

  if (distanceKm <= rainBandRange) {
    return buildDefense(
      province,
      "外围雨带区",
      downgradeTyphoonHazard(storm.rating),
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
      "狼级",
      distanceKm,
      storm,
      "建议持续查看官方路径更新，留意后续路径调整和本地预警升级。",
      "Boss 还在远处读条，但雷达边缘已经亮起红点。"
    );
  }

  return buildDefense(
    province,
    "安全区",
    "无威胁",
    distanceKm,
    storm,
    "当前距离较远，保持普通关注，不传播未经证实的路径截图。",
    "安全区不是免疫区，是可以冷静看雷达的区域。"
  );
}

export function getDataSourceLabel() {
  return lastTrackSource;
}

async function getTyphoonList(year: number): Promise<ZjTyphoonListItem[]> {
  const currentYear = new Date().getFullYear();
  const cached = yearlyTyphoonListCache.get(year);
  // Historical archive lists are stable enough for a day-long cache. The
  // current-year list is also the active-storm discovery feed, so caching it
  // would hide a newly numbered storm while still reporting a fresh fetch.
  if (year !== currentYear && cached && cached.expiresAt > Date.now()) return cached.items;
  const items = await fetchJson<ZjTyphoonListItem[]>(`${await typhoonApiBase()}/TyphoonList/${year}`);
  if (year !== currentYear) {
    yearlyTyphoonListCache.set(year, { expiresAt: Date.now() + 24 * 60 * 60 * 1000, items });
  }
  return items;
}

async function getTyphoonInfo(tfid: string): Promise<ZjTyphoonInfo | null> {
  try {
    return await fetchJson<ZjTyphoonInfo>(`${await typhoonApiBase()}/TyphoonInfo/${tfid}`);
  } catch {
    return null;
  }
}

async function typhoonApiBase() {
  const settings = await readControlConsoleSettings();
  return settings.dataSources.typhoonTrackBaseUrl.replace(/\/$/, "");
}

async function fetchJson<T>(url: string): Promise<T> {
  const settings = await readControlConsoleSettings();
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "TyphoonBossRadar/1.0"
      },
      cache: "no-store",
      signal: AbortSignal.timeout(settings.reliability.requestTimeoutSeconds * 1000)
    });
    if (!response.ok) throw new Error(`Typhoon API request failed: ${response.status} ${url}`);
    return response.json() as Promise<T>;
  } catch (directError) {
    try {
      const relayUrl = `https://r.jina.ai/http://${url}`;
      const response = await fetch(relayUrl, {
        headers: { Accept: "text/plain", "User-Agent": "TyphoonBossRadar/1.0" },
        cache: "no-store",
        signal: AbortSignal.timeout(settings.reliability.requestTimeoutSeconds * 1000)
      });
      if (!response.ok) throw new Error(`reader relay HTTP ${response.status}`);
      const body = await response.text();
      const marker = "Markdown Content:";
      const markerIndex = body.indexOf(marker);
      if (markerIndex < 0) throw new Error("reader relay response has no JSON marker");
      const payload = JSON.parse(body.slice(markerIndex + marker.length).trim()) as T;
      currentLoadUsedReaderRelay = true;
      return payload;
    } catch (relayError) {
      const directMessage = directError instanceof Error ? directError.message : String(directError);
      const relayMessage = relayError instanceof Error ? relayError.message : String(relayError);
      throw new Error(`Typhoon API direct and relay requests failed: ${directMessage}; ${relayMessage}`);
    }
  }
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
  const forecastScenarios = convertForecastScenarios(latest);
  const forecast = forecastScenarios.find((scenario) => scenario.isPrimary)?.points ?? forecastScenarios[0]?.points ?? [];
  const r7 = parseWindRadii(latest.radius7);
  const r10 = parseWindRadii(latest.radius10);
  const r12 = parseWindRadii(latest.radius12);
  const windRadiiKm = {
    r7: maxWindRadius(r7),
    r10: maxWindRadius(r10),
    r12: maxWindRadius(r12),
    quadrants: {
      r7: { ...r7, max: maxWindRadius(r7) },
      r10: { ...r10, max: maxWindRadius(r10) },
      r12: { ...r12, max: maxWindRadius(r12) }
    }
  };
  const windRadiiReports = {
    r7: latestWindRadiusReport(validPoints, "radius7"),
    r10: latestWindRadiusReport(validPoints, "radius10"),
    r12: latestWindRadiusReport(validPoints, "radius12")
  };
  const rating = classifyTyphoonHazard(toNumber(latest.speed), stage, windRadiiKm);

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
    updatedAt: toBeijingIso(latest.time) ?? latest.time,
    windRadiiKm,
    windRadiiReports,
    track,
    forecast,
    forecastScenarios,
    landfalls: ("land" in info ? info.land ?? [] : []).map((land) => ({
      time: toBeijingIso(land.landtime) ?? land.landtime ?? "",
      place: land.landaddress ?? "公开路径档案未注明地点",
      lat: toNumber(land.lat),
      lon: toNumber(land.lng),
      note: land.info?.trim() || undefined
    })).filter((land) => Boolean(land.time)),
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
    rating: classifyTyphoonHazard(maxWind, stage, {
      r7: parseRadius(peak?.radius7),
      r10: parseRadius(peak?.radius10),
      r12: parseRadius(peak?.radius12)
    }),
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
  const startAt = parseBeijingTime(start);
  const endAt = parseBeijingTime(end);
  if (startAt === null || endAt === null || endAt < startAt) return null;
  return Math.round((endAt - startAt) / (60 * 60 * 1000));
}

function convertTrackPoint(point: ZjPoint | ZjForecastPoint): TrackPoint {
  return {
    time: toBeijingIso(point.time) ?? point.time,
    lon: toNumber(point.lng),
    lat: toNumber(point.lat),
    wind: toNumber(point.speed),
    pressure: toNumber(point.pressure),
    locationDescription: "ckposition" in point ? point.ckposition?.trim() || undefined : undefined
  };
}

async function reconcileLastTrackedStorm(storms: Storm[], fetchedAt: string): Promise<LastTrackedStorm | null> {
  if (lastTrackedStorm === undefined) {
    lastTrackedStorm = (await readLastTrackSnapshot())?.lastTrackedStorm ?? null;
  }
  const activeStorm = storms[0] ?? null;
  if (activeStorm) {
    lastTrackedStorm = {
      id: activeStorm.id,
      nameZh: activeStorm.nameZh,
      nameEn: activeStorm.nameEn,
      lastObservedAt: activeStorm.updatedAt,
      status: "active",
      exitedLiveTrackAt: null
    };
  } else if (lastTrackedStorm?.status === "active") {
    // This is a feed-state transition, not an assertion that an agency has
    // issued a formal termination bulletin.
    lastTrackedStorm = { ...lastTrackedStorm, status: "exited-live-track", exitedLiveTrackAt: fetchedAt };
  }
  return lastTrackedStorm;
}

async function persistTrackSnapshot(
  storms: Storm[],
  fetchedAt: string,
  lifecycle: LastTrackedStorm | null,
  source: string
) {
  try {
    await writeFileAtomic(
      TRACK_SNAPSHOT_PATH,
      JSON.stringify({ version: 3, source, fetchedAt, storms, lastTrackedStorm: lifecycle })
    );
  } catch (error) {
    console.warn("[track-snapshot] persistence failed", error);
  }
}

async function readLastTrackSnapshot(): Promise<{
  fetchedAt: string;
  storms: Storm[];
  lastTrackedStorm: LastTrackedStorm | null;
  recoveryMode: TrackSnapshotRecoveryMode;
  forecastEndsAt: string | null;
  source: string;
} | null> {
  try {
    const settings = await readControlConsoleSettings();
    const payload = JSON.parse(await readFile(TRACK_SNAPSHOT_PATH, "utf8")) as {
      version?: number;
      source?: string;
      fetchedAt?: string;
      storms?: Storm[];
      lastTrackedStorm?: unknown;
    };
    const fetchedAt = Date.parse(payload.fetchedAt ?? "");
    if (![1, 2, 3].includes(payload.version ?? 0) || !Array.isArray(payload.storms) || !Number.isFinite(fetchedAt)) return null;
    const lifecycle = normalizeLastTrackedStorm(payload.lastTrackedStorm);
    const recovery = evaluateTrackSnapshotRecovery({
      fetchedAt: payload.fetchedAt as string,
      retainLastGoodDataHours: settings.reliability.retainLastGoodDataHours,
      active: lifecycle?.status === "active" && payload.storms.some((storm) => storm.id === lifecycle.id),
      forecastTimes: payload.storms.flatMap((storm) => [
        ...storm.forecast.map((point) => point.time),
        ...storm.forecastScenarios.flatMap((scenario) => scenario.points.map((point) => point.time))
      ])
    });
    if (!recovery.retain) return null;
    return {
      fetchedAt: payload.fetchedAt as string,
      storms: payload.storms,
      lastTrackedStorm: lifecycle,
      recoveryMode: recovery.mode,
      forecastEndsAt: recovery.forecastEndsAt,
      source: payload.source || DATA_SOURCE
    };
  } catch {
    return null;
  }
}

async function recoverLatestCenterFromHko(storms: Storm[]): Promise<{ storms: Storm[]; observedAt: string } | null> {
  if (storms.length === 0) return null;
  try {
    const settings = await readControlConsoleSettings();
    const report = await fetchHkoTyphoonTrack(settings.reliability.requestTimeoutSeconds * 1000);
    const currentAgeMs = Date.now() - Date.parse(report.current.time);
    if (!Number.isFinite(currentAgeMs) || currentAgeMs < -60 * 60 * 1000 || currentAgeMs > 12 * 60 * 60 * 1000) {
      return null;
    }
    const match = storms.find((storm) => normalizeHkoName(storm.nameZh) === normalizeHkoName(report.nameZh));
    if (!match || Date.parse(report.current.time) < Date.parse(match.updatedAt)) return null;
    return {
      storms: storms.map((storm) => storm.id === match.id ? mergeHkoTrack(storm, report) : storm),
      observedAt: report.current.time
    };
  } catch {
    return null;
  }
}

function mergeHkoTrack(storm: Storm, report: HkoTyphoonTrack): Storm {
  const historyByTime = new Map(storm.track.map((point) => [point.time, point]));
  for (const point of report.history) {
    historyByTime.set(point.time, {
      time: point.time,
      lat: point.lat,
      lon: point.lon,
      wind: point.wind,
      pressure: 0
    });
  }
  const track = [...historyByTime.values()].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  const zeroRadius = { ne: 0, se: 0, sw: 0, nw: 0, max: 0 };
  const windRadiiKm = {
    r7: 0,
    r10: 0,
    r12: 0,
    quadrants: { r7: zeroRadius, r10: zeroRadius, r12: zeroRadius }
  };
  const forecastScenarios = mergeHkoForecastScenarios(storm.forecastScenarios, report);

  return {
    ...storm,
    nameZh: normalizeHkoName(report.nameZh),
    stage: report.current.stage,
    rating: classifyTyphoonHazard(report.current.wind, report.current.stage, windRadiiKm),
    status: "实时监测中 · HKO 最新中心",
    position: { lat: report.current.lat, lon: report.current.lon },
    maxWind: report.current.wind,
    minPressure: 0,
    moveDirection: "暂无",
    moveSpeed: 0,
    updatedAt: report.current.time,
    windRadiiKm,
    windRadiiReports: { r7: null, r10: null, r12: null },
    track,
    forecast: report.forecast,
    forecastScenarios,
    skills: []
  };
}

function normalizeLastTrackedStorm(value: unknown): LastTrackedStorm | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<LastTrackedStorm>;
  if (!item.id || !item.nameZh || !item.nameEn || !item.lastObservedAt) return null;
  if (item.status !== "active" && item.status !== "exited-live-track") return null;
  return {
    id: item.id,
    nameZh: item.nameZh,
    nameEn: item.nameEn,
    lastObservedAt: item.lastObservedAt,
    status: item.status,
    exitedLiveTrackAt: item.exitedLiveTrackAt ?? null
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
      points: group.forecastpoints.filter(isUsableForecastPoint).map(convertTrackPoint),
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

function normalizeDirection(direction?: string) {
  return direction?.trim() || "暂无";
}

function parseRadius(value?: string): number { return maxWindRadius(parseWindRadii(value)); }

function latestWindRadiusReport(points: ZjPoint[], field: "radius7" | "radius10" | "radius12") {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index];
    const quadrants = parseWindRadii(point[field]);
    const max = maxWindRadius(quadrants);
    if (max <= 0) continue;
    return {
      ...quadrants,
      max,
      observedAt: toBeijingIso(point.time) ?? point.time,
      position: { lat: toNumber(point.lat), lon: toNumber(point.lng) }
    };
  }
  return null;
}

function normalizeTyphoonName(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[\s\-_.()（）,，。！？?]/g, "");
}

function typhoonNameMatches(normalizedQuery: string, item: ZjTyphoonListItem): boolean {
  return [item.name, item.enname]
    .map((name) => normalizeTyphoonName(name || ""))
    .filter(Boolean)
    .some((name) => normalizedQuery.includes(name) || name.includes(normalizedQuery));
}

function buildSkills(
  point: ZjPoint,
  radii: Storm["windRadiiKm"]
): StormSkill[] {
  const wind = toNumber(point.speed);
  const direction = normalizeDirection(point.movedirection);
  const moveSpeed = toNumber(point.movespeed);

  return [
    ...(radii.r7 > 0 ? [{
      name: "风圈压制",
      detail: `七级风圈最大半径约 ${radii.r7} 公里，来自当前实况时次。`,
      severity: clampSeverity(Math.round(wind / 8))
    }] : []),
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
