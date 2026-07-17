import type { CityBriefing, CityComparisonRank } from "@/lib/cityBriefingData";
import type { BattleArchive, BattleMutator, CityPanelsModel } from "@/lib/cityPanelsPresentation";

export type CityBattleShowPhase = "deploy" | "card";

export interface CityBattleTelemetryMetric {
  id: string;
  label: string;
  value: string;
  detail: string;
  level: number;
  icon: "temperature" | "humidity" | "rain" | "wind" | "convection";
}

export interface CityBattleTelemetryDeck {
  id: string;
  title: string;
  metrics: CityBattleTelemetryMetric[];
}

export type CityBattleRankTier = "crown" | "elite" | "frontline" | "field" | "local";

export interface CityBattleRankIntel {
  id: "apparent-temperature" | "humidity" | "wind" | "precipitation";
  label: string;
  value: string;
  position: number;
  total: number;
  scope: string;
  tier: CityBattleRankTier;
  adaptation: string;
}

type CityBattleRankCandidate = Omit<CityBattleRankIntel, "tier" | "adaptation"> & { raw: number };

export interface CityBattleShowViewModel {
  cityLabel: string;
  viewerLabel: string | null;
  title: string;
  score: number;
  statusSeal: string | null;
  summary: string;
  rankIntel: CityBattleRankIntel[];
  telemetry: CityBattleTelemetryDeck[];
  mutators: BattleMutator[];
  actions: Array<{ id: string; text: string; delayMs: number }>;
  archive: BattleArchive;
  observedAt: string;
}

export function buildCityBattleShowModel({
  briefing,
  model,
  archive = model.battle.archive
}: {
  briefing: CityBriefing;
  model: CityPanelsModel;
  archive?: BattleArchive;
}): CityBattleShowViewModel {
  const officialFacts = collectOfficialFacts(briefing);
  const summary = resolveBattleNarrative(briefing, model.battle.summary);
  const safeArchive = sanitizeArchive(archive, officialFacts);

  return {
    cityLabel: model.shared.cityLabel,
    viewerLabel: model.shared.viewerName,
    title: safeText(model.battle.title, officialFacts, "城市战况载入"),
    score: clamp(model.battle.threatScore, 0, 100),
    statusSeal: model.battle.statusSeal
      ? safeText(model.battle.statusSeal, officialFacts, "EVENT // ACTIVE")
      : null,
    summary,
    rankIntel: buildRankIntel(briefing),
    telemetry: buildTelemetry(briefing),
    mutators: model.battle.mutators.slice(0, 3).map((mutator) => ({
      ...mutator,
      label: safeText(mutator.label, officialFacts, "环境异动"),
      value: safeText(mutator.value, officialFacts, "ACTIVE"),
      detail: safeText(mutator.detail, officialFacts, "参数已记录"),
      comment: safeText(mutator.comment, officialFacts, "本轮状态已写入城市副本。")
    })),
    actions: model.battle.actions.slice(0, 2).map((action, index) => ({
      id: `action-${index + 1}`,
      text: safeText(action, officialFacts, index === 0 ? "给行程留出调整空间。" : "继续观察环境变化。"),
      delayMs: 180 + index * 150
    })),
    archive: safeArchive,
    observedAt: briefing.current.observedAt ?? briefing.generatedAt
  };
}

/**
 * Ranking is a battle affordance, not a second weather feed. It only uses the
 * comparison snapshot already attached to this briefing, then selects the two
 * strongest meaningful positions for the broadcast hero.
 */
export function buildRankIntel(briefing: CityBriefing): CityBattleRankIntel[] {
  const comparison = briefing.comparison;
  if (!comparison) return [];

  const current = briefing.current;
  const candidates: Array<CityBattleRankCandidate | null> = [
    rankCandidate("apparent-temperature", "体感热度", current.apparentTemperatureC ?? current.temperatureC, "°C", comparison.apparentTemperatureRank, comparison.scope),
    rankCandidate("humidity", "空气含水", current.relativeHumidityPct, "%", comparison.relativeHumidityRank, comparison.scope),
    rankCandidate("wind", "近地风场", current.windSpeedMps, " m/s", comparison.windSpeedRank, comparison.scope),
    rankCandidate("precipitation", "代表点降水", current.precipitationMm, " mm", comparison.precipitationRank, comparison.scope)
  ];
  const meaningfulCandidates = candidates
    .filter((candidate): candidate is CityBattleRankCandidate => candidate !== null)
    .filter(isMeaningfulRankReading);

  return meaningfulCandidates
    .sort((left, right) => rankStrength(right) - rankStrength(left) || left.position - right.position)
    .slice(0, 2)
    .map(({ raw: _raw, ...candidate }) => {
      const tier = rankTier(candidate.position, candidate.total);
      return { ...candidate, tier, adaptation: rankAdaptation(candidate.id, tier, candidate.position, candidate.total) };
    });
}

