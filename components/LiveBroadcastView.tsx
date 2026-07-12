"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BatteryCharging,
  Clock3,
  MapPin,
  RadioTower,
  RefreshCw,
  Route,
  Satellite,
  TimerReset,
  Zap,
} from "lucide-react";
import type { BossEvidenceLevel, BossProfile } from "@/lib/bossEngine/types";
import type { SatelliteLayerPayload, Storm } from "@/lib/types";
import { windForceFromSpeed as sharedWindForceFromSpeed } from "@/lib/meteorology";
import { StormSatellitePortrait } from "./StormSatellitePortrait";

interface LiveMetric {
  label: string;
  value: string;
  unit: string;
  tone: "hot" | "cool" | "neutral";
}

interface LiveStructureBrief {
  mode: "structure" | "satellite" | "unavailable";
  eyebrow: string;
  title: string;
  detail: string;
  evidenceLabel: string;
  evidenceLevel: BossEvidenceLevel | "unavailable";
  confidenceLabel: string;
  sourceLabel: string;
  observedAt: string;
}

interface LiveAhiBand {
  id: "B03" | "B08" | "B13";
  label: string;
  available: boolean;
}

interface LiveForecastPoint {
  id: string;
  time: string;
  wind: string;
  pressure: string;
}

interface LiveEventBrief {
  id: string;
  time: string;
  title: string;
  detail: string;
  evidence: string;
}

interface LiveSatelliteProduct {
  id: string;
  label: string;
  status: "available" | "unavailable";
}

export type LiveDeckView = "briefing" | "analysis";

interface LiveLandfallBrief {
  label: string;
  place: string;
  time: string;
  detail: string;
  status: "forecast-landfall" | "approaching" | "overland" | "open-ocean" | "unavailable";
}

interface LiveLandfallScenario {
  id: string;
  province: string;
  headlineLabel: string;
  impactStatus: "landfall" | "direct" | "watch" | "unaffected" | "unavailable";
  impactLabel: string;
  currentWindLabel: string;
  timeLabel: string;
  countdownLabel: string;
  strengthLabel: string;
  time: string;
  countdown: string;
  windLevel: string;
  windSpeed: string;
  currentWindLevel: string;
  currentWindSpeed: string;
  currentWindDirection: string;
  windObservedAt: string;
  windSamples: string;
  windDataStale: boolean;
  closestApproach: string;
  support: string;
  durationMs: number;
  isPriority: boolean;
  priorityReason: string | null;
}

interface LiveLandingPriority {
  province: string | null;
  place: string;
  time: string;
  isConfirmed: boolean;
  phase: "upcoming" | "just-landed";
}

interface LiveCityTickerItem {
  id: string;
  message: string;
}

export interface LiveBroadcastModel {
  status: "active" | "standby" | "degraded";
  nameZh: string;
  nameEn: string;
  code: string;
  archetype: string;
  phase: string;
  stageLabel: string;
  windForceLevel: string;
  energy: number;
  landfall: LiveLandfallBrief;
  landfallScenarios: LiveLandfallScenario[];
  stormTime: string;
  syncTime: string;
  sourceLabel: string;
  sourceTitle: string;
  stale: boolean;
  metrics: LiveMetric[];
  structure: LiveStructureBrief;
  ahiBands: LiveAhiBand[];
  ahiUpdatedAt: string;
  forecast: LiveForecastPoint[];
  agencyCodes: string[];
  trackPointCount: number;
  forecastPointCount: number;
  events: LiveEventBrief[];
  satelliteProducts: LiveSatelliteProduct[];
  professionalSources: string[];
  tickerTitle: string;
  tickerDetail: string;
  tickerEvidence: string;
  cityTickerItems: LiveCityTickerItem[];
}

