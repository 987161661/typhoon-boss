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
  reservedRects = []
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
    const update = () => {
      const battleBox = battleRef.current?.getBoundingClientRect();
      const infoBox = infoRef.current?.getBoundingClientRect();
      const next = resolveCityPanelLayout({
        viewport: { width: window.innerWidth, height: window.innerHeight },
        anchor,
        battleSize: battleBox ? { width: battleBox.width, height: battleBox.height } : INITIAL_BATTLE_SIZE,
        infoSize: infoBox ? { width: infoBox.width, height: infoBox.height } : INITIAL_INFO_SIZE,
        safeInsets: stableInsets,
        reservedRects: stableReservedRects
      });
      setLayout((current) => sameLayout(current, next) ? current : next);
    };

    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    if (battleRef.current) observer?.observe(battleRef.current);
    if (infoRef.current) observer?.observe(infoRef.current);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [anchor, phase, stableInsets, stableReservedRects]);

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
      />
      <CityInfoDeck panelRef={infoRef} rect={layout.infoRect} phase={phase} model={model} />
    </section>
  );
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

function sameRect(left: LayoutRect, right: LayoutRect) {
  return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
}
