import {
  HOST_REPLY_READY_TYPE,
  type HostConversationKind,
  type HostReplyReadyEvent
} from "./digitalHostConversation";

type QueueItem = {
  eventId?: unknown;
  text?: unknown;
  source?: unknown;
  viewerId?: unknown;
  viewerName?: unknown;
  status?: unknown;
  preparedReply?: unknown;
  preparedAt?: unknown;
  updatedAt?: unknown;
  doneAt?: unknown;
  testRunId?: unknown;
  roomContext?: {
    samples?: Array<{ viewerId?: unknown; text?: unknown }>;
  };
};

export function queueItemToHostReplyReady(value: unknown): HostReplyReadyEvent | null {
  if (!value || typeof value !== "object") return null;
  const item = value as QueueItem;
  const requestId = cleanString(item.eventId, 160);
  const replyText = cleanString(item.preparedReply, 1_000);
  const source = cleanString(item.source, 120) ?? "";
  const viewerId = cleanString(item.viewerId, 160);
  const viewerName = cleanString(item.viewerName, 80);
  const readyAt = finiteTimestamp(item.doneAt)
    ?? finiteTimestamp(item.updatedAt)
    ?? finiteTimestamp(item.preparedAt);
  if (
    !requestId ||
    !replyText ||
    !readyAt ||
    item.testRunId ||
    (item.status !== "speaking" && item.status !== "done")
  ) {
    return null;
  }

  const kind = conversationKind(source, viewerId, viewerName);
  const sample = item.roomContext?.samples?.find(
    (candidate) => !viewerId || candidate.viewerId === viewerId
  );
  const viewerText = kind === "audience"
    ? cleanString(sample?.text, 500) ?? cleanString(item.text, 500) ?? undefined
    : undefined;

  return {
    type: HOST_REPLY_READY_TYPE,
    version: 1,
    requestId,
    replyText,
    kind,
    viewerName: kind === "audience" ? viewerName ?? undefined : undefined,
    viewerText,
    source: source || undefined,
    readyAt
  };
}

function conversationKind(
  source: string,
  viewerId: string | null,
  viewerName: string | null
): HostConversationKind {
  const isAmbient = source.includes("quiet-room") || source.includes("proactive");
  const isControl =
    viewerId === "radar-operator" ||
    source.includes("operator") ||
    source.includes("web-chat") ||
    source.includes("control-room");
  if (viewerName && !isAmbient && !isControl) return "audience";
  if (isControl) return "control";
  if (isAmbient) return "ambient";
  return "narration";
}

function cleanString(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const normalized = value
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function finiteTimestamp(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}