function rankCandidate(
  id: CityBattleRankIntel["id"],
  label: string,
  raw: number | null,
  unit: string,
  rank: CityComparisonRank | undefined,
  fallbackScope: string
): CityBattleRankCandidate | null {
  if (raw === null || !rank || typeof rank !== "object" || !("position" in rank) || !("total" in rank)) return null;
  const position = Number(rank.position);
  const total = Number(rank.total);
  if (!Number.isFinite(position) || !Number.isFinite(total) || position < 1 || total < position) return null;
  return { id, label, value: `${formatMetric(raw)}${unit}`, position, total, scope: typeof rank.scope === "string" && rank.scope.trim() ? rank.scope : fallbackScope, raw };
}

function isMeaningfulRankReading(rank: CityBattleRankCandidate) {
  if (rank.id === "precipitation") return rank.raw >= 0.1;
  if (rank.id === "wind") return rank.raw >= 4;
  if (rank.id === "humidity") return rank.raw >= 45;
  return true;
}

function rankStrength(rank: CityBattleRankCandidate) {
  return 1 - ((rank.position - 1) / Math.max(1, rank.total - 1));
}

function rankTier(position: number, total: number): CityBattleRankTier {
  if (position === 1) return "crown";
  if (position <= 3) return "elite";
  if (position <= 10) return "frontline";
  if (position / total <= 0.15) return "field";
  return "local";
}

function rankAdaptation(id: CityBattleRankIntel["id"], tier: CityBattleRankTier, position: number, total: number) {
  const rankLabel = tier === "crown" ? "登顶" : tier === "elite" ? "跻身前三" : tier === "frontline" ? "打入前十" : tier === "field" ? "进入前列" : `位列 ${position}/${total}`;
  const lines: Record<CityBattleRankIntel["id"], Record<CityBattleRankTier, string>> = {
    "apparent-temperature": {
      crown: "热压登顶，阴影点按稀有补给站管理。",
      elite: "热压跻身前三，主线任务避开正午窗口。",
      frontline: "热度打入前十，补水与降温进入常驻技能栏。",
      field: "热压进入前列，路线优先串联阴影与补水点。",
      local: "体感仍有存在感，行程给高热时段留出余量。"
    },
    humidity: {
      crown: "空气含水登顶，干爽装备今日无权发言。",
      elite: "湿度跻身前三，通风位与速干位优先占领。",
      frontline: "湿热打入前十，移动节奏切换为低消耗模式。",
      field: "空气含水进入前列，体感条会比温度条更诚实。",
      local: "湿度仍参与战局，别把体感只交给温度数字。"
    },
    wind: {
      crown: "风场登顶，轻物件请先完成离队申请。",
      elite: "风场跻身前三，发型与伞面进入协商阶段。",
      frontline: "风速打入前十，路线避开长直风廊。",
      field: "风场进入前列，手持物与帽檐提高警戒。",
      local: "风场有一定存在感，留意局地阵风的临时加戏。"
    },
    precipitation: {
      crown: "雨势登顶，鞋底与排水口都在申请战术支援。",
      elite: "雨势跻身前三，路线优先选择可撤离的干线。",
      frontline: "降水打入前十，伞具耐久开始按回合结算。",
      field: "雨势进入前列，给通勤路线预留转身位。",
      local: "当前雨势已有读数，路面节奏需要顺手调整。"
    }
  };
  return `${rankLabel}：${lines[id][tier]}`;
}

function formatMetric(raw: number) {
  return raw.toFixed(1).replace(/\.0$/, "");
}

export function splitRevealText(text: string): string[] {
  return Array.from(text);
}

