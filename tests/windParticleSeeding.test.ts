import assert from "node:assert/strict";
import test from "node:test";
import {
  createStableWindSeedPlan,
  createStableWindSeeds,
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