export function buildLiveBroadcastModel({
  storm,
  bossProfile,
  sourceLabel,
  lastUpdated,
  lastSyncedAt,
  dataError,
  snapshotStale
}: {
  storm: Storm | null;
  bossProfile?: BossProfile | null;
  sourceLabel: string;
  lastUpdated: string;
  lastSyncedAt?: number | null;
  dataError?: string | null;
  snapshotStale?: boolean;
}): LiveBroadcastModel {
  const status = dataError ? "degraded" : storm ? "active" : "standby";
  const structure = buildStructureBrief(bossProfile);
  const sourceParts = storm
    ? ["实时路径", bossProfile?.structure.source !== "unavailable" ? bossProfile?.structure.sourceLabel : null, bossProfile?.ahi.sensor]
    : ["实时路径监测"];
  const sourceSummary = unique(sourceParts.filter((item): item is string => Boolean(item))).join(" · ");
  const primaryForecast =
    storm?.forecastScenarios.find((scenario) => scenario.isPrimary)?.points ?? storm?.forecast ?? [];
  const forecast = primaryForecast.slice(0, 6).map((point, index) => ({
    id: `${point.time}-${index}`,
    time: formatCompactTime(point.time),
    wind: point.wind > 0 ? `${Math.round(point.wind)} m/s` : "风速待报",
    pressure: point.pressure > 0 ? `${Math.round(point.pressure)} hPa` : "气压待报"
  }));
  const latestEvent =
    bossProfile?.events.find((event) => event.category === "structure") ?? bossProfile?.events[0] ?? null;
  const landingPriority = buildLandingPriority(storm, bossProfile);

  return {
    status,
    nameZh: storm?.nameZh ?? "当前无活动台风",
    nameEn: storm?.nameEn || "STANDBY",
    code: storm?.code ?? "--",
    archetype: bossProfile?.archetypeLabel ?? storm?.stage ?? "待机巡航",
    phase: bossProfile?.phaseLabel ?? storm?.rating ?? "低威胁",
    stageLabel: storm?.stage ?? "待机",
    windForceLevel: storm ? windForceFromSpeed(storm.maxWind) : "--",
    energy: bossProfile?.energy ?? (storm ? calculateFallbackEnergy(storm) : 0),
    landfall: buildLandfallBrief(bossProfile),
    landfallScenarios: buildLiveLandfallScenarios(bossProfile, landingPriority),
    stormTime: storm ? formatCompactTime(storm.updatedAt) : "等待上游发布",
    syncTime: lastSyncedAt ? formatSyncTime(lastSyncedAt) : lastUpdated,
    sourceLabel: sourceSummary,
    sourceTitle: sourceLabel,
    stale: Boolean(snapshotStale || bossProfile?.structure.stale),
    metrics: storm ? buildMetrics(storm) : emptyMetrics(),
    structure,
    ahiBands: buildAhiBands(bossProfile),
    ahiUpdatedAt: bossProfile?.ahi.updatedAt ? formatCompactTime(bossProfile.ahi.updatedAt) : "等待卫星资料",
    forecast,
    agencyCodes: unique((storm?.forecastScenarios ?? []).map((scenario) => scenario.agencyCode)).slice(0, 5),
    trackPointCount: storm?.track.length ?? 0,
    forecastPointCount: storm?.forecast.length ?? 0,
    events: (bossProfile?.events ?? []).slice(0, 4).map((event) => ({
      id: event.id,
      time: formatCompactTime(event.time),
      title: event.title,
      detail: event.detail,
      evidence: evidenceLabel(event.evidenceLevel)
    })),
    satelliteProducts: (bossProfile?.satellite.products ?? []).map((product) => ({
      id: product.product,
      label: product.label,
      status: product.status
    })),
    professionalSources: unique([
      bossProfile?.sourcePolicy.machineReadableTrackSource,
      bossProfile?.structure.sourceLabel,
      bossProfile?.ahi.attribution
    ].filter((item): item is string => Boolean(item))),
    tickerTitle: dataError ? "数据链路异常" : latestEvent?.title ?? (storm ? "当前风险判断" : "雷达待机巡航"),
    tickerDetail: dataError
      ? "实时接口正在重试，画面中的旧资料必须结合标注时次判断。"
      : latestEvent?.detail ?? bossProfile?.riskSummary ?? storm?.notice ?? "当前没有活动台风，系统继续监听公开实况。",
    tickerEvidence: dataError
      ? "链路降级"
      : latestEvent
        ? `${evidenceLabel(latestEvent.evidenceLevel)} · ${formatCompactTime(latestEvent.time)}`
        : storm
          ? `公开实况 · ${formatCompactTime(storm.updatedAt)}`
          : "每 10 秒检查一次",
    cityTickerItems: buildCityTickerItems(storm)
  };
}

export function LiveTopBar({
  model,
  refreshSequence,
  deck,
  secondsToSwitch,
  cycle
}: {
  model: LiveBroadcastModel;
  refreshSequence: number;
  deck: LiveDeckView;
  secondsToSwitch: number;
  cycle: number;
}) {
  return (
    <header className={`live-topbar status-${model.status}`} key={`${deck}-${cycle}`}>
      <div className="live-topbar-brand">
        <span>台风 BOSS 雷达</span>
        <strong><i /> LIVE · {deck === "briefing" ? "观众态势" : "专业分析"}</strong>
      </div>
      <div className="live-topbar-target">
        <span>当前目标</span>
        <strong>{model.status === "active" ? `${model.nameZh} · ${model.archetype}` : model.nameZh}</strong>
      </div>
      <div className="live-topbar-sync">
        <RefreshCw key={refreshSequence} aria-hidden="true" />
        <div>
          <span>{model.status === "degraded" ? "数据链路异常" : `第 ${refreshSequence} 次实时同步`}</span>
          <strong>{model.syncTime} · {secondsToSwitch > 0 ? `${secondsToSwitch}秒后换屏` : "场景常驻"}</strong>
        </div>
        {secondsToSwitch > 0 ? <i className="live-view-progress" aria-hidden="true" /> : null}
      </div>
    </header>
  );
}

