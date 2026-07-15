"use client";

import {
  Archive,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  MapPinned,
  Pause,
  Play,
  RadioTower
} from "lucide-react";
import type { NationalSituationSnapshot, SourceFreshness, WeatherEventLevel, WeatherHazard } from "@/lib/nationalWeatherTypes";
import {
  buildNationalSituationHudModel,
  type HudMainEvent,
  type HudSourceState
} from "@/components/nationalSituationHudModel";
import { useWarningCarousel } from "@/components/useWarningCarousel";
import styles from "./FutureWeatherArchivePanel.module.css";

export interface FutureWeatherArchivePanelProps {
  snapshot: NationalSituationSnapshot;
  className?: string;
  onSelectEvent?: (eventId: string) => void;
  onOpenCitySituation?: () => void;
}

export function FutureWeatherArchivePanel({
  snapshot,
  className = "",
  onSelectEvent
}: FutureWeatherArchivePanelProps) {
  const model = buildNationalSituationHudModel(snapshot);
  const carousel = useWarningCarousel(model.warningQueue);
  const active = carousel.current ?? model.warningQueue[0] ?? model.mainEvent;
  const nextCases = nextWarnings(model.warningQueue, carousel.currentIndex, 3);
  const verifiedSourceCount = model.sources.filter((source) => source.status === "fresh").length;

  return (
    <section
      className={`${styles.cabinet} ${active ? styles[`level_${active.level}`] : styles.level_none} ${className}`.trim()}
      aria-labelledby="future-weather-archive-title"
      data-highest-event-level={active?.level ?? "none"}
      data-archive-cabinet="vault-07"
    >
      <span className={styles.cabinetGrain} aria-hidden="true" />
      <span className={styles.indexSpine} aria-hidden="true">
        <span>07</span>
        <i />
        <small>FMRA</small>
      </span>

      <header className={styles.bureauPlaque}>
        <span className={styles.bureauSeal} aria-hidden="true" />
        <div className={styles.bureauIdentity}>
          <span className={styles.protocol}>F.M.R.A · VAULT 07</span>
          <h2 id="future-weather-archive-title">未来气象研究档案局</h2>
          <p>异常天气保存科 <i /> 赤曜自动归档协议</p>
        </div>
        <div className={styles.shiftReadout}>
          <span>观测时次</span>
          <time dateTime={snapshot.generatedAt}>{model.generatedLabel}</time>
          <small><CircleDot size={9} /> 回声链在线</small>
        </div>
      </header>

      <StormSpecimen
        event={active}
        total={model.warningQueue.length}
        index={carousel.currentIndex}
        paused={carousel.paused}
        onPrevious={() => carousel.move(-1)}
        onNext={() => carousel.move(1)}
        onTogglePaused={carousel.togglePaused}
        onInteractionPause={carousel.setInteractionPaused}
        onSelectEvent={onSelectEvent}
        generatedAt={snapshot.generatedAt}
      />

      <section className={styles.caseRack} aria-labelledby="archive-case-rack-title">
        <div className={styles.sectionLabel}>
          <div>
            <Archive size={15} />
            <h3 id="archive-case-rack-title">待入库切片</h3>
          </div>
          <span>{nextCases.length > 0 ? `${nextCases.length} 卷待调阅` : "队列已清空"}</span>
        </div>
        {nextCases.length > 0 ? (
          <ol>
            {nextCases.map((event, index) => (
              <li key={event.id} className={styles.caseTab} data-level={event.level}>
                <span className={styles.tabIndex}>{String(index + 1).padStart(2, "0")}</span>
                <span className={styles.tabSeal}>{sealShortLabel(event.level)}</span>
                <span className={styles.tabCopy}>
                  <strong>{event.title}</strong>
                  <small>{event.locationLabel} · {event.timeLabel}</small>
                </span>
                <ChevronRight size={15} aria-hidden="true" />
              </li>
            ))}
          </ol>
        ) : (
          <p className={styles.emptyRack}>没有等待轮播的官方预警。观察层仍持续接收雷达、卫星与来源时效。</p>
        )}
      </section>

      <WarningSignalBoard
        counts={snapshot.warnings.byLevel}
        total={model.warning.total}
        highestLevel={model.warning.highestLevel}
        highestLevelLabel={model.warning.highestLevelLabel}
        updatedLabel={model.warning.updatedLabel}
      />

      <details className={styles.evidenceRibbon}>
        <summary className={styles.sectionLabel}>
          <div>
            <RadioTower size={15} />
            <h3 id="archive-evidence-title">来源凭证链</h3>
          </div>
          <span className={styles.evidenceSummary}>
            {verifiedSourceCount}/{model.sources.length} 路新鲜
            <small>展开核对</small>
            <ChevronDown size={14} aria-hidden="true" />
          </span>
        </summary>
        <ul>
          {model.sources.map((source, index) => (
            <EvidenceTicket key={source.sourceId} source={source} index={index} />
          ))}
        </ul>
      </details>

      <footer className={styles.archiveFooter}>
        <span>回声层：已封存 / 不参与现实行动指令</span>
        <span>值守签名 <b>—</b></span>
        <i aria-label="赤曜印">赤曜</i>
      </footer>
    </section>
  );
}

