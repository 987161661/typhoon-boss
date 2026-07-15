import type { CityBriefing } from "@/lib/cityBriefingData";
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

export interface CityBattleShowViewModel {
  cityLabel: string;
  viewerLabel: string | null;
  title: string;
  score: number;
  statusSeal: string | null;
  summary: string;
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