export function LiveForecastOverlay({ model }: { model: LiveBroadcastModel }) {
  if (model.status !== "active") return null;
  return (
    <section className="live-forecast-overlay" aria-label="未来三个关键时次">
      <div className="live-forecast-heading">
        <Route aria-hidden="true" />
        <span>主路径关键时次</span>
      </div>
      {model.forecast.length > 0 ? (
        <div className="live-forecast-points">
          {model.forecast.slice(0, 3).map((point, index) => (
            <article key={point.id}>
              <b>+{index + 1}</b>
              <strong>{point.time}</strong>
              <span>{point.wind}</span>
              <small>{point.pressure}</small>
            </article>
          ))}
        </div>
      ) : (
        <p>预测路径时次等待上游发布</p>
      )}
    </section>
  );
}

function LiveLandfallBroadcast({ scenarios }: { scenarios: LiveLandfallScenario[] }) {
  const [page, setPage] = useState(0);
  const playback = useMemo(() => buildPriorityPlayback(scenarios), [scenarios]);
  const scenario = playback[page % Math.max(1, playback.length)];
  const pageDurationMs = scenario?.durationMs ?? 2500;

  useEffect(() => {
    setPage(provincePageAtTimestamp(playback, Date.now()));
  }, [playback]);

  useEffect(() => {
    if (playback.length <= 1) return;
    const timer = window.setTimeout(() => {
      setPage((current) => (current + 1) % playback.length);
    }, pageDurationMs);
    return () => window.clearTimeout(timer);
  }, [page, pageDurationMs, playback.length]);

  const nextScenario = playback.length > 1 ? playback[(page + 1) % playback.length] : null;

  return (
    <section className="live-landfall-broadcast" aria-label="全国省份播报">
      <header>
        <div><RadioTower aria-hidden="true" /><strong>全国省份播报</strong></div>
        <b>{scenario?.isPriority ? "登陆事件优先播报" : scenarios.length ? `${page + 1}/${playback.length}` : "0/34"} · {scenario?.impactLabel ?? "全国数据同步中"}</b>
      </header>
      {scenario ? (
        <article className={`${scenario.windDataStale ? "is-wind-stale" : ""} ${scenario.isPriority ? "is-landing-priority" : ""}`} key={`${scenario.id}-${page}`}>
          <div className="live-landfall-destination">
            <span>{scenario.isPriority ? scenario.priorityReason : scenario.headlineLabel}</span>
            <strong>{scenario.province}</strong>
          </div>
          <div className="live-landfall-current-wind">
            <span>{scenario.currentWindLabel}</span>
            <strong>{scenario.currentWindLevel}</strong>
          </div>
          <div className="live-landfall-time"><Clock3 aria-hidden="true" /><span>{scenario.timeLabel}</span><strong>{scenario.time}</strong></div>
          <div className="live-landfall-wind"><Zap aria-hidden="true" /><span>{scenario.strengthLabel}</span><strong>{scenario.windSpeed ? `${scenario.windLevel} · ${scenario.windSpeed}` : scenario.windLevel}</strong></div>
          <div className="live-landfall-facts">
            <span><b>{scenario.countdownLabel}</b><strong>{scenario.countdown}</strong></span>
            <span><b>路径最近</b><strong>{scenario.closestApproach}</strong></span>
            <span><b>路径支持</b><strong>{scenario.support}</strong></span>
            <span><b>平均风速</b><strong>{scenario.currentWindDirection} · {scenario.currentWindSpeed} · {scenario.windSamples}</strong></span>
          </div>
        </article>
      ) : (
        <div className="live-landfall-empty">全国34省级地区数据正在同步，暂不使用局部情景替代。</div>
      )}
      <footer><i key={scenario?.id} style={{ animationDuration: `${scenario?.durationMs ?? 2500}ms` }} />下一站 {nextScenario?.province ?? "等待队列"} · 风场 {scenario?.windObservedAt ?? "待同步"}{scenario?.windDataStale ? "（延迟保护）" : ""}</footer>
    </section>
  );
}

