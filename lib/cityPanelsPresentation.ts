import type {
  CityBriefing,
  CityBriefingSource,
  CityEvidenceLevel,
  CityRiskLevel
} from "@/lib/cityBriefingData";
import { buildCitySignalBoard, type CitySignalSeverity } from "@/lib/citySignalBoard";

export type WarningFeedState = "active" | "none-reported" | "unavailable";
export type PanelEvidence = "official" | "observed" | "model" | "unavailable";
export type PanelRiskId = "rain" | "wind" | "convection" | "heat";
export type CityPanelAccessSource = "observed" | "whitelist" | "unknown";
export type CityArchiveStatus = "locked" | "unlocking" | "unlocked" | "unavailable";

export interface CityPanelAudience {
  requestId: string;
  viewerName: string | null;
  viewerId?: string | null;
  platform?: string | null;
  accessSource: CityPanelAccessSource;
}

export interface CityPanelArchiveInput {
  status: CityArchiveStatus;
  code?: string;
  clearance?: string;
  teaserTokens?: string[];
  fragment?: string | null;
  statusText?: string;
}

export interface BattleArchive {
  status: CityArchiveStatus;
  code: string;
  clearance: string;
  teaserTokens: [string, string];
  fragment: string | null;
  statusText: string;
}

export interface PanelMetric {
  id: string;
  label: string;
  value: string;
  unit?: string;
  detail?: string;
  evidence: PanelEvidence;
}

export interface PanelWarning {
  status: WarningFeedState;
  title: string;
  level: string | null;
  issuer: string | null;
  issuedAt: string | null;
  effectiveAt: string | null;
  expiresAt: string | null;
  description: string | null;
  instruction: string | null;
  evidence: "official" | "unavailable";
}

export interface BattleMutator {
  id: string;
  label: string;
  value: string;
  detail: string;
  comment: string;
  tone: CitySignalSeverity;
}

export interface PanelRisk {
  id: PanelRiskId;
  label: string;
  level: CityRiskLevel;
  summary: string;
  evidence: PanelEvidence;
}

export interface CityPanelsModel {
  shared: {
    cityLabel: string;
    generatedAt: string;
    observedAt: string | null;
    dataStatus: CityBriefing["status"];
    warningFeed: WarningFeedState;
    viewerName: string | null;
  };
  battle: {
    title: string;
    threatScore: number;
    statusSeal: string | null;
    summary: string;
    mutators: BattleMutator[];
    actions: string[];
    archive: BattleArchive;
  };
  info: {
    warning: PanelWarning;
    relatedWarnings: PanelWarning[];
    currentMetrics: PanelMetric[];
    nowcastMetrics: PanelMetric[];
    trendMetrics: PanelMetric[];
    risks: PanelRisk[];
    actions: string[];
    limitations: string[];
  };
}

export interface BuildCityPanelsModelInput {
  briefing: CityBriefing;
  audience: CityPanelAudience;
  archive: CityPanelArchiveInput;
}

const RISK_LABELS: Record<PanelRiskId, string> = {
  rain: "降雨",
  wind: "大风",
  convection: "对流",
  heat: "高温"
};

const RISK_WEIGHT: Record<CityRiskLevel, number> = {
  severe: 90,
  high: 70,
  moderate: 42,
  low: 18,
  unavailable: 0
};

const WARNING_WEIGHT: Record<string, number> = {
  red: 96,
  orange: 84,
  yellow: 68,
  blue: 54,
  watch: 45,
  红色: 96,
  橙色: 84,
  黄色: 68,
  蓝色: 54
};

const ARCHIVE_TEASERS: Record<ReturnType<typeof getPrimaryKind>, [string, string]> = {
  warning: ["倒置校验码", "延迟回声"],
  unavailable: ["缺失坐标", "封存页"],
  rain: ["玻璃雨痕", "失去的时间片"],
  wind: ["无声观测站", "反向风标"],
  convection: ["静电底稿", "延迟回声"],
  heat: ["灼光残页", "缺失坐标"],
  ordinary: ["静默频段", "倒置校验码"]
};

