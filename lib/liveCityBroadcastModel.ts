import type { CityBriefing, CityHazardKind } from "@/lib/cityBriefingData";
import { buildCityBattleShowModel, type CityBattleRankIntel } from "@/lib/cityBattleShowModel";
import type {
  BattleArchive,
  CityPanelsModel,
  PanelEvidence,
  PanelMetric,
  PanelWarning
} from "@/lib/cityPanelsPresentation";

export interface LiveCityBroadcastMetric extends PanelMetric {
  displayValue: string;
}

export interface LiveCityBroadcastModel {
  cityLabel: string;
  viewerLabel: string | null;
  battle: {
    title: string;
    score: number;
    summary: string;
    spotlight: LiveCityBroadcastMetric;
    nearTerm: LiveCityBroadcastMetric | null;
    ranks: CityBattleRankIntel[];
    actions: string[];
    archive: BattleArchive;
  };
  info: {
    warning: PanelWarning;
    metrics: LiveCityBroadcastMetric[];
    trend: LiveCityBroadcastMetric | null;
    dataStatus: CityPanelsModel["shared"]["dataStatus"];
    observedAt: string;
  };
}

const HAZARD_METRIC_PRIORITY: Record<Exclude<CityHazardKind, "warning" | "calm">, string[]> = {
  rain: ["weather-condition", "rain-next-2h", "precipitation-now", "rain-next-6h", "rain-probability", "rain-5m-peak", "humidity"],
  wind: ["wind-gust", "gust-next-6h", "wind-speed", "cape-next-6h", "temperature", "humidity"],
  convection: ["cape-next-6h", "gust-next-6h", "rain-next-2h", "rain-probability", "wind-gust", "humidity"],
  heat: ["apparent-temperature", "temperature", "humidity", "wind-speed", "rain-probability", "rain-next-2h"]
};

const GENERIC_METRIC_PRIORITY = [
  "weather-condition",
  "apparent-temperature",
  "rain-next-2h",
  "gust-next-6h",
  "precipitation-now",
  "wind-speed",
  "humidity",
  "temperature",
  "rain-probability",
  "cape-next-6h"
];

export function buildLiveCityBroadcastModel({
  briefing,
  model
}: {
  briefing: CityBriefing;
  model: CityPanelsModel;
}): LiveCityBroadcastModel {
  const battle = buildCityBattleShowModel({ briefing, model });
  const primaryHazard = resolvePrimaryHazard(briefing, model.info.warning);
  const allMetrics = [
    ...model.info.currentMetrics,
    ...model.info.nowcastMetrics,
    ...model.info.trendMetrics
  ];
  const rankedMetrics = rankMetrics(allMetrics, primaryHazard);
  const availableMetrics = rankedMetrics.filter(hasReading);
  const selected = uniqueMetrics([
    ...availableMetrics,
    ...rankedMetrics
  ]).slice(0, 3).map(toBroadcastMetric);
  const metrics = selected.length > 0 ? selected : [dataGapMetric()];
  const spotlight = metrics[0] ?? dataGapMetric();
  const nearTerm = rankedMetrics
    .filter((metric) => metric.id !== spotlight.id && isNearTermMetric(metric.id))
    .map(toBroadcastMetric)[0] ?? null;
  const selectedIds = new Set(metrics.map((metric) => metric.id));
  const trend = rankedMetrics
    .filter((metric) => !selectedIds.has(metric.id) && isTrendMetric(metric.id))
    .map(toBroadcastMetric)[0] ?? null;
  return {
    cityLabel: battle.cityLabel,
    viewerLabel: battle.viewerLabel,
    battle: {
      title: battle.title,
      score: battle.score,
      summary: conciseBroadcastText(battle.summary),
      spotlight,
      nearTerm,
      ranks: battle.rankIntel.slice(0, 2),
      actions: battle.actions.slice(0, 2).map((action) => action.text),
      archive: battle.archive
    },
    info: {
      warning: model.info.warning,
      metrics,
      trend,
      dataStatus: model.shared.dataStatus,
      observedAt: model.shared.observedAt ?? model.shared.generatedAt
    }
  };
}