export function LiveAudiencePanel({
  model,
  storm,
  satelliteLayer,
  refreshSequence
}: {
  model: LiveBroadcastModel;
  storm: Storm | null;
  satelliteLayer?: SatelliteLayerPayload | null;
  refreshSequence: number;
}) {
  if (!storm) {
    return (
      <aside className={`live-audience-panel is-${model.status}`} aria-label="直播观众态势">
        <div className="live-standby-panel">
          {model.status === "degraded" ? <AlertTriangle aria-hidden="true" /> : <RadioTower aria-hidden="true" />}
          <span>{model.status === "degraded" ? "LIVE LINK DEGRADED" : "LIVE RADAR STANDBY"}</span>
          <h1>{model.nameZh}</h1>
          <p>{model.tickerDetail}</p>
          <div><Clock3 aria-hidden="true" /> 最近同步 {model.syncTime}</div>
        </div>
      </aside>
    );
  }

  const wind = model.metrics[0];
  return (
    <aside className={`live-audience-panel is-${model.status}`} aria-label="直播观众态势">
      <section className="live-audience-hero">
        <StormSatellitePortrait storm={storm} satelliteLayer={satelliteLayer} />
        <div>
          <span>当前台风 · TY {model.code}</span>
          <h1>{model.nameZh}</h1>
          <p>{model.archetype}</p>
        </div>
      </section>

      <section className="live-level-callout">
        <div>
          <Zap aria-hidden="true" />
          <span>当前强度</span>
        </div>
        <strong>{model.windForceLevel}<small>级风</small></strong>
        <b>{model.stageLabel}</b>
        <p>中心最大风速 {wind.value} {wind.unit}</p>
      </section>

      <section className={`live-landfall-callout status-${model.landfall.status}`}>
        <MapPin aria-hidden="true" />
        <div>
          <span>{model.landfall.label}</span>
          <strong>{model.landfall.place}</strong>
          <time>{model.landfall.time}</time>
          <p>{model.landfall.detail}</p>
        </div>
      </section>

      <section className="live-energy-callout">
        <div className="live-energy-heading">
          <BatteryCharging aria-hidden="true" />
          <span>BOSS 能量</span>
          <strong>{model.energy}<small>%</small></strong>
        </div>
        <div className="live-energy-track" aria-label={`Boss 能量 ${model.energy}%`}>
          <i style={{ width: `${model.energy}%` }} />
          <b style={{ left: `${model.energy}%` }} />
        </div>
        <p>由风速、气压与风圈范围综合换算</p>
      </section>

      <section className="live-situation-metrics" aria-label="当前台风核心态势">
        {model.metrics.map((metric) => (
          <div className={`tone-${metric.tone}`} key={metric.label}>
            <span>{metric.label}</span><strong>{metric.value}</strong><small>{metric.unit}</small>
          </div>
        ))}
      </section>

      <LiveLandfallBroadcast scenarios={model.landfallScenarios} />

      <section className={`live-audience-structure evidence-${model.structure.evidenceLevel}`}>
        <div className="live-structure-orbit" aria-hidden="true"><i /><i /><i /></div>
        <div>
          <span>核心结构判读</span>
          <strong>{model.structure.title}</strong>
          <p>{model.structure.detail}</p>
          <small>{model.structure.evidenceLabel} · {model.structure.confidenceLabel} · {model.structure.observedAt}</small>
        </div>
      </section>

      <section className="live-proof-strip">
        <RefreshCw key={refreshSequence} aria-hidden="true" />
        <div><span>实时数据正在刷新</span><strong>第 {refreshSequence} 次同步 · {model.syncTime}</strong></div>
        <i />
      </section>
    </aside>
  );
}

export function LiveIntelPanel({
  model,
  storm,
  satelliteLayer
}: {
  model: LiveBroadcastModel;
  storm: Storm | null;
  satelliteLayer?: SatelliteLayerPayload | null;
}) {
  if (!storm) {
    return (
      <aside className={`live-intel-panel is-${model.status}`} aria-label="直播台风技术情报">
        <div className="live-standby-panel">
          {model.status === "degraded" ? <AlertTriangle aria-hidden="true" /> : <RadioTower aria-hidden="true" />}
          <span>{model.status === "degraded" ? "LIVE LINK DEGRADED" : "LIVE RADAR STANDBY"}</span>
          <h1>{model.nameZh}</h1>
          <p>{model.tickerDetail}</p>
          <div><Clock3 aria-hidden="true" /> 最近同步 {model.syncTime}</div>
        </div>
      </aside>
    );
  }

  return (
    <aside className={`live-professional-panel is-${model.status}`} aria-label="直播专业数据视图">
      <header className="live-professional-head">
        <div><span>PROFESSIONAL DATA MATRIX</span><strong>{model.nameZh} · 专业实况</strong></div>
        <p>实况 {model.stormTime} · 同步 {model.syncTime}</p>
      </header>

      <section className="live-sync-ledger" aria-label="实时数据账本">
        <div><span>历史路径点</span><strong>{model.trackPointCount}</strong><small>实时接口</small></div>
        <div><span>主预报点</span><strong>{model.forecastPointCount}</strong><small>未来路径</small></div>
        <div><span>预报机构</span><strong>{model.agencyCodes.length}</strong><small>{model.agencyCodes.join(" / ") || "待接入"}</small></div>
        <div><span>卫星时次</span><strong>{model.ahiUpdatedAt}</strong><small>Himawari-9 AHI</small></div>
      </section>

      <div className="live-professional-grid">
        <section className="live-pro-forecast">
          <div className="live-pro-section-head"><Route aria-hidden="true" /><span>主路径逐时次预报</span><b>{model.forecast.length} PTS</b></div>
          <div className="live-pro-forecast-table">
            <header><span>时次</span><span>风速</span><span>气压</span></header>
            {model.forecast.map((point) => (
              <div key={point.id}><strong>{point.time}</strong><span>{point.wind}</span><span>{point.pressure}</span></div>
            ))}
          </div>
          <div className="live-agency-chips">
            {model.agencyCodes.map((agency) => <span key={agency}>{agency}</span>)}
          </div>
        </section>

        <section className="live-pro-satellite">
          <div className="live-pro-section-head"><Satellite aria-hidden="true" /><span>卫星与多波段产品</span><b>{model.ahiUpdatedAt}</b></div>
          <div className="live-pro-satellite-body">
            <StormSatellitePortrait storm={storm} satelliteLayer={satelliteLayer} />
            <div className="live-pro-ahi-bands">
              {model.ahiBands.map((band) => (
                <div className={band.available ? "is-available" : "is-unavailable"} key={band.id}>
                  <b>{band.id}</b><span>{band.label}</span><strong>{band.available ? "AVAILABLE" : "WAIT"}</strong>
                </div>
              ))}
            </div>
          </div>
          <div className="live-product-matrix">
            {model.satelliteProducts.map((product) => (
              <span className={`status-${product.status}`} key={product.id}><b>{product.id.toUpperCase()}</b>{product.status === "available" ? "在线" : "待机"}</span>
            ))}
          </div>
        </section>

        <section className="live-pro-events">
          <div className="live-pro-section-head"><Activity aria-hidden="true" /><span>实时事件时间线</span><b>{model.events.length} EVENTS</b></div>
          <div className="live-event-timeline">
            {model.events.length ? model.events.map((event) => (
              <article key={event.id}>
                <time>{event.time}</time><strong>{event.title}</strong><b>{event.evidence}</b><p>{event.detail}</p>
              </article>
            )) : <p>暂无新的结构或路径事件。</p>}
          </div>
        </section>

        <section className="live-pro-sources">
          <div className="live-pro-section-head"><RefreshCw aria-hidden="true" /><span>证据链与更新状态</span><b>LIVE</b></div>
          <div className="live-source-ledger">
            {model.professionalSources.map((source, index) => (
              <div key={source}><b>0{index + 1}</b><span>{source}</span><strong>已接入</strong></div>
            ))}
          </div>
          <p>所有“登陆”信息均由主预报路径与省界相交推算，正式结论以气象部门发布为准。</p>
        </section>
      </div>
    </aside>
  );
}

