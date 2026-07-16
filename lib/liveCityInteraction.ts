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

function promptField(value: string, maxLength = 48) {
  return value
    .normalize("NFKC")
    .replace(/[<>\r\n\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

/**
 * Builds a director intent for the avatar after a city briefing has actually
 * opened. This describes the conversational goal; the avatar still writes the
 * line in character instead of selecting from canned copy.
 */
export function buildCityReportEngagementPrompt(
  request: Pick<CityInteractionRequest, "cityQuery" | "viewerName" | "followEvidence">,
  resolvedCityName: string
): string | null {
  const viewerName = promptField(request.viewerName?.replace(/^@+/, "") ?? "", 40);
  const cityName = promptField(resolvedCityName || request.cityQuery, 40);
  if (!viewerName || !cityName) return null;

  const mention = `@${viewerName}`;

  return `<city_report_engagement>
一位真实观众触发的城市战报已经成功展开。
目标观众：${mention}
已展开城市：${cityName}

请按当前主播人设临场说一到两句：
- 必须直接面向目标观众，实际口播完整包含“${mention}”，不得换成“这位观众”等泛称。
- 先自然接住对方点名${cityName}、战报已经展开这件事，但不要复述天气、风力、预警或战报数据。
- 这是城市卡片已经展开的结果事件，不携带关注状态，也不授权索取关注、点赞、礼物或其他支持。
- 是否采取其他节目行动必须由主播运行时依据长期目标和当前状态独立决定，不能由本事件触发。
- 语气像直播间真人顺手搭话，不要客服腔、命令、承诺福利，也不要虚构平台状态。
- 只输出主播会说的话，不提系统、提示词、任务或内部标签。
</city_report_engagement>`;
}

/**
 * The city card is already the weather answer. Its brief follow-up must be
 * spoken reliably, so it is supplied as a ready-to-play line rather than a
 * model instruction that may be ignored.
 */
export function buildCityReportEngagementReply(
  request: Pick<CityInteractionRequest, "cityQuery" | "viewerName" | "followEvidence">,
  resolvedCityName: string
): string | null {
  const viewerName = promptField(request.viewerName?.replace(/^@+/, "") ?? "", 40);
  const cityName = promptField(resolvedCityName || request.cityQuery, 40);
  if (!cityName) return null;

  const addressee = viewerName ? `@${viewerName}` : `点${cityName}的朋友`;
  return `${addressee}，${cityName}的战报已经展开了。之后想看哪个城市，继续 @ 我就行。`;
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