export function resolveBattleNarrative(briefing: CityBriefing, fallback: string): string {
  const officialFacts = collectOfficialFacts(briefing);
  const safeFallback = safeText(fallback, officialFacts, "城市环境参数已装入战术终端，按当前状态推进本轮行动。");
  return safeText(briefing.narrative.summary, officialFacts, safeFallback);
}

export function revealDelayFor(character: string, speedMs: number): number {
  if (/[。！？!?]/u.test(character)) return speedMs * 5;
  if (/[，、；：,;:]/u.test(character)) return speedMs * 2.4;
  return speedMs;
}

function buildTelemetry(briefing: CityBriefing): CityBattleTelemetryDeck[] {
  const current = briefing.current;
  const next = briefing.nextSixHours;
  return [
    {
      id: "current",
      title: "LIVE TELEMETRY // 实况链路",
      metrics: [
        metric("temperature", "实况温度", current.temperatureC, "°C", `体感 ${value(current.apparentTemperatureC, "°C")}`, temperatureLevel(current.temperatureC), "temperature"),
        metric("humidity", "相对湿度", current.relativeHumidityPct, "%", "空气含水", current.relativeHumidityPct ?? 0, "humidity"),
        metric("rain-now", "当前降水", current.precipitationMm, " mm", "当前时段", rainLevel(current.precipitationMm), "rain"),
        metric("wind-now", "近地风速", current.windSpeedMps, " m/s", "近实时", windLevel(current.windSpeedMps), "wind")
      ]
    },
    {
      id: "forecast",
      title: "SIX HOUR WINDOW // 战术窗口",
      metrics: [
        metric("rain-six-hour", "六小时累计", next.precipitationMm, " mm", "模式趋势", rainLevel(next.precipitationMm), "rain"),
        metric("rain-probability", "降水概率", next.maxPrecipitationProbabilityPct, "%", "六小时峰值", next.maxPrecipitationProbabilityPct ?? 0, "rain"),
        metric("gust", "阵风峰值", next.maxWindGustMps, " m/s", "六小时峰值", windLevel(next.maxWindGustMps), "wind"),
        metric("cape", "对流条件", next.maxCapeJkg, " J/kg", "模式环境", convectionLevel(next.maxCapeJkg), "convection")
      ]
    }
  ];
}

function metric(
  id: string,
  label: string,
  raw: number | null,
  unit: string,
  detail: string,
  level: number,
  icon: CityBattleTelemetryMetric["icon"]
): CityBattleTelemetryMetric {
  return { id, label, value: value(raw, unit), detail, level: clamp(level, 0, 100), icon };
}

function value(raw: number | null, unit: string) {
  return raw === null ? "暂无资料" : `${raw.toFixed(1).replace(/\.0$/, "")}${unit}`;
}

function temperatureLevel(raw: number | null) { return raw === null ? 0 : (raw - 15) * 5; }
function rainLevel(raw: number | null) { return raw === null ? 0 : raw * 4; }
function windLevel(raw: number | null) { return raw === null ? 0 : raw * 5; }
function convectionLevel(raw: number | null) { return raw === null ? 0 : raw / 20; }

function collectOfficialFacts(briefing: CityBriefing): string[] {
  return briefing.officialWarnings.flatMap((warning) => [
    warning.title,
    warning.senderName,
    warning.description,
    warning.instruction
  ]).filter((item): item is string => typeof item === "string" && item.trim().length >= 4);
}

function safeText(text: string, officialFacts: string[], fallback: string): string {
  const normalized = text.trim();
  if (!normalized) return fallback;
  if (officialFacts.some((fact) => normalized.includes(fact.trim()))) return fallback;
  return normalized;
}

function sanitizeArchive(archive: BattleArchive, officialFacts: string[]): BattleArchive {
  if (archive.status === "locked") {
    return {
      ...archive,
      fragment: null,
      statusText: archive.statusText.split(/[｜|]/u)[0]?.trim() || "未检测到关注凭证"
    };
  }
  if (!archive.fragment || !officialFacts.some((fact) => archive.fragment!.includes(fact.trim()))) return archive;
  return {
    ...archive,
    status: "unavailable",
    fragment: null,
    statusText: "观测员权限已确认，档案同步中"
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));
}