export function buildCityPanelsModel({ briefing, audience, archive }: BuildCityPanelsModelInput): CityPanelsModel {
  const warning = buildWarning(briefing);
  const relatedWarnings = buildRelatedWarnings(briefing, warning);
  const primaryKind = getPrimaryKind(briefing);
  return {
    shared: {
      cityLabel: buildCityLabel(briefing),
      generatedAt: briefing.generatedAt,
      observedAt: briefing.current.observedAt,
      dataStatus: briefing.status,
      warningFeed: warning.status,
      viewerName: audience.viewerName
    },
    battle: {
      title: buildBattleTitle(briefing, primaryKind),
      threatScore: buildThreatScore(briefing, warning),
      statusSeal: buildStatusSeal(warning, primaryKind),
      summary: buildBattleSummary(briefing, primaryKind),
      mutators: buildMutators(briefing, primaryKind),
      actions: buildBattleActions(briefing, primaryKind),
      archive: buildArchive(briefing, audience, archive, primaryKind)
    },
    info: {
      warning,
      relatedWarnings,
      currentMetrics: buildCurrentMetrics(briefing),
      nowcastMetrics: buildNowcastMetrics(briefing),
      trendMetrics: buildTrendMetrics(briefing),
      risks: buildRisks(briefing),
      actions: buildInfoActions(briefing, primaryKind),
      limitations: buildLimitations(briefing, warning)
    }
  };
}

