import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  buildDeterministicNationalSituationBroadcast,
  buildNationalSituationBroadcastPrompt,
  validateLegacyTyphoonNarrative,
  validateNationalSituationBroadcast
} from "../lib/agent/nationalSituationBroadcast.mjs";
import {
  buildTropicalDisturbanceOutlook,
  CPC_WEEK2_TC_KML_URL,
  CPC_WEEK3_TC_KML_URL,
  JTWC_WESTERN_PACIFIC_ADVISORY_URL,
  renderTropicalDisturbanceReport
} from "../lib/agent/tropicalDisturbanceOutlook.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeDir = path.join(root, ".runtime");
const statePath = path.join(runtimeDir, "typhoon-evolution-agent.json");
const reportPath = path.join(root, "台风实时演进分析.md");
let apiBase = "https://typhoon.slt.zj.gov.cn/Api";
let miniMaxEndpoint = "https://api.minimaxi.com/v1/chat/completions";
let miniMaxModel = "MiniMax-M3";
let documentAgentApiKey = "";
let documentAgentTimeoutMs = 60_000;
let documentAgentRetryCount = 1;
const cityWindCacheMs = 50 * 60 * 1000;
const cityLocations = [
  { region: "北京市", city: "北京", lat: 39.9042, lon: 116.4074 },
  { region: "天津市", city: "天津", lat: 39.0842, lon: 117.2010 },
  { region: "河北省", city: "石家庄", lat: 38.0428, lon: 114.5149 },
  { region: "山西省", city: "太原", lat: 37.8706, lon: 112.5489 },
  { region: "内蒙古自治区", city: "呼和浩特", lat: 40.8426, lon: 111.7492 },
  { region: "辽宁省", city: "沈阳", lat: 41.8057, lon: 123.4315 },
  { region: "吉林省", city: "长春", lat: 43.8171, lon: 125.3235 },
  { region: "黑龙江省", city: "哈尔滨", lat: 45.8038, lon: 126.5340 },
  { region: "上海市", city: "上海", lat: 31.2304, lon: 121.4737 },
  { region: "江苏省", city: "南京", lat: 32.0603, lon: 118.7969 },
  { region: "浙江省", city: "杭州", lat: 30.2741, lon: 120.1551 },
  { region: "安徽省", city: "合肥", lat: 31.8206, lon: 117.2272 },
  { region: "福建省", city: "福州", lat: 26.0745, lon: 119.2965 },
  { region: "江西省", city: "南昌", lat: 28.6820, lon: 115.8579 },
  { region: "山东省", city: "济南", lat: 36.6512, lon: 117.1201 },
  { region: "河南省", city: "郑州", lat: 34.7466, lon: 113.6254 },
  { region: "湖北省", city: "武汉", lat: 30.5928, lon: 114.3055 },
  { region: "湖南省", city: "长沙", lat: 28.2282, lon: 112.9388 },
  { region: "广东省", city: "广州", lat: 23.1291, lon: 113.2644 },
  { region: "广西壮族自治区", city: "南宁", lat: 22.8170, lon: 108.3669 },
  { region: "海南省", city: "海口", lat: 20.0440, lon: 110.1999 },
  { region: "重庆市", city: "重庆", lat: 29.4316, lon: 106.9123 },
  { region: "四川省", city: "成都", lat: 30.5728, lon: 104.0668 },
  { region: "贵州省", city: "贵阳", lat: 26.6470, lon: 106.6302 },
  { region: "云南省", city: "昆明", lat: 25.0389, lon: 102.7183 },
  { region: "西藏自治区", city: "拉萨", lat: 29.6520, lon: 91.1721 },
  { region: "陕西省", city: "西安", lat: 34.3416, lon: 108.9398 },
  { region: "甘肃省", city: "兰州", lat: 36.0611, lon: 103.8343 },
  { region: "青海省", city: "西宁", lat: 36.6171, lon: 101.7782 },
  { region: "宁夏回族自治区", city: "银川", lat: 38.4872, lon: 106.2309 },
  { region: "新疆维吾尔自治区", city: "乌鲁木齐", lat: 43.8256, lon: 87.6168 },
  { region: "台湾省", city: "台北", lat: 25.0330, lon: 121.5654 },
  { region: "香港特别行政区", city: "香港", lat: 22.3193, lon: 114.1694 },
  { region: "澳门特别行政区", city: "澳门", lat: 22.1987, lon: 113.5439 }
];

