"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CornerDownRight, MessageSquareText, Radio, UserRound } from "lucide-react";
import {
  activeConversations,
  conversationReplyTarget,
  conversationKindLabel,
  HOST_REPLY_INITIAL_REVEAL_DELAY_MS,
  hostReplyRevealDelayMs,
  MAX_VISIBLE_CONVERSATIONS,
  splitHostReplyText,
  type HostConversationEntry
} from "@/lib/digitalHostConversation";
import { usePersistentFloatingWindow } from "./usePersistentFloatingWindow";

const CONVERSATION_WINDOW_STORAGE_KEY = "typhoon-boss-radar:linglan-conversation-window";

export function DigitalHostConversationPanel({
  entries,
  visible
}: {
  entries: readonly HostConversationEntry[];
  visible: boolean;
}) {
  const floating = usePersistentFloatingWindow({
    storageKey: CONVERSATION_WINDOW_STORAGE_KEY,
    minWidth: 420,
    minHeight: 320
  });
  const [now, setNow] = useState(() => Date.now());
  const streamRef = useRef<HTMLDivElement | null>(null);
  const visibleEntries = activeConversations(entries, now);
  const latest = visibleEntries.at(-1) ?? null;
  const keepLatestVisible = useCallback(() => {
    const stream = streamRef.current;
    if (stream) stream.scrollTop = stream.scrollHeight;
  }, []);

  useEffect(() => {
    setNow(Date.now());
    const stream = streamRef.current;
    if (!stream) return;
    const frame = window.requestAnimationFrame(() => {
      stream.scrollTo({ top: stream.scrollHeight, behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [entries]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <aside
      ref={floating.windowRef}
      className={`digital-host-conversation ${visible ? "" : "is-hidden"} ${floating.positioned ? "is-positioned" : ""} ${floating.interacting ? "is-interacting" : ""}`}
      style={floating.positionedStyle}
      aria-label="凌岚数字人交互记录"
      aria-hidden={!visible}
    >
      <header
        className="digital-conversation-head"
        onPointerDown={(event) => floating.beginInteraction("move", event)}
        title="拖动调整聊天板位置"
      >
        <div><MessageSquareText aria-hidden="true" /><span>LINGLAN COMMS</span><strong>通联记录</strong></div>
        <b className={latest?.status === "ready" ? "is-ready" : ""}>
          <i aria-hidden="true" />
          {latest?.status === "ready" ? "待播文本就绪" : "监听中"}
        </b>
      </header>

      <div
        ref={streamRef}
        className="digital-conversation-stream"
        aria-live="polite"
        aria-atomic="false"
      >
        {visibleEntries.length ? visibleEntries.map((entry) => {
          const replyTarget = conversationReplyTarget(entry);
          return (
          <article
            key={entry.id}
            className={`digital-conversation-turn is-${entry.kind} is-${entry.status}`}
          >
            <div className="digital-conversation-channel">
              <span>{conversationKindLabel(entry.kind)}</span>
              <time>{formatClock(entry.updatedAt)}</time>
            </div>
            {entry.kind === "audience" && entry.viewerText ? (
              <p className="digital-conversation-viewer">
                <UserRound aria-hidden="true" />
                <span>@{entry.viewerName || "观众"}：</span>
                <strong>{entry.viewerText}</strong>
              </p>
            ) : null}
            {replyTarget ? (
              <div className="digital-conversation-reply-target">
                <CornerDownRight aria-hidden="true" />
                <span>回复</span>
                <strong>@{replyTarget}</strong>
              </div>
            ) : null}
            <p className="digital-conversation-host">
              <Radio aria-hidden="true" />
              <span>凌岚：</span>
              {entry.replyText
                ? (
                  <ProgressiveHostReply
                    key={`${entry.id}:${entry.updatedAt}`}
                    text={entry.replyText}
                    onReveal={keepLatestVisible}
                  />
                )
                : <em><i aria-hidden="true" />正在生成回复</em>}
            </p>
          </article>
          );
        }) : (
          <div className="digital-conversation-empty">
            <MessageSquareText aria-hidden="true" />
            <strong>等待下一次通联</strong>
            <span>观众问答与凌岚口播会在发声前显示于此</span>
          </div>
        )}
      </div>

      <footer>
        <span>LIVE WINDOW · {visibleEntries.length}/{MAX_VISIBLE_CONVERSATIONS}</span>
        <b>旧消息自动退场 · 新消息置底</b>
      </footer>
      <button
        className="digital-conversation-resize"
        type="button"
        aria-label="拖动调整聊天板大小"
        onPointerDown={(event) => floating.beginInteraction("resize", event)}
      >
        <i aria-hidden="true" />
      </button>
    </aside>
  );
}

function ProgressiveHostReply({
  text,
  onReveal
}: {
  text: string;
  onReveal: () => void;
}) {
  const characters = useMemo(() => splitHostReplyText(text), [text]);
  const [visibleCount, setVisibleCount] = useState(0);
  const revealing = visibleCount < characters.length;

  useEffect(() => {
    if (!characters.length) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVisibleCount(characters.length);
      onReveal();
      return;
    }

    let nextIndex = 0;
    let timer = window.setTimeout(revealNext, HOST_REPLY_INITIAL_REVEAL_DELAY_MS);

    function revealNext() {
      nextIndex += 1;
      setVisibleCount(nextIndex);
      onReveal();
      if (nextIndex >= characters.length) return;
      timer = window.setTimeout(
        revealNext,
        hostReplyRevealDelayMs(characters[nextIndex - 1] ?? "")
      );
    }

    return () => window.clearTimeout(timer);
  }, [characters, onReveal]);

  return (
    <strong
      className={revealing ? "is-revealing" : undefined}
      aria-label={text}
    >
      <span aria-hidden="true">{characters.slice(0, visibleCount).join("")}</span>
    </strong>
  );
}

function formatClock(value: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date(value));
}
