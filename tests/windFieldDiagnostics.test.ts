import assert from "node:assert/strict";
import test from "node:test";
import { findCyclonicVorticityCenter, resolveWindAnalysisReference } from "../lib/windFieldDiagnostics";
import type { Storm, WindFieldPoint } from "../lib/types";

function storm(): Storm {
  return {
    id: "202609",
    code: "202609",
    nameZh: "巴威",
    nameEn: "BAVI",
    stage: "台风",
    rating: "台风级",
    status: "active",
    position: { lon: 130, lat: 30 },
    maxWind: 35,
    minPressure: 970,
    moveDirection: "东北",
    moveSpeed: 18,
    updatedAt: "2026-07-13 14:00:00",
    windRadiiKm: {
      r7: 180,
      r10: 80,
      r12: 40,
      quadrants: {
        r7: { max: 180, ne: 180, se: 160, sw: 140, nw: 170 },
        r10: { max: 80, ne: 80, se: 70, sw: 60, nw: 75 },
        r12: { max: 40, ne: 40, se: 35, sw: 30, nw: 38 }
      }
    },
    track: [
      { time: "2026-07-13 02:00:00", lon: 118, lat: 19, wind: 30, pressure: 980 },
      { time: "2026-07-13 14:00:00", lon: 122, lat: 21, wind: 35, pressure: 970 }
    ],
    forecast: [],
    forecastScenarios: [],
    landfalls: [],
    skills: [],
    notice: ""
  };
}

test("wind analysis reference interpolates the best track to the GFS valid time", () => {
  const reference = resolveWindAnalysisReference(storm(), "2026-07-13T00:00:00Z");
  assert.equal(reference.method, "track-interpolated");
  assert.equal(reference.lon, 120);
  assert.equal(reference.lat, 20);
  assert.equal(reference.validAt, "2026-07-13T00:00:00.000Z");
});

test("vortex diagnosis finds a balanced northern-hemisphere circulation", () => {
  const reference = { lon: 120, lat: 20, validAt: "2026-07-13T00:00:00.000Z", method: "track-interpolated" as const };
  const center = findCyclonicVorticityCenter(vortexGrid(120, 20, 1), reference);
  assert.ok(center);
  assert.equal(center.lon, 120);
  assert.equal(center.lat, 20);
  assert.equal(center.confidence, "high");
  assert.equal(center.referenceMethod, "track-interpolated");
  assert.ok((center.circulationBalance ?? 0) > 0.9);
});

test("vortex diagnosis handles clockwise southern-hemisphere circulation", () => {
  const reference = { lon: 120, lat: -20, validAt: "2026-07-13T00:00:00.000Z", method: "track-nearest" as const };
  const center = findCyclonicVorticityCenter(vortexGrid(120, -20, -1), reference);
  assert.ok(center);
  assert.equal(center.lon, 120);
  assert.equal(center.lat, -20);
  assert.equal(center.confidence, "high");
});

test("vortex diagnosis rejects a one-axis shear maximum", () => {
  const points: WindFieldPoint[] = [];
  for (let lat = 18; lat <= 22; lat += 0.5) {
    for (let lon = 118; lon <= 122; lon += 0.5) {
      const v = (lon - 120) * 8;
      points.push({ lon, lat, u: 0, v, speed: Math.abs(v), direction: 0 });
    }
  }
  const reference = { lon: 120, lat: 20, validAt: "2026-07-13T00:00:00.000Z", method: "current-position" as const };
  assert.equal(findCyclonicVorticityCenter(points, reference), undefined);
});

function vortexGrid(centerLon: number, centerLat: number, rotation: 1 | -1) {
  const points: WindFieldPoint[] = [];
  for (let lat = centerLat - 2; lat <= centerLat + 2; lat += 0.5) {
    for (let lon = centerLon - 2; lon <= centerLon + 2; lon += 0.5) {
      const xKm = (lon - centerLon) * 111 * Math.cos((centerLat * Math.PI) / 180);
      const yKm = (lat - centerLat) * 111;
      const radiusKm = Math.hypot(xKm, yKm);
      const tangential = 14 * Math.exp(-Math.pow(radiusKm / 180, 2));
      const u = radiusKm === 0 ? 0 : rotation * -tangential * yKm / radiusKm;
      const v = radiusKm === 0 ? 0 : rotation * tangential * xKm / radiusKm;
      points.push({ lon, lat, u, v, speed: Math.hypot(u, v), direction: 0 });
    }
  }
  return points;
}