export function LiveBottomBar({
  model,
  deck,
  secondsToSwitch
}: {
  model: LiveBroadcastModel;
  deck: LiveDeckView;
  secondsToSwitch: number;
}) {
  const [tickerIndex, setTickerIndex] = useState(0);
  const [showCityTicker, setShowCityTicker] = useState(false);
  const tickerItems = model.cityTickerItems;
  const tickerSignature = tickerItems.map((item) => item.id).join("|");

  useEffect(() => {
    if (tickerItems.length === 0) {
      setShowCityTicker(false);
      return;
    }
    let disposed = false;
    let showTimer: number | null = null;
    let hideTimer: number | null = null;
    const schedule = (delayMs: number) => {
      showTimer = window.setTimeout(() => {
        if (disposed) return;
        setShowCityTicker(true);
        hideTimer = window.setTimeout(() => {
          if (disposed) return;
          setShowCityTicker(false);
          setTickerIndex((current) => (current + 1) % tickerItems.length);
          schedule(22_000);
        }, 8_000);
      }, delayMs);
    };
    schedule(3_000);
    return () => {
      disposed = true;
      if (showTimer !== null) window.clearTimeout(showTimer);
      if (hideTimer !== null) window.clearTimeout(hideTimer);
    };
  }, [tickerItems.length, tickerSignature]);

  const cityTicker = tickerItems[tickerIndex % Math.max(1, tickerItems.length)] ?? null;
  return (
    <footer className={`live-bottom-bar live-fact-rail status-${model.status}`}>
      <div><Zap aria-hidden="true" /><span>当前强度</span><strong>{model.windForceLevel}级 · {model.stageLabel}</strong></div>
      <div><MapPin aria-hidden="true" /><span>{model.landfall.label}</span><strong>{model.landfall.time} · {model.landfall.place}</strong></div>
      {showCityTicker && cityTicker && <div className="live-arrival-ticker"><Route aria-hidden="true" /><span>城市台风动态</span><strong>{cityTicker.message}</strong></div>}
      <div><BatteryCharging aria-hidden="true" /><span>BOSS 能量</span><strong>{model.energy}%</strong></div>
      <div><TimerReset aria-hidden="true" /><span>当前：{deck === "briefing" ? "观众态势" : "专业分析"}</span><strong>{secondsToSwitch > 0 ? `${secondsToSwitch} 秒后自动换屏` : "独立场景 · 导播切换"}</strong></div>
    </footer>
  );
}

