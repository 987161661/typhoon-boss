import { sortNationalWeatherEvents } from "@/lib/nationalWeather";
import type {
  NationalSituationSnapshot,
  NationalWeatherEvent,
  SourceFreshness,
  SourceHealth,
  WeatherEventLevel,
  WeatherHazard
} from "@/lib/nationalWeatherTypes";

export type HudSourceState = {
  sourceId: string;
  label: string;
  status: SourceFreshness;
  statusLabel: string;
  statusDetail: string;
  updatedLabel: string;
  isPrimaryEvidence: boolean;
};

export type HudMainEvent = {
  id: string;
  hazard: WeatherHazard;
  title: string;
  locationLabel: string;
  factSummary: string;
  limitation: string;
  level: WeatherEventLevel;
  levelLabel: string;
  evidenceLabel: string;
  evidenceDetail: string;
  timeLabel: string;
  badgeAsset: string;
  sealAsset: string;
  isOfficialHighRisk: boolean;
};

export type NationalSituationHudModel = {
  generatedLabel: string;
  mainEvent: HudMainEvent | null;
  /**
   * Display-only queue for authoritative warnings. It deliberately does not
   * change the snapshot ordering contract used by map risk and broadcast
   * systems.
   */
  warningQueue: HudMainEvent[];
  warning: {
    total: number;
    highestLevel: Exclude<WeatherEventLevel, "watch"> | null;
    highestLevelLabel: string;
    countsLabel: string;
    updatedLabel: string;
  };
  city: {
    state: "events" | "quiet";
    eventCount: number;
    label: string;
    detail: string;
    coverageLabel: string;
  };
  sources: HudSourceState[];
  eventCount: number;
};

const SOURCE_STATUS_LABEL: Record<SourceFreshness, string> = {
  fresh: "最新",
  delayed: "延迟",
  expired: "已过期",
  unavailable: "不可用",
  "no-record": "无记录"
};

const SOURCE_STATUS_DETAIL: Record<SourceFreshness, string> = {
  fresh: "刷新正常",
  delayed: "刷新延迟，保留最近有效时次",
  expired: "数据已过期，仅供核对",
  unavailable: "来源不可用，不等于无风险",
  "no-record": "来源返回无记录，不等于无风险"
};

const LEVEL_LABEL: Record<WeatherEventLevel, string> = {
  red: "红色官方风险",
  orange: "橙色官方风险",
  yellow: "黄色官方风险",
  blue: "蓝色官方风险",
  watch: "观察信号"
};

const WARNING_LEVEL_LABEL: Record<Exclude<WeatherEventLevel, "watch">, string> = {
  red: "红色预警",
  orange: "橙色预警",
  yellow: "黄色预警",
  blue: "蓝色预警"
};

const SEAL_ASSET: Record<WeatherEventLevel, string> = {
  red: "/assets/weather-boss/risk-seal-red.svg",
  orange: "/assets/weather-boss/risk-seal-orange.svg",
  yellow: "/assets/weather-boss/risk-seal-yellow.svg",
  blue: "/assets/weather-boss/risk-seal-blue.svg",
  watch: "/assets/weather-boss/risk-seal-watch.svg"
};

const BADGE_ASSET: Record<WeatherHazard, string> = {
  typhoon: "/assets/weather-boss/event-badge-typhoon.svg",
  rain: "/assets/weather-boss/event-badge-rainstorm.svg",
  convection: "/assets/weather-boss/event-badge-severe-convection.svg",
  heat: "/assets/weather-boss/event-badge-heat.svg",
  wind: "/assets/weather-boss/event-badge-gale-dust.svg",
  dust: "/assets/weather-boss/event-badge-gale-dust.svg",
  visibility: "/assets/weather-boss/event-badge-gale-dust.svg",
  flood: "/assets/weather-boss/event-badge-rainstorm.svg",
  geological: "/assets/weather-boss/event-badge-composite-warning.svg",
  other: "/assets/weather-boss/event-badge-composite-warning.svg"
};

