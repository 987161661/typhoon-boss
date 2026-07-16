import assert from "node:assert/strict";
import test from "node:test";
import {
  createHierarchicalWindSeeds,
  createStableWindSeedPlan,
  createStableWindSeeds,
  planWindParticlePoolReconciliation,
  type WindSeedBounds
} from "../lib/windParticleSeeding";

const chinaView: WindSeedBounds = { west: 72, east: 142, south: 9, north: 55 };

test("stable wind seeds are deterministic and remain inside the requested bounds", () => {
  const plan = createStableWindSeedPlan(chinaView, 1_200);
  const first = createStableWindSeeds(chinaView, plan, 1_200);
  const second = createStableWindSeeds(chinaView, plan, 1_200);

  assert.deepEqual(first, second);
  assert.ok(first.length > 900);
  for (const seed of first) {
    assert.ok(seed.lon >= chinaView.west && seed.lon <= chinaView.east);
    assert.ok(seed.lat >= chinaView.south && seed.lat <= chinaView.north);
  }
});

test("overlapping viewports reuse the same geographic seed coordinates", () => {
  const plan = createStableWindSeedPlan(chinaView, 1_200);
  const eastView: WindSeedBounds = { west: 100, east: 150, south: 9, north: 55 };
  const first = createStableWindSeeds(chinaView, plan, 1_200);
  const second = createStableWindSeeds(eastView, plan, 1_200);
  const secondByKey = new Map(second.map((seed) => [seed.key, seed]));
  const shared = first.filter((seed) => secondByKey.has(seed.key));

  assert.ok(shared.length > 300);
  for (const seed of shared) assert.deepEqual(seed, secondByKey.get(seed.key));
});

test("zooming into a smaller geographic area does not manufacture extra seed density", () => {
  const plan = createStableWindSeedPlan(chinaView, 1_200);
  const closeView: WindSeedBounds = { west: 112, east: 124, south: 25, north: 36 };
  const wideSeeds = createStableWindSeeds(chinaView, plan, 10_000);
  const closeSeeds = createStableWindSeeds(closeView, plan, 10_000);

  assert.ok(closeSeeds.length < wideSeeds.length / 3);
  const wideKeysInsideCloseView = new Set(
    wideSeeds
      .filter((seed) => seed.lon >= closeView.west && seed.lon <= closeView.east && seed.lat >= closeView.south && seed.lat <= closeView.north)
      .map((seed) => seed.key)
  );
  assert.ok(closeSeeds.every((seed) => wideKeysInsideCloseView.has(seed.key)));
});

test("hierarchical seed levels hand off continuously across a resolution boundary", () => {
  const beforeBounds: WindSeedBounds = { west: 78, east: 144, south: 8, north: 55 };
  let before = createHierarchicalWindSeeds(beforeBounds, 1_200);
  let after = before;

  for (let step = 1; step <= 120; step += 1) {
    const inset = step * 0.12;
    const candidateBounds = {
      west: beforeBounds.west + inset,
      east: beforeBounds.east - inset,
      south: beforeBounds.south + inset * 0.4,
      north: beforeBounds.north - inset * 0.4
    };
    const candidate = createHierarchicalWindSeeds(candidateBounds, 1_200);
    if (candidate.plan.lowerResolution !== before.plan.lowerResolution) {
      after = candidate;
      break;
    }
    before = candidate;
  }

  assert.notEqual(before.plan.lowerResolution, after.plan.lowerResolution);
  const beforeKeys = new Set(before.seeds.map((seed) => seed.key));
  const sharedCount = after.seeds.filter((seed) => beforeKeys.has(seed.key)).length;
  assert.ok(sharedCount > 800, `expected a mostly continuous handoff, got ${sharedCount} shared seeds`);
});

test("particle pool reconciliation preserves in-bounds identities and fills only deficits", () => {
  const bounds: WindSeedBounds = { west: 100, east: 130, south: 15, north: 40 };
  const seeds = createHierarchicalWindSeeds(bounds, 6).seeds;
  const existing = [
    { id: "kept", seedKey: "old:kept", lon: 112, lat: 24, state: "active" as const },
    { id: "reactivated", seedKey: "old:reactivated", lon: 118, lat: 29, state: "retiring" as const },
    { id: "outside", seedKey: "old:outside", lon: 80, lat: 29, state: "active" as const }
  ];
  const result = planWindParticlePoolReconciliation(existing, seeds, bounds, 6, 8);

  assert.ok(result.keepIds.includes("kept"));
  assert.ok(result.reactivateIds.includes("reactivated"));
  assert.ok(result.retireIds.includes("outside"));
  assert.equal(result.spawnSeeds.length, 4);
});