function buildLiveLandfallScenarios(bossProfile?: BossProfile | null, priority?: LiveLandingPriority | null): LiveLandfallScenario[] {
  if (bossProfile?.provinceBriefings?.length) {
    return bossProfile.provinceBriefings
      .filter((briefing) => briefing.impactStatus === "unaffected" || Boolean(briefing.estimatedAt))
      .map((briefing, index) => {
        const current = briefing.currentConditions;
        const isPriority = Boolean(priority && briefing.province === priority.province);
        return {
        id: `${briefing.province}-${index}`,
        // City precision is reserved for an official landfall record only.
        province: isPriority && priority?.isConfirmed
          ? `${provinceDisplayName(briefing.province)} · ${priority.place}`
          : provinceDisplayName(briefing.province),
        headlineLabel: briefing.headlineLabel,
        impactStatus: briefing.impactStatus,
        impactLabel: briefing.impactLabel,
        currentWindLabel: briefing.impactStatus === "landfall" || briefing.impactStatus === "direct"
          ? current.windDataStale ? "最近有效平均风力" : "当前平均风力"
          : current.windDataStale ? "最近有效当地风力" : "当地当前风力",
        timeLabel: briefing.impactStatus === "unaffected" ? "影响时次" : "预计时次",
        countdownLabel: briefing.impactStatus === "unaffected" ? "影响判断" : "还有",
        strengthLabel: briefing.impactStatus === "unaffected" ? "影响强度" : "台风届时强度",
        time: briefing.impactStatus === "unaffected"
          ? "暂无直接影响"
          : `${formatCompactTime(briefing.estimatedAt as string)} 前后`,
        countdown: briefing.impactStatus === "unaffected"
          ? "无需倒计时"
          : formatCountdown(briefing.estimatedAt as string),
        windLevel: briefing.impactStatus === "unaffected"
          ? "无直接影响"
          : briefing.stormWindForceLevel === "--" ? "风级待定" : `${briefing.stormWindForceLevel}级`,
        windSpeed: briefing.impactStatus === "unaffected"
          ? ""
          : briefing.stormWindSpeedMs === null ? "风速待定" : `${Math.round(briefing.stormWindSpeedMs)}m/s`,
        currentWindLevel: current.windForceLevel === "--" ? "待同步" : `${current.windForceLevel}级`,
        currentWindSpeed: current.averageWindSpeedMs === null ? "暂无省域采样" : `${current.averageWindSpeedMs.toFixed(1)}m/s`,
        currentWindDirection: current.windDirection ?? "风向待同步",
        windObservedAt: current.windObservedAt ? formatClockTime(current.windObservedAt) : "时次待同步",
        windSamples: current.windSampleCount ? `${current.windSampleCount}点` : "等待采样",
        windDataStale: current.windDataStale,
        closestApproach: briefing.closestApproachKm === null
          ? "待计算"
          : briefing.closestApproachKm === 0 ? "登陆交会" : `${briefing.closestApproachKm} km`,
        support: briefing.agencySupport > 0
          ? `${briefing.agencySupport}/${briefing.agencyTotal}家指向`
          : "暂无线形指向",
        durationMs: isPriority ? 5000 : briefing.displayDurationMs,
        isPriority,
        priorityReason: isPriority
          ? `${priority?.isConfirmed ? "官方确认" : "推断"}${priority?.phase === "upcoming" ? " · 即将登陆" : " · 登陆后重点播报"}`
          : null
        };
      });
  }
  return [];
}

function buildPriorityPlayback(scenarios: LiveLandfallScenario[]) {
  const priority = scenarios.filter((scenario) => scenario.isPriority);
  const ordinary = scenarios.filter((scenario) => !scenario.isPriority);
  if (priority.length === 0) return scenarios;
  const playback: LiveLandfallScenario[] = [];
  ordinary.forEach((scenario, index) => {
    playback.push(scenario);
    // A landing event is inserted after every two ordinary provinces: it gets
    // both more turns and a longer on-air slot without starving national coverage.
    if (index % 2 === 1) playback.push(...priority);
  });
  return [...priority, ...playback, ...priority];
}

function provincePageAtTimestamp(scenarios: LiveLandfallScenario[], timestamp: number) {
  if (scenarios.length === 0) return 0;
  const cycleDuration = scenarios.reduce((total, scenario) => total + scenario.durationMs, 0);
  if (cycleDuration <= 0) return 0;
  let offset = timestamp % cycleDuration;
  for (let index = 0; index < scenarios.length; index += 1) {
    offset -= scenarios[index].durationMs;
    if (offset < 0) return index;
  }
  return 0;
}

