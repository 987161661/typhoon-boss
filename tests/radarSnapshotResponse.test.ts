import assert from "node:assert/strict";
import test from "node:test";
import type { RadarSnapshot } from "../lib/radarSnapshot";
import { createRadarSnapshotResponse } from "../lib/radarSnapshotResponse";

function snapshot(bosses: RadarSnapshot["bosses"]): RadarSnapshot {
  return {
    source: "fixture",
    updatedAt: "2026-07-24T01:15:22.687Z",
    observedAt: "2026-07-24T00:00:00.000Z",
    fetchedAt: "2026-07-24T01:15:22.687Z",
    status: "fresh",
    activeStormId: "202612",
    storms: [],
    lastTrackedStorm: null,
    bosses,
    environment: {
      satellite: {} as RadarSnapshot["environment"]["satellite"],
      windField: {} as RadarSnapshot["environment"]["windField"],
      windCenters: {},
      impactArea: {} as RadarSnapshot["environment"]["impactArea"]
    },
    warnings: [],
    cache: {
      stormUpdatedAt: "2026-07-24T00:00:00.000Z",
      derivedGeneratedAt: "2026-07-24T01:15:22.687Z",
      derivedExpiresAt: "2026-07-24T01:19:22.687Z",
      stale: false
    }
  };
}

test("radar ETag changes when hydrated Boss content changes within the same millisecond", async () => {
  const bootstrap = snapshot([]);
  const hydrated = snapshot([{ stormId: "202612" } as RadarSnapshot["bosses"][number]]);

  const bootstrapResponse = createRadarSnapshotResponse(bootstrap, null);
  const bootstrapEtag = bootstrapResponse.headers.get("etag");
  assert.ok(bootstrapEtag);

  const hydratedResponse = createRadarSnapshotResponse(hydrated, bootstrapEtag);
  assert.equal(hydratedResponse.status, 200);
  assert.notEqual(hydratedResponse.headers.get("etag"), bootstrapEtag);
  assert.deepEqual(await hydratedResponse.json(), hydrated);
});

test("radar conditional requests return 304 only for identical serialized content", () => {
  const value = snapshot([]);
  const response = createRadarSnapshotResponse(value, null);
  const etag = response.headers.get("etag");
  assert.ok(etag);

  const notModified = createRadarSnapshotResponse(value, etag);
  assert.equal(notModified.status, 304);
  assert.equal(notModified.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(notModified.headers.get("etag"), etag);
});
