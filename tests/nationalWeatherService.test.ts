import assert from "node:assert/strict";
import test from "node:test";
import {
  createStaleWhileRefreshCache
} from "../lib/staleWhileRefreshCache";
import type { NationalSituationSnapshot } from "../lib/nationalWeatherTypes";

function snapshot(generatedAt: string): NationalSituationSnapshot {
  return {
    schemaVersion: 1,
    generatedAt,
    sourceHealth: [],
    events: [],
    warnings: {
      total: 0,
      byLevel: { red: 0, orange: 0, yellow: 0, blue: 0 },
      highestLevel: null,
      updatedAt: null,
      sourceId: "china-weather-national-warnings"
    },
    storms: [],
    radar: {
      sourceId: "radar",
      status: "unavailable",
      updatedAt: null,
      georeferenced: false,
      frames: [],
      limitations: []
    },
    satellite: {
      sourceId: "satellite",
      status: "unavailable",
      updatedAt: null,
      georeferenced: false,
      frames: [],
      limitations: []
    },
    products: [],
    cityRankSnapshot: null
  };
}

test("a persisted national snapshot returns immediately while a slow refresh runs in background", async () => {
  const persisted = snapshot("2026-07-26T01:20:00.000Z");
  const refreshed = snapshot("2026-07-26T01:21:00.000Z");
  let finishRefresh!: (value: NationalSituationSnapshot) => void;
  const slowRefresh = new Promise<NationalSituationSnapshot>((resolve) => {
    finishRefresh = resolve;
  });
  const cache = createStaleWhileRefreshCache({
    loader: () => slowRefresh,
    readPersisted: async () => persisted,
    ttlMs: 15_000,
    now: () => 100_000
  });

  const first = await cache.get();
  assert.strictEqual(first, persisted);

  finishRefresh(refreshed);
  await slowRefresh;
  await new Promise((resolve) => setImmediate(resolve));

  assert.strictEqual(await cache.get(), refreshed);
});

test("a failed background refresh retains the persisted national snapshot", async () => {
  const persisted = snapshot("2026-07-26T01:20:00.000Z");
  const cache = createStaleWhileRefreshCache({
    loader: async () => {
      throw new Error("slow provider failed");
    },
    readPersisted: async () => persisted,
    ttlMs: 15_000,
    now: () => 100_000
  });

  assert.strictEqual(await cache.get(), persisted);
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(await cache.get(), persisted);
});
