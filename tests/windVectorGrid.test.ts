import assert from "node:assert/strict";
import test from "node:test";
import {
  createCompositeWindVectorIndex,
  mergeWindVectorPoints,
  sampleCompositeWindVector,
  windFieldsShareFrame
} from "../lib/windVectorGrid";
import type { WindFieldPayload, WindFieldPoint } from "../lib/types";

test("composite wind sampling bilinearly interpolates raw U/V components", () => {
  const index = createCompositeWindVectorIndex(grid([0, 1], [0, 1], (lon, lat) => ({ u: lon * 10, v: lat * 20 })));
  const sample = { u: 0, v: 0 };
  assert.equal(sampleCompositeWindVector(index, 0.25, 0.75, sample), true);
  assert.equal(sample.u, 2.5);
  assert.equal(sample.v, 15);
});

test("detail grid takes precedence only inside its own footprint", () => {
  const ambient = grid([0, 1, 2], [0, 1, 2], () => ({ u: 5, v: 0 }));
  const detail = grid([0.5, 1, 1.5], [0.5, 1, 1.5], () => ({ u: 20, v: 4 }));
  const index = createCompositeWindVectorIndex(ambient, detail);
  const sample = { u: 0, v: 0 };

  assert.equal(sampleCompositeWindVector(index, 1, 1, sample), true);
  assert.equal(sample.u, 20);
  assert.equal(sample.v, 4);
  assert.equal(sampleCompositeWindVector(index, 1.8, 1.8, sample), true);
  assert.equal(sample.u, 5);
  assert.equal(sample.v, 0);
});

test("detail and ambient U/V components blend across one detail-grid cell at the seam", () => {
  const ambient = grid([0, 0.5, 1, 1.5, 2], [0, 0.5, 1, 1.5, 2], () => ({ u: 4, v: 2 }));
  const detail = grid([0.5, 1, 1.5], [0.5, 1, 1.5], () => ({ u: 20, v: 10 }));
  const index = createCompositeWindVectorIndex(ambient, detail);
  const sample = { u: 0, v: 0 };

  assert.equal(sampleCompositeWindVector(index, 0.5, 1, sample), true);
  assert.equal(sample.u, 4);
  assert.equal(sample.v, 2);
  assert.equal(sampleCompositeWindVector(index, 0.75, 1, sample), true);
  assert.equal(sample.u, 12);
  assert.equal(sample.v, 6);
  assert.equal(sampleCompositeWindVector(index, 1, 1, sample), true);
  assert.equal(sample.u, 20);
  assert.equal(sample.v, 10);
});

test("barb point merge removes coarse duplicates under the detail grid", () => {
  const ambient = grid([0, 1, 2], [0, 1, 2], () => ({ u: 5, v: 0 }));
  const detail = grid([0.5, 1, 1.5], [0.5, 1, 1.5], () => ({ u: 20, v: 4 }));
  const merged = mergeWindVectorPoints(ambient, detail);
  assert.equal(merged.filter((point) => point.lon === 1 && point.lat === 1).length, 1);
  assert.equal(merged.find((point) => point.lon === 1 && point.lat === 1)?.u, 20);
  assert.equal(merged.length, ambient.length - 1 + detail.length);
});

test("detail grids are accepted only for the same model analysis frame", () => {
  const ambient = payload({ stormId: "storm-a", updatedAt: "2026-07-14T06:00:00Z", cycle: "20260714 06Z" });
  const detail = payload({ stormId: "storm-a", updatedAt: "2026-07-14T06:00:00Z", cycle: "20260714 06Z" });
  assert.equal(windFieldsShareFrame(ambient, detail), true);
  assert.equal(windFieldsShareFrame(ambient, { ...detail, updatedAt: "2026-07-14T00:00:00Z" }), false);
  assert.equal(windFieldsShareFrame(ambient, { ...detail, source: "fallback" }), false);
  assert.equal(windFieldsShareFrame(ambient, { ...detail, stormId: "storm-b" }), false);
});

function grid(
  longitudes: number[],
  latitudes: number[],
  vector: (lon: number, lat: number) => { u: number; v: number }
) {
  const points: WindFieldPoint[] = [];
  for (const lat of latitudes) {
    for (const lon of longitudes) {
      const { u, v } = vector(lon, lat);
      points.push({ lon, lat, u, v, speed: Math.hypot(u, v), direction: 0 });
    }
  }
  return points;
}

function payload(overrides: Partial<WindFieldPayload> = {}): WindFieldPayload {
  return {
    source: "NCEP GFS",
    updatedAt: "2026-07-14T06:00:00Z",
    status: "available",
    attribution: "test",
    model: "NCEP GFS 0.25 degree analysis, 10m U/V wind",
    unit: "m/s",
    points: grid([0, 1], [0, 1], () => ({ u: 1, v: 1 })),
    cycle: "20260714 06Z",
    ...overrides
  };
}
