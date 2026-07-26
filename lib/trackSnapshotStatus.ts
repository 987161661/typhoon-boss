export function resolveTrackSnapshotStatus(input: {
  warning: string | null;
  relayedOfficialPayload: boolean;
  observedAt: string | null;
  now?: number;
}): "fresh" | "stale" {
  if (!input.warning) return "fresh";
  const observedAt = Date.parse(input.observedAt ?? "");
  const ageMs = (input.now ?? Date.now()) - observedAt;
  // A transport fallback is not a data-age failure. Jina carries the same
  // official JSON bytes and timestamps; retain the warning for provenance,
  // but do not paint a current agency fix as stale.
  if (
    input.relayedOfficialPayload &&
    Number.isFinite(observedAt) &&
    ageMs >= 0 &&
    ageMs <= 90 * 60 * 1000
  ) {
    return "fresh";
  }
  return "stale";
}