function conciseBroadcastText(value: string, limit = 38) {
  const normalized = value.trim();
  if (Array.from(normalized).length <= limit) return normalized;
  const sentences = normalized.match(/[^。！？!?]+[。！？!?]?/gu) ?? [normalized];
  let result = "";
  for (const sentence of sentences) {
    if (Array.from(result + sentence).length > limit) break;
    result += sentence;
  }
  if (result) return result;
  return `${Array.from(normalized).slice(0, limit - 1).join("")}…`;
}

function resolvePrimaryHazard(briefing: CityBriefing, warning: PanelWarning): Exclude<CityHazardKind, "warning" | "calm"> | null {
  const narrative = briefing.narrative.primaryKind;
  if (narrative === "rain" || narrative === "wind" || narrative === "convection" || narrative === "heat") return narrative;
  const warningText = warning.status === "active" ? warning.title : "";
  if (/高温|热浪|酷热/.test(warningText)) return "heat";
  if (/暴雨|降雨|洪水|内涝/.test(warningText)) return "rain";
  if (/大风|台风|阵风|风/.test(warningText)) return "wind";
  if (/雷电|冰雹|强对流/.test(warningText)) return "convection";
  const strongestRisk = [...modelRisks(briefing)]
    .sort((left, right) => riskWeight(right.level) - riskWeight(left.level))[0];
  return strongestRisk?.kind === "rain" || strongestRisk?.kind === "wind" || strongestRisk?.kind === "convection" || strongestRisk?.kind === "heat"
    ? strongestRisk.kind
    : null;
}

function rankMetrics(metrics: PanelMetric[], hazard: Exclude<CityHazardKind, "warning" | "calm"> | null) {
  const priority = hazard ? HAZARD_METRIC_PRIORITY[hazard] : GENERIC_METRIC_PRIORITY;
  return [...metrics].sort((left, right) => {
    const leftIndex = priority.indexOf(left.id);
    const rightIndex = priority.indexOf(right.id);
    const leftScore = (leftIndex < 0 ? 0 : 200 - leftIndex * 12) + evidenceWeight(left.evidence) + (hasReading(left) ? 30 : 0);
    const rightScore = (rightIndex < 0 ? 0 : 200 - rightIndex * 12) + evidenceWeight(right.evidence) + (hasReading(right) ? 30 : 0);
    return rightScore - leftScore || left.id.localeCompare(right.id);
  });
}

function uniqueMetrics(metrics: PanelMetric[]) {
  const seen = new Set<string>();
  return metrics.filter((metric) => {
    if (seen.has(metric.id)) return false;
    seen.add(metric.id);
    return true;
  });
}

function toBroadcastMetric(metric: PanelMetric): LiveCityBroadcastMetric {
  return {
    ...metric,
    displayValue: metric.unit && metric.value !== "暂无资料" ? `${metric.value}${metric.unit}` : metric.value
  };
}

function dataGapMetric(): LiveCityBroadcastMetric {
  return {
    id: "data-gap",
    label: "资料状态",
    value: "资料受限",
    displayValue: "资料受限",
    detail: "当前没有足够资料形成可信读数。",
    evidence: "unavailable"
  };
}

function hasReading(metric: PanelMetric) {
  return metric.evidence !== "unavailable" && metric.value !== "暂无资料";
}

function isNearTermMetric(id: string) {
  return id.includes("next-2h") || id.includes("next-6h") || id.includes("probability") || id.includes("gust");
}

function isTrendMetric(id: string) {
  return id.includes("next-6h") || id === "rain-probability" || id === "cape-next-6h";
}

function evidenceWeight(evidence: PanelEvidence) {
  return ({ official: 24, observed: 20, model: 12, unavailable: 0 })[evidence];
}

function modelRisks(briefing: CityBriefing) {
  return briefing.risks.filter((risk) => risk.kind !== "warning" && risk.kind !== "calm");
}

function riskWeight(level: CityBriefing["risks"][number]["level"]) {
  return ({ severe: 4, high: 3, moderate: 2, low: 1, unavailable: 0 })[level];
}