function StormSpecimen({
  event,
  total,
  index,
  paused,
  onPrevious,
  onNext,
  onTogglePaused,
  onInteractionPause,
  onSelectEvent,
  generatedAt
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
  generatedAt: string;
}) {
  if (!event) {
    return (
      <article className={`${styles.stormSpecimen} ${styles.emptySpecimen}`}>
        <div className={styles.specimenArt} aria-hidden="true" />
        <div className={styles.emptySpecimenCopy}>
          <span>当前封存件 / NO RECORD</span>
          <h3>统一快照未发现显著全国事件</h3>
          <p>雷达、环境图层与来源凭证仍在工作；无事件记录不等于无风险。</p>
        </div>
      </article>
    );
  }

  const carouselEnabled = total > 1;
  return (
    <article
      className={styles.stormSpecimen}
      data-hazard={event.hazard}
      data-level={event.level}
      onMouseEnter={() => onInteractionPause(true)}
      onMouseLeave={() => onInteractionPause(false)}
      onFocusCapture={() => onInteractionPause(true)}
      onBlurCapture={(focusEvent) => {
        if (!focusEvent.currentTarget.contains(focusEvent.relatedTarget)) onInteractionPause(false);
      }}
    >
      <div className={styles.specimenArt} aria-hidden="true">
        <span
          key={event.id}
          className={styles.hazardScene}
          style={{ backgroundImage: `url("${hazardSceneAsset(event.hazard)}")` }}
        />
        <span className={styles.opticalBloom} />
        <span className={styles.hazardCrest} style={{ backgroundImage: `url(${event.badgeAsset})` }} />
        <span className={styles.calibrationMarks} />
        <span className={styles.echoLabel}>ECHO / 07</span>
      </div>

      <div className={styles.specimenSeal} data-level={event.level}>
        <span>{sealShortLabel(event.level)}</span>
        <small>{event.evidenceLabel}</small>
      </div>

      <div className={styles.specimenCaption}>
        <div className={styles.caseMeta}>
          <span>当前封存件</span>
          <code>{archiveCaseNumber(event, generatedAt)}</code>
          <time>{event.timeLabel}</time>
        </div>
        <h3>{event.title}</h3>
        <strong className={styles.location}>{event.locationLabel}</strong>
        <p className={styles.fact}>{event.factSummary}</p>
        <p className={styles.boundary}><span>事实边界</span>{event.limitation}</p>
      </div>

      <div className={styles.cabinetControls} aria-label="官方预警卷宗控制">
        <span className={styles.controlCounter}>{total ? `${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}` : "01 / 01"}</span>
        <div className={styles.reelControls}>
          <button type="button" onClick={onPrevious} aria-label="上一卷官方预警" disabled={!carouselEnabled}>
            <ChevronLeft size={16} /> <span>上一卷</span>
          </button>
          <button type="button" onClick={onTogglePaused} aria-label={paused ? "继续自动调阅" : "冻结自动调阅"} disabled={!carouselEnabled}>
            {paused ? <Play size={15} /> : <Pause size={15} />}
            <span>{paused ? "继续" : "冻结"}</span>
          </button>
          <button type="button" onClick={onNext} aria-label="下一卷官方预警" disabled={!carouselEnabled}>
            <span>下一卷</span> <ChevronRight size={16} />
          </button>
        </div>
        {onSelectEvent ? (
          <button type="button" className={styles.projectAction} onClick={() => onSelectEvent(event.id)}>
            <MapPinned size={16} /> 投影到地图
          </button>
        ) : null}
      </div>

      {carouselEnabled ? (
        <span key={event.id} className={`${styles.loadProgress} ${paused ? styles.loadProgressPaused : ""}`} aria-hidden="true" />
      ) : null}
    </article>
  );
}

