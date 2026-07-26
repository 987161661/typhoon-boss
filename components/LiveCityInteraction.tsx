"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { LoaderCircle } from "lucide-react";
import type { CityBriefing } from "@/lib/cityBriefingData";
import type { CityAttention, CityAttentionAnchor, CityInteractionRequest } from "@/lib/liveCityInteraction";
import {
  buildCityPanelsModel,
  type CityArchiveStatus,
  type CityPanelAccessSource
} from "@/lib/cityPanelsPresentation";
import { acceptanceScenarioFromLocation, withAcceptanceScenario } from "@/lib/acceptanceScenario";
import { CityPanelGroup } from "./CityPanelGroup";
import { CityLiveBroadcastGroup } from "./CityLiveBroadcastGroup";
import {
  playLiveCityBroadcastCue,
  type LiveCityBroadcastEffects
} from "@/lib/liveCityBroadcastAudio";
import { fetchCityBriefingWithRetry } from "@/lib/cityBriefingClient";
import styles from "./LiveCityInteraction.module.css";

const FLASH_DURATION_MS = 1_000;
// Battle opens first; the factual deck starts one second later and gets time
// to complete its calibration sweep before the copy begins typing.
const PANEL_DEPLOY_DURATION_MS = 3_180;
const BROADCAST_FLASH_DURATION_MS = 550;
const BROADCAST_PANEL_DEPLOY_DURATION_MS = 2_450;
const CARD_DURATION_MS = 30_000;
const DEFAULT_BROADCAST_EFFECTS: LiveCityBroadcastEffects = { enabled: false, volume: "standard" };
// City panels are the live interaction stage, not a small HUD widget. Keep a
// narrow viewport gutter and let the layout resolver avoid the city core;
// broad global insets previously crushed both panels at 720p/768p.
const CITY_SAFE_INSETS = { top: 20, right: 16, bottom: 20, left: 16 } as const;

type Presentation =
  | { state: "idle" }
  | { state: "loading"; request: CityInteractionRequest }
  | { state: "acquiring"; request: CityInteractionRequest; cityName: string }
  | { state: "flash"; request: CityInteractionRequest; briefing: CityBriefing }
  | { state: "deploy"; request: CityInteractionRequest; briefing: CityBriefing }
  | { state: "card"; request: CityInteractionRequest; briefing: CityBriefing }
  | { state: "error"; request: CityInteractionRequest; message: string };

type ArchiveState = {
  status: CityArchiveStatus;
  code?: string;
  fragment?: string;
  statusText?: string;
};

type ArchiveClaimResponse = {
  status: "revealed" | "syncing" | "sealed";
  fragment?: string;
  archiveCode: string;
  error?: string;
};

