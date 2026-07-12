"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TyphoonMap } from "./TyphoonMap";
import { DigitalHostWindow, type HostChatRequest } from "./DigitalHostWindow";
import { LiveOperatorControls } from "./LiveOperatorControls";
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
  const [controlSettings, setControlSettings] = useState(DEFAULT_LIVE_CONTROL_SETTINGS);
  const [settingsStatus, setSettingsStatus] = useState<"loading" | "saved" | "saving" | "error">(
    "loading"
  );
  const transitionTimerRef = useRef<number | null>(null);
  const ready = loaded.briefing && loaded.analysis;

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
    >
      <section
        aria-hidden={activeScene !== "briefing"}
        className={`live-director-scene ${activeScene === "briefing" ? "is-active" : "is-inactive"}`}
        data-scene="briefing"
      >
        <TyphoonMap
          view="live"
          liveDeck="briefing"
          onSceneReady={() => markLoaded("briefing")}
        />
      </section>
      <section
        aria-hidden={activeScene !== "analysis"}
        className={`live-director-scene ${activeScene === "analysis" ? "is-active" : "is-inactive"}`}
        data-scene="analysis"
      >
        <TyphoonMap
          view="live"
          liveDeck="analysis"
          onSceneReady={() => markLoaded("analysis")}
        />
      </section>

      <DigitalHostWindow scene={activeScene} visible={hostVisible} chatRequest={chatRequest} />
      <LiveOperatorControls
        hostVisible={hostVisible}
        onToggleHost={() => setHostVisible((current) => !current)}
        onSendChat={(text) =>
          setChatRequest({ id: `${Date.now()}-${crypto.randomUUID()}`, text })
        }
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
          <span>DUAL SCENE PRELOAD</span>
          <strong>双场景正在预热</strong>
          <small>{loaded.briefing ? "态势就绪" : "态势加载中"} · {loaded.analysis ? "专业就绪" : "专业加载中"}</small>
        </div>
      ) : null}
    </main>
  );
}