// Keep the background agent credential isolated from unrelated server keys.
// The dedicated ignored file wins because the loader preserves the first
// configured value.
loadEnvFile(path.join(root, ".env.agent.local"));
loadEnvFile(path.join(root, ".env.local"));

async function main() {
  await applyControlConsoleOverrides();
  const apiKey = documentAgentApiKey || process.env.MINIMAX_API_KEY;
  if (!apiKey) throw new Error("MINIMAX_API_KEY is missing. Add it to the local .env.local file.");

  const now = new Date();
  const previousState = await readJson(statePath, emptyState());
  const [facts, cityWind, nationalSnapshot] = await Promise.all([
    collectTyphoonFacts(now),
    collectCityWind(previousState.cityWind ?? null, now),
    readJson(path.join(runtimeDir, "national-situation.json"), null)
  ]);
  const nationalPrompt = buildNationalSituationBroadcastPrompt(nationalSnapshot, { now: now.toISOString() });
  const trackSnapshot = await readJson(path.join(runtimeDir, "track-snapshot.json"), null);
  const changeSet = buildChangeSet(previousState.snapshotByStormId, facts.storms);
  const disturbanceOutlook = facts.storms.length === 0
    ? await collectTropicalDisturbanceOutlook(now)
    : null;
  const lifecycleEvents = reconcileLifecycleEvents(
    previousState.lifecycleEvents,
    previousState.snapshotByStormId,
    facts.storms,
    trackSnapshot?.lastTrackedStorm,
    now,
  );
  let analysis;
  let analysisMode = "MiniMax M3 智能汇总";
  if (disturbanceOutlook) {
    analysis = renderTropicalDisturbanceReport(disturbanceOutlook);
    analysisMode = "JTWC 近时扰动 + NOAA CPC 延伸期概率规则化研判";
  } else {
    try {
      analysis = await requestAnalysis(apiKey, facts, changeSet, previousState.lastAnalysis ?? null);
    } catch (error) {
      analysis = buildDeterministicAnalysis(facts, changeSet);
      analysisMode = `规则化保底汇总（MiniMax 本轮异常：${error instanceof Error ? error.message : "未知错误"}）`;
    }
  }
  let nationalBroadcast;
  let nationalBroadcastMode = "MiniMax M3 结构化全国态势播报";
  try {
    nationalBroadcast = await requestNationalSituationBroadcast(apiKey, nationalPrompt);
  } catch (error) {
    nationalBroadcast = buildDeterministicNationalSituationBroadcast(nationalPrompt);
    nationalBroadcastMode = `规则化保底播报（MiniMax 本轮异常：${error instanceof Error ? error.message : "未知错误"}）`;
  }
  const history = buildHistory(previousState.history, facts, changeSet, analysis, now);
  const nextState = {
    version: 5,
    updatedAt: now.toISOString(),
    snapshotByStormId: Object.fromEntries(facts.storms.map((storm) => [storm.id, compactSnapshot(storm)])),
    cityWind,
    history,
    lifecycleEvents,
    lastAnalysis: analysis,
    lastNationalBroadcast: nationalBroadcast,
    lastDisturbanceOutlook: disturbanceOutlook
  };

  await mkdir(runtimeDir, { recursive: true });
  await writeAtomicJson(statePath, nextState);
  await writeAtomicText(reportPath, renderReport(
    facts,
    changeSet,
    cityWind,
    analysis,
    analysisMode,
    nationalBroadcast,
    nationalBroadcastMode,
    history,
    lifecycleEvents,
    now
  ));
  console.log(`Updated ${path.basename(reportPath)} with ${facts.storms.length} active storm(s) and ${cityWind.cities.length} city wind rows.`);
}

