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

export interface CityHostWeatherBriefing {
  city: { name: string };
  current: {
    temperatureC: number | null;
    apparentTemperatureC: number | null;
    relativeHumidityPct: number | null;
    precipitationMm: number | null;
    windSpeedMps: number | null;
    weatherText?: string | null;
  };
  comparison: {
    scope: string;
    apparentTemperatureRank?: { position: number; total: number };
    relativeHumidityRank?: { position: number; total: number };
    windSpeedRank?: { position: number; total: number };
    precipitationRank?: { position: number; total: number };
  } | null;
  officialWarnings: Array<{ title: string; severity: string | null }>;
  /** Set only by a source that explicitly confirms an occurring disaster. */
  confirmedDisaster?: { factSummary: string } | null;
  situation?: {
    mode: "official-warning" | "observed-anomaly" | "ordinary" | "data-unavailable";
    anomalies: Array<{ severity: "notable" | "high" | "severe"; factSummary: string }>;
  };
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
  briefing: CityHostWeatherBriefing
): string | null {
  const viewerName = promptField(request.viewerName?.replace(/^@+/, "") ?? "", 40);
  const cityName = promptField(briefing.city.name || request.cityQuery, 40);
  if (!viewerName || !cityName) return null;

  const mention = `@${viewerName}`;
  const facts = weatherFactSummary(briefing);
  const warning = briefing.officialWarnings[0];
  const safety = briefing.confirmedDisaster
    ? `已确认灾害实况：${promptField(briefing.confirmedDisaster.factSummary, 90)}。严肃、清晰、安全优先，不调侃。`
    : warning
      ? `官方预警：${promptField(warning.title, 70)}。有趣但不玩灾害梗，不夸大成已发生灾害。`
      : "普通天气：幽默毒舌地根据事实调侃，可自然露出“你们人类”等AI身份破绽。";

  return `<city_report_engagement>
目标观众：${mention}；查询城市：${cityName}
已核验天气事实：${facts}
表达规则：${safety}
临场说1至2句，必须叫出${mention}，像真人主播自然接话；不要客服腔，不索取关注点赞礼物，不虚构事实。不要说“战报已经展开”或“继续@我”，只输出主播口播。
</city_report_engagement>`;
}

function weatherFactSummary(briefing: CityHostWeatherBriefing) {
  const current = briefing.current;
  const facts: string[] = [];
  if (current.weatherText) facts.push(promptField(current.weatherText, 16));
  if (current.temperatureC !== null) facts.push(`气温${round(current.temperatureC)}℃`);
  if (current.apparentTemperatureC !== null) facts.push(`体感${round(current.apparentTemperatureC)}℃`);
  if (current.relativeHumidityPct !== null) facts.push(`湿度${round(current.relativeHumidityPct)}%`);
  if (current.windSpeedMps !== null) facts.push(`风速${round(current.windSpeedMps)}m/s`);
  if (current.precipitationMm !== null && current.precipitationMm > 0) facts.push(`降水${round(current.precipitationMm)}mm`);
  const rank = strongestRank(briefing.comparison);
  if (rank) facts.push(rank);
  return facts.length ? facts.join("，") : "当前实况数据不足，只能承认不知道";
}

function strongestRank(comparison: CityHostWeatherBriefing["comparison"]) {
  if (!comparison) return null;
  const candidates: Array<[string, { position: number; total: number } | undefined]> = [
    ["体感温度", comparison.apparentTemperatureRank],
    ["湿度", comparison.relativeHumidityRank],
    ["风速", comparison.windSpeedRank],
    ["降水", comparison.precipitationRank]
  ];
  const ranked = candidates.filter(
    (candidate): candidate is [string, { position: number; total: number }] => candidate[1] !== undefined
  );
  const strongest = ranked
    .sort((left, right) => left[1].position - right[1].position)[0];
  if (!strongest || strongest[1].position > Math.max(10, Math.ceil(strongest[1].total * 0.1))) return null;
  return `${promptField(comparison.scope, 18)}${strongest[0]}第${strongest[1].position}/${strongest[1].total}`;
}

function round(value: number) {
  return Math.round(value * 10) / 10;
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
const CITY_MENTION_INTENT =
  "天气|战况|气象|下雨|降雨|温度|几度|冷不冷|热不热";
const CHINESE_CITY_MENTION = new RegExp(
  `@\\s*([\\u3400-\\u9fff]{2,16}?)(?=$|[\\s,，。！？!？、:：;；#]|(?:${CITY_MENTION_INTENT}))`,
);

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
  const match = text.trim().normalize("NFKC").match(CHINESE_CITY_MENTION);
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
