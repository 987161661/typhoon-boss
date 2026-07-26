"use client";

import {
  Activity,
  CircleAlert,
  LockKeyhole,
  RadioTower,
  ScanLine,
  ShieldAlert,
  TimerReset,
  UnlockKeyhole,
  X
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from "react";
import type { CityBriefing } from "@/lib/cityBriefingData";
import {
  buildLiveCityBroadcastModel,
  type LiveCityBroadcastMetric
} from "@/lib/liveCityBroadcastModel";
import {
  LIVE_CITY_BROADCAST_RENDER_MILESTONES,
  LIVE_CITY_BROADCAST_TIMELINE,
  resolveLiveCityBroadcastAct,
  resolveLiveScoreAt,
  resolveLiveSummarySpeed
} from "@/lib/liveCityBroadcastPerformance";
import {
  playLiveCityBroadcastCue,
  type LiveCityBroadcastEffects
} from "@/lib/liveCityBroadcastAudio";
import {
  resolveLiveCityBroadcastLayout,
  type LiveCityBroadcastLayout
} from "@/lib/liveCityBroadcastLayout";
import type {
  BattleArchive,
  CityPanelsModel,
  PanelEvidence,
  PanelWarning
} from "@/lib/cityPanelsPresentation";
import type { CityBattleRankIntel } from "@/lib/cityBattleShowModel";
import { resolveAspectLockedFrameBox } from "@/lib/broadcastFrameGeometry";
import type { LayoutPoint, LayoutRect } from "@/lib/cityPanelLayout";
import { BroadcastFrameSkin } from "./BroadcastFrameSkin";
import { CityTypewriterText } from "./CityTypewriterText";
import styles from "./CityLiveBroadcastGroup.module.css";

const BATTLE_FRAME = "/live/city-broadcast/battle-frame.png";
const OFFICIAL_FRAME = "/live/city-broadcast/official-lab-frame.png";
const BATTLE_FRAME_SOURCE = {
  sourceWidth: 1_672,
  sourceHeight: 941
};
const BATTLE_FRAME_OPTICAL_RIGHT = 1_580 / BATTLE_FRAME_SOURCE.sourceWidth;
const OFFICIAL_FRAME_OPTICAL_LEFT = 49 / 1_672;

export function CityLiveBroadcastGroup({
  phase,
  anchor,
  briefing,
  model,
  effects,
  onClose
}: {
  phase: "deploy" | "card";
  anchor: LayoutPoint | null;
  briefing: CityBriefing;
  model: CityPanelsModel;
  effects: LiveCityBroadcastEffects;
  onClose: () => void;
}) {
  const presentation = useMemo(
    () => buildLiveCityBroadcastModel({ briefing, model }),
    [briefing, model]
  );
  const infoCityLabel = briefing.city.administrativePath?.county ?? briefing.city.name;
  const layout = useLiveBroadcastLayout();
  const battleFrameBox = resolveAspectLockedFrameBox({
    ...BATTLE_FRAME_SOURCE,
    renderedWidth: layout.battleRect.width
  });
  const reducedMotion = useReducedMotion();
  const { act, elapsedMs } = useLiveBroadcastTimeline(effects, reducedMotion);
  const [summaryComplete, setSummaryComplete] = useState(reducedMotion);
  const previousArchiveStatus = useRef<BattleArchive["status"] | null>(null);
  const longWarning = Array.from(presentation.info.warning.title).length > 38;
  const summarySpeed = useMemo(
    () => resolveLiveSummarySpeed(presentation.battle.summary),
    [presentation.battle.summary]
  );
  useEffect(() => setSummaryComplete(reducedMotion), [presentation.battle.summary, reducedMotion]);

  useEffect(() => {
    const previous = previousArchiveStatus.current;
    previousArchiveStatus.current = presentation.battle.archive.status;
    if (
      previous &&
      previous !== "unlocked" &&
      presentation.battle.archive.status === "unlocked" &&
      !reducedMotion
    ) {
      playLiveCityBroadcastCue("archive", effects);
    }
  }, [effects, presentation.battle.archive.status, reducedMotion]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const typeTick = useCallback((character: string) => {
    if (!character.trim() || reducedMotion) return;
    playLiveCityBroadcastCue("type", effects);
  }, [effects, reducedMotion]);

  const groupStyle = ({
    "--broadcast-core-x": `${anchor?.x ?? layout.target.x}px`,
    "--broadcast-core-y": `${anchor?.y ?? layout.target.y}px`,
    "--broadcast-battle-end": `${layout.battleRect.x + layout.battleRect.width * BATTLE_FRAME_OPTICAL_RIGHT}px`,
    "--broadcast-info-start": `${layout.infoRect.x + layout.infoRect.width * OFFICIAL_FRAME_OPTICAL_LEFT}px`,
    "--broadcast-core-clearance": `${Math.min(58, Math.max(28, layout.corridorRect.width / 2 - 4))}px`
  } as CSSProperties);

  return (
    <section
      className={styles.group}
      style={groupStyle}
      data-component="live-city-broadcast"
      data-role="city-panel-group"
      data-phase={phase}
      data-act={act}
      data-reduced-motion={reducedMotion ? "true" : "false"}
      data-warning-feed={presentation.info.warning.status}
      aria-label={`${presentation.cityLabel}直播战况`}
    >
      <div className={styles.battleShade} aria-hidden="true" />
      <div className={styles.infoShade} aria-hidden="true" />
      <div className={styles.corridorLink} aria-hidden="true">
        <i className={styles.battleLink} />
        <i className={styles.infoLink} />
      </div>

      <article
        className={`${styles.panel} ${styles.battlePanel}`}
        style={{
          ...rectStyle(layout.battleRect),
          "--battle-frame-source-height": `${battleFrameBox.height}px`
        } as CSSProperties}
        data-role="live-battle-panel"
      >
        <div className={styles.panelSurface} aria-hidden="true" />
        <BroadcastFrameSkin
          image={BATTLE_FRAME}
          tone="battle"
          className={styles.frameSkin}
          aspectLock={{ ...BATTLE_FRAME_SOURCE, renderedWidth: layout.battleRect.width }}
        />
        <BroadcastFrameSkin
          image={BATTLE_FRAME}
          tone="battle"
          className={`${styles.frameSkin} ${styles.battleFrameOverlay}`}
          aspectLock={{ ...BATTLE_FRAME_SOURCE, renderedWidth: layout.battleRect.width }}
        />
        <button type="button" className={styles.battleClose} onClick={onClose} aria-label="关闭城市战况"><X /></button>
        <div className={styles.panelContent}>
          <header className={styles.panelHeader}>
            <div>
              <span className={styles.eyebrow}>城市战况 // 战区接入</span>
              <h2>{presentation.cityLabel}</h2>
            </div>
          </header>

          <section className={styles.verdict} aria-label="战况结论">
            <BroadcastScore target={presentation.battle.score} reducedMotion={reducedMotion} />
            <div className={styles.verdictCopy}>
              <span>本轮结论</span>
              <h3>{presentation.battle.title}</h3>
              <CityTypewriterText
                text={presentation.battle.summary}
                active={reducedMotion || elapsedMs >= LIVE_CITY_BROADCAST_TIMELINE.summaryStartMs}
                speed={summarySpeed}
                reducedMotion={reducedMotion}
                role="live-battle-summary"
                className={styles.typewriter}
                startDelayMs={0}
                onCharacter={typeTick}
                onComplete={() => setSummaryComplete(true)}
              />
            </div>
          </section>

          <BroadcastMetricHero metric={presentation.battle.spotlight} />

          <section className={styles.intelBand} aria-label="近期变化与全国城市排名">
            {presentation.battle.nearTerm ? (
              <CompactMetric metric={presentation.battle.nearTerm} label="近期变化" />
            ) : (
              <section className={styles.compactMetric} data-evidence="unavailable">
                <span>近期变化 · 不可用</span><strong>资料缺口</strong><b>待更新</b>
              </section>
            )}
            <RankDeck ranks={presentation.battle.ranks} />
          </section>

          <section className={styles.actions} aria-label="行动提示">
            <span><Activity /> 行动</span>
            <div>{presentation.battle.actions.map((action) => <p key={action}>› {action}</p>)}</div>
          </section>

          <ArchiveSlot
            archive={presentation.battle.archive}
            reducedMotion={reducedMotion}
            active={summaryComplete}
            onCharacter={typeTick}
          />
        </div>
      </article>

      <aside
        className={`${styles.panel} ${styles.infoPanel}`}
        style={rectStyle(layout.infoRect)}
        data-role="live-info-panel"
        data-status={presentation.info.dataStatus}
        data-long-warning={longWarning ? "true" : "false"}
      >
        <div className={styles.panelSurface} aria-hidden="true" />
        <BroadcastFrameSkin image={OFFICIAL_FRAME} tone="official" className={styles.frameSkin} />
        <div className={styles.calibrationSweep} aria-hidden="true" />
        <div className={styles.panelContent}>
          <header className={styles.infoHeader}>
            <div><span className={styles.eyebrow}>官方信息塔</span><h2>{infoCityLabel}</h2></div>
            <strong>{dataStatusLabel(presentation.info.dataStatus)}</strong>
          </header>

          <WarningBlock warning={presentation.info.warning} />

          <section className={styles.factStack} aria-label="关键气象事实">
            {presentation.info.metrics.map((metric) => <FactMetric key={metric.id} metric={metric} />)}
          </section>

          {presentation.info.trend && !longWarning && (
            <section className={styles.trendCard} aria-label="近期趋势">
              <span><TimerReset /> 近期趋势 · {evidenceLabel(presentation.info.trend.evidence)}</span>
              <strong>{presentation.info.trend.label}</strong>
              <b>{presentation.info.trend.displayValue}</b>
            </section>
          )}

          <footer className={styles.infoFooter}>
            <RadioTower />
            <span>{evidenceSummary(presentation.info.metrics)}</span>
            <time dateTime={presentation.info.observedAt}>更新 {formatTime(presentation.info.observedAt)}</time>
          </footer>
        </div>
      </aside>
    </section>
  );
}

function BroadcastMetricHero({ metric }: { metric: LiveCityBroadcastMetric }) {
  return <section className={styles.metricHero} data-evidence={metric.evidence} data-role="live-spotlight">
    <span>{metric.label}</span>
    <div><b>{metric.displayValue}</b></div>
  </section>;
}

function CompactMetric({ metric, label }: { metric: LiveCityBroadcastMetric; label: string }) {
  return <section className={styles.compactMetric} data-evidence={metric.evidence} aria-label={`${label} ${metric.label}`}>
    <span>{metric.label}</span>
    <b>{metric.displayValue}</b>
  </section>;
}

function RankDeck({ ranks }: { ranks: CityBattleRankIntel[] }) {
  return <div className={styles.rankDeck} data-count={ranks.length} data-role="live-city-ranks">
    {ranks.length === 0 ? (
      <section className={styles.rankEmpty} data-role="live-rank-unavailable">
        <span>全国比较</span><strong>资料未完成</strong>
      </section>
    ) : ranks.map((rank, index) => (
      <section
        className={styles.rankCard}
        data-tier={rank.tier}
        data-rank-order={index + 1}
        key={rank.id}
      >
        <span>{rank.label}</span>
        <div
          className={styles.rankReading}
          aria-label={`${rank.label} ${rank.value}，全国排名第 ${rank.position}`}
        >
          <strong className={styles.rankValue}>{rank.value}</strong>
          <span className={styles.rankLead}>全国排名第</span>
          <b className={styles.rankPosition}>{rank.position}</b>
        </div>
      </section>
    ))}
  </div>;
}

function ArchiveSlot({
  archive,
  active,
  reducedMotion,
  onCharacter
}: {
  archive: BattleArchive;
  active: boolean;
  reducedMotion: boolean;
  onCharacter: (character: string) => void;
}) {
  const Icon = archive.status === "unlocked"
    ? UnlockKeyhole
    : archive.status === "unlocking"
      ? ScanLine
      : LockKeyhole;
  const displayCode = compactArchiveCode(archive.code);
  return <section className={styles.archive} data-role="live-battle-archive" data-status={archive.status}>
    <header aria-label={`档案 ${archive.code}`}><Icon /><span>档案 {displayCode}</span><b>{archive.clearance}</b></header>
    {archive.status === "locked" && <div className={styles.archiveLocked}>
      <p>{archive.statusText}</p>
      <small>{archive.teaserTokens.join(" // ")}</small>
      <strong data-role="live-archive-follow-cta">关注主播，解锁档案。</strong>
    </div>}
    {archive.status === "unlocking" && <p className={styles.archiveStatus}>关注凭证已接入，黑色封锁装置正在断开。</p>}
    {archive.status === "unavailable" && <p className={styles.archiveStatus}>{archive.statusText}</p>}
    {archive.status === "unlocked" && archive.fragment && <CityTypewriterText
      text={archive.fragment}
      active={active}
      speed={58}
      reducedMotion={reducedMotion}
      role="live-archive-fragment"
      className={styles.archiveFragment}
      startDelayMs={LIVE_CITY_BROADCAST_TIMELINE.archiveDelayMs}
      onCharacter={onCharacter}
    />}
  </section>;
}

function BroadcastScore({ target, reducedMotion }: {
  target: number | null;
  reducedMotion: boolean;
}) {
  const scoreEndMs = LIVE_CITY_BROADCAST_TIMELINE.summaryStartMs + 600;
  const [elapsedMs, setElapsedMs] = useState(reducedMotion ? scoreEndMs : 0);

  useEffect(() => {
    if (target === null || reducedMotion) {
      setElapsedMs(scoreEndMs);
      return;
    }
    const startedAt = performance.now();
    let frame = 0;
    let lastPaint = -50;
    const tick = (now: number) => {
      const next = Math.min(scoreEndMs, now - startedAt);
      if (next - lastPaint >= 32 || next >= scoreEndMs) {
        lastPaint = next;
        setElapsedMs(next);
      }
      if (next < scoreEndMs) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [reducedMotion, scoreEndMs, target]);

  const score = target === null
    ? null
    : reducedMotion
      ? Math.round(target)
      : resolveLiveScoreAt(elapsedMs, target);
  return (
    <div
      className={styles.score}
      style={{ "--broadcast-score": `${score ?? 0}%` } as CSSProperties}
      data-score-state={score === null ? "unknown" : "available"}
      aria-label={score === null ? "战况指数待判，当前资料不足" : `战况指数 ${score}`}
    >
      <span>{score === null ? "指数待判" : "指数"}</span>
      <strong>{score === null ? "—" : score}</strong>
    </div>
  );
}

function compactArchiveCode(code: string) {
  const segments = code.split("-").filter(Boolean);
  return segments.length > 2 ? segments.slice(-2).join("-") : code;
}

function WarningBlock({ warning }: { warning: PanelWarning }) {
  const active = warning.status === "active";
  const Icon = active ? ShieldAlert : CircleAlert;
  return <section className={styles.warning} data-status={warning.status} role={active ? "alert" : "status"}>
    <div><Icon /><span>{active ? `${warning.level ?? "属地"}官方预警` : "官方预警链路"}</span></div>
    <h3>{warning.title}</h3>
    {(warning.issuer || warning.issuedAt) && <p>{[warning.issuer, warning.issuedAt ? formatTime(warning.issuedAt) : null].filter(Boolean).join(" · ")}</p>}
    {!active && warning.description && <p>{warning.description}</p>}
  </section>;
}

function FactMetric({ metric }: { metric: LiveCityBroadcastMetric }) {
  return <article className={styles.factMetric} data-evidence={metric.evidence}>
    <div><span>{metric.label}</span><em>{evidenceLabel(metric.evidence)}</em></div>
    <strong>{metric.displayValue}</strong>
  </article>;
}

function useLiveBroadcastTimeline(effects: LiveCityBroadcastEffects, reducedMotion: boolean) {
  const [elapsedMs, setElapsedMs] = useState(
    reducedMotion ? LIVE_CITY_BROADCAST_TIMELINE.settledMs : 0
  );
  const elapsedRef = useRef(elapsedMs);
  elapsedRef.current = elapsedMs;

  useEffect(() => {
    if (reducedMotion) {
      setElapsedMs(LIVE_CITY_BROADCAST_TIMELINE.settledMs);
      return;
    }
    setElapsedMs(0);
    elapsedRef.current = 0;
    const timers = LIVE_CITY_BROADCAST_RENDER_MILESTONES.map((at) => window.setTimeout(() => {
      elapsedRef.current = at;
      setElapsedMs(at);
    }, at));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [reducedMotion]);

  useEffect(() => {
    if (reducedMotion || !effects.enabled) return;
    const now = elapsedRef.current;
    const schedule = [
      [LIVE_CITY_BROADCAST_TIMELINE.battleImpactMs, "battle"],
      [LIVE_CITY_BROADCAST_TIMELINE.infoCueMs, "info"],
      [LIVE_CITY_BROADCAST_TIMELINE.rankStampMs, "stamp"]
    ] as const;
    const timers = schedule
      .filter(([at]) => at > now + 16)
      .map(([at, cue]) => window.setTimeout(
        () => playLiveCityBroadcastCue(cue, effects),
        at - now
      ));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [effects, reducedMotion]);

  return {
    elapsedMs,
    act: resolveLiveCityBroadcastAct(elapsedMs, reducedMotion)
  };
}

function useLiveBroadcastLayout() {
  const [layout, setLayout] = useState<LiveCityBroadcastLayout>(
    () => resolveLiveCityBroadcastLayout({ width: 1280, height: 720 })
  );
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      setLayout(resolveLiveCityBroadcastLayout({ width: window.innerWidth, height: window.innerHeight }));
    };
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("resize", schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);
  return layout;
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

function evidenceLabel(evidence: PanelEvidence) {
  return ({ official: "官方", observed: "观测", model: "模式", unavailable: "不可用" })[evidence];
}

function evidenceSummary(metrics: LiveCityBroadcastMetric[]) {
  return [...new Set(metrics.map((metric) => evidenceLabel(metric.evidence)))].join(" / ") || "资料不可用";
}

function dataStatusLabel(status: CityPanelsModel["shared"]["dataStatus"]) {
  return status === "available" ? "资料在线" : status === "degraded" ? "部分资料" : "资料受限";
}

function formatTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function rectStyle(rect: LayoutRect): CSSProperties {
  return { left: rect.x, top: rect.y, width: rect.width, height: rect.height };
}