async function applyControlConsoleOverrides() {
  const settings = await readJson(path.join(runtimeDir, "control-console.json"), null);
  if (!settings || typeof settings !== "object") return;
  const sourceBaseUrl = settings.dataSources?.typhoonTrackBaseUrl;
  if (typeof sourceBaseUrl === "string" && sourceBaseUrl.trim()) apiBase = sourceBaseUrl.trim().replace(/\/$/, "");
  const route = settings.routes?.documentAgent;
  if (!route || typeof route !== "object") return;
  if (typeof route.endpoint === "string" && route.endpoint.trim()) miniMaxEndpoint = route.endpoint.trim();
  if (typeof route.model === "string" && route.model.trim()) miniMaxModel = route.model.trim();
  if (typeof route.apiKey === "string" && route.apiKey.trim()) documentAgentApiKey = route.apiKey.trim();
  if (Number.isFinite(Number(route.timeoutSeconds))) documentAgentTimeoutMs = Math.max(5_000, Math.min(180_000, Number(route.timeoutSeconds) * 1000));
  if (Number.isFinite(Number(settings.automation?.retryCount))) documentAgentRetryCount = Math.max(0, Math.min(3, Math.round(Number(settings.automation.retryCount))));
}

async function collectTyphoonFacts(now) {
  const year = now.getFullYear();
  const list = await fetchJson(`${apiBase}/TyphoonList/${year}`);
  const activeItems = Array.isArray(list) ? list.filter((item) => item.isactive === "1") : [];
  const storms = await Promise.all(activeItems.map(async (item) => normalizeStorm(item, await fetchJson(`${apiBase}/TyphoonInfo/${item.tfid}`))));
  return {
    collectedAt: now.toISOString(),
    source: "浙江省水利厅台风路径公开接口",
    sourceUrl: `${apiBase}/TyphoonList/${year}`,
    storms: storms.filter(Boolean)
  };
}

async function collectTropicalDisturbanceOutlook(now) {
  const [jtwc, week2, week3] = await Promise.allSettled([
    fetchText(JTWC_WESTERN_PACIFIC_ADVISORY_URL, "JTWC 西北太平洋扰动公报"),
    fetchText(CPC_WEEK2_TC_KML_URL, "NOAA CPC 第2周热带气旋生成概率"),
    fetchText(CPC_WEEK3_TC_KML_URL, "NOAA CPC 第3周热带气旋生成概率")
  ]);
  return buildTropicalDisturbanceOutlook({
    jtwcAdvisory: jtwc.status === "fulfilled" ? jtwc.value : null,
    cpcWeek2Kml: week2.status === "fulfilled" ? week2.value : null,
    cpcWeek3Kml: week3.status === "fulfilled" ? week3.value : null
  }, { now });
}

async function collectCityWind(previousCityWind, now) {
  const previousFetchedAt = Date.parse(previousCityWind?.fetchedAt ?? "");
  const completePrevious = Array.isArray(previousCityWind?.cities) && previousCityWind.cities.length === cityLocations.length;
  if (completePrevious && Number.isFinite(previousFetchedAt) && now.getTime() - previousFetchedAt < cityWindCacheMs) {
    return {
      ...previousCityWind,
      reusedAt: now.toISOString(),
      note: "沿用同一模式时次的已缓存城市风场；下一小时重新采集。"
    };
  }

  const previousByCity = new Map(
    (Array.isArray(previousCityWind?.cities) ? previousCityWind.cities : []).map((item) => [`${item.region}/${item.city}`, item])
  );
  const fetched = await mapWithConcurrency(cityLocations, 4, fetchCityWind);
  let freshCount = 0;
  const cities = cityLocations.map((location, index) => {
    const current = fetched[index];
    if (current) {
      freshCount += 1;
      return { ...location, ...current, stale: false };
    }
    const previous = previousByCity.get(`${location.region}/${location.city}`);
    if (previous && Number.isFinite(previous.windMps)) {
      return { ...previous, stale: true };
    }
    return {
      ...location,
      windMps: null,
      windForceLevel: null,
      windDirection: "—",
      observedAt: null,
      stale: true
    };
  });
  const observedAt = cities.find((city) => city.observedAt)?.observedAt ?? previousCityWind?.observedAt ?? null;
  return {
    source: "MET Norway Locationforecast 2.0 全球预报",
    sourceUrl: "https://api.met.no/weatherapi/locationforecast/2.0/compact",
    fetchedAt: now.toISOString(),
    observedAt,
    freshCount,
    staleCount: cities.length - freshCount,
    note: freshCount === cities.length
      ? "34 个代表城市均取得本轮 10 米风场数据。"
      : `本轮取得 ${freshCount}/${cities.length} 个城市的新数据；其余城市保留最后有效值或标记暂缺。`,
    cities
  };
}

