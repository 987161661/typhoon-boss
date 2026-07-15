"use client";

import type { Storm } from "@/lib/types";
import type { NationalMapState } from "./nationalMapState";
import styles from "./NationalMap.module.css";

export function NationalMapModeControl({
  state,
  storms,
  warningsVisible,
  onReturnNational,
  onSelectStorm,
  onWarningsVisibleChange
}: {
  state: NationalMapState;
  storms: readonly Storm[];
  warningsVisible: boolean;
  onReturnNational: () => void;
  onSelectStorm: (stormId: string) => void;
  onWarningsVisibleChange: (visible: boolean) => void;
}) {
  return (
    <nav className={styles.modeControl} aria-label="全国与台风地图模式" data-testid="national-map-mode-control">
      <button type="button" className={state.mode === "national" ? styles.active : ""} onClick={onReturnNational}>全国态势</button>
      {storms.map((storm) => (
        <button
          type="button"
          key={storm.id}
          className={state.mode === "typhoon" && state.selectedStormId === storm.id ? styles.active : ""}
          onClick={() => onSelectStorm(storm.id)}
        >{storm.code} {storm.nameZh}</button>
      ))}
      <button
        type="button"
        className={warningsVisible ? styles.active : ""}
        aria-pressed={warningsVisible}
        data-testid="national-warning-toggle"
        data-layer-enabled={warningsVisible ? "true" : "false"}
        onClick={() => onWarningsVisibleChange(!warningsVisible)}
      >
        全国预警 {warningsVisible ? "开" : "关"}
      </button>
    </nav>
  );
}
