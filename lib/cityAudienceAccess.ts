export type AudienceAccessSource = "observed" | "whitelist" | "unknown";

export interface CityAudienceIdentity {
  platform: string;
  viewerId: string;
}

export interface CityAudienceAccessEntry extends CityAudienceIdentity {
  note: string;
  createdAt: string;
  updatedAt: string;
}

export const CITY_AUDIENCE_ACCESS_LIMITS = {
  platform: 32,
  viewerId: 128,
  note: 200
} as const;

export class CityAudienceAccessValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CityAudienceAccessValidationError";
  }
}

export function normalizeCityAudienceIdentity(platform: unknown, viewerId: unknown): CityAudienceIdentity {
  if (typeof platform !== "string" || typeof viewerId !== "string") {
    throw new CityAudienceAccessValidationError("platform 和 viewerId 必须是字符串。");
  }
  const normalizedPlatform = platform.trim().toLowerCase();
  const normalizedViewerId = viewerId.trim();
  if (!normalizedPlatform || normalizedPlatform.length > CITY_AUDIENCE_ACCESS_LIMITS.platform) {
    throw new CityAudienceAccessValidationError(`platform 长度必须为 1-${CITY_AUDIENCE_ACCESS_LIMITS.platform} 个字符。`);
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(normalizedPlatform)) {
    throw new CityAudienceAccessValidationError("platform 仅允许小写字母、数字、点、下划线和连字符。");
  }
  if (!normalizedViewerId || normalizedViewerId.length > CITY_AUDIENCE_ACCESS_LIMITS.viewerId) {
    throw new CityAudienceAccessValidationError(`viewerId 长度必须为 1-${CITY_AUDIENCE_ACCESS_LIMITS.viewerId} 个字符。`);
  }
  if (hasControlCharacters(normalizedViewerId)) {
    throw new CityAudienceAccessValidationError("viewerId 不能包含控制字符。");
  }
  return { platform: normalizedPlatform, viewerId: normalizedViewerId };
}

export function normalizeCityAudienceNote(note: unknown): string {
  if (note === undefined || note === null) return "";
  if (typeof note !== "string") throw new CityAudienceAccessValidationError("备注必须是字符串。");
  const normalized = note.trim();
  if (normalized.length > CITY_AUDIENCE_ACCESS_LIMITS.note) {
    throw new CityAudienceAccessValidationError(`备注不能超过 ${CITY_AUDIENCE_ACCESS_LIMITS.note} 个字符。`);
  }
  if (hasControlCharacters(normalized)) throw new CityAudienceAccessValidationError("备注不能包含控制字符。");
  return normalized;
}

/** Platform is case-insensitive; viewerId remains case-sensitive by contract. */
export function cityAudienceAccessKey(identity: CityAudienceIdentity): string {
  return `${identity.platform}\u0000${identity.viewerId}`;
}

export function resolveAudienceAccessSource(input: {
  observedFollowing?: boolean | null;
  whitelisted: boolean;
}): AudienceAccessSource {
  if (input.observedFollowing === true) return "observed";
  if (input.whitelisted) return "whitelist";
  return "unknown";
}

function hasControlCharacters(value: string) {
  return /[\u0000-\u001f\u007f]/.test(value);
}