function buildLandingPriority(storm: Storm | null, bossProfile?: BossProfile | null): LiveLandingPriority | null {
  if (!storm) return null;
  const now = Date.now();
  const windowMs = 30 * 60 * 1000;
  const official = storm.landfalls
    .map((landfall) => ({ landfall, offset: parseStormTime(landfall.time) - now }))
    .filter((item) => Number.isFinite(item.offset) && item.offset >= -windowMs && item.offset <= windowMs)
    .sort((left, right) => Math.abs(left.offset) - Math.abs(right.offset))[0];
  if (official) {
    return {
      province: provinceFromPlace(official.landfall.place),
      place: cityFromPlace(official.landfall.place) ?? official.landfall.place,
      time: official.landfall.time,
      isConfirmed: true,
      phase: official.offset >= 0 ? "upcoming" : "just-landed"
    };
  }
  const inferred = (bossProfile?.landfallScenarios ?? [])
    .map((scenario) => ({ scenario, offset: parseStormTime(scenario.estimatedAt) - now }))
    .filter((item) => item.scenario.estimatedAt && Number.isFinite(item.offset) && item.offset >= -windowMs && item.offset <= windowMs)
    .sort((left, right) => Math.abs(left.offset) - Math.abs(right.offset))[0];
  if (!inferred?.scenario.estimatedAt) return null;
  return {
    province: inferred.scenario.province,
    place: `${provinceDisplayName(inferred.scenario.province)}沿海`,
    time: inferred.scenario.estimatedAt,
    isConfirmed: false,
    phase: inferred.offset >= 0 ? "upcoming" : "just-landed"
  };
}

function buildCityTickerItems(storm: Storm | null): LiveCityTickerItem[] {
  if (!storm) return [];
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  return storm.track
    .map((point) => {
      const city = point.locationDescription ? cityFromPlace(point.locationDescription) : null;
      const timestamp = parseStormTime(point.time);
      if (!city || !Number.isFinite(timestamp) || Math.abs(timestamp - now) > oneHour) return null;
      const minutes = Math.max(0, Math.ceil((timestamp - now) / 60_000));
      const level = windForceFromSpeed(point.wind);
      return {
        id: `${point.time}-${city}`,
        message: timestamp >= now
          ? `预计 ${minutes} 分钟后抵达${city}，等级为 ${level} 级`
          : `已抵达${city}，等级为 ${level} 级`
      };
    })
    .filter((item): item is LiveCityTickerItem => item !== null)
    .filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index);
}

function parseStormTime(value: string | null | undefined) {
  if (!value) return Number.NaN;
  return new Date(value.replace(" ", "T")).getTime();
}

function provinceFromPlace(place: string) {
  const match = place.match(/(北京|天津|上海|重庆|河北|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|台湾|山西|广西|内蒙古|西藏|宁夏|新疆|香港|澳门)/);
  return match?.[1] ?? null;
}

function cityFromPlace(place: string) {
  // Only use a city explicitly present in the provider's place string. This
  // deliberately does not reverse-geocode coordinates or invent a coastal city.
  const afterProvince = place.replace(/^.*?(?:省|自治区|特别行政区)/, "");
  return afterProvince.match(/([\u4e00-\u9fa5]{2}市)/)?.[1] ?? null;
}

function formatCountdown(value: string) {
  const target = new Date(value).getTime();
  if (!Number.isFinite(target)) return "时次待定";
  const minutes = Math.round((target - Date.now()) / 60_000);
  if (minutes <= 0) return "已到预计时段";
  if (minutes < 60) return `约 ${minutes} 分钟`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `约 ${hours} 小时`;
  return `约 ${Math.round(hours / 24)} 天`;
}

function formatClockTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时次待同步";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function provinceDisplayName(name: string) {
  if (/省|市|自治区|特别行政区|地区$/.test(name)) return name;
  if (["北京", "天津", "上海", "重庆"].includes(name)) return `${name}市`;
  const autonomousRegions: Record<string, string> = {
    广西: "广西壮族自治区",
    内蒙古: "内蒙古自治区",
    西藏: "西藏自治区",
    宁夏: "宁夏回族自治区",
    新疆: "新疆维吾尔自治区"
  };
  if (autonomousRegions[name]) return autonomousRegions[name];
  if (name === "香港" || name === "澳门") return `${name}特别行政区`;
  if (name === "台湾") return "台湾地区";
  return `${name}省`;
}

function buildLandfallBrief(bossProfile?: BossProfile | null): LiveLandfallBrief {
  const landfall = bossProfile?.landfall;
  if (!landfall) {
    return { label: "登陆判断", place: "资料同步中", time: "等待主路径", detail: "尚未生成路径与省界交会判断。", status: "unavailable" };
  }
  if (landfall.status === "forecast-landfall" && landfall.targetProvince && landfall.estimatedAt) {
    return {
      label: "预计登陆",
      place: `${landfall.targetProvince}沿海`,
      time: `${formatCompactTime(landfall.estimatedAt)} 前后`,
      detail: "主预报路径与沿海省界的首个交会点，属于路径推算。",
      status: landfall.status
    };
  }
  if (landfall.status === "approaching" && landfall.targetProvince) {
    return {
      label: "预计靠近",
      place: `${landfall.targetProvince}沿海`,
      time: "登陆时次待明确",
      detail: landfall.nearestDistanceKm === null ? landfall.detail : `路径走廊最近约 ${Math.round(landfall.nearestDistanceKm)} km，尚无明确登陆点。`,
      status: landfall.status
    };
  }
  if (landfall.status === "overland" && landfall.targetProvince) {
    return { label: "中心已进入", place: landfall.targetProvince, time: "当前实况时次", detail: landfall.detail, status: landfall.status };
  }
  return { label: "登陆判断", place: "暂无明确登陆信号", time: "持续监测", detail: landfall.detail, status: landfall.status };
}