export function LiveCityInteraction({
  interaction,
  anchor,
  presentationMode = "full",
  broadcastEffects = DEFAULT_BROADCAST_EFFECTS,
  onAttentionChange,
  onBriefingReady,
  onComplete
}: {
  interaction: CityInteractionRequest | null;
  anchor: CityAttentionAnchor | null;
  presentationMode?: "full" | "broadcast";
  broadcastEffects?: LiveCityBroadcastEffects;
  onAttentionChange: (attention: CityAttention | null) => void;
  onBriefingReady?: (request: CityInteractionRequest, briefing: CityBriefing) => void;
  onComplete: (id: string) => void;
}) {
  const [presentation, setPresentation] = useState<Presentation>({ state: "idle" });
  const [accessSource, setAccessSource] = useState<CityPanelAccessSource>("unknown");
  const [archive, setArchive] = useState<ArchiveState>({ status: "locked" });
  const archiveClaimKeyRef = useRef<string | null>(null);
  const previousInteractionIdRef = useRef<string | null>(null);
  const interactionRef = useRef(interaction);
  interactionRef.current = interaction;
  const interactionId = interaction?.id ?? null;
  const cityQuery = interaction?.cityQuery ?? null;

  useEffect(() => {
    const isNewRequest = previousInteractionIdRef.current !== interactionId;
    previousInteractionIdRef.current = interactionId;
    if (isNewRequest) {
      archiveClaimKeyRef.current = null;
      setAccessSource(interaction?.followEvidence === "observed" ? "observed" : "unknown");
      setArchive({ status: interaction?.followEvidence === "observed" ? "unlocking" : "locked" });
      return;
    }
    if (interaction?.followEvidence === "observed") setAccessSource("observed");
  }, [interaction?.followEvidence, interactionId]);

  useEffect(() => {
    if (!interactionId || !interaction?.platform || !interaction.viewerId || interaction.followEvidence === "observed") return;
    const controller = new AbortController();
    const query = new URLSearchParams({ platform: interaction.platform, viewerId: interaction.viewerId });
    void fetch(`/api/city-audience-access?${query}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<{ source?: CityPanelAccessSource }>;
      })
      .then((result) => {
        if (result.source === "whitelist") setAccessSource("whitelist");
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [interaction?.followEvidence, interaction?.platform, interaction?.viewerId, interactionId]);

  useEffect(() => {
    const request = interactionRef.current;
    if (!interactionId || !cityQuery || !request) {
      setPresentation({ state: "idle" });
      onAttentionChange(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    let phaseTimer: number | null = null;
    let deployTimer: number | null = null;
    let closeTimer: number | null = null;
    let attentionStartedAt = 0;
    let attention: Omit<CityAttention, "phase"> | null = null;
    const flashDuration = presentationMode === "broadcast"
      ? BROADCAST_FLASH_DURATION_MS
      : FLASH_DURATION_MS;
    const deployDuration = presentationMode === "broadcast"
      ? BROADCAST_PANEL_DEPLOY_DURATION_MS
      : PANEL_DEPLOY_DURATION_MS;
    const acceptanceScenario = acceptanceScenarioFromLocation();
    const cityBriefingUrl = withAcceptanceScenario(`/api/city-briefing?city=${encodeURIComponent(cityQuery)}`, acceptanceScenario);

    setPresentation({ state: "loading", request });
    onAttentionChange(null);

    const startAttention = (next: Omit<CityAttention, "phase">) => {
      if (attentionStartedAt) return;
      attention = next;
      attentionStartedAt = Date.now();
      onAttentionChange({ ...next, phase: "flash" });
    };

    void fetch(`${cityBriefingUrl}&stage=location`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<CityBriefing["city"]>;
      })
      .then((city) => {
        if (cancelled) return;
        startAttention({ id: request.id, city: city.name, longitude: city.longitude, latitude: city.latitude });
        setPresentation((current) => current.state === "loading"
          ? { state: "acquiring", request, cityName: city.name }
          : current);
      })
      .catch(() => undefined);

    void fetchCityBriefingWithRetry<CityBriefing>(cityBriefingUrl, {
      signal: controller.signal,
      maxAttempts: 4,
      // A degraded response can still contain verified current observations.
      // Keep retrying it while the upstream sources recover.
      shouldRetryResult: (briefing) => briefing.status === "unavailable"
    })
      .then((briefing) => {
        if (cancelled) return;
        startAttention({ id: request.id, city: briefing.city.name, longitude: briefing.city.longitude, latitude: briefing.city.latitude });
        const attentionBase = attention ?? { id: request.id, city: briefing.city.name, longitude: briefing.city.longitude, latitude: briefing.city.latitude };
        onBriefingReady?.(request, briefing);
        if (
          presentationMode === "broadcast" &&
          !window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ) {
          playLiveCityBroadcastCue("lock", broadcastEffects);
        }
        setPresentation({ state: "flash", request, briefing });
        onAttentionChange({ ...attentionBase, phase: "flash" });
        const decodeDelay = Math.max(160, flashDuration - (Date.now() - attentionStartedAt));
        phaseTimer = window.setTimeout(() => {
          if (cancelled) return;
          setPresentation({ state: "deploy", request, briefing });
          onAttentionChange({ ...attentionBase, phase: "card" });
        }, decodeDelay);
        deployTimer = window.setTimeout(() => {
          if (!cancelled) setPresentation({ state: "card", request, briefing });
        }, decodeDelay + deployDuration);
        closeTimer = window.setTimeout(() => {
          if (!cancelled) onComplete(request.id);
        }, flashDuration + CARD_DURATION_MS);
      })
      .catch((error) => {
        if (cancelled || controller.signal.aborted) return;
        setPresentation({ state: "error", request, message: error instanceof Error ? error.message : "城市数据暂时不可用" });
        closeTimer = window.setTimeout(() => onComplete(request.id), 3_000);
      });

    return () => {
      cancelled = true;
      controller.abort();
      if (phaseTimer !== null) window.clearTimeout(phaseTimer);
      if (deployTimer !== null) window.clearTimeout(deployTimer);
      if (closeTimer !== null) window.clearTimeout(closeTimer);
    };
  }, [broadcastEffects, cityQuery, interactionId, onAttentionChange, onBriefingReady, onComplete, presentationMode]);

  const briefing = presentation.state === "flash" || presentation.state === "deploy" || presentation.state === "card"
    ? presentation.briefing
    : null;

  useEffect(() => {
    if (!briefing || !interactionId || accessSource === "unknown" || !interaction?.platform || !interaction.viewerId) return;
    const claimKey = `${interactionId}|${interaction.platform.trim().toLowerCase()}|${interaction.viewerId.trim()}|${accessSource}`;
    if (archiveClaimKeyRef.current === claimKey) return;
    archiveClaimKeyRef.current = claimKey;
    const controller = new AbortController();
    setArchive((current) => current.status === "locked" ? { status: "unlocking", code: current.code } : current);
    void fetch("/api/world-fragments/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId: interactionId,
        cityKey: briefing.city.cityCode ?? briefing.city.name,
        platform: interaction.platform,
        viewerId: interaction.viewerId,
        accessSource
      }),
      signal: controller.signal
    })
      .then(async (response) => {
        const result = await response.json() as ArchiveClaimResponse;
        if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
        return result;
      })
      .then((result) => {
        if (result.status === "revealed" && result.fragment) {
          setArchive({ status: "unlocked", code: result.archiveCode, fragment: result.fragment });
          return;
        }
        setArchive({ status: "unavailable", code: result.archiveCode, statusText: "观测员权限已确认，本次暂无可展示档案" });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setArchive({ status: "unavailable", statusText: "观测员权限已确认，本次暂无可展示档案" });
      });
    return () => controller.abort();
  }, [accessSource, briefing, interaction?.platform, interaction?.viewerId, interactionId]);

  const panelsModel = useMemo(() => {
    if (!briefing || (presentation.state !== "deploy" && presentation.state !== "card")) return null;
    return buildCityPanelsModel({
      briefing,
      audience: {
        requestId: interactionId ?? presentation.request.id,
        viewerName: interaction?.viewerName ?? presentation.request.viewerName,
        viewerId: interaction?.viewerId ?? presentation.request.viewerId,
        platform: interaction?.platform ?? presentation.request.platform,
        accessSource
      },
      archive
    });
  }, [accessSource, archive, briefing, interaction?.platform, interaction?.viewerId, interaction?.viewerName, interactionId, presentation]);

  if (presentation.state === "idle") return null;
  if (presentation.state === "loading") return <CityAcquisitionStatus city={presentation.request.cityQuery} detail="正在接入城市坐标" anchor={anchor} loading />;
  if (presentation.state === "acquiring") return <CityAcquisitionStatus city={presentation.cityName} detail="坐标锁定，正在回收战区资料" anchor={anchor} />;
  if (presentation.state === "error") return <CityAcquisitionStatus city={presentation.request.cityQuery} detail={presentation.message} anchor={anchor} error />;
  if (presentation.state === "flash") return <CityAcquisitionStatus city={presentation.briefing.city.name} detail="双相链路校准中" anchor={anchor} />;

  if (!panelsModel || !briefing) return null;
  if (presentationMode === "broadcast") {
    return (
      <CityLiveBroadcastGroup
        phase={presentation.state}
        anchor={anchor ? { x: anchor.x, y: anchor.y } : null}
        briefing={briefing}
        model={panelsModel}
        effects={broadcastEffects}
        onClose={() => onComplete(presentation.request.id)}
      />
    );
  }
  return (
    <CityPanelGroup
      phase={presentation.state}
      anchor={anchor ? { x: anchor.x, y: anchor.y } : null}
      briefing={briefing}
      model={panelsModel}
      onClose={() => onComplete(presentation.request.id)}
      safeInsets={CITY_SAFE_INSETS}
    />
  );
}

function CityAcquisitionStatus({ city, detail, anchor, loading = false, error = false }: {
  city: string;
  detail: string;
  anchor: CityAttentionAnchor | null;
  loading?: boolean;
  error?: boolean;
}) {
  const style = anchor ? ({ "--acquire-x": `${anchor.x}px`, "--acquire-y": `${anchor.y}px` } as CSSProperties) : undefined;
  return (
    <aside className={styles.acquisition} style={style} data-anchored={anchor ? "true" : "false"} data-error={error ? "true" : "false"} role="status" aria-live="polite">
      <div className={styles.acquireLine} aria-hidden="true" />
      {loading && <LoaderCircle aria-hidden="true" />}
      <div><span>DUAL CHANNEL // CITY LOCK</span><strong>{city}</strong><b>{detail}</b></div>
    </aside>
  );
}
