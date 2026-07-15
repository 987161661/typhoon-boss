/**
 * Shared contract for the live-room comment bridge and the radar presentation.
 * Keep parsing and replay protection independent from MapLibre / React so the
 * same semantics can be exercised by a live bridge and the operator simulator.
 */

export const LIVE_CITY_COMMENT_TYPE = "aituber:live-comment";
export const LIVE_VIEWER_RELATION_TYPE = "aituber:viewer-relation";

export type FollowEvidence = "observed" | "unknown";

export interface HostLiveComment {
  type: typeof LIVE_CITY_COMMENT_TYPE;
  version: 1;
  id: string;
  text: string;
  viewerId?: string;
  viewerName?: string;
  platform?: string;
  followEvidence?: FollowEvidence;
  followObservedAt?: number;
  receivedAt: number;
}

export interface HostViewerRelationEvent {
  type: typeof LIVE_VIEWER_RELATION_TYPE;
  version: 1;
  id: string;
  relation: "follow";
  state: "verified";
  viewerId: string;
  viewerName?: string;
  platform: string;
  observedAt: number;
}

export type HostLiveEvent = HostLiveComment | HostViewerRelationEvent;

export interface CityInteractionRequest {
  id: string;
  cityQuery: string;
  viewerId: string | null;
  viewerName: string | null;
  platform: string | null;
  followEvidence: FollowEvidence;
  followObservedAt: number | null;
  receivedAt: number;
}

export interface CityAttention {
  id: string;
  city: string;
  longitude: number;
  latitude: number;
  phase: "flash" | "card";
}

export interface CityAttentionAnchor {
  x: number;
  y: number;
  horizontal: "left" | "right";
  vertical: "up" | "down";
}

export function createLiveCityEventId(prefix = "live-city") {
  const uuid = globalThis.crypto?.randomUUID?.();
  const suffix = uuid ?? Math.random().toString(36).slice(2, 12);
  return `${prefix}-${Date.now()}-${suffix}`;
}

export function viewerIdentityKey(platform: string | null | undefined, viewerId: string | null | undefined) {
  const normalizedPlatform = platform?.trim().toLocaleLowerCase("en-US");
  const normalizedViewerId = viewerId?.trim();
  return normalizedPlatform && normalizedViewerId ? `${normalizedPlatform}:${normalizedViewerId}` : null;
}

const MAX_COMMENT_LENGTH = 500;
// A live mention may include a country prefix and a full province-city path,
// such as @中国北京 or @广东省广州市. Keep administrative suffixes: “市”
// distinguishes a city from a same-name village in the resolver.
const MAX_CITY_LENGTH = 16;
const CHINESE_CITY_MENTION = /@([\u3400-\u9fff]{2,16})(?=$|[\s,，。！？!？、:：;；#])/;

export function isHostLiveComment(value: unknown): value is HostLiveComment {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<HostLiveComment>;
  return (
    candidate.type === LIVE_CITY_COMMENT_TYPE &&
    candidate.version === 1 &&
    typeof candidate.id === "string" &&
    candidate.id.trim().length > 0 &&
    candidate.id.length <= 160 &&
    typeof candidate.text === "string" &&
    candidate.text.trim().length > 0 &&
    candidate.text.length <= MAX_COMMENT_LENGTH &&
    typeof candidate.receivedAt === "number" &&
    Number.isFinite(candidate.receivedAt) &&
    (candidate.followEvidence === undefined || candidate.followEvidence === "observed" || candidate.followEvidence === "unknown") &&
    (candidate.followObservedAt === undefined || (typeof candidate.followObservedAt === "number" && Number.isFinite(candidate.followObservedAt)))
  );
}

export function isHostViewerRelationEvent(value: unknown): value is HostViewerRelationEvent {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<HostViewerRelationEvent>;
  return (
    candidate.type === LIVE_VIEWER_RELATION_TYPE &&
    candidate.version === 1 &&
    typeof candidate.id === "string" &&
    candidate.id.trim().length > 0 &&
    candidate.id.length <= 160 &&
    candidate.relation === "follow" &&
    candidate.state === "verified" &&
    typeof candidate.viewerId === "string" &&
    candidate.viewerId.trim().length > 0 &&
    candidate.viewerId.length <= 160 &&
    typeof candidate.platform === "string" &&
    candidate.platform.trim().length > 0 &&
    candidate.platform.length <= 80 &&
    typeof candidate.observedAt === "number" &&
    Number.isFinite(candidate.observedAt)
  );
}

export function extractChinaCityMention(text: string): string | null {
  const match = text.trim().match(CHINESE_CITY_MENTION);
  if (!match) return null;
  const city = match[1].trim();
  // Without punctuation Chinese chat text has no word boundary. Long mentions
  // must therefore carry a city suffix; otherwise “@杭州今天会不会下雨” would
  // be mistaken for a 9-character place name.
  if (city.length > 6 && !city.endsWith("市")) return null;
  return city.length >= 2 && city.length <= MAX_CITY_LENGTH ? city : null;
}

export function toCityInteractionRequest(comment: HostLiveComment): CityInteractionRequest | null {
  const cityQuery = extractChinaCityMention(comment.text);
  if (!cityQuery) return null;
  return {
    id: comment.id.trim(),
    cityQuery,
    viewerId: optionalText(comment.viewerId, 160),
    viewerName: optionalText(comment.viewerName, 80),
    platform: optionalText(comment.platform, 80),
    followEvidence: comment.followEvidence === "observed" ? "observed" : "unknown",
    followObservedAt:
      comment.followEvidence === "observed" && typeof comment.followObservedAt === "number"
        ? comment.followObservedAt
        : null,
    receivedAt: comment.receivedAt
  };
}

function optionalText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : null;
}
