"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  isHostLiveComment,
  isHostViewerRelationEvent,
  type HostLiveEvent
} from "@/lib/liveCityInteraction";
import {
  isHostReplyReadyEvent,
  type HostReplyReadyEvent
} from "@/lib/digitalHostConversation";
import { shouldRecoverDigitalHostFrame } from "@/lib/digitalHostFrameRecovery";
import { usePersistentFloatingWindow } from "./usePersistentFloatingWindow";

type DirectorScene = "briefing" | "analysis";

export type HostChatRequest = {
  id: string;
  text: string;
  directReply?: string;
  viewerId?: string;
  viewerName?: string;
};

export type { HostLiveEvent } from "@/lib/liveCityInteraction";

type HostHealth = {
  queueDepth?: number;
  isSpeaking?: boolean;
  ttsRateLimitCount?: number;
  lastEventAt?: number;
  runtimeOwner?: {
    active?: boolean;
  };
  host?: {
    hostPhase?: string;
    activeTurnId?: string;
  };
  supervisor?: {
    state?: string;
    isLive?: boolean;
    onlineCount?: number;
    connectedClients?: number;
  };
};

const DEFAULT_HOST_URL = "http://127.0.0.1:5173";
const HEALTH_POLL_MS = 5_000;
const NARRATION_COOLDOWN_MS = 90_000;
const HOST_WINDOW_STORAGE_KEY = "typhoon-boss-radar:linglan-window";
const CHAT_RETRY_INTERVAL_MS = 750;
const CHAT_MAX_ATTEMPTS = 8;
const REPLY_RELAY_POLL_MS = 500;
const HOST_FRAME_READY_TIMEOUT_MS = 30_000;
const HOST_FRAME_MAX_RECOVERY_ATTEMPTS = 1;
const DEFAULT_RADAR_VIEWER = "001号人类";

function isHostReady(health: HostHealth | null) {
  return health?.supervisor?.state === "online";
}

