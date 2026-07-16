"use client";

import { useEffect, useMemo, useReducer } from "react";
import type { VisualLayerSummary } from "@/lib/nationalWeatherTypes";
import {
  createRadarPlaybackState,
  radarPlaybackFrames,
  reduceRadarPlaybackState,
  shouldRunRadarPlaybackTimer
} from "./nationalRadarPlaybackState";
import styles from "./NationalMap.module.css";

export function NationalRadarPlayback({
  radar,
  enabled,
  onEnabledChange,
  intervalMs = 900
}: {
  radar: VisualLayerSummary | null;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  intervalMs?: number;
}) {
  const frames = useMemo(() => radarPlaybackFrames(radar), [radar]);
  const frameIds = useMemo(() => frames.map((frame) => frame.id), [frames]);
  const [state, dispatch] = useReducer(reduceRadarPlaybackState, frameIds, createRadarPlaybackState);

  useEffect(() => dispatch({ type: "sync", frameIds }), [frameIds]);
  useEffect(() => {
    if (!enabled) dispatch({ type: "pause" });
  }, [enabled]);
  useEffect(() => {
    if (!shouldRunRadarPlaybackTimer(enabled, state)) return;
    const timer = window.setInterval(() => dispatch({ type: "tick" }), intervalMs);
    return () => window.clearInterval(timer);
  }, [enabled, intervalMs, state]);

  if (!enabled) {
    return <button className={styles.radarLauncher} type="button" onClick={() => onEnabledChange(true)}>打开全国雷达播放板</button>;
  }

  const frame = frames[state.index] ?? null;
  return (
    <aside className={styles.radarPanel} aria-label="全国雷达独立播放板" data-georeferenced={radar?.georeferenced ? "true" : "false"}>
      <header>
        <div><strong>全国雷达</strong><small>独立图像播放 · 未校准为地图叠图</small></div>
        <button type="button" onClick={() => onEnabledChange(false)}>关闭</button>
      </header>
      <div className={styles.radarImage}>
        {frame?.imageUrl ? (
          // Provider frames may be short-lived dynamic URLs, so Next image
          // optimization cannot safely proxy or cache them.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={frame.imageUrl} alt={`全国雷达 ${frame.observedAt ?? "时次未知"}`} />
        ) : <span>当前无可播放图像</span>}
      </div>
      <footer>
        <time>{frame?.observedAt ? new Date(frame.observedAt).toLocaleString("zh-CN", { hour12: false }) : "时次未知"}</time>
        <div>
          <button type="button" disabled={frames.length < 2} onClick={() => dispatch({ type: "previous" })}>前一帧</button>
          <button type="button" disabled={frames.length < 2} onClick={() => dispatch({ type: "toggle" })}>{state.playing ? "暂停" : "播放"}</button>
          <button type="button" disabled={frames.length < 2} onClick={() => dispatch({ type: "next" })}>后一帧</button>
        </div>
      </footer>
    </aside>
  );
}