export function buildNationalSituationHudModel(snapshot: NationalSituationSnapshot): NationalSituationHudModel {
  const events = sortNationalWeatherEvents(snapshot.events);
  const main = events[0] ?? null;
  const warningQueue = buildOfficialWarningQueue(events);
  const deterministicCityEvents = events.filter((event) =>
    event.geography.cityAttribution === "deterministic" && event.geography.cityCode !== null
  );
  const cityCodes = new Set(deterministicCityEvents.map((event) => event.geography.cityCode));
  const coverage = snapshot.cityRankSnapshot;

  return {
    generatedLabel: formatNationalTime(snapshot.generatedAt),
    mainEvent: main ? toMainEvent(main) : null,
    warningQueue,
    warning: {
      total: snapshot.warnings.total,
      highestLevel: snapshot.warnings.highestLevel,
      highestLevelLabel: snapshot.warnings.highestLevel
        ? WARNING_LEVEL_LABEL[snapshot.warnings.highestLevel]
        : "当前无官方预警记录",
      countsLabel: warningCountsLabel(snapshot.warnings.byLevel),
      updatedLabel: formatNationalTime(snapshot.warnings.updatedAt)
    },
    city: cityCodes.size > 0
      ? {
          state: "events",
          eventCount: cityCodes.size,
          label: `${cityCodes.size} 个城市级事件可核对`,
          detail: "仅包含行政父级已确定的全国事件。",
          coverageLabel: coverage
            ? `城市排名快照覆盖 ${coverage.cityCount} 城`
            : "城市排名快照尚未接入"
        }
      : {
          state: "quiet",
          eventCount: 0,
          label: "当前未发现显著城市战况",
          detail: "这是当前统一快照的结果，不代表没有风险。",
          coverageLabel: coverage
            ? `城市排名快照覆盖 ${coverage.cityCount} 城`
            : "城市排名快照尚未接入，数据边界仍在"
        },
    sources: sortSourceHealth(snapshot.sourceHealth, main),
    eventCount: events.length
  };
}

/**
 * A red/orange/yellow/blue round is intentionally not a severity score. It
 * is a broadcast cadence: red receives a second slot while every available
 * official level still reaches the viewer before the next red-only pass.
 */
export function buildOfficialWarningQueue(events: readonly NationalWeatherEvent[]): HudMainEvent[] {
  const byLevel: Record<Exclude<WeatherEventLevel, "watch">, HudMainEvent[]> = {
    red: [], orange: [], yellow: [], blue: []
  };
  for (const event of events) {
    if (event.kind !== "official-warning" || event.evidenceLevel !== "official" || event.level === "watch") continue;
    byLevel[event.level].push(toMainEvent(event));
  }

  const queue: HudMainEvent[] = [];
  const cursor: Record<Exclude<WeatherEventLevel, "watch">, number> = { red: 0, orange: 0, yellow: 0, blue: 0 };
  const round: Array<Exclude<WeatherEventLevel, "watch">> = ["red", "red", "orange", "yellow", "blue"];
  while (round.some((level) => cursor[level] < byLevel[level].length)) {
    for (const level of round) {
      const event = byLevel[level][cursor[level]];
      if (!event) continue;
      queue.push(event);
      cursor[level] += 1;
    }
  }
  return queue;
}

function toMainEvent(event: NationalWeatherEvent): HudMainEvent {
  const official = event.evidenceLevel === "official" && event.level !== "watch";
  const displayLevel = official ? event.level : "watch";
  return {
    id: event.id,
    hazard: event.hazard,
    title: event.title,
    locationLabel: event.geography.names.length > 0 ? event.geography.names.join(" / ") : "全国范围",
    factSummary: event.factSummary,
    limitation: event.limitations[0] ?? "详情以对应来源的最新有效记录为准。",
    level: displayLevel,
    levelLabel: official ? LEVEL_LABEL[displayLevel] : "观察信号",
    evidenceLabel: official ? "官方事实" : event.evidenceLevel === "model" ? "模式观察" : "环境观察",
    evidenceDetail: official
      ? "按官方事实层级进入主事件排序"
      : "仅作观察证据，不能替代官方预警结论",
    timeLabel: formatNationalTime(event.issuedAt ?? event.dataTime ?? event.updatedAt),
    badgeAsset: BADGE_ASSET[event.hazard],
    sealAsset: SEAL_ASSET[displayLevel],
    isOfficialHighRisk: official && (displayLevel === "red" || displayLevel === "orange")
  };
}

function sortSourceHealth(sourceHealth: readonly SourceHealth[], main: NationalWeatherEvent | null): HudSourceState[] {
  const primary = new Set(main?.sourceIds ?? []);
  const statusWeight: Record<SourceFreshness, number> = {
    unavailable: 4,
    expired: 3,
    delayed: 2,
    "no-record": 1,
    fresh: 0
  };
  return [...sourceHealth]
    .sort((a, b) => Number(primary.has(b.sourceId)) - Number(primary.has(a.sourceId))
      || statusWeight[b.status] - statusWeight[a.status]
      || a.label.localeCompare(b.label, "zh-CN"))
    .map((source) => ({
      sourceId: source.sourceId,
      label: source.label,
      status: source.status,
      statusLabel: SOURCE_STATUS_LABEL[source.status],
      statusDetail: SOURCE_STATUS_DETAIL[source.status],
      updatedLabel: formatNationalTime(source.lastSuccessfulAt ?? source.updatedAt),
      isPrimaryEvidence: primary.has(source.sourceId)
    }));
}

function warningCountsLabel(counts: Record<Exclude<WeatherEventLevel, "watch">, number>) {
  return `红 ${counts.red} · 橙 ${counts.orange} · 黄 ${counts.yellow} · 蓝 ${counts.blue}`;
}

export function formatNationalTime(value: string | null) {
  if (!value) return "未记录";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "时次无效";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date).replaceAll("/", "-");
}