async function fetchCityWind(location) {
  const query = new URLSearchParams({ lat: location.lat.toFixed(3), lon: location.lon.toFixed(3) });
  const response = await fetch(`https://api.met.no/weatherapi/locationforecast/2.0/compact?${query.toString()}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": process.env.WEATHER_API_USER_AGENT ?? "TyphoonBossRadarEvolutionAgent/2.0 local-deployment"
    },
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`MET Norway city wind request failed: ${response.status}`);
  const payload = await response.json();
  const timeseries = payload?.properties?.timeseries?.[0];
  const details = timeseries?.data?.instant?.details;
  const windMps = Number(details?.wind_speed);
  const direction = Number(details?.wind_from_direction);
  if (!Number.isFinite(windMps) || !Number.isFinite(direction)) {
    throw new Error(`MET Norway returned incomplete wind data for ${location.city}.`);
  }
  return {
    windMps: Number(windMps.toFixed(1)),
    windForceLevel: windForceFromSpeed(windMps),
    windDirection: windDirectionLabel(direction),
    observedAt: String(timeseries?.time ?? payload?.properties?.meta?.updated_at ?? "") || null
  };
}

async function mapWithConcurrency(items, concurrency, task) {
  const results = new Array(items.length).fill(null);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = await task(items[index]);
      } catch {
        results[index] = null;
      }
    }
  });
  await Promise.all(workers);
  return results;
}

function normalizeStorm(listItem, detail) {
  const points = Array.isArray(detail?.points) ? detail.points.filter(hasCoordinates) : [];
  const latest = points.at(-1);
  if (!latest) return null;
  const prior = points.at(-2) ?? null;
  const primaryForecast = (latest.forecast ?? []).find((item) => item.tm === "中国") ?? latest.forecast?.[0] ?? null;
  const forecast = (primaryForecast?.forecastpoints ?? []).filter(hasCoordinates).slice(0, 4).map(toPoint);

  return {
    id: String(detail?.tfid ?? listItem.tfid),
    nameZh: String(detail?.name ?? listItem.name ?? "未命名台风"),
    nameEn: String(detail?.enname ?? listItem.enname ?? "UNKNOWN"),
    sourceActive: String(detail?.isactive ?? listItem.isactive) === "1",
    latest: toPoint(latest),
    previous: prior ? toPoint(prior) : null,
    windRadiiKm: {
      r7: maxRadius(latest.radius7),
      r10: maxRadius(latest.radius10),
      r12: maxRadius(latest.radius12)
    },
    forecast,
    pointCount: points.length
  };
}

function toPoint(point) {
  return {
    observedAt: String(point.time ?? ""),
    longitude: numberOrNull(point.lng),
    latitude: numberOrNull(point.lat),
    windMps: numberOrNull(point.speed),
    pressureHpa: numberOrNull(point.pressure),
    movementKmh: numberOrNull(point.movespeed),
    movementDirection: String(point.movedirection ?? "未提供"),
    stage: String(point.strong ?? "未提供")
  };
}

function buildChangeSet(previousById, storms) {
  return storms.map((storm) => {
    const previousRun = previousById?.[storm.id] ?? null;
    if (!previousRun) return { stormId: storm.id, kind: "first-observation", summary: "首次纳入本智能体观测，尚无上一轮对比。" };
    const now = storm.latest;
    const before = previousRun.latest;
    const sourcePointChanged = now.observedAt !== before.observedAt;
    return {
      stormId: storm.id,
      kind: sourcePointChanged ? "new-source-point" : "source-unchanged",
      sourcePointChanged,
      fromObservedAt: before.observedAt,
      toObservedAt: now.observedAt,
      deltaLongitude: difference(now.longitude, before.longitude),
      deltaLatitude: difference(now.latitude, before.latitude),
      deltaWindMps: difference(now.windMps, before.windMps),
      deltaPressureHpa: difference(now.pressureHpa, before.pressureHpa),
      summary: sourcePointChanged
        ? "上游已发布新实况点，可据此评估路径与强度变化。"
        : "本轮轮询未发现上游新增实况点；不得把刷新本身描述为台风演变。"
    };
  });
}

// Lifecycle facts are deterministic feed transitions, not LLM conclusions.
// Keeping a small ledger makes an item disappearing from the active list
// answerable as "ended / no longer active" instead of "data unavailable".
function reconcileLifecycleEvents(previousEvents, previousById, storms, snapshotHint, now) {
  const retained = Array.isArray(previousEvents) ? previousEvents : [];
  const activeIds = new Set(storms.map((storm) => storm.id));
  const candidates = Object.values(previousById ?? {})
    .filter((storm) => storm?.id && !activeIds.has(storm.id))
    .map((storm) => ({
      id: storm.id,
      nameZh: storm.nameZh,
      nameEn: storm.nameEn,
      lastObservedAt: storm.latest?.observedAt ?? null,
      exitedLiveTrackAt: now.toISOString(),
      status: "exited-live-track",
      source: "upstream-active-list",
    }));
  if (snapshotHint?.status === "exited-live-track" && snapshotHint.id && !activeIds.has(snapshotHint.id)) {
    candidates.push({
      id: snapshotHint.id,
      nameZh: snapshotHint.nameZh,
      nameEn: snapshotHint.nameEn,
      lastObservedAt: snapshotHint.lastObservedAt ?? null,
      exitedLiveTrackAt: snapshotHint.exitedLiveTrackAt ?? now.toISOString(),
      status: "exited-live-track",
      source: "upstream-active-list",
    });
  }
  const byId = new Map(retained.map((event) => [event.id, event]));
  for (const event of candidates) byId.set(event.id, event);
  return [...byId.values()]
    .sort((a, b) => Date.parse(b.exitedLiveTrackAt || 0) - Date.parse(a.exitedLiveTrackAt || 0))
    .slice(0, 24);
}

function buildDeterministicAnalysis(facts, changeSet) {
  if (facts.storms.length === 0) {
    return "当前公开接口未返回活动台风。本轮仅记录数据状态，不生成路径或强度变化判断。";
  }
  return facts.storms.map((storm) => {
    const point = storm.latest;
    const change = changeSet.find((item) => item.stormId === storm.id);
    const comparison = change?.kind === "new-source-point"
      ? `上游实况从 ${change.fromObservedAt || "上一时次"} 更新至 ${change.toObservedAt || point.observedAt}；经度变化 ${signedValue(change.deltaLongitude, "°")}，纬度变化 ${signedValue(change.deltaLatitude, "°")}，风速变化 ${signedValue(change.deltaWindMps, " m/s")}，气压变化 ${signedValue(change.deltaPressureHpa, " hPa")}。`
      : change?.summary ?? "首次纳入本智能体观测，暂无上一轮对比。";
    const forecast = storm.forecast.length
      ? storm.forecast.map((item) => `${item.observedAt} ${formatCoordinate(item.latitude, "N", "S")} / ${formatCoordinate(item.longitude, "E", "W")}`).join("；")
      : "公开详情未提供可用的主预报路径点。";
    return `### ${storm.nameZh}（${storm.id}）

- **当前实况**：${point.observedAt || "时次未提供"}，中心位于 ${formatCoordinate(point.latitude, "N", "S")} / ${formatCoordinate(point.longitude, "E", "W")}，最大风速 ${point.windMps ?? "—"} m/s，中心气压 ${point.pressureHpa ?? "—"} hPa，强度为${point.stage}。
- **与上一轮对比**：${comparison}
- **路径预报**：${forecast}
- **数据限制**：本段为规则化保底汇总，只陈述公开接口事实，不解释成因，也不替代官方预警。`;
  }).join("\n\n");
}

function signedValue(value, unit) {
  if (!Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value}${unit}`;
}

function windForceFromSpeed(speed) {
  const upperBounds = [0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7, 37, 41.5, 46.2, 51, 56.1, 61.3];
  const level = upperBounds.findIndex((bound) => speed < bound);
  return level === -1 ? "17+" : level;
}

function windDirectionLabel(degrees) {
  const labels = ["北风", "东北风", "东风", "东南风", "南风", "西南风", "西风", "西北风"];
  return labels[Math.round(((degrees % 360) + 360) % 360 / 45) % labels.length];
}

async function requestAnalysis(apiKey, facts, changeSet, previousAnalysis) {
  const prompt = {
    task: "基于公开台风实况数据撰写一次严谨的中文演进分析。",
    rules: [
      "只使用提供的事实；不能补造卫星、降雨、登陆、预警或机构结论。",
      "如果 changeSet 指出 source-unchanged，必须明确写上游没有新增实况点，不得声称台风在本轮发生了变化。",
      "区分实况、路径预报与分析推断；预报只可称为预报。",
      "禁止解释成因，禁止出现海温、风切变、降雨、卫星、登陆距离、预警等 facts 中没有的概念。",
      "每个台风只能输出以下四个项目：当前实况、与上一轮对比、路径预报、数据限制。",
      "输出 Markdown 正文，不要标题、不要表格、不要复述数据源或采集时间、不要输出思维过程。"
    ],
    facts,
    changeSet,
    previousAnalysis
  };
  const primary = await invokeMiniMax(apiKey, prompt);
  const primaryValidation = validateLegacyTyphoonNarrative(primary);
  if (primaryValidation.ok) return primaryValidation.value;

  // M3 can occasionally spend the whole completion budget on hidden reasoning.
  // Retry once with a compact brief instead of publishing an empty report.
  const compactRetry = await invokeMiniMax(apiKey, {
    task: "直接输出可发布的中文 Markdown 演进分析正文。",
    facts,
    changeSet,
    requirements: "每个台风仅写当前实况、与上一轮对比、路径预报、数据限制四条。必须写明实况时次；若上游无新点，明确写无新增实况；不得输出思维过程或未提供的气象原因。"
  });
  const retryValidation = validateLegacyTyphoonNarrative(compactRetry);
  if (retryValidation.ok) return retryValidation.value;
  throw new Error(`MiniMax returned no publishable typhoon analysis after one retry: ${retryValidation.errors.join("; ")}`);
}

async function requestNationalSituationBroadcast(apiKey, prompt) {
  const first = await invokeMiniMax(apiKey, prompt.request, prompt.systemPrompt, 1_600);
  const firstValidation = validateNationalSituationBroadcast(first, prompt);
  if (firstValidation.ok) return firstValidation.value;

  const compactSystem = `${prompt.systemPrompt}\n立即只输出一个符合 outputSchema 的 JSON 对象。所有段落必须带同类别 factRefs。`;
  const retry = await invokeMiniMax(apiKey, {
    task: prompt.request.task,
    facts: prompt.request.facts,
    outputSchema: prompt.request.outputSchema,
    outputPolicy: prompt.request.outputPolicy
  }, compactSystem, 1_200);
  const retryValidation = validateNationalSituationBroadcast(retry, prompt);
  if (retryValidation.ok) return retryValidation.value;
  throw new Error(`MiniMax returned no contract-valid national broadcast: ${retryValidation.errors.join("; ")}`);
}

async function invokeMiniMax(
  apiKey,
  prompt,
  systemPrompt = "你是严谨的热带气旋分析助手，优先陈述数据来源、时间与不确定性。",
  maxCompletionTokens = 4_096
) {
  let response;
  let lastError;
  for (let attempt = 0; attempt <= documentAgentRetryCount; attempt += 1) {
    try {
      response = await fetch(miniMaxEndpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
        body: JSON.stringify({
      model: miniMaxModel,
      temperature: 0.1,
      // M3 may emit a long thinking segment before the publishable body. The
      // report needs enough headroom to complete its constrained Markdown.
      max_completion_tokens: maxCompletionTokens,
      // This is a publishable operational report, not a reasoning task. With
      // reasoning splitting enabled, M3 can exhaust the completion budget in
      // hidden reasoning and return no usable report body.
      reasoning_split: false,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(prompt) }
      ]
        }),
        signal: AbortSignal.timeout(documentAgentTimeoutMs)
      });
      if (response.ok || response.status < 500 || attempt === documentAgentRetryCount) break;
    } catch (error) {
      lastError = error;
      if (attempt === documentAgentRetryCount) throw error;
    }
  }
  if (!response) throw lastError instanceof Error ? lastError : new Error("MiniMax request failed before receiving a response.");
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`MiniMax request failed: ${response.status} ${payload?.base_resp?.status_msg ?? ""}`.trim());
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) return null;
  const analysis = stripThinking(content);
  return analysis || null;
}

