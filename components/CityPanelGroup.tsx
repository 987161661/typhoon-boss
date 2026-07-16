"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from "react";
import type { CityBriefing } from "@/lib/cityBriefingData";
import type { CityPanelsModel, PanelWarning } from "@/lib/cityPanelsPresentation";
import {
  resolveCityPanelLayout,
  type CityPanelLayout,
  type LayoutPoint,
  type LayoutRect,
  type SafeInsets
} from "@/lib/cityPanelLayout";
import { CityBattleShow } from "./CityBattleShow";
import { CityInfoDeck } from "./CityInfoDeck";
import styles from "./CityPanelGroup.module.css";
import motionStyles from "./CityPanelMotion.module.css";

export type CityPanelPhase = "deploy" | "card";

export interface CityPanelGroupProps {
  phase: CityPanelPhase;
  anchor: LayoutPoint | null;
  briefing: CityBriefing;
  model: CityPanelsModel;
  onClose: () => void;
  safeInsets?: Partial<SafeInsets>;
  reservedRects?: LayoutRect[];
}

const INITIAL_BATTLE_SIZE = { width: 680, height: 680 };
const INITIAL_INFO_SIZE = { width: 550, height: 680 };
const EMPTY_RESERVED_RECTS: LayoutRect[] = [];

/**
 * One controller for one city. It owns geometry and lifecycle only; the two
 * panels consume the same briefing/model and never fetch independently.
 */
export function CityPanelGroup({
  phase,
  anchor,
  briefing,
  model,
  onClose,
  safeInsets,
  reservedRects = EMPTY_RESERVED_RECTS
}: CityPanelGroupProps) {
  const battleRef = useRef<HTMLElement>(null);
  const infoRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const stableInsets = useMemo(() => safeInsets, [safeInsets]);
  const stableReservedRects = useMemo(() => reservedRects, [reservedRects]);
  const [layout, setLayout] = useState<CityPanelLayout>(() => resolveCityPanelLayout({
    viewport: { width: 1280, height: 720 },
    anchor,
    battleSize: INITIAL_BATTLE_SIZE,
    infoSize: INITIAL_INFO_SIZE,
    safeInsets,
    reservedRects
  }));

  useLayoutEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const battleSize = layoutSize(battleRef.current, INITIAL_BATTLE_SIZE);
      const infoSize = layoutSize(infoRef.current, INITIAL_INFO_SIZE);
      const next = resolveCityPanelLayout({
        viewport: { width: window.innerWidth, height: window.innerHeight },
        anchor,
        battleSize,
        infoSize,
        safeInsets: stableInsets,
        reservedRects: stableReservedRects
      });
      setLayout((current) => sameLayout(current, next) ? current : next);
    };

    const scheduleUpdate = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(update);
    };

    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleUpdate);
    if (battleRef.current) observer?.observe(battleRef.current);
    if (infoRef.current) observer?.observe(infoRef.current);
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [anchor, stableInsets, stableReservedRects]);

  const prefersReducedMotion = usePrefersReducedMotion();
  useCityPanelSoundEffects(phase, prefersReducedMotion);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const severity = warningSeverity(model.info.warning);
  const groupStyle = anchor ? ({
    "--city-core-x": `${anchor.x}px`,
    "--city-core-y": `${anchor.y}px`,
    "--battle-link-start": `${layout.battleRect.x + layout.battleRect.width}px`,
    "--info-link-end": `${layout.infoRect.x}px`
  } as CSSProperties) : undefined;

  return (
    <section
      className={`${styles.group} ${motionStyles.motionRoot}`}
      style={groupStyle}
      role="region"
      aria-labelledby={titleId}
      data-role="city-panel-group"
      data-phase={phase}
      data-density={layout.density}
      data-warning-feed={model.shared.warningFeed}
      data-severity={severity}
      data-layout={layout.mode}
    >
      <h2 id={titleId} className={styles.srOnly}>{model.shared.cityLabel}城市战况与气象信息</h2>
      {anchor && (
        <div className={styles.cityCore} data-role="city-core" aria-hidden="true">
          <i /><i /><b />
        </div>
      )}
      {layout.connectorsVisible && anchor && (
        <div className={styles.connectors} aria-hidden="true">
          <i className={styles.battleLink} data-role="battle-link" />
          <i className={styles.infoLink} data-role="info-link" />
        </div>
      )}
      <CityBattleShow
        panelRef={battleRef}
        rect={layout.battleRect}
        phase={phase}
        briefing={briefing}
        model={model}
        archive={model.battle.archive}
        onClose={onClose}
        typingSound={!prefersReducedMotion}
        reducedMotion={prefersReducedMotion}
      />
      <CityInfoDeck panelRef={infoRef} rect={layout.infoRect} phase={phase} model={model} />
    </section>
  );
}

