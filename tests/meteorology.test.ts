import assert from "node:assert/strict";
import test from "node:test";
import { distanceToPathKm, makeQuadrantWindPolygon, maxWindRadius, parseBeijingTime, parseWindRadii, toBeijingIso, windForceFromSpeed } from "../lib/meteorology";

test("Beijing timestamps are stable on UTC and non-UTC hosts", () => {
  assert.equal(toBeijingIso("2026-07-13 00:00:00"), "2026-07-12T16:00:00.000Z");
  assert.equal(parseBeijingTime("2026-07-13T00:00:00+08:00"), parseBeijingTime("2026-07-13 00:00:00"));
});

test("Beaufort boundaries share one implementation", () => {
  assert.equal(windForceFromSpeed(32.6), "11");
  assert.equal(windForceFromSpeed(32.7), "12");
  assert.equal(windForceFromSpeed(61.3), "17+");
});

test("quadrant wind radii preserve asymmetric provider values", () => {
  const radii = parseWindRadii("400|400|170|160");
  assert.deepEqual(radii, { ne: 400, se: 400, sw: 170, nw: 160 });
  assert.equal(maxWindRadius(radii), 400);
  const polygon = makeQuadrantWindPolygon({ lon: 120, lat: 25 }, radii, 8);
  assert.ok(polygon);
  assert.equal(polygon?.geometry.coordinates[0].length, 9);
});

test("distance uses the full path segment instead of endpoints only", () => {
  const distance = distanceToPathKm({ lon: 120, lat: 25 }, [{ lon: 118, lat: 25 }, { lon: 122, lat: 25 }]);
  assert.ok(distance !== null && distance < 1);
});