export function DigitalHostWindow({
  scene,
  visible = true,
  chatRequest,
  onLiveEvent,
  onReplyReady
}: {
  scene: DirectorScene;
  visible?: boolean;
  chatRequest?: HostChatRequest | null;
  onLiveEvent?: (event: HostLiveEvent) => void;
  onReplyReady?: (event: HostReplyReadyEvent) => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const sceneRef = useRef(scene);
  const lastNarrationAtRef = useRef(0);
  const chatDeliveryTimerRef = useRef<number | null>(null);
  const pendingChatRef = useRef<{
    id: string;
    text: string;
    directReply?: string;
    viewerId: string;
    viewerName: string;
    attempts: number;
    acknowledged: boolean;
  } | null>(null);
  const onLiveEventRef = useRef(onLiveEvent);
  const onReplyReadyRef = useRef(onReplyReady);
  const deliveredReplyIdsRef = useRef(new Set<string>());
  const replyRelayInitializedRef = useRef(false);
  const replyRelayStartedAtRef = useRef(Date.now());
  const [frameLoaded, setFrameLoaded] = useState(false);
  const frameLoadedRef = useRef(false);
  const [hostFrameReady, setHostFrameReady] = useState(false);
  const hostFrameReadyRef = useRef(false);
  const hostFrameRecoveryAttemptsRef = useRef(0);
  const lastRuntimeStallRecoveryAtRef = useRef(0);
  const [hostFrameRevision, setHostFrameRevision] = useState(0);
  const [isObsBrowser, setIsObsBrowser] = useState(false);
  const [health, setHealth] = useState<HostHealth | null>(null);
  const [healthFailed, setHealthFailed] = useState(false);
  const floating = usePersistentFloatingWindow({
    storageKey: HOST_WINDOW_STORAGE_KEY,
    minWidth: 200,
    minHeight: 220
  });
  const hostUrl = process.env.NEXT_PUBLIC_LINGLAN_HOST_URL || DEFAULT_HOST_URL;
  const hostOrigin = useMemo(() => {
    try {
      return new URL(hostUrl).origin;
    } catch {
      return DEFAULT_HOST_URL;
    }
  }, [hostUrl]);
  const iframeUrl = isObsBrowser
    ? `${hostUrl.replace(/\/$/, "")}/?overlay=1&listener=1&avatar=musetalk`
    : `${hostUrl.replace(/\/$/, "")}/?overlay=1&listener=0&runtime=preview&avatar=musetalk`;

  useEffect(() => {
    setIsObsBrowser(
      /\bOBS\//i.test(window.navigator.userAgent) ||
        "obsstudio" in window
    );
  }, []);

  useEffect(() => {
    sceneRef.current = scene;
  }, [scene]);

  useEffect(() => {
    onLiveEventRef.current = onLiveEvent;
  }, [onLiveEvent]);

  useEffect(() => {
    onReplyReadyRef.current = onReplyReady;
  }, [onReplyReady]);

  useEffect(() => {
    frameLoadedRef.current = frameLoaded;
  }, [frameLoaded]);

  useEffect(() => {
    hostFrameReadyRef.current = hostFrameReady;
  }, [hostFrameReady]);

  useEffect(() => {
    const handleHostMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== hostOrigin || event.source !== iframeRef.current?.contentWindow) return;
      if (isHostLiveComment(event.data) || isHostViewerRelationEvent(event.data)) {
        onLiveEventRef.current?.(event.data);
        return;
      }
      if (isHostReplyReadyEvent(event.data)) {
        deliveredReplyIdsRef.current.add(event.data.requestId);
        onReplyReadyRef.current?.(event.data);
        return;
      }
      const data = event.data as { type?: unknown; requestId?: unknown };
      if (data?.type === "linglan:ready" || data?.type === "aituber:ready") {
        hostFrameRecoveryAttemptsRef.current = 0;
        setHostFrameReady(true);
        return;
      }
      if (data?.type !== "linglan:chat-ack" && data?.type !== "aituber:chat-ack") return;
      const requestId = String(data.requestId ?? "");
      if (!requestId || requestId !== pendingChatRef.current?.id) return;
      pendingChatRef.current.acknowledged = true;
      void fetch("/api/digital-host/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "delivery_postmessage_ack", requestId, channel: "postmessage" })
      }).catch(() => undefined);
      if (chatDeliveryTimerRef.current !== null) {
        window.clearInterval(chatDeliveryTimerRef.current);
        chatDeliveryTimerRef.current = null;
      }
    };
    window.addEventListener("message", handleHostMessage);
    return () => window.removeEventListener("message", handleHostMessage);
  }, [hostOrigin]);

  useEffect(() => {
    if (
      hostFrameReady ||
      hostFrameRecoveryAttemptsRef.current >= HOST_FRAME_MAX_RECOVERY_ATTEMPTS
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      // A host restart or failed cross-origin navigation can leave the frame
      // at about:blank. Waiting forever here made a full-page refresh the only
      // recovery path. Allow one bounded remount, then leave the stable frame
      // alone so a delayed handshake cannot create a reconnect loop.
      setFrameLoaded(false);
      setHostFrameReady(false);
      hostFrameRecoveryAttemptsRef.current += 1;
      setHostFrameRevision((value) => value + 1);
      void fetch("/api/digital-host/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "host_frame_watchdog_reload",
          channel: "postmessage"
        })
      }).catch(() => undefined);
    }, HOST_FRAME_READY_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [hostFrameReady, hostFrameRevision]);

  useEffect(() => {
    let cancelled = false;
    const refreshReplies = async () => {
      try {
        const response = await fetch("/api/digital-host/replies", {
          cache: "no-store"
        });
        if (!response.ok) return;
        const payload = (await response.json()) as { replies?: unknown[] };
        const initial = !replyRelayInitializedRef.current;
        for (const value of payload.replies ?? []) {
          if (!isHostReplyReadyEvent(value)) continue;
          if (deliveredReplyIdsRef.current.has(value.requestId)) continue;
          deliveredReplyIdsRef.current.add(value.requestId);
          const isCurrentPending = pendingChatRef.current?.id === value.requestId;
          if (!initial || isCurrentPending || value.readyAt >= replyRelayStartedAtRef.current) {
            onReplyReadyRef.current?.(value);
          }
        }
        replyRelayInitializedRef.current = true;
        if (deliveredReplyIdsRef.current.size > 500) {
          deliveredReplyIdsRef.current = new Set(
            Array.from(deliveredReplyIdsRef.current).slice(-250)
          );
        }
      } catch {
        // The iframe bridge remains available while the local relay restarts.
      }
    };
    void refreshReplies();
    const timer = window.setInterval(() => {
      if (!cancelled) void refreshReplies();
    }, REPLY_RELAY_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const now = Date.now();
    if (
      !shouldRecoverDigitalHostFrame({
        isObsBrowser,
        frameReady: hostFrameReady,
        runtimeOwnerActive: health?.runtimeOwner?.active,
        queueDepth: health?.queueDepth,
        hostPhase: health?.host?.hostPhase,
        activeTurnId: health?.host?.activeTurnId,
        lastEventAt: health?.lastEventAt,
        now,
        lastRecoveryAt: lastRuntimeStallRecoveryAtRef.current
      })
    ) {
      return;
    }
    lastRuntimeStallRecoveryAtRef.current = now;
    setFrameLoaded(false);
    setHostFrameReady(false);
    setHostFrameRevision((value) => value + 1);
    void fetch("/api/digital-host/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "host_frame_runtime_stall_reload",
        requestId: health?.host?.activeTurnId,
        channel: "health-watchdog"
      })
    }).catch(() => undefined);
  }, [health, hostFrameReady, isObsBrowser]);

  useEffect(() => {
    if (!chatRequest?.text.trim()) return;
    if (chatDeliveryTimerRef.current !== null) window.clearInterval(chatDeliveryTimerRef.current);
    pendingChatRef.current = {
      id: chatRequest.id,
      text: chatRequest.text.trim(),
      directReply: chatRequest.directReply?.trim(),
      viewerId: chatRequest.viewerId?.trim() || DEFAULT_RADAR_VIEWER,
      viewerName:
        chatRequest.viewerName?.trim() ||
        chatRequest.viewerId?.trim() ||
        DEFAULT_RADAR_VIEWER,
      attempts: 0,
      acknowledged: false
    };

    const deliver = () => {
      const pending = pendingChatRef.current;
      if (!pending || pending.acknowledged) return;
      if (pending.attempts >= CHAT_MAX_ATTEMPTS) {
        if (chatDeliveryTimerRef.current !== null) {
          window.clearInterval(chatDeliveryTimerRef.current);
          chatDeliveryTimerRef.current = null;
        }
        return;
      }
      pending.attempts += 1;
      // Restore the original in-frame delivery path first. It keeps the chat
      // execution in the same browser runtime that historically handled both
      // speech and avatar animation. The HTTP bridge remains a fallback only
      // for an iframe that has not installed its message listener yet.
      iframeRef.current?.contentWindow?.postMessage(
        {
          type: "linglan:chat",
          requestId: pending.id,
          text: pending.text,
          directReply: pending.directReply,
          viewerId: pending.viewerId,
          viewerName: pending.viewerName,
          requestedAt: Date.now()
        },
        hostOrigin
      );
      if (pending.attempts === 1) {
        void fetch("/api/digital-host/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "delivery_postmessage_sent",
            requestId: pending.id,
            channel: "postmessage"
          })
        }).catch(() => undefined);
      }
      if (pending.attempts < 3) return;
      void fetch("/api/digital-host/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: pending.id,
          text: pending.text,
          directReply: pending.directReply,
          viewerId: pending.viewerId,
          viewerName: pending.viewerName
        })
      })
        .then((response) => {
          if (!response.ok || pending.acknowledged) return;
          pending.acknowledged = true;
          if (chatDeliveryTimerRef.current !== null) {
            window.clearInterval(chatDeliveryTimerRef.current);
            chatDeliveryTimerRef.current = null;
          }
        })
        .catch(() => undefined);
    };

    deliver();
    chatDeliveryTimerRef.current = window.setInterval(deliver, CHAT_RETRY_INTERVAL_MS);
    return () => {
      if (chatDeliveryTimerRef.current !== null) {
        window.clearInterval(chatDeliveryTimerRef.current);
        chatDeliveryTimerRef.current = null;
      }
    };
  }, [chatRequest, hostOrigin]);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const response = await fetch("/api/digital-host/health", {
          cache: "no-store"
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const value = (await response.json()) as HostHealth;
        if (!cancelled) {
          setHealth(value);
          setHealthFailed(false);
        }
      } catch {
        if (!cancelled) {
          setHealth(null);
          setHealthFailed(true);
        }
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, HEALTH_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const maybeNarrate = () => {
      const now = Date.now();
      const audiencePresent = Number(health?.supervisor?.onlineCount || 0) > 0;
      const canNarrate =
        frameLoaded &&
        isHostReady(health) &&
        health?.supervisor?.isLive === true &&
        audiencePresent &&
        Number(health?.queueDepth || 0) === 0 &&
        health?.isSpeaking !== true &&
        Number(health?.ttsRateLimitCount || 0) === 0 &&
        now - lastNarrationAtRef.current >= NARRATION_COOLDOWN_MS;
      if (!canNarrate) return;

      iframeRef.current?.contentWindow?.postMessage(
        {
          type: "linglan:narrate",
          scene: sceneRef.current,
          requestedAt: now
        },
        hostOrigin
      );
      lastNarrationAtRef.current = now;
    };
    maybeNarrate();
    const timer = window.setInterval(maybeNarrate, 15_000);
    return () => window.clearInterval(timer);
  }, [frameLoaded, health, hostOrigin]);

  const status = healthFailed
    ? "主播服务未连接"
    : health?.isSpeaking
      ? "正在讲解"
      : health?.supervisor?.isLive
        ? "直播监听中"
        : "待机";

  return (
    <aside
      ref={floating.windowRef}
      className={`digital-host-window ${healthFailed ? "is-offline" : ""} ${visible ? "" : "is-hidden"} ${floating.positioned ? "is-positioned" : ""} ${floating.interacting ? "is-interacting" : ""}`}
      aria-label="数字人讲解主播凌岚"
      aria-hidden={!visible}
      style={floating.positionedStyle}
    >
      <header
        className="digital-host-head"
        onPointerDown={(event) => floating.beginInteraction("move", event)}
        title="拖动调整数字人窗口位置"
      >
        <div>
          <i aria-hidden="true" />
          <span>AI LIVE ANALYST</span>
        </div>
        <strong>{status}</strong>
      </header>
      <div className="digital-host-stage">
        <iframe
          key={`${hostFrameRevision}:${isObsBrowser ? "owner" : "preview"}`}
          ref={iframeRef}
          src={iframeUrl}
          title="凌岚数字人讲解主播"
          allow="autoplay"
          onLoad={() => setFrameLoaded(true)}
        />
        {healthFailed ? (
          <div className="digital-host-fallback" role="status">
            <b>凌岚暂未接入</b>
            <span>请启动数字人联合直播服务</span>
          </div>
        ) : null}
      </div>
      <footer>
        <span>凌岚</span>
        <b>{scene === "analysis" ? "专业数据解读" : "台风态势讲解"}</b>
      </footer>
      <button
        className="digital-host-resize-handle"
        type="button"
        aria-label="拖动调整数字人窗口大小"
        onPointerDown={(event) => floating.beginInteraction("resize", event)}
      >
        <i aria-hidden="true" />
      </button>
    </aside>
  );
}
