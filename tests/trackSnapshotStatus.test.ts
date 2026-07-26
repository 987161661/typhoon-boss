import assert from "node:assert/strict";
import test from "node:test";
import { resolveTrackSnapshotStatus } from "../lib/trackSnapshotStatus";

test("a current official fix remains fresh when only its transport used the read-only relay", () => {
  assert.equal(
    resolveTrackSnapshotStatus({
      warning: "direct TLS failed; official JSON arrived through relay",
      relayedOfficialPayload: true,
      observedAt: "2026-07-26T09:00:00.000Z",
      now: Date.parse("2026-07-26T09:20:00.000Z")
    }),
    "fresh"
  );
});

test("an old or non-relay fallback remains stale", () => {
  assert.equal(
    resolveTrackSnapshotStatus({
      warning: "using last valid snapshot",
      relayedOfficialPayload: true,
      observedAt: "2026-07-26T06:00:00.000Z",
      now: Date.parse("2026-07-26T09:20:00.000Z")
    }),
    "stale"
  );
  assert.equal(
    resolveTrackSnapshotStatus({
      warning: "upstream failed",
      relayedOfficialPayload: false,
      observedAt: "2026-07-26T09:00:00.000Z",
      now: Date.parse("2026-07-26T09:20:00.000Z")
    }),
    "stale"
  );
});
