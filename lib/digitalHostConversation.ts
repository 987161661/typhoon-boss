export const HOST_REPLY_READY_TYPE = "linglan:reply-ready";

export type HostConversationKind = "audience" | "control" | "ambient" | "narration";

export interface HostReplyReadyEvent {
  type: typeof HOST_REPLY_READY_TYPE;
  version: 1;
  requestId: string;
  replyText: string;
  kind: HostConversationKind;
  viewerName?: string;
  viewerText?: string;
  source?: string;
  readyAt: number;
}

export interface HostConversationEntry {
  id: string;
  kind: HostConversationKind;
  viewerName: string | null;
  viewerText: string | null;
  replyText: string | null;
  status: "waiting" | "ready";
  updatedAt: number;
}

const MAX_CONVERSATIONS = 8;
export const READY_CONVERSATION_RETENTION_MS = 45_000;
export const WAITING_CONVERSATION_RETENTION_MS = 90_000;
export const MAX_VISIBLE_CONVERSATIONS = 4;
export const HOST_REPLY_INITIAL_REVEAL_DELAY_MS = 180;

const SENTENCE_END = /[。！？!?…]/u;
const CLAUSE_BREAK = /[，、；：,;:]/u;
const ASCII_WORD_CHARACTER = /[A-Za-z0-9]/u;

export function isHostReplyReadyEvent(value: unknown): value is HostReplyReadyEvent {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<HostReplyReadyEvent>;
  return (
    candidate.type === HOST_REPLY_READY_TYPE &&
    candidate.version === 1 &&
    typeof candidate.requestId === "string" &&
    candidate.requestId.trim().length > 0 &&
    candidate.requestId.length <= 160 &&
    typeof candidate.replyText === "string" &&
    candidate.replyText.trim().length > 0 &&
    candidate.replyText.length <= 1_000 &&
    (
      candidate.viewerText === undefined ||
      (
        typeof candidate.viewerText === "string" &&
        candidate.viewerText.trim().length > 0 &&
        candidate.viewerText.length <= 500
      )
    ) &&
    isConversationKind(candidate.kind) &&
    typeof candidate.readyAt === "number" &&
    Number.isFinite(candidate.readyAt)
  );
}

export function recordConversationPrompt(
  entries: readonly HostConversationEntry[],
  prompt: {
    id: string;
    kind?: HostConversationKind;
    viewerName?: string | null;
    viewerText: string;
    at?: number;
  }
) {
  const existing = entries.find((entry) => entry.id === prompt.id);
  const viewerName = cleanText(prompt.viewerName, 80);
  const next: HostConversationEntry = {
    id: prompt.id,
    kind: prompt.kind ?? "audience",
    viewerName,
    viewerText: cleanAudienceText(prompt.viewerText, viewerName),
    replyText: existing?.replyText ?? null,
    status: existing?.replyText ? "ready" : "waiting",
    updatedAt: prompt.at ?? Date.now()
  };
  return appendBounded(entries, next);
}

export function recordConversationReply(
  entries: readonly HostConversationEntry[],
  event: HostReplyReadyEvent
) {
  const existing = entries.find((entry) => entry.id === event.requestId)
    ?? correlateAudiencePrompt(entries, event);
  const viewerName = event.kind === "audience"
    ? cleanText(event.viewerName, 80) ?? existing?.viewerName ?? null
    : null;
  const next: HostConversationEntry = {
    id: event.requestId,
    kind: event.kind,
    viewerName,
    viewerText: event.kind === "audience"
      ? cleanAudienceText(existing?.viewerText ?? event.viewerText, viewerName)
      : null,
    replyText: cleanText(event.replyText, 1_000),
    status: "ready",
    updatedAt: event.readyAt
  };
  return appendBounded(
    entries,
    next,
    existing?.id !== event.requestId ? existing?.id : undefined
  );
}

export function conversationKindLabel(kind: HostConversationKind) {
  if (kind === "control") return "控场对话";
  if (kind === "ambient") return "静息播报";
  if (kind === "narration") return "态势讲解";
  return "观众互动";
}

export function activeConversations(
  entries: readonly HostConversationEntry[],
  now = Date.now()
) {
  return entries
    .filter((entry) => {
      const retention = entry.status === "waiting"
        ? WAITING_CONVERSATION_RETENTION_MS
        : READY_CONVERSATION_RETENTION_MS;
      return now - entry.updatedAt < retention;
    })
    .map((entry) => entry.kind === "audience" && entry.viewerText
      ? { ...entry, viewerText: cleanAudienceText(entry.viewerText, entry.viewerName) }
      : entry)
    .slice(-MAX_VISIBLE_CONVERSATIONS);
}

export function conversationReplyTarget(entry: HostConversationEntry) {
  if (entry.kind !== "audience") return null;
  return cleanText(entry.viewerName, 80) ?? "观众";
}

export function splitHostReplyText(text: string) {
  return Array.from(text);
}

export function hostReplyRevealDelayMs(character: string) {
  if (SENTENCE_END.test(character)) return 420;
  if (CLAUSE_BREAK.test(character)) return 280;
  if (/\s/u.test(character)) return 70;
  if (ASCII_WORD_CHARACTER.test(character)) return 75;
  return 175;
}

function correlateAudiencePrompt(
  entries: readonly HostConversationEntry[],
  event: HostReplyReadyEvent
) {
  if (event.kind !== "audience") return undefined;
  const waiting = entries.filter(
    (entry) =>
      entry.kind === "audience" &&
      entry.status === "waiting" &&
      entry.viewerText &&
      event.readyAt - entry.updatedAt < WAITING_CONVERSATION_RETENTION_MS
  );
  const viewerName = cleanText(event.viewerName, 80);
  if (viewerName) {
    const sameViewer = waiting.find((entry) => entry.viewerName === viewerName);
    if (sameViewer) return sameViewer;
  }
  // The host speaks audience turns in queue order. This preserves the original
  // comment when an upstream bridge assigns a new id to the spoken reply.
  return waiting[0];
}

function appendBounded(
  entries: readonly HostConversationEntry[],
  next: HostConversationEntry,
  replacedId?: string
) {
  return [
    ...entries.filter((entry) => entry.id !== next.id && entry.id !== replacedId),
    next
  ].slice(-MAX_CONVERSATIONS);
}

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function cleanAudienceText(value: unknown, viewerName: string | null) {
  const text = cleanText(value, 500);
  if (!text || !viewerName) return text;
  const escapedViewerName = viewerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const internalLabel = new RegExp(
    `^(?:@\\s*${escapedViewerName}\\s*[：:]|(?:观众\\s*)?${escapedViewerName}\\s*(?:的\\s*)?弹幕\\s*[：:])\\s*`,
    "u"
  );
  return cleanText(text.replace(internalLabel, ""), 500);
}

function isConversationKind(value: unknown): value is HostConversationKind {
  return value === "audience" || value === "control" || value === "ambient" || value === "narration";
}
