"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TyphoonMap } from "./TyphoonMap";
import { DigitalHostWindow, type HostChatRequest } from "./DigitalHostWindow";
import { LiveOperatorControls } from "./LiveOperatorControls";
import { LiveCityInteraction } from "./LiveCityInteraction";
import { LiveCityTargetLock } from "./LiveCityTargetLock";
import { useLiveCityInteractionQueue } from "./useLiveCityInteractionQueue";
import { useNationalSituation } from "./useNationalSituation";
import { createLiveCityEventId, type CityAttention, type CityAttentionAnchor, type HostLiveEvent } from "@/lib/liveCityInteraction";
import {
  DEFAULT_LIVE_CONTROL_SETTINGS,
  normalizeLiveControlSettings,
  type LiveControlSettings
} from "@/lib/liveControlSettings";

type DirectorScene = "briefing" | "analysis";

const TRANSITION_DURATION_MS = 700;

export function LiveDirector() {
  const [activeScene, setActiveScene] = useState<DirectorScene>("briefing");
  const [loaded, setLoaded] = useState({ briefing: false, analysis: false });
  const [switching, setSwitching] = useState(false);
  const [cycle, setCycle] = useState(0);
  const [hostVisible, setHostVisible] = useState(true);
  const [chatRequest, setChatRequest] = useState<HostChatRequest | null>(null);
  const [cityAttention, setCityAttention] = useState<CityAttention | null>(null);
  const [cityAttentionAnchor, setCityAttentionAnchor] = useState<CityAttentionAnchor | null>(null);
  const [controlSettings, setControlSettings] = useState(DEFAULT_LIVE_CONTROL_SETTINGS);
  const [settingsStatus, setSettingsStatus] = useState<"loading" | "saved" | "saving" | "error">(
    "loading"
  );
  const [cityOverlayHost, setCityOverlayHost] = useState<HTMLElement | null>(null);
  const transitionTimerRef = useRef<number | null>(null);
  const ready = loaded.briefing || loaded.analysis;
  const nationalSituation = useNationalSituation();
  const cityInteractions = useLiveCityInteractionQueue({
    highestOfficialWarningLevel: nationalSituation.snapshot?.warnings.highestLevel ?? null,
    focusedStormId: nationalSituation.snapshot?.storms[0]?.id ?? null
  });

  useEffect(() => {
    setCityOverlayHost(document.body);
  }, []);

  const handleLiveEvent = useCallback((event: HostLiveEvent) => {
    cityInteractions.submitEvent(event);
  }, [cityInteractions]);

  const handleRadarChat = useCallback((text: string) => {
    const id = createLiveCityEventId("radar-chat");
    const handledAsCity = cityInteractions.submitComment({
      type: "aituber:live-comment",
      version: 1,
      id,
      text,
      viewerId: "radar-operator",
      viewerName: "雷达操作台",
      platform: "radar-chat",
      receivedAt: Date.now()
    });
    // An @city command is a visual interaction only. Keep it out of the
    // avatar dialogue queue so the map/card is the complete response.
    if (handledAsCity) return "city";
    setChatRequest({ id, text });
    return "host";
  }, [cityInteractions]);

  const handleCityAttentionChange = useCallback((attention: CityAttention | null) => {
    setCityAttention(attention);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/live-control-settings", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<{ settings?: Partial<LiveControlSettings> }>;
      })
      .then((payload) => {
        if (cancelled) return;
        setControlSettings(normalizeLiveControlSettings(payload.settings));
        setSettingsStatus("saved");
      })
      .catch(() => {
        if (!cancelled) setSettingsStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready || !controlSettings.sceneRotationEnabled) return;
    let scene: DirectorScene = "briefing";
    const durationFor = (current: DirectorScene) =>
      (current === "briefing"
        ? controlSettings.briefingDurationSeconds
        : controlSettings.analysisDurationSeconds) * 1_000;
    let deadline = Date.now() + durationFor(scene);

    const tick = () => {
      const now = Date.now();
      if (now < deadline) return;

      setSwitching(true);
      scene = scene === "briefing" ? "analysis" : "briefing";
      setActiveScene(scene);
      setCycle((current) => current + 1);
      deadline = now + durationFor(scene);

      if (transitionTimerRef.current !== null) window.clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = window.setTimeout(() => {
        setSwitching(false);
        transitionTimerRef.current = null;
      }, TRANSITION_DURATION_MS);
    };

    const timer = window.setInterval(tick, 100);
    return () => {
      window.clearInterval(timer);
      if (transitionTimerRef.current !== null) window.clearTimeout(transitionTimerRef.current);
    };
  }, [
    ready,
    controlSettings.sceneRotationEnabled,
    controlSettings.briefingDurationSeconds,
    controlSettings.analysisDurationSeconds
  ]);

  const saveControlSettings = useCallback(async (patch: Partial<LiveControlSettings>) => {
    setSettingsStatus("saving");
    try {
      const response = await fetch("/api/live-control-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as { settings?: Partial<LiveControlSettings> };
      setControlSettings((current) => normalizeLiveControlSettings(payload.settings, current));
      setSettingsStatus("saved");
    } catch {
      setSettingsStatus("error");
    }
  }, []);

  const markLoaded = useCallback((scene: DirectorScene) => {
    setLoaded((current) => (current[scene] ? current : { ...current, [scene]: true }));
  }, []);

  return (
    <main
      className="live-director"
      data-active-scene={activeScene}
      data-ready={ready ? "true" : "false"}
      data-switching={switching ? "true" : "false"}
      data-camera-intent={cityInteractions.lensIntent.kind}
      data-camera-storm-id={cityInteractions.lensIntent.kind === "typhoon" ? cityInteractions.lensIntent.stormId : undefined}
    >
      <section
        className="live-director-scene is-active"
        data-scene={activeScene}
      >
        <TyphoonMap
          view="live"
          liveDeck={activeScene}
          cityAttention={cityAttention}
          onCityAttentionAnchor={setCityAttentionAnchor}
          onSceneReady={() => markLoaded(activeScene)}
        />
      </section>

      <DigitalHostWindow
        scene={activeScene}
        visible={hostVisible}
        chatRequest={chatRequest}
        onLiveEvent={handleLiveEvent}
      />
      {/* City reports are broadcast overlays, outside the map scene and side
          rail stacking contexts. */}
      {cityOverlayHost ? createPortal(
        <div className="live-city-overlay">
          <LiveCityInteraction
            interaction={cityInteractions.active}
            anchor={cityAttentionAnchor}
            onAttentionChange={handleCityAttentionChange}
            onComplete={cityInteractions.completeActive}
          />
          <LiveCityTargetLock attention={cityAttention} anchor={cityAttentionAnchor} />
        </div>,
        cityOverlayHost
      ) : null}
      <LiveOperatorControls
        hostVisible={hostVisible}
        onToggleHost={() => setHostVisible((current) => !current)}
        onSendChat={handleRadarChat}
        settings={controlSettings}
        settingsStatus={settingsStatus}
        onSaveSettings={saveControlSettings}
      />

      {ready && controlSettings.sceneRotationEnabled ? (
        <i
          className="live-director-progress"
          key={`${cycle}-${activeScene}-${controlSettings.briefingDurationSeconds}-${controlSettings.analysisDurationSeconds}`}
          style={{
            animationDuration: `${
              (activeScene === "briefing"
                ? controlSettings.briefingDurationSeconds
                : controlSettings.analysisDurationSeconds) * 1_000
            }ms`
          }}
          aria-hidden="true"
        />
      ) : null}
      {switching ? <div className="live-director-sweep" key={`sweep-${cycle}`} aria-hidden="true" /> : null}
      {!ready ? (
        <div className="live-director-preload" role="status">
          <span>LIVE MAP STARTUP</span>
          <strong>直播地图正在就绪</strong>
          <small>{loaded.briefing || loaded.analysis ? "地图已就绪" : "实时场景加载中"}</small>
        </div>
      ) : null}
    </main>
  );
}