function windForceFromSpeed(speed: number) {
  if (!Number.isFinite(speed) || speed < 0) return "--";
  return sharedWindForceFromSpeed(speed);
}

function calculateFallbackEnergy(storm: Storm) {
  const windScore = clamp(((storm.maxWind || 0) / 70) * 48, 0, 48);
  const pressureScore = storm.minPressure ? clamp(((1010 - storm.minPressure) / 120) * 30, 0, 30) : 0;
  const radiusScore = clamp(((storm.windRadiiKm.r7 || 0) / 650) * 22, 0, 22);
  return Math.round(clamp(windScore + pressureScore + radiusScore, 0, 100));
}

function buildMetrics(storm: Storm): LiveMetric[] {
  const radius = selectStrongestRadius(storm);
  const metrics: LiveMetric[] = [
    { label: "中心最大风速", value: storm.maxWind > 0 ? String(Math.round(storm.maxWind)) : "--", unit: "m/s", tone: "hot" },
    { label: "中心气压", value: storm.minPressure > 0 ? String(Math.round(storm.minPressure)) : "--", unit: "hPa", tone: "cool" },
    { label: "移动", value: storm.moveDirection || "待报", unit: storm.moveSpeed > 0 ? `${Math.round(storm.moveSpeed)} km/h` : "速度待报", tone: "neutral" },
  ];
  if (radius) metrics.push({ label: radius.label, value: String(Math.round(radius.value)), unit: "km", tone: "neutral" });
  return metrics;
}

function emptyMetrics(): LiveMetric[] {
  return ["中心最大风速", "中心气压", "移动", "风圈半径"].map((label) => ({
    label,
    value: "--",
    unit: "待发布",
    tone: "neutral" as const
  }));
}

function selectStrongestRadius(storm: Storm) {
  if (storm.windRadiiKm.r12 > 0) return { label: "12级风圈", value: storm.windRadiiKm.r12 };
  if (storm.windRadiiKm.r10 > 0) return { label: "10级风圈", value: storm.windRadiiKm.r10 };
  if (storm.windRadiiKm.r7 > 0) return { label: "7级风圈", value: storm.windRadiiKm.r7 };
  return null;
}

function buildStructureBrief(bossProfile?: BossProfile | null): LiveStructureBrief {
  const structure = bossProfile?.structure;
  if (structure && structure.state !== "unknown") {
    return {
      mode: "structure",
      eyebrow: "核心结构判读",
      title: structure.stateLabel,
      detail: [structure.cycleLabel, structure.detail].filter(Boolean).join(" · "),
      evidenceLabel: evidenceLabel(structure.evidenceLevel),
      evidenceLevel: structure.evidenceLevel,
      confidenceLabel: `置信 ${Math.round(structure.confidence * 100)}%`,
      sourceLabel: structure.sourceLabel,
      observedAt: formatCompactTime(structure.observedAt)
    };
  }

  if (bossProfile && (bossProfile.ahi.status !== "unavailable" || bossProfile.satellite.status !== "unavailable")) {
    const availableBands = bossProfile.ahi.availableBands.join(" / ");
    return {
      mode: "satellite",
      eyebrow: "卫星结构提示",
      title: "多波段持续监测",
      detail: availableBands
        ? `${availableBands} 波段可用；当前没有权威结构源确认眼壁状态。`
        : "卫星产品可用，但当前没有权威结构源确认眼壁状态。",
      evidenceLabel: "卫星提示",
      evidenceLevel: "visualHint",
      confidenceLabel: "不作结构确认",
      sourceLabel: bossProfile.ahi.attribution,
      observedAt: formatCompactTime(bossProfile.ahi.updatedAt || bossProfile.satellite.updatedAt)
    };
  }

  return {
    mode: "unavailable",
    eyebrow: "核心结构判读",
    title: "结构资料待更新",
    detail: "当前没有可用于确认眼壁状态的权威结构资料。",
    evidenceLabel: "资料不足",
    evidenceLevel: "unavailable",
    confidenceLabel: "不作推断",
    sourceLabel: "--",
    observedAt: "等待资料"
  };
}

function buildAhiBands(bossProfile?: BossProfile | null): LiveAhiBand[] {
  const labels: Record<LiveAhiBand["id"], string> = { B03: "可见光", B08: "水汽", B13: "红外" };
  return (["B03", "B08", "B13"] as const).map((id) => ({
    id,
    label: labels[id],
    available: Boolean(bossProfile?.ahi.availableBands.includes(id))
  }));
}

function evidenceLabel(level: BossEvidenceLevel) {
  if (level === "confirmed") return "实况确认";
  if (level === "inferred") return "模型推断";
  return "卫星提示";
}

function formatCompactTime(value: string) {
  const date = new Date(value.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return value || "等待资料";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function formatSyncTime(value: number) {
  return new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