/**
 * The battle channel lands first; one second later the factual channel
 * calibrates. The sounds are synthesized so the broadcast overlay has no
 * network/audio-asset dependency. Autoplay policy may keep them silent until
 * the host has interacted with the page, but never blocks the presentation.
 */
function useCityPanelSoundEffects(phase: CityPanelPhase, reducedMotion: boolean) {
  const contextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (phase !== "deploy" || reducedMotion) return;

    const timers = [
      window.setTimeout(() => playPanelOpenSound(contextRef, "battle"), 760),
      window.setTimeout(() => playPanelOpenSound(contextRef, "info"), 1_760)
    ];
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [phase, reducedMotion]);

  useEffect(() => () => {
    if (contextRef.current) void contextRef.current.close().catch(() => undefined);
  }, []);
}

function usePrefersReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reducedMotion;
}

function playPanelOpenSound(contextRef: { current: AudioContext | null }, channel: "battle" | "info") {
  try {
    const context = contextRef.current ?? new AudioContext();
    contextRef.current = context;
    if (context.state === "suspended") void context.resume();
    const start = context.currentTime;
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -18;
    limiter.knee.value = 12;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.16;
    limiter.connect(context.destination);

    if (channel === "battle") {
      // A physical low strike followed by a short metal latch: the wasteland
      // panel should land, not merely make a generic UI beep.
      playTone(context, limiter, start, { type: "sine", from: 118, to: 46, peak: 0.14, attack: 0.012, duration: 0.42 });
      playTone(context, limiter, start + 0.035, { type: "triangle", from: 680, to: 190, peak: 0.065, attack: 0.006, duration: 0.22 });
      return;
    }

    // The fact channel gets an audible calibration rise and a clean confirm
    // chime, deliberately distinct from the battle impact.
    playTone(context, limiter, start, { type: "sine", from: 420, to: 1_180, peak: 0.095, attack: 0.014, duration: 0.38 });
    playTone(context, limiter, start + 0.13, { type: "triangle", from: 1_520, to: 1_240, peak: 0.07, attack: 0.008, duration: 0.27 });
  } catch {
    // Decorative sound must not interrupt the live city briefing.
  }
}

function playTone(
  context: AudioContext,
  destination: AudioNode,
  start: number,
  { type, from, to, peak, attack, duration }: {
    type: OscillatorType;
    from: number;
    to: number;
    peak: number;
    attack: number;
    duration: number;
  }
) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(from, start);
  oscillator.frequency.exponentialRampToValueAtTime(to, start + duration);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.01);
}

function warningSeverity(warning: PanelWarning) {
  if (warning.status !== "active") return warning.status;
  const level = warning.level?.toLowerCase() ?? "watch";
  if (level.includes("red") || level.includes("红")) return "red";
  if (level.includes("orange") || level.includes("橙")) return "orange";
  if (level.includes("yellow") || level.includes("黄")) return "yellow";
  if (level.includes("blue") || level.includes("蓝")) return "blue";
  return "watch";
}

function sameLayout(left: CityPanelLayout, right: CityPanelLayout) {
  return left.mode === right.mode
    && left.density === right.density
    && left.connectorsVisible === right.connectorsVisible
    && sameRect(left.battleRect, right.battleRect)
    && sameRect(left.infoRect, right.infoRect);
}

/**
 * offsetWidth/offsetHeight describe the element's layout box without CSS
 * transforms. getBoundingClientRect includes the deploy animation's scale,
 * which fed animated dimensions back into layout and caused React error #185.
 */
function layoutSize(node: HTMLElement | null, fallback: { width: number; height: number }) {
  if (!node || node.offsetWidth <= 0 || node.offsetHeight <= 0) return fallback;
  return { width: node.offsetWidth, height: node.offsetHeight };
}

function sameRect(left: LayoutRect, right: LayoutRect) {
  return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
}
