"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from "react";

type DirectorScene = "briefing" | "analysis";

export type HostChatRequest = {
  id: string;
  text: string;
};

type HostHealth = {
  queueDepth?: number;
  isSpeaking?: boolean;
  ttsRateLimitCount?: number;
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
const HOST_WINDOW_MIN_WIDTH = 200;
const HOST_WINDOW_MIN_HEIGHT = 220;
const HOST_WINDOW_PADDING = 8;
const CHAT_RETRY_INTERVAL_MS = 750;
const CHAT_MAX_ATTEMPTS = 8;

type HostWindowBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type HostWindowInteraction = {
  kind: "move" | "resize";
  pointerId: number;
  startX: number;
  startY: number;
  bounds: HostWindowBounds;
};

function constrainHostWindow(bounds: HostWindowBounds): HostWindowBounds {
  const maxWidth = Math.max(HOST_WINDOW_MIN_WIDTH, window.innerWidth - HOST_WINDOW_PADDING * 2);
  const maxHeight = Math.max(HOST_WINDOW_MIN_HEIGHT, window.innerHeight - HOST_WINDOW_PADDING * 2);
  const width = Math.min(maxWidth, Math.max(HOST_WINDOW_MIN_WIDTH, Math.round(bounds.width)));
  const height = Math.min(maxHeight, Math.max(HOST_WINDOW_MIN_HEIGHT, Math.round(bounds.height)));
  return {
    width,
    height,
    left: Math.min(window.innerWidth - width - HOST_WINDOW_PADDING, Math.max(HOST_WINDOW_PADDING, Math.round(bounds.left))),
    top: Math.min(window.innerHeight - height - HOST_WINDOW_PADDING, Math.max(HOST_WINDOW_PADDING, Math.round(bounds.top)))
  };
}

function isHostReady(health: HostHealth | null) {
  return health?.supervisor?.state === "online";
}

export function DigitalHostWindow({
  scene,
  visible = true,
  chatRequest
}: {
  scene: DirectorScene;
  visible?: boolean;
  chatRequest?: HostChatRequest | null;
}) {
  const hostWindowRef = useRef<HTMLElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const sceneRef = useRef(scene);
  const lastNarrationAtRef = useRef(0);
  const chatDeliveryTimerRef = useRef<number | null>(null);
  const pendingChatRef = useRef<{
    id: string;
    text: string;
    attempts: number;
    acknowledged: boolean;
  } | null>(null);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const frameLoadedRef = useRef(false);
  const [hostFrameReady, setHostFrameReady] = useState(false);
  const hostFrameReadyRef = useRef(false);
  const [health, setHealth] = useState<HostHealth | null>(null);
  const [healthFailed, setHealthFailed] = useState(false);
  const [windowBounds, setWindowBounds] = useState<HostWindowBounds | null>(null);
  const [interaction, setInteraction] = useState<HostWindowInteraction | null>(null);
  const hostUrl = process.env.NEXT_PUBLIC_LINGLAN_HOST_URL || DEFAULT_HOST_URL;
  const hostOrigin = useMemo(() => {
    try {
      return new URL(hostUrl).origin;
    } catch {
      return DEFAULT_HOST_URL;
    }
  }, [hostUrl]);
  const iframeUrl = `${hostUrl.replace(/\/$/, "")}/?overlay=1&listener=1&avatar=musetalk`;

  useEffect(() => {
    sceneRef.current = scene;
  }, [scene]);

  useEffect(() => {
    frameLoadedRef.current = frameLoaded;
  }, [frameLoaded]);

  useEffect(() => {
    hostFrameReadyRef.current = hostFrameReady;
  }, [hostFrameReady]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(HOST_WINDOW_STORAGE_KEY);
      if (!stored) return;
      const value = JSON.parse(stored) as Partial<HostWindowBounds>;
      if (
        Number.isFinite(value.left) &&
        Number.isFinite(value.top) &&
        Number.isFinite(value.width) &&
        Number.isFinite(value.height)
      ) {
        setWindowBounds(constrainHostWindow(value as HostWindowBounds));
      }
    } catch {
      // A malformed local preference must never prevent the host from loading.
    }
  }, []);

  useEffect(() => {
    if (!windowBounds) return;
    window.localStorage.setItem(HOST_WINDOW_STORAGE_KEY, JSON.stringify(windowBounds));
  }, [windowBounds]);

  useEffect(() => {
    if (!interaction) return;
    const update = (event: PointerEvent) => {
      if (event.pointerId !== interaction.pointerId) return;
      const deltaX = event.clientX - interaction.startX;
      const deltaY = event.clientY - interaction.startY;
      const next =
        interaction.kind === "move"
          ? {
              ...interaction.bounds,
              left: interaction.bounds.left + deltaX,
              top: interaction.bounds.top + deltaY
            }
          : {
              ...interaction.bounds,
              width: interaction.bounds.width + deltaX,
              height: interaction.bounds.height + deltaY
            };
      setWindowBounds(constrainHostWindow(next));
    };
    const stop = (event: PointerEvent) => {
      if (event.pointerId === interaction.pointerId) setInteraction(null);
    };
    window.addEventListener("pointermove", update);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointermove", update);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [interaction]);

  useEffect(() => {
    const handleHostMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== hostOrigin || event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as { type?: unknown; requestId?: unknown };
      if (data?.type === "linglan:ready") {
        setHostFrameReady(true);
        return;
      }
      if (data?.type !== "linglan:chat-ack") return;
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
    if (!chatRequest?.text.trim()) return;
    if (chatDeliveryTimerRef.current !== null) window.clearInterval(chatDeliveryTimerRef.current);
    pendingChatRef.current = {
      id: chatRequest.id,
      text: chatRequest.text.trim(),
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
        body: JSON.stringify({ requestId: pending.id, text: pending.text })
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

  const beginWindowInteraction = (
    kind: HostWindowInteraction["kind"],
    event: ReactPointerEvent<HTMLElement>
  ) => {
    if (event.button !== 0) return;
    const rect = hostWindowRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    const bounds = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    };
    setWindowBounds(bounds);
    setInteraction({
      kind,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      bounds
    });
  };

  const positionedStyle: CSSProperties | undefined = windowBounds
    ? {
        left: `${windowBounds.left}px`,
        top: `${windowBounds.top}px`,
        width: `${windowBounds.width}px`,
        height: `${windowBounds.height}px`,
        right: "auto",
        bottom: "auto"
      }
    : undefined;

  return (
    <aside
      ref={hostWindowRef}
      className={`digital-host-window ${healthFailed ? "is-offline" : ""} ${visible ? "" : "is-hidden"} ${windowBounds ? "is-positioned" : ""} ${interaction ? "is-interacting" : ""}`}
      aria-label="数字人讲解主播凌岚"
      aria-hidden={!visible}
      style={positionedStyle}
    >
      <header
        className="digital-host-head"
        onPointerDown={(event) => beginWindowInteraction("move", event)}
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
        onPointerDown={(event) => beginWindowInteraction("resize", event)}
      >
        <i aria-hidden="true" />
      </button>
    </aside>
  );
}
