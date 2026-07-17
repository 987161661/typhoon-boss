"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TyphoonMap } from "./TyphoonMap";
import { DigitalHostWindow, type HostChatRequest } from "./DigitalHostWindow";
import { LiveOperatorControls } from "./LiveOperatorControls";
import { LiveCityInteraction } from "./LiveCityInteraction";
import { LiveCityTargetLock } from "./LiveCityTargetLock";
import { useLiveCityInteractionQueue } from "./useLiveCityInteractionQueue";
import { useNationalSituation } from "./useNationalSituation";
import type { CityBriefing } from "@/lib/cityBriefingData";
import {
  buildCityReportEngagementPrompt,
  createLiveCityEventId,
  isHostLiveComment,
  type CityAttention,
  type CityAttentionAnchor,
  type CityInteractionRequest,
  type HostLiveEvent
} from "@/lib/liveCityInteraction";
import {
  DEFAULT_LIVE_CONTROL_SETTINGS,
  normalizeLiveControlSettings,
  type LiveControlSettings
} from "@/lib/liveControlSettings";
import { primeLiveCityBroadcastAudio } from "@/lib/liveCityBroadcastAudio";

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
  const cityEngagementIdsRef = useRef(new Set<string>());
  const ready = loaded.briefing || loaded.analysis;
  const broadcastEffects = useMemo(() => ({
    enabled: controlSettings.cityReportEffectsEnabled,
    volume: controlSettings.cityReportEffectsVolume
  }), [controlSettings.cityReportEffectsEnabled, controlSettings.cityReportEffectsVolume]);
  const nationalSituation = useNationalSituation();
  const cityInteractions = useLiveCityInteractionQueue({
    highestOfficialWarningLevel: nationalSituation.snapshot?.warnings.highestLevel ?? null,
    focusedStormId: nationalSituation.snapshot?.storms[0]?.id ?? null
  });
  const submitCityInteractionEvent = cityInteractions.submitEvent;

  useEffect(() => {
    setCityOverlayHost(document.body);
  }, []);

  useEffect(() => {
    const prime = () => primeLiveCityBroadcastAudio();
    window.addEventListener("pointerdown", prime, { once: true });
    window.addEventListener("keydown", prime, { once: true });
    return () => {
      window.removeEventListener("pointerdown", prime);
      window.removeEventListener("keydown", prime);
    };
  }, []);

  const handleLiveEvent = useCallback((event: HostLiveEvent) => {
    submitCityInteractionEvent(event);
  }, [submitCityInteractionEvent]);

  useEffect(() => {
    let cancelled = false;
    let after: number | null = null;
    const consumeGatewayEvents = async () => {
      try {
        const response = await fetch(
          `/api/live-city-events?after=${after === null ? "latest" : after}`,
          { cache: "no-store" }
        );
        if (!response.ok) return;
        const payload = (await response.json()) as {
          events?: Array<{ sequence?: unknown; event?: unknown }>;
          latestSequence?: unknown;
        };
        if (after === null) {
          after = typeof payload.latestSequence === "number" ? payload.latestSequence : 0;
          return;
        }
        if (typeof payload.latestSequence === "number" && payload.latestSequence < after) {
          // The relay process restarted and began a new sequence. Align to the
          // new head without replaying anything that accumulated during boot.
          after = payload.latestSequence;
          return;
        }
        for (const item of payload.events || []) {
          if (typeof item.sequence !== "number") continue;
          after = Math.max(after, item.sequence);
          if (isHostLiveComment(item.event)) submitCityInteractionEvent(item.event);
        }
      } catch {
        // The local gateway may restart independently of the radar page.
      }
    };
    void consumeGatewayEvents();
    const timer = window.setInterval(() => {
      if (!cancelled) void consumeGatewayEvents();
    }, 500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [submitCityInteractionEvent]);

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
    // The city card is visual first. Its short engagement line is emitted
    // only after the matching card is actually ready.
    if (handledAsCity) return "city";
    setChatRequest({ id, text });
    return "host";
  }, [cityInteractions]);

  const handleCityAttentionChange = useCallback((attention: CityAttention | null) => {
    setCityAttention(attention);
  }, []);

  const handleCityBriefingReady = useCallback((request: CityInteractionRequest, briefing: CityBriefing) => {
    if (cityEngagementIdsRef.current.has(request.id)) return;
    const eventPrompt = buildCityReportEngagementPrompt(request, briefing);
    if (!eventPrompt) return;

    cityEngagementIdsRef.current.add(request.id);
    // Keep the runtime dedupe set bounded during long broadcasts.
    if (cityEngagementIdsRef.current.size > 256) {
      const oldestId = cityEngagementIdsRef.current.values().next().value;
      if (oldestId) cityEngagementIdsRef.current.delete(oldestId);
    }
    setChatRequest({
      id: `city-engagement:${request.id}`,
      // Keep the fallback payload safe too: it must be a final host line, not
      // a long instruction that a model could reinterpret as a new topic.
      text: eventPrompt,
      viewerId: request.viewerId ?? undefined,
      viewerName: request.viewerName ?? undefined
    });
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
      data-city-broadcast-active={cityAttention ? "true" : "false"}
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
          cityAttentionLayout="broadcast-corridor"
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
            presentationMode="broadcast"
            broadcastEffects={broadcastEffects}
            onAttentionChange={handleCityAttentionChange}
            onBriefingReady={handleCityBriefingReady}
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
