"use client";

import {
  CloudRain,
  Droplets,
  Gauge,
  LockKeyhole,
  ScanLine,
  Thermometer,
  UnlockKeyhole,
  Wind,
  X,
  type LucideIcon
} from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type RefObject
} from "react";
import type { CityBriefing } from "@/lib/cityBriefingData";
import type { BattleArchive, CityPanelsModel } from "@/lib/cityPanelsPresentation";
import type { LayoutRect } from "@/lib/cityPanelLayout";
import {
  buildCityBattleShowModel,
  type CityBattleShowPhase,
  type CityBattleTelemetryDeck,
  type CityBattleTelemetryMetric
} from "@/lib/cityBattleShowModel";
import { CityTypewriterText } from "./CityTypewriterText";
import styles from "./CityBattleShow.module.css";

export interface CityBattleShowProps {
  panelRef: RefObject<HTMLElement | null>;
  rect: LayoutRect;
  phase: CityBattleShowPhase;
  briefing: CityBriefing;
  model: CityPanelsModel;
  archive?: BattleArchive;
  onClose: () => void;
  typingSound?: boolean;
  reducedMotion?: boolean;
}

export function CityBattleShow({
  panelRef,
  rect,
  phase,
  briefing,
  model,
  archive,
  onClose,
  typingSound = false,
  reducedMotion
}: CityBattleShowProps) {
  const titleId = useId();
  const prefersReducedMotion = useReducedMotion(reducedMotion);
  const show = buildCityBattleShowModel({ briefing, model, archive });
  const style = {
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height
  } satisfies CSSProperties;

  return (
    <section
      ref={panelRef}
      className={`${styles.panel} ${phase === "deploy" ? styles.deploy : styles.card}`}
      style={style}
      data-role="battle-panel"
      data-component="city-battle-show"
      data-phase={phase}
      data-reduced-motion={prefersReducedMotion ? "true" : "false"}
      aria-labelledby={titleId}
    >
      <div className={`${styles.damage} ${styles.damageA}`} data-role="battle-damage" aria-hidden="true" />
      <div className={`${styles.damage} ${styles.damageB}`} data-role="battle-damage" aria-hidden="true" />
      <svg className={styles.cracks} data-role="battle-cracks" viewBox="0 0 700 570" preserveAspectRatio="none" aria-hidden="true">
        <path d="M8 18 69 51 99 42 138 88 191 103 218 154" />
        <path d="M696 417 633 382 594 407 531 355 476 377 421 321" />
        <path d="M557 5 518 49 526 94 473 127" />
      </svg>
      <div className={styles.corners} data-role="battle-corners" aria-hidden="true"><i /><i /><i /><i /></div>
      <div className={styles.decode} data-role="battle-decode" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /><i /></div>

      <header className={styles.header}>
        <div>
          <span>STORM FRONTIER // CITY INSTANCE</span>
          <h2 id={titleId}>{show.cityLabel}<em>战区接入</em></h2>
          {show.viewerLabel && <small>TRIGGER // {show.viewerLabel}</small>}
        </div>
        <button type="button" onClick={onClose} aria-label="关闭城市战况"><X /></button>
      </header>

      <div className={styles.command}>
        <ThreatDial score={show.score} />
        <div className={styles.verdict}>
          <div className={styles.verdictMeta}>
            <span>{show.title}</span>
            {show.statusSeal && <b>{show.statusSeal}</b>}
          </div>
          <TypewriterText
            text={show.summary}
            active={phase === "card" || prefersReducedMotion}
            speed={78}
            sound={typingSound}
            reducedMotion={prefersReducedMotion}
            role="battle-summary"
          />
          {show.rankIntel.length > 0 && <CityRankIntel intel={show.rankIntel} />}
        </div>
      </div>

      <div className={styles.tacticalGrid}>
        <div className={styles.telemetryColumn}>
          {show.telemetry.map((deck) => <TelemetryDeck key={deck.id} deck={deck} />)}
        </div>
        <CitySignalBoard mutators={show.mutators} />
      </div>

      <section className={styles.actions} data-role="battle-actions" aria-label="局内策略">
        <span>TACTICAL ORDERS // 局内策略</span>
        {show.actions.map((action) => (
          <b
            key={action.id}
            data-role="battle-action"
            style={{ "--battle-action-delay": `${action.delayMs}ms` } as CSSProperties}
          >› {action.text}</b>
        ))}
      </section>

      <ArchiveSlot
        archive={show.archive}
        active={phase === "card" || prefersReducedMotion}
        sound={typingSound}
        reducedMotion={prefersReducedMotion}
      />

      <footer className={styles.footer}>
        <span>赤曜档案局 // 城市副本播报</span>
        <time>更新 {formatTime(show.observedAt)}</time>
      </footer>
    </section>
  );
}

export function ThreatDial({ score }: { score: number | null }) {
  return <div
    className={styles.threatDial}
    data-role="threat-dial"
    data-score-state={score === null ? "unknown" : "available"}
    aria-label={score === null ? "热压指数待判，当前资料不足" : `热压指数 ${Math.round(score)}`}
    style={{ "--battle-threat": `${score ?? 0}%` } as CSSProperties}
  >
    <i /><span>{score === null ? "指数待判" : "热压指数"}</span><b>{score === null ? "—" : Math.round(score)}</b><small>{score === null ? "UNKNOWN" : "THREAT"}</small>
  </div>;
}

function CityRankIntel({ intel }: { intel: ReturnType<typeof buildCityBattleShowModel>["rankIntel"] }) {
  return <div className={styles.rankIntel} data-role="battle-rank-intel" aria-label="城市气象全国排名">
    {intel.map((item) => <article key={item.id} data-tier={item.tier}>
      <div><span>{item.label}</span><strong>全国 #{item.position}</strong><small>{item.value} · {item.scope}</small></div>
      <p>{item.adaptation}</p>
    </article>)}
  </div>;
}

export function TypewriterText({
  text,
  active,
  speed,
  sound,
  reducedMotion,
  role
}: {
  text: string;
  active: boolean;
  speed: number;
  sound: boolean;
  reducedMotion: boolean;
  role: "battle-summary" | "archive-fragment";
}) {
  const audioContext = useRef<AudioContext | null>(null);

  useEffect(() => () => {
    if (audioContext.current) void audioContext.current.close().catch(() => undefined);
  }, []);

  return <CityTypewriterText
    text={text}
    active={active}
    speed={speed}
    reducedMotion={reducedMotion}
    role={role}
    className={styles.typewriter}
    onCharacter={() => {
      if (sound) playTypewriterTick(audioContext);
    }}
  />;
}

export function TelemetryDeck({ deck }: { deck: CityBattleTelemetryDeck }) {
  return <section className={styles.telemetry} data-role="telemetry-deck" aria-label={deck.title}>
    <header><span>{deck.title}</span><i /></header>
    <div>
      {deck.metrics.map((metric) => <TelemetryMetric key={metric.id} metric={metric} />)}
    </div>
  </section>;
}

function TelemetryMetric({ metric }: { metric: CityBattleTelemetryMetric }) {
  const icons: Record<CityBattleTelemetryMetric["icon"], LucideIcon> = {
    temperature: Thermometer,
    humidity: Droplets,
    rain: CloudRain,
    wind: Wind,
    convection: Gauge
  };
  const Icon = icons[metric.icon];
  return <article style={{ "--battle-metric": `${metric.level}%` } as CSSProperties}>
    <Icon /><span>{metric.label}</span><strong>{metric.value}</strong><small>{metric.detail}</small><i />
  </article>;
}

export function CitySignalBoard({ mutators }: { mutators: CityPanelsModel["battle"]["mutators"] }) {
  return <section className={styles.signalBoard} data-role="city-signal-board" aria-label="城市异动">
    <header><span>CITY MUTATORS // 异动优先</span><small>花文本层</small></header>
    <div data-count={mutators.length}>
      {mutators.map((mutator) => <article key={mutator.id} data-tone={mutator.tone}>
        <div><span>{mutator.label}</span><strong>{mutator.value}</strong><small>{mutator.detail}</small></div>
        <b>PLAYFUL</b>
        <p>{mutator.comment}</p>
      </article>)}
    </div>
  </section>;
}

function ArchiveSlot({
  archive,
  active,
  sound,
  reducedMotion
}: {
  archive: BattleArchive;
  active: boolean;
  sound: boolean;
  reducedMotion: boolean;
}) {
  const icon = archive.status === "unlocked" ? <UnlockKeyhole /> : archive.status === "unlocking" ? <ScanLine /> : <LockKeyhole />;
  return <section className={styles.archive} data-role="battle-archive" data-status={archive.status} aria-label="档案碎片">
    <header>{icon}<span>ARCHIVE FRAGMENT // {archive.code}</span><b>{archive.clearance}</b></header>
    {archive.status === "locked" && <div className={styles.archiveLocked}>
      <p>{archive.statusText}</p>
      <small>{archive.teaserTokens.join(" // ")}</small>
      <strong data-role="archive-follow-cta">关注主播，登记为观测员并解锁本次档案。</strong>
    </div>}
    {archive.status === "unlocking" && <p className={styles.archiveStatus}>关注凭证已接入，黑色封锁装置正在断开。</p>}
    {archive.status === "unavailable" && <p className={styles.archiveStatus}>{archive.statusText}</p>}
    {archive.status === "unlocked" && archive.fragment && <TypewriterText
      text={archive.fragment}
      active={active}
      speed={112}
      sound={sound}
      reducedMotion={reducedMotion}
      role="archive-fragment"
    />}
  </section>;
}

function useReducedMotion(override?: boolean) {
  const [reduced, setReduced] = useState(override ?? false);
  useEffect(() => {
    if (override !== undefined) {
      setReduced(override);
      return;
    }
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [override]);
  return reduced;
}

function playTypewriterTick(contextRef: { current: AudioContext | null }) {
  try {
    const context = contextRef.current ?? new AudioContext();
    contextRef.current = context;
    if (context.state === "suspended") void context.resume();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = context.currentTime;
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(1_340, start);
    oscillator.frequency.exponentialRampToValueAtTime(980, start + 0.034);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.042, start + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.038);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.04);
  } catch {
    // Audio is ornamental. Browser autoplay policy must never block the copy.
  }
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "--:--" : date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}