function renderReport(
  facts,
  changeSet,
  cityWind,
  analysis,
  analysisMode,
  nationalBroadcast,
  nationalBroadcastMode,
  history,
  lifecycleEvents,
  now
) {
  const sourceRows = facts.storms.length
    ? facts.storms.map((storm) => {
        const point = storm.latest;
        return `| ${storm.nameZh} (${storm.id}) | ${formatCoordinate(point.latitude, "N", "S")} / ${formatCoordinate(point.longitude, "E", "W")} | ${point.windMps ?? "—"} m/s | ${point.pressureHpa ?? "—"} hPa | ${point.observedAt || "—"} |`;
      }).join("\n")
    : "| 无活动台风 | — | — | — | — |";
  const historyRows = history.map((entry) => `| ${entry.ranAt} | ${entry.stormCount} | ${entry.sourceTimes || "—"} | ${entry.changeNote} |`).join("\n");
  const lifecycleRows = lifecycleEvents.length
    ? lifecycleEvents.map((event) => `- ${event.nameZh} (${event.id}) \u5df2\u4ece\u4e0a\u6e38\u6d3b\u52a8\u53f0\u98ce\u5217\u8868\u9000\u51fa\uff1b\u6700\u540e\u53ef\u6838\u5b9e\u5b9e\u51b5\uff1a${event.lastObservedAt || "--"}\uff1b\u9000\u51fa\u65f6\u95f4\uff1a${event.exitedLiveTrackAt || "--"}\u3002`)
        .join("\n")
    : "- \u672c\u8f6e\u65e0\u65b0\u7684\u53f0\u98ce\u9000\u51fa\u6d3b\u52a8\u5217\u8868\u4e8b\u4ef6\u3002";
  const cityRows = cityWind.cities.map((city) => {
    const speed = Number.isFinite(city.windMps) ? `${city.windMps.toFixed(1)} m/s` : "—";
    const force = Number.isFinite(city.windForceLevel) ? `${city.windForceLevel} 级` : "—";
    const observedAt = city.observedAt ? formatBeijingTime(city.observedAt) : "—";
    const status = city.stale ? (Number.isFinite(city.windMps) ? "延迟保护" : "暂缺") : "最新模式时次";
    return `| ${city.region} | ${city.city} | ${speed} | ${force} | ${city.windDirection || "—"} | ${observedAt} | ${status} |`;
  }).join("\n");
  return `# 台风实时演进分析

> 自动维护：每 30 分钟采集浙江省水利厅公开台风路径数据，并维护全国 34 个省级行政区代表城市的当前风力表。页面刷新时间不等于上游发布新实况点；请以各表“数据时次”为准。

- 本轮运行：${formatBeijingTime(now.toISOString())}
- 数据源：${facts.source}
- 数据接口：${facts.sourceUrl}
- 活动台风数：${facts.storms.length}
- 演进分析模式：${analysisMode}
- 城市风场来源：${cityWind.source}
- 城市风场采集：${cityWind.freshCount}/${cityWind.cities.length} 个代表城市取得本轮新数据；${cityWind.note}

## 全国态势播报

- 输出模式：${nationalBroadcastMode}
${renderNationalBroadcast(nationalBroadcast)}

${facts.storms.length ? `## 最新演进判断\n\n${analysis}` : analysis}

## \u53f0\u98ce\u751f\u547d\u5468\u671f\u8f6c\u573a\u4e8b\u5b9e

${lifecycleRows}

## 本轮公开实况

| 台风 | 坐标 | 最大风速 | 中心气压 | 公开实况时次 |
| --- | --- | ---: | ---: | --- |
${sourceRows}

## 全国代表城市当前风力等级

> 口径：覆盖 34 个省级行政区的省会、首府、直辖市及港澳台代表城市。数值为代表坐标的 10 米风场模式数据，不等同于全市气象站观测平均值。

| 省级地区 | 代表城市 | 当前风速 | 风力等级 | 风向 | 数据时次（北京时间） | 状态 |
| --- | --- | ---: | ---: | --- | --- | --- |
${cityRows}

## 近 24 小时运行记录

| 运行时间 | 活动台风数 | 上游实况时次 | 本轮判定 |
| --- | ---: | --- | --- |
${historyRows}

## 口径与限制

- 本文的路径、风速、气压和风圈均来自公开路径接口；M3 只负责基于这些事实进行汇总，不替代官方预警。
- 无活动台风时，近时胚胎位置与定性等级来自 JTWC 西北太平洋显著天气公报；第2周和第3周数值概率来自 NOAA CPC 热带气旋生成概率 KML。
- JTWC LOW/MEDIUM/HIGH 不会被擅自换算成百分比；CPC 20/40/60% 是区域周期概率，不是单个胚胎的定点概率。
- 城市风力来自 MET Norway Locationforecast 2.0 全球预报的代表坐标 10 米风场；这是模式数据，不可替代当地气象台站实况与预警。
- 城市风场获取失败时保留最后有效值并标注“延迟保护”，不会把旧数据伪装成最新时次。
- 当上游未发布新实况点时，本文会保留最新状态并明确标注“无新增实况”，不会伪造连续变化。
`;
}

function renderNationalBroadcast(broadcast) {
  const labels = { official_fact: "官方事实", observation: "观察/元数据", model: "模式" };
  const rows = broadcast.segments.map((segment) => `- **${labels[segment.category] ?? segment.category}**：${segment.text}（事实引用：${segment.factRefs.join("、")}）`);
  if (broadcast.closing) rows.push(`- **口径**：${broadcast.closing}`);
  return rows.join("\n");
}

function buildHistory(previousHistory, facts, changeSet, _analysis, now) {
  const sourceTimes = facts.storms.map((storm) => `${storm.nameZh} ${storm.latest.observedAt}`).join("；");
  const changed = changeSet.filter((item) => item.kind === "new-source-point").length;
  const entry = {
    ranAt: formatBeijingTime(now.toISOString()),
    stormCount: facts.storms.length,
    sourceTimes,
    changeNote: changed > 0 ? `${changed} 个台风有新实况点` : "上游无新增实况点"
  };
  return [entry, ...(Array.isArray(previousHistory) ? previousHistory : [])].slice(0, 48);
}

function compactSnapshot(storm) {
  return { id: storm.id, nameZh: storm.nameZh, latest: storm.latest, windRadiiKm: storm.windRadiiKm };
}

function difference(next, previous) {
  return next === null || previous === null ? null : Number((next - previous).toFixed(2));
}

function maxRadius(value) {
  return Math.max(0, ...String(value ?? "").split("|").map(Number).filter(Number.isFinite));
}

function hasCoordinates(point) {
  return Number.isFinite(Number(point?.lng)) && Number.isFinite(Number(point?.lat));
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatCoordinate(value, positiveSuffix, negativeSuffix) {
  if (!Number.isFinite(value)) return "—";
  return `${Math.abs(value).toFixed(2)}°${value >= 0 ? positiveSuffix : negativeSuffix}`;
}

function formatBeijingTime(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date(value)).replaceAll("/", "-");
}

function stripThinking(value) {
  const withoutThinking = value.replace(/<think>[\s\S]*?<\/think>\s*/gi, "");
  // Never publish an incomplete hidden-reasoning segment when a model reaches
  // its completion limit before emitting a closing tag and final answer.
  if (/<think>/i.test(withoutThinking)) return "";
  return withoutThinking
    .replace(/^#\s+.*$/gm, "")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "Cache-Control": "no-cache", "User-Agent": "TyphoonBossRadarEvolutionAgent/1.0" },
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`Public typhoon API failed: ${response.status} ${url}`);
  return response.json();
}

async function fetchText(url, label) {
  const response = await fetch(url, {
    headers: { Accept: "text/plain, application/vnd.google-earth.kml+xml, application/xml", "Cache-Control": "no-cache", "User-Agent": "TyphoonBossRadarEvolutionAgent/2.0" },
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`${label}获取失败：${response.status} ${url}`);
  return response.text();
}

function loadEnvFile(filePath) {
  try {
    const contents = requireText(filePath);
    for (const line of contents.split(/\r?\n/)) {
      const matched = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!matched || matched[1] in process.env) continue;
      process.env[matched[1]] = matched[2].replace(/^['"]|['"]$/g, "");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function requireText(filePath) { return readFileSync(filePath, "utf8"); }

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeAtomicJson(filePath, value) {
  await writeAtomicText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeAtomicText(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(tempPath, value, "utf8");
  await rename(tempPath, filePath);
}

function emptyState() {
  return { version: 5, snapshotByStormId: {}, cityWind: null, history: [], lastAnalysis: null, lastDisturbanceOutlook: null };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