function buildRelatedWarnings(briefing: CityBriefing, primary: PanelWarning): PanelWarning[] {
  if (primary.status !== "active") return [];
  const seen = new Set([primary.title.trim()]);
  return briefing.officialWarnings
    .map(panelWarningFromLegacy)
    .filter((warning) => {
      const key = warning.title.trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => warningPriority(right.level) - warningPriority(left.level)
      || (Date.parse(right.issuedAt ?? "") || 0) - (Date.parse(left.issuedAt ?? "") || 0));
}

function panelWarningFromLegacy(warning: CityBriefing["officialWarnings"][number]): PanelWarning {
  const description = distinctCopy(warning.description, warning.title);
  return {
    status: "active",
    title: warning.title,
    level: warning.severity,
    issuer: warning.senderName,
    issuedAt: warning.issuedAt,
    effectiveAt: warning.effectiveAt,
    expiresAt: warning.expiresAt,
    description,
    instruction: distinctCopy(warning.instruction, warning.title, description),
    evidence: "official"
  };
}

function warningPriority(level: string | null) {
  const normalized = level?.toLowerCase() ?? "";
  if (normalized.includes("red") || normalized.includes("红")) return 4;
  if (normalized.includes("orange") || normalized.includes("橙")) return 3;
  if (normalized.includes("yellow") || normalized.includes("黄")) return 2;
  if (normalized.includes("blue") || normalized.includes("蓝")) return 1;
  return 0;
}

function buildCityLabel(briefing: CityBriefing) {
  const { name, province, country, administrativePath } = briefing.city;
  if (administrativePath) {
    return [...new Set([administrativePath.province, administrativePath.city, administrativePath.county].filter(Boolean))].join(" · ");
  }
  if (province && province !== name) return `${province} · ${name}`;
  if (province || name) return province || name;
  return country || "未知城市";
}

function buildWarning(briefing: CityBriefing): PanelWarning {
  const situationWarning = briefing.situation?.primaryWarning;
  const matchingLegacy = briefing.officialWarnings.find((item) => item.title === situationWarning?.title)
    ?? briefing.officialWarnings[0];
  if (situationWarning) {
    const description = distinctCopy(
      situationWarning.factSummary || matchingLegacy?.description || null,
      situationWarning.title
    );
    return {
      status: "active",
      title: situationWarning.title,
      level: situationWarning.level,
      issuer: matchingLegacy?.senderName ?? null,
      issuedAt: situationWarning.issuedAt,
      effectiveAt: situationWarning.dataTime,
      expiresAt: situationWarning.expiresAt,
      description,
      instruction: distinctCopy(matchingLegacy?.instruction ?? null, situationWarning.title, description),
      evidence: "official"
    };
  }
  const legacyWarning = briefing.officialWarnings[0];
  if (legacyWarning) {
    return panelWarningFromLegacy(legacyWarning);
  }
  const warningSource = briefing.sources.find((source) => source.id === "qweather-warning");
  if (warningSource?.status === "available") {
    return {
      status: "none-reported",
      title: "当前未报告有效官方预警",
      level: null,
      issuer: null,
      issuedAt: null,
      effectiveAt: null,
      expiresAt: null,
      description: "仅表示已接入预警源当前未返回有效记录，不代表没有天气风险。",
      instruction: null,
      evidence: "official"
    };
  }
  return {
    status: "unavailable",
    title: "预警链路不可用",
    level: null,
    issuer: null,
    issuedAt: null,
    effectiveAt: null,
    expiresAt: null,
    description: warningSource?.limitation || "当前无法核对属地官方预警，不能据此判断无预警。",
    instruction: null,
    evidence: "unavailable"
  };
}

function getPrimaryKind(briefing: CityBriefing): PanelRiskId | "warning" | "ordinary" | "unavailable" {
  const situation = briefing.situation;
  if (situation) {
    if (situation.mode === "data-unavailable") return "unavailable";
    if (situation.mode === "official-warning") {
      const hazard = situation.primaryWarning?.hazard;
      return isPanelRiskId(hazard) ? hazard : "warning";
    }
    if (situation.mode === "observed-anomaly") {
      const hazard = situation.anomalies[0]?.hazard;
      return isPanelRiskId(hazard) ? hazard : "ordinary";
    }
    return "ordinary";
  }
  if (briefing.officialWarnings.length) return inferHazardFromWarning(briefing.officialWarnings[0]?.title ?? "");
  return isPanelRiskId(briefing.narrative.primaryKind)
    ? briefing.narrative.primaryKind
    : briefing.status === "unavailable" ? "unavailable" : "ordinary";
}

function inferHazardFromWarning(title: string): PanelRiskId | "warning" {
  if (/高温|热浪|酷热/.test(title)) return "heat";
  if (/暴雨|降雨|雷雨|洪水/.test(title)) return "rain";
  if (/大风|台风|阵风|风/.test(title)) return "wind";
  if (/雷电|冰雹|对流/.test(title)) return "convection";
  return "warning";
}

function buildBattleTitle(briefing: CityBriefing, primaryKind: ReturnType<typeof getPrimaryKind>) {
  if (primaryKind === "unavailable") return "信号迷雾";
  if (primaryKind === "rain") return (briefing.current.precipitationMm ?? 0) > 0 ? "雨幕攻城" : "雨云候场";
  if (primaryKind === "wind") return "风场越界";
  if (primaryKind === "convection") return "雷云接管";
  if (primaryKind === "heat") return "赤昼占领";
  if (primaryKind === "warning") return "边界事件";
  return "短时休战";
}

function buildBattleSummary(briefing: CityBriefing, primaryKind: ReturnType<typeof getPrimaryKind>) {
  const apparent = numberValue(briefing.current.apparentTemperatureC ?? briefing.current.temperatureC);
  const rain = numberValue(briefing.minutelyRain.precipitationNextTwoHoursMm ?? briefing.nextSixHours.precipitationMm);
  const wind = numberValue(briefing.nextSixHours.maxWindGustMps ?? briefing.current.windGustMps ?? briefing.current.windSpeedMps);
  if (primaryKind === "heat") return `城市热压正在占领白昼时段，体感读数 ${apparent}℃；阴影与补水点成为本局稀缺资源。`;
  if (primaryKind === "rain") return `雨幕正在改写城市路线，近程雨量读数 ${rain} mm；低洼路径获得额外地形惩罚。`;
  if (primaryKind === "wind") return `风场取得临时行动权，峰值读数 ${wind} m/s；轻物件与伞具进入易位移状态。`;
  if (primaryKind === "convection") return "高空能量槽正在蓄积，城市上方的临时剧本仍可能改写。";
  if (primaryKind === "unavailable") return "观测链路出现缺页，本局只标记未知区域，不把空白伪装成平静。";
  if (primaryKind === "warning") return "城市边界事件已进入高亮状态；本面板只翻译游戏状态，事实请查看右侧情报链路。";
  return "城市暂处低噪声回合，常规行动可以继续，但天气系统从不签永久停战书。";
}

function buildStatusSeal(warning: PanelWarning, primaryKind: ReturnType<typeof getPrimaryKind>) {
  if (warning.status !== "active") return null;
  const level = normalizeWarningLevel(warning.level);
  const kind = primaryKind === "warning" ? "EVENT" : primaryKind.toUpperCase();
  return `${level} EVENT / ${kind}`;
}

function normalizeWarningLevel(level: string | null) {
  const value = level?.toLowerCase() ?? "watch";
  if (value.includes("red") || value.includes("红")) return "RED";
  if (value.includes("orange") || value.includes("橙")) return "ORANGE";
  if (value.includes("yellow") || value.includes("黄")) return "YELLOW";
  if (value.includes("blue") || value.includes("蓝")) return "BLUE";
  return "WATCH";
}

function buildThreatScore(briefing: CityBriefing, warning: PanelWarning) {
  if (warning.status === "active") {
    const level = warning.level?.toLowerCase() ?? "watch";
    return WARNING_WEIGHT[level] ?? WARNING_WEIGHT[warning.level ?? ""] ?? 72;
  }
  if (briefing.situation?.mode === "data-unavailable" || briefing.status === "unavailable") return 0;
  return Math.max(18, ...briefing.risks.map((risk) => RISK_WEIGHT[risk.level]));
}

function buildMutators(briefing: CityBriefing, primaryKind: ReturnType<typeof getPrimaryKind>): BattleMutator[] {
  const mutators: BattleMutator[] = [];
  for (const signal of buildCitySignalBoard(briefing).signals) {
    if (signal.id === "warning" || signal.id === "calm") continue;
    mutators.push(buildSignalMutator(briefing, signal.id, signal.severity));
  }
  if (!mutators.some((item) => riskIdFromMutator(item.id) === primaryKind) && isPanelRiskId(primaryKind)) {
    mutators.unshift(buildPrimaryMutator(briefing, primaryKind));
  }
  if (!mutators.length) {
    mutators.push({
      id: "ordinary",
      label: "低噪声回合",
      value: "常规行动",
      detail: "当前接入资料未见显著异动",
      comment: playfulComment(briefing, "ordinary"),
      tone: "calm"
    });
  }
  return uniqueMutators(mutators).slice(0, 3);
}

function buildPrimaryMutator(briefing: CityBriefing, kind: PanelRiskId): BattleMutator {
  if (kind === "heat") return {
    id: "heat-primary", label: "正午移速", value: "DEBUFF", detail: `体感 ${numberValue(briefing.current.apparentTemperatureC ?? briefing.current.temperatureC)}℃`,
    comment: "阴影资源刷新变慢，补水可缩短冷却时间。", tone: "critical"
  };
  if (kind === "rain") return {
    id: "rain-primary", label: "路面摩擦", value: "DEBUFF", detail: `2h ${numberValue(briefing.minutelyRain.precipitationNextTwoHoursMm)} mm`,
    comment: "伞具耐久开始结算，路线最好保留转身位。", tone: "critical"
  };
  if (kind === "wind") return {
    id: "wind-primary", label: "轻物件稳定", value: "DEBUFF", detail: `峰值 ${numberValue(briefing.nextSixHours.maxWindGustMps ?? briefing.current.windSpeedMps)} m/s`,
    comment: "帽子和伞面暂时失去部分自主权。", tone: "critical"
  };
  return {
    id: "convection-primary", label: "天空技能槽", value: "CHARGING", detail: `CAPE ${numberValue(briefing.nextSixHours.maxCapeJkg)} J/kg`,
    comment: "云层正在后台加载临时剧本。", tone: "watch"
  };
}

function buildSignalMutator(briefing: CityBriefing, id: string, tone: CitySignalSeverity): BattleMutator {
  const { current, nextSixHours, minutelyRain, recentRain } = briefing;
  if (id === "recent-rain") return {
    id, label: "雨后地形", value: `24h ${numberValue(recentRain?.total24hMm)} mm`,
    detail: recentRain?.observedDate ? `历史回合 · ${recentRain.observedDate}` : "历史回合",
    comment: "天空下班不代表地面积水也交班。", tone
  };
  if (id === "incoming-rain") return {
    id, label: "伞具耐久", value: "消耗 +1",
    detail: minutelyRain.available ? `2h ${numberValue(minutelyRain.precipitationNextTwoHoursMm)} mm` : `6h ${numberValue(nextSixHours.precipitationMm)} mm`,
    comment: playfulComment(briefing, "rain"), tone
  };
  if (id === "heat") return {
    id, label: "正午移速", value: "DEBUFF",
    detail: `体感 ${numberValue(current.apparentTemperatureC ?? current.temperatureC)}℃`, comment: playfulComment(briefing, "heat"), tone
  };
  if (id === "humidity") return {
    id, label: "空气贴身", value: "黏滞 +1",
    detail: `湿度 ${numberValue(current.relativeHumidityPct)}%`, comment: playfulComment(briefing, "humidity"), tone
  };
  return {
    id, label: "轻物件稳定", value: "DEBUFF",
    detail: `峰值 ${numberValue(nextSixHours.maxWindGustMps ?? current.windGustMps ?? current.windSpeedMps)} m/s`,
    comment: playfulComment(briefing, "wind"), tone
  };
}

function buildBattleActions(briefing: CityBriefing, primaryKind: ReturnType<typeof getPrimaryKind>) {
  if (primaryKind === "heat") return ["把正午高热时段移出主线任务。", "沿阴影与补水点规划移动路线。"];
  if (primaryKind === "rain") return ["避开低洼地形，给返程预留替代路线。", "让伞具和防水装备提前进入快捷栏。"];
  if (primaryKind === "wind") return ["收纳轻物件，减少迎风路线暴露。", "把伞具切换为低风阻使用方式。"];
  if (primaryKind === "convection") return ["缩短户外任务链，保留快速撤回点。", "留意天空状态刷新，不把静默当作结束。"];
  if (primaryKind === "unavailable") return ["先补齐情报链路，再决定高暴露行程。", "把未知区域视作未探索，不判定为安全区。"];
  if (primaryKind === "warning") return ["右侧情报链路已高亮，先读取完整事实。", "为临时路线调整预留资源。"];
  const seed = deterministicPick([0, 1], `${briefing.city.name}|${briefing.generatedAt}|actions`);
  return seed === 0
    ? ["常规行动照旧，给天气刷新留一个观察位。", "装备无需加码，但别清空应急快捷栏。"]
    : ["利用低噪声窗口推进日常任务。", "下一次资料刷新前，不签永久停战书。"];
}

function buildInfoActions(briefing: CityBriefing, primaryKind: ReturnType<typeof getPrimaryKind>) {
  if (primaryKind === "heat") return ["尽量避开午后高温时段，持续补水并安排阴凉休息点。", "留意属地预警更新，老人、儿童及户外作业人员优先降温休息。"];
  if (primaryKind === "rain") return ["避开低洼积水路段，为返程预留替代路线。", "携带防水装备，并留意短临降雨更新。"];
  if (primaryKind === "wind") return ["收好阳台和户外轻物件，远离临时搭建物。", "步行与骑行减少迎风暴露，留意阵风变化。"];
  if (primaryKind === "convection") return ["缩短户外停留时间，并保留可快速进入的室内场所。", "持续留意雷达、短临和属地预警更新。"];
  if (primaryKind === "unavailable") return ["资料链路尚未完整恢复，重要行程请交叉核对属地信息。", "未知不等于无风险，暂缓高暴露安排。"];
  if (primaryKind === "warning") return ["先完整阅读上方官方预警事实，再调整出行安排。", "持续留意发布机构的后续更新。"];
  const isWet = (briefing.minutelyRain.precipitationNextTwoHoursMm ?? 0) > 0;
  return isWet
    ? ["随身准备雨具，留意两小时短临变化。", "出发前再次核对当前实况与路线。"]
    : ["当前资料支持常规安排，出发前仍应刷新实况。", "长时间户外活动保留天气变化余量。"];
}

function distinctCopy(value: string | null | undefined, ...existing: Array<string | null | undefined>) {
  const copy = value?.trim();
  if (!copy) return null;
  const normalized = normalizeComparableCopy(copy);
  return existing.some((item) => item && normalizeComparableCopy(item) === normalized) ? null : copy;
}

function normalizeComparableCopy(value: string) {
  return value.replace(/[\s，。！？、；：,.!?;:【】\[\]（）()]/g, "").toLowerCase();
}

function buildArchive(
  briefing: CityBriefing,
  audience: CityPanelAudience,
  input: CityPanelArchiveInput,
  kind: ReturnType<typeof getPrimaryKind>
): BattleArchive {
  const defaultTokens = ARCHIVE_TEASERS[kind];
  const tokens = unique([...(input.teaserTokens ?? []), ...defaultTokens]).slice(0, 2);
  const status = audience.accessSource === "unknown" ? "locked" : input.status;
  return {
    status,
    code: input.code?.trim() || buildArchiveCode(audience.requestId, briefing.city.cityCode ?? briefing.city.name),
    clearance: input.clearance?.trim() || (status === "locked" ? "OBSERVER // SEALED" : "OBSERVER // VERIFIED"),
    teaserTokens: [tokens[0] ?? defaultTokens[0], tokens[1] ?? defaultTokens[1]],
    fragment: status === "unlocked" ? input.fragment?.trim() || null : null,
    statusText: audience.accessSource === "unknown" ? archiveStatusText("locked") : input.statusText?.trim() || archiveStatusText(status)
  };
}

function buildArchiveCode(requestId: string, cityKey: string) {
  const hash = stableHash(`${requestId}|${cityKey}`).toString(16).toUpperCase().padStart(8, "0");
  return `OE-01-${hash.slice(0, 4)}-${hash.slice(4, 8)}`;
}

function archiveStatusText(status: CityArchiveStatus) {
  if (status === "locked") return "未检测到关注凭证｜关注主播，登记为观测员并解锁本次档案。";
  if (status === "unlocking") return "关注凭证已确认｜档案解封中。";
  if (status === "unlocked") return "观测员权限已确认｜档案已公开解码。";
  return "观测员权限已确认，档案同步中。";
}

function buildCurrentMetrics(briefing: CityBriefing): PanelMetric[] {
  const evidence = evidenceOf(briefing.current.evidenceLevel);
  return [
    metric("temperature", "气温", briefing.current.temperatureC, "℃", evidence),
    metric("apparent-temperature", "体感", briefing.current.apparentTemperatureC, "℃", evidence),
    metric("humidity", "湿度", briefing.current.relativeHumidityPct, "%", evidence),
    metric("precipitation-now", "当前降水", briefing.current.precipitationMm, "mm", evidence),
    metric("wind-speed", "风速", briefing.current.windSpeedMps, "m/s", evidence),
    metric("wind-gust", "阵风", briefing.current.windGustMps, "m/s", evidence)
  ];
}

function buildNowcastMetrics(briefing: CityBriefing): PanelMetric[] {
  const evidence: PanelEvidence = briefing.minutelyRain.available ? "observed" : "unavailable";
  return [
    metric("rain-next-2h", "未来2小时雨量", briefing.minutelyRain.precipitationNextTwoHoursMm, "mm", evidence, briefing.minutelyRain.summary ?? undefined),
    metric("rain-5m-peak", "5分钟峰值", briefing.minutelyRain.maxFiveMinutePrecipitationMm, "mm", evidence)
  ];
}

function buildTrendMetrics(briefing: CityBriefing): PanelMetric[] {
  const evidence: PanelEvidence = briefing.nextSixHours.sourceId ? "model" : "unavailable";
  return [
    metric("rain-next-6h", "未来6小时累计", briefing.nextSixHours.precipitationMm, "mm", evidence),
    metric("rain-probability", "降水概率", briefing.nextSixHours.maxPrecipitationProbabilityPct, "%", evidence),
    metric("gust-next-6h", "阵风峰值", briefing.nextSixHours.maxWindGustMps, "m/s", evidence),
    metric("cape-next-6h", "对流条件", briefing.nextSixHours.maxCapeJkg, "J/kg", evidence)
  ];
}

function buildRisks(briefing: CityBriefing): PanelRisk[] {
  const primaryWarning = briefing.situation?.primaryWarning;
  return (Object.keys(RISK_LABELS) as PanelRiskId[]).map((id) => {
    if (primaryWarning?.hazard === id) {
      return {
        id,
        label: RISK_LABELS[id],
        level: warningLevelToRisk(primaryWarning.level),
        summary: `属地官方${RISK_LABELS[id]}事件已进入当前风险矩阵，完整事实见上方情报。`,
        evidence: "official"
      };
    }
    const risk = briefing.risks.find((item) => item.kind === id);
    if (!risk) return {
      id,
      label: RISK_LABELS[id],
      level: "unavailable",
      summary: `${RISK_LABELS[id]}资料不足，当前无法判断。`,
      evidence: "unavailable"
    };
    return {
      id,
      label: RISK_LABELS[id],
      level: risk.level,
      summary: risk.summary || (risk.level === "unavailable"
        ? `${RISK_LABELS[id]}资料不足，当前无法判断。`
        : `当前已接入资料未显示显著${RISK_LABELS[id]}异动；仍需留意后续变化。`),
      evidence: evidenceOf(risk.evidenceLevel)
    };
  });
}

function buildLimitations(briefing: CityBriefing, warning: PanelWarning) {
  const source = briefing.sources.find((item) => item.id === "qweather-warning");
  const warningLimitation = warning.status === "unavailable"
    ? source?.limitation || "官方预警链路当前不可用，不能据此判断无预警。"
    : null;
  return unique([
    ...(briefing.situation?.limitations ?? []),
    warningLimitation,
    ...briefing.warnings,
    ...briefing.sources.filter((item) => item.status !== "available").map(sourceLimitation)
  ]).slice(0, 2);
}

function sourceLimitation(source: CityBriefingSource) {
  return source.limitation || `${source.label}当前不可用。`;
}

function metric(id: string, label: string, rawValue: number | null, unit: string, evidence: PanelEvidence, detail?: string): PanelMetric {
  if (rawValue === null) return { id, label, value: "暂无资料", evidence, detail };
  return { id, label, value: numberValue(rawValue), unit, evidence, detail };
}

function numberValue(value: number | null | undefined) {
  if (value === null || value === undefined) return "暂无资料";
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

function evidenceOf(value: CityEvidenceLevel): PanelEvidence {
  if (value === "confirmed") return "official";
  return value;
}

function warningLevelToRisk(level: string): CityRiskLevel {
  const normalized = level.toLowerCase();
  if (normalized.includes("red") || normalized.includes("红")) return "severe";
  if (normalized.includes("orange") || normalized.includes("橙")) return "high";
  if (normalized.includes("yellow") || normalized.includes("blue") || normalized.includes("黄") || normalized.includes("蓝") || normalized.includes("watch")) return "moderate";
  return "high";
}

function playfulComment(briefing: CityBriefing, kind: string) {
  const pools: Record<string, readonly string[]> = {
    rain: ["伞具耐久开始结算，路线给自己留个转身位。", "雨云爱临时加戏，鞋面不必配合演出。"],
    wind: ["帽子若想离家出走，请先把它劝住。", "伞面今天需要先和风场谈判。"],
    heat: ["阴凉处今天属于战略资源。", "补水比意志力更适合解除热压。"],
    humidity: ["空气选择贴身办公，体感不接受远程。", "晾衣架正在申请带薪休假。"],
    ordinary: ["平静窗口值得使用，不值得过度解读。", "天气暂时低调，常识继续值班。"]
  };
  return deterministicPick(pools[kind] ?? pools.ordinary, `${briefing.city.name}|${briefing.current.observedAt ?? briefing.generatedAt}|${kind}`);
}

function deterministicPick<T>(items: readonly T[], key: string) {
  return items[stableHash(key) % items.length]!;
}

function stableHash(key: string) {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function riskIdFromMutator(id: string): PanelRiskId | null {
  if (id.includes("rain")) return "rain";
  if (id.includes("wind")) return "wind";
  if (id.includes("heat") || id.includes("humid")) return "heat";
  if (id.includes("convect") || id.includes("storm")) return "convection";
  return null;
}

function isPanelRiskId(value: unknown): value is PanelRiskId {
  return value === "rain" || value === "wind" || value === "convection" || value === "heat";
}

function uniqueMutators(values: BattleMutator[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = riskIdFromMutator(value.id) ?? value.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}
