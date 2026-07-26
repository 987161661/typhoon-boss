const MAX_GFS_ANALYSIS_AGE_MS = 12 * 60 * 60 * 1000;

export function isWindFieldSourceStale(
  updatedAt: string | null | undefined,
  now = Date.now()
): boolean {
  const sourceAt = Date.parse(updatedAt ?? "");
  return !Number.isFinite(sourceAt) ||
    sourceAt > now + 30 * 60 * 1000 ||
    now - sourceAt > MAX_GFS_ANALYSIS_AGE_MS;
}

export function isWindFieldSourceUsable(
  updatedAt: string | null | undefined,
  now = Date.now()
): boolean {
  return !isWindFieldSourceStale(updatedAt, now);
}
