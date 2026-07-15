"use client";

import { MapPinned, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import type { NationalSituationSnapshot, SourceFreshness, WeatherEventLevel, WeatherHazard } from "@/lib/nationalWeatherTypes";
import { buildNationalSituationHudModel, type HudMainEvent } from "@/components/nationalSituationHudModel";
import { useWarningCarousel } from "@/components/useWarningCarousel";
import styles from "./NationalSituationHud.module.css";

export interface NationalSituationHudProps {
  snapshot: NationalSituationSnapshot;
  className?: string;
  variant?: "full" | "compact";
  onSelectEvent?: (eventId: string) => void;
  onOpenCitySituation?: () => void;
}

export function NationalSituationHud({
  snapshot,
  className = "",
  variant = "full",
  onSelectEvent,
  onOpenCitySituation
}: NationalSituationHudProps) {
  const model = buildNationalSituationHudModel(snapshot);
  const carousel = useWarningCarousel(model.warningQueue);
  const active = carousel.current ?? model.warningQueue[0] ?? model.mainEvent;
  const primarySource = model.sources[0] ?? null;
  const cardProps = {
    event: active,
    total: model.warningQueue.length,
    index: carousel.currentIndex,
    paused: carousel.paused,
    onPrevious: () => carousel.move(-1),
    onNext: () => carousel.move(1),
    onTogglePaused: carousel.togglePaused,
    onInteractionPause: carousel.setInteractionPaused,
    onSelectEvent
  };

  if (variant === "compact") {
    return (
      <section
        className={`${styles.hud} ${styles.compact} ${active ? styles[`level_${active.level}`] : styles.level_none} ${className}`.trim()}
        aria-label="全国气象态势摘要"
        data-highest-event-level={active?.level ?? "none"}
      >
        <div className={styles.compactBrand}>
          <strong>气象 Boss 雷达</strong>
          <time dateTime={snapshot.generatedAt}>{model.generatedLabel}</time>
        </div>
        <WarningSignalCard {...cardProps} variant="compact" />
        <div className={styles.compactFooter}>
          <span>{model.warning.countsLabel}</span>
          <small>{primarySource ? `${primarySource.label} · ${primarySource.statusLabel}` : "来源待同步"}</small>
        </div>
      </section>
    );
  }

  return (
    <section
      className={`${styles.hud} ${className}`.trim()}
      aria-labelledby="national-situation-hud-title"
      data-highest-event-level={active?.level ?? "none"}
      data-signal-desk="national"
    >
      <div className={styles.brandRail}>
        <div className={styles.deskIdentity}>
          <span className={styles.deskGridMark} aria-hidden="true" />
          <div>
          <span className={styles.eyebrow}>全国气象值守</span>
          <h2 id="national-situation-hud-title">气象 Boss 雷达</h2>
          </div>
        </div>
        <div className={styles.deskReadout}>
          <span className={styles.readoutLabel}>官方快照</span>
          <span>权威快照</span>
          <time dateTime={snapshot.generatedAt}>{model.generatedLabel}</time>
        </div>
      </div>

      <WarningSignalCard {...cardProps} variant="full" />

      {model.warningQueue.length > 1 ? (
        <section className={styles.queueChannel} aria-label="即将播报的官方预警">
          <div className={styles.channelHeading}>
            <span>即将播报</span>
            <span>后续 {Math.min(3, model.warningQueue.length - 1)} 条</span>
          </div>
        <ol className={styles.upNext} aria-label="后续官方预警">
          {nextWarnings(model.warningQueue, carousel.currentIndex, 3).map((event) => (
            <li key={event.id} data-hazard={event.hazard}>
              <span className={styles[`levelFlag_${event.level}`]}>{event.levelLabel}</span>
              <strong>{event.title}</strong>
              <span className={styles.queueVector} aria-hidden="true" />
            </li>
          ))}
        </ol>
        </section>
      ) : null}

      <div className={styles.summaryGrid} data-panel-group="operational">
        <section className={`${styles.warningSummary} ${levelClass(model.warning.highestLevel)}`} aria-label="最高官方预警摘要">
          <span>最高官方预警</span>
          <strong>{model.warning.highestLevelLabel}</strong>
          <p>{model.warning.countsLabel}</p>
          <time>{model.warning.updatedLabel}</time>
        </section>

        {onOpenCitySituation ? (
          <button type="button" className={`${styles.cityEntry} ${styles[`city_${model.city.state}`]}`} onClick={onOpenCitySituation}>
            <span>异常城市入口</span>
            <strong>{model.city.label}</strong>
            <small>{model.city.detail}</small>
            <small>{model.city.coverageLabel}</small>
          </button>
        ) : (
          <section className={`${styles.cityEntry} ${styles[`city_${model.city.state}`]}`} aria-label="城市战况摘要">
            <span>异常城市入口</span>
            <strong>{model.city.label}</strong>
            <small>{model.city.detail}</small>
            <small>{model.city.coverageLabel}</small>
          </section>
        )}
      </div>

      <section className={styles.sourceLedger} aria-labelledby="source-health-title">
        <div className={styles.ledgerHeading}>
          <h3 id="source-health-title">来源时效</h3>
          <span>{model.sources.length} 路证据</span>
        </div>
        <ul>
          {model.sources.map((source) => (
            <li key={source.sourceId} className={`${styles.sourceRow} ${styles[`source_${source.status}`]}`} data-primary-evidence={source.isPrimaryEvidence || undefined}>
              <span className={`${styles.healthGlyph} ${healthGlyphClass(source.status)}`} aria-hidden="true" />
              <span className={styles.sourceName}>{source.label}</span>
              <span className={styles.sourceStatus}>{source.statusLabel}</span>
              <time>{source.updatedLabel}</time>
              <small>{source.statusDetail}</small>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}

function WarningSignalCard({
  event,
  total,
  index,
  paused,
  onPrevious,
  onNext,
  onTogglePaused,
  onInteractionPause,
  onSelectEvent,
  variant
}: {
  event: HudMainEvent | null;
  total: number;
  index: number;
  paused: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onTogglePaused: () => void;
  onInteractionPause: (paused: boolean) => void;
  onSelectEvent?: (eventId: string) => void;
  variant: "full" | "compact";
}) {
  if (!event) {
    return (
      <article className={`${styles.signalCard} ${styles.emptySignal} ${styles[`signal_${variant}`]}`}>
        <span className={styles.levelFlag_none}>统一快照无事件记录</span>
        <h3>当前未发现显著全国战况</h3>
        <p>继续显示雷达、环境图层与来源时效；无事件记录不等于无风险。</p>
      </article>
    );
  }

  const carouselEnabled = total > 1;
  return (
    <article
      className={`${styles.signalCard} ${styles[`signal_${variant}`]} ${styles[`level_${event.level}`]}`}
      data-hazard={event.hazard}
      data-level={event.level}
      onMouseEnter={() => onInteractionPause(true)}
      onMouseLeave={() => onInteractionPause(false)}
      onFocusCapture={() => onInteractionPause(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onInteractionPause(false);
      }}
    >
      <span className={styles.hazardTexture} aria-hidden="true" />
      <div className={styles.hazardVisual} aria-hidden="true">
        <span className={styles.hazardGlyph} style={{ backgroundImage: `url(${event.badgeAsset})` }} />
        <span className={styles.hazardName}>{hazardLabel(event.hazard)}</span>
      </div>
      <div className={styles.signalCopy}>
        <div className={styles.signalMeta}>
          <span className={styles[`levelFlag_${event.level}`]}>{event.levelLabel}</span>
          <span>{event.evidenceLabel}</span>
          <time>{event.timeLabel}</time>
        </div>
        <h3>{event.title}</h3>
        <strong className={styles.location}>{event.locationLabel}</strong>
        {variant === "full" ? <p className={styles.fact}>{event.factSummary}</p> : null}
        {variant === "full" ? <p className={styles.limitation}><span>边界</span>{event.limitation}</p> : null}
      </div>
      <div className={styles.signalControls} aria-label="预警快报控制">
        <span className={styles.queuePosition}>{total ? `${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}` : "01 / 01"}</span>
        {carouselEnabled ? <div className={styles.controlRow}>
          <button type="button" onClick={onPrevious} aria-label="上一条官方预警"><SkipBack size={14} /></button>
          <button type="button" onClick={onTogglePaused} aria-label={paused ? "继续自动轮播" : "暂停自动轮播"}>{paused ? <Play size={14} /> : <Pause size={14} />}</button>
          <button type="button" onClick={onNext} aria-label="下一条官方预警"><SkipForward size={14} /></button>
        </div> : null}
        {onSelectEvent ? <button type="button" className={styles.locateAction} onClick={() => onSelectEvent(event.id)}><MapPinned size={14} />定位事件</button> : null}
      </div>
      {carouselEnabled ? <span key={event.id} className={`${styles.cycleProgress} ${paused ? styles.cyclePaused : ""}`} aria-hidden="true" /> : null}
    </article>
  );
}

function nextWarnings(queue: HudMainEvent[], index: number, count: number) {
  if (queue.length < 2) return [];
  return Array.from({ length: Math.min(count, queue.length - 1) }, (_, offset) => queue[(index + offset + 1) % queue.length]);
}

function hazardLabel(hazard: WeatherHazard) {
  return ({ typhoon: "台风", rain: "暴雨", convection: "强对流", heat: "高温", wind: "大风", dust: "沙尘", visibility: "能见度", flood: "洪涝", geological: "地质", other: "综合" })[hazard];
}

function levelClass(level: Exclude<WeatherEventLevel, "watch"> | null) {
  return level ? styles[`summary_${level}`] : styles.summary_none;
}

function healthGlyphClass(status: SourceFreshness) {
  return styles[`glyph_${status.replace("-", "_")}`];
}
