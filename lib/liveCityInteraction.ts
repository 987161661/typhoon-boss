/**
 * Shared contract for the live-room comment bridge and the radar presentation.
 * Keep parsing and replay protection independent from MapLibre / React so the
 * same semantics can be exercised by a live bridge and the operator simulator.
 */

export const LIVE_CITY_COMMENT_TYPE = "aituber:live-comment";

export interface HostLiveComment {
  type: typeof LIVE_CITY_COMMENT_TYPE;
  version: 1;
  id: string;
  text: string;
  viewerId?: string;
  viewerName?: string;
  platform?: string;
  receivedAt: number;
}

export interface CityInteractionRequest {
  id: string;
  cityQuery: string;
  viewerName: string | null;
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

const MAX_COMMENT_LENGTH = 500;
const MAX_CITY_LENGTH = 6;
const CHINESE_CITY_MENTION = /@([\u3400-\u9fff]{2,6})(?=$|[\s,，。！？!？、:：;；#])/;

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
    Number.isFinite(candidate.receivedAt)
  );
}

export function extractChinaCityMention(text: string): string | null {
  const match = text.trim().match(CHINESE_CITY_MENTION);
  if (!match) return null;
  const city = match[1].replace(/(市|区|县)$/, "").trim();
  return city.length >= 2 && city.length <= MAX_CITY_LENGTH ? city : null;
}

export function toCityInteractionRequest(comment: HostLiveComment): CityInteractionRequest | null {
  const cityQuery = extractChinaCityMention(comment.text);
  if (!cityQuery) return null;
  return {
    id: comment.id.trim(),
    cityQuery,
    viewerName: optionalText(comment.viewerName, 80),
    receivedAt: comment.receivedAt
  };
}

function optionalText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : null;
}