function WarningSignalBoard({
  counts,
  total,
  highestLevel,
  highestLevelLabel,
  updatedLabel
}: {
  counts: Record<"red" | "orange" | "yellow" | "blue", number>;
  total: number;
  highestLevel: "red" | "orange" | "yellow" | "blue" | null;
  highestLevelLabel: string;
  updatedLabel: string;
}) {
  const levels = [
    { id: "red", label: "红色", code: "RED" },
    { id: "orange", label: "橙色", code: "ORG" },
    { id: "yellow", label: "黄色", code: "YLW" },
    { id: "blue", label: "蓝色", code: "BLU" }
  ] as const;

  return (
    <section className={styles.warningSignalBoard} aria-labelledby="warning-signal-board-title">
      <header>
        <div>
          <span>全国官方预警</span>
          <h3 id="warning-signal-board-title">风险信号总览</h3>
        </div>
        <strong>{total} <small>条在案</small></strong>
        <time>{updatedLabel}</time>
      </header>
      <div className={styles.warningLevelGrid}>
        {levels.map((level) => (
          <article key={level.id} data-level={level.id} data-highest={highestLevel === level.id || undefined}>
            <span>{level.label}</span>
            <strong>{counts[level.id]}</strong>
            <small>{level.code}</small>
          </article>
        ))}
      </div>
      <p>当前最高等级：<strong>{highestLevelLabel}</strong></p>
    </section>
  );
}

function EvidenceTicket({ source, index }: { source: HudSourceState; index: number }) {
  return (
    <li
      className={`${styles.evidenceTicket} ${styles[`source_${source.status.replace("-", "_")}`]}`}
      data-primary-evidence={source.isPrimaryEvidence || undefined}
    >
      <span className={styles.ticketPunch} aria-hidden="true" />
      <span className={styles.ticketIndex}>{String(index + 1).padStart(2, "0")}</span>
      <span className={styles.ticketState} aria-hidden="true">{sourceStatusGlyph(source.status)}</span>
      <span className={styles.ticketCopy}>
        <strong>{source.label}</strong>
        <small>{source.statusDetail}</small>
      </span>
      <span className={styles.ticketMeta}>
        <b>{source.statusLabel}</b>
        <time>{source.updatedLabel}</time>
      </span>
    </li>
  );
}

function nextWarnings(queue: HudMainEvent[], index: number, count: number) {
  if (queue.length < 2) return [];
  return Array.from({ length: Math.min(count, queue.length - 1) }, (_, offset) => queue[(index + offset + 1) % queue.length]);
}

function sealShortLabel(level: WeatherEventLevel) {
  return ({ red: "红 / 紧急", orange: "橙 / 限制", yellow: "黄 / 警戒", blue: "蓝 / 公开", watch: "观察层" })[level];
}

function sourceStatusGlyph(status: SourceFreshness) {
  return ({ fresh: "●", delayed: "◐", expired: "×", unavailable: "!", "no-record": "—" })[status];
}

function archiveCaseNumber(event: HudMainEvent, generatedAt: string) {
  const date = new Date(generatedAt);
  const datePart = Number.isFinite(date.getTime())
    ? `${String(date.getFullYear()).slice(-2)}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`
    : "000000";
  const hash = Array.from(event.id).reduce((value, character) => (value * 31 + character.charCodeAt(0)) >>> 0, 7);
  return `FMRA-${datePart}-${hazardCode(event.hazard)}-${String(hash % 1000).padStart(3, "0")}`;
}

function hazardCode(hazard: WeatherHazard) {
  return ({ typhoon: "TC", rain: "RN", convection: "CV", heat: "HT", wind: "GL", dust: "DS", visibility: "VS", flood: "FL", geological: "GE", other: "MX" })[hazard];
}

function hazardSceneAsset(hazard: WeatherHazard) {
  return ({
    typhoon: "/assets/future-weather-archive/performances/typhoon-show-v2.webp",
    rain: "/assets/future-weather-archive/performances/rainstorm-show-v2.webp",
    convection: "/assets/future-weather-archive/performances/thunderstorm-show-v2.webp",
    heat: "/assets/future-weather-archive/performances/heatwave-show-v2.webp",
    wind: "/assets/future-weather-archive/performances/gale-show-v2.webp",
    dust: "/assets/future-weather-archive/performances/duststorm-show-v2.webp",
    visibility: "/assets/future-weather-archive/performances/duststorm-show-v2.webp",
    flood: "/assets/future-weather-archive/performances/rainstorm-show-v2.webp",
    geological: "/assets/future-weather-archive/performances/geological-show-v2.webp",
    other: "/assets/future-weather-archive/storm-specimen-v1.webp"
  })[hazard];
}
