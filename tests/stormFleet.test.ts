import assert from "node:assert/strict";
import test from "node:test";
import { alignStormToWindCenter, buildGfsAnalysisCenterMarkerModels, buildStormFleetGeo, FORECAST_ROUTE_COLORS, selectCanonicalStormWindField, stormFleetBounds, stormTrackColor, windFieldMatchesStorm } from "../lib/stormFleet";
import type { Storm, WindFieldPayload } from "../lib/types";

function storm(id: string, lon: number, lat: number): Storm {
  return {
    id,
    code: id,
    nameZh: `台风${id}`,
    nameEn: id,
    stage: "台风",
    rating: "台风级",
    status: "active",
    position: { lon, lat },
    maxWind: 35,
    minPressure: 970,
    moveDirection: "西北",
    moveSpeed: 15,
    updatedAt: "2026-07-13 08:00:00",
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
      { time: "2026-07-13 02:00:00", lon: lon - 2, lat: lat - 1, wind: 30, pressure: 980 },
      { time: "2026-07-13 08:00:00", lon, lat, wind: 35, pressure: 970 }
    ],
    forecast: [
      { time: "2026-07-13 14:00:00", lon: lon + 1, lat: lat + 1, wind: 33, pressure: 975 },
      { time: "2026-07-13 20:00:00", lon: lon + 2, lat: lat + 2, wind: 30, pressure: 980 }
    ],
    forecastScenarios: [],
    landfalls: [],
    skills: [],
    notice: ""
  };
}

test("fleet geo keeps every storm while identifying the locked target", () => {
  const storms = [storm("202609", 118, 33), storm("202611", 136, 10)];
  const geo = buildStormFleetGeo(storms, "202611");

  assert.deepEqual(new Set(geo.routes.features.map((feature) => feature.properties?.stormId)), new Set(["202609", "202611"]));
  assert.equal(geo.routes.features.filter((feature) => feature.properties?.active).length, 2);
  assert.equal(geo.routes.features.filter((feature) => feature.properties?.routeKind === "forecast").length, 2);
  assert.deepEqual(
    geo.routes.features.filter((feature) => feature.properties?.routeKind === "track").map((feature) => feature.properties?.trackColor),
    storms.map((item) => stormTrackColor(item.id))
  );
});

test("storm track colors stay stable when the locked target changes", () => {
  const storms = [storm("202609", 118, 33), storm("202611", 136, 10)];
  const first = buildStormFleetGeo(storms, "202609");
  const second = buildStormFleetGeo(storms, "202611");
  assert.deepEqual(
    first.routes.features.filter((feature) => feature.properties?.routeKind === "track").map((feature) => feature.properties?.trackColor),
    second.routes.features.filter((feature) => feature.properties?.routeKind === "track").map((feature) => feature.properties?.trackColor)
  );
});

test("fleet bounds include current, historical, and forecast positions", () => {
  const bounds = stormFleetBounds([storm("202609", 118, 33), storm("202611", 136, 10)]);
  assert.deepEqual(bounds, [[116, 9], [138, 35]]);
});

test("fleet geo preserves every published agency forecast", () => {
  const haishen = storm("202611", 136, 10);
  haishen.forecastScenarios = [
    { id: "cma", agency: "中国", agencyCode: "CMA", points: haishen.forecast, isPrimary: true },
    {
      id: "jma",
      agency: "日本",
      agencyCode: "JMA",
      isPrimary: false,
      points: [
        { time: "2026-07-13 14:00:00", lon: 137, lat: 11, wind: 32, pressure: 976 },
        { time: "2026-07-13 20:00:00", lon: 141, lat: 15, wind: 30, pressure: 980 }
      ]
    }
  ];

  const geo = buildStormFleetGeo([haishen], null);
  const forecasts = geo.routes.features.filter((feature) => feature.properties?.routeKind === "forecast");
  assert.deepEqual(forecasts.map((feature) => feature.properties?.agencyCode), ["CMA", "JMA"]);
  assert.deepEqual(forecasts.map((feature) => feature.properties?.color), [FORECAST_ROUTE_COLORS.CMA, FORECAST_ROUTE_COLORS.JMA]);
  assert.deepEqual(stormFleetBounds([haishen]), [[134, 9], [141, 15]]);
});

test("every storm can use its own recorded GFS vortex center", () => {
  const haishen = storm("202611", 136.5, 10.6);
  const aligned = alignStormToWindCenter(haishen, {
    stormId: haishen.id,
    status: "available",
    source: "NOAA/NCEP NOMADS Grib Filter",
    updatedAt: "2026-07-12T18:00:00Z",
    analysisCenter: { lon: 137, lat: 9.75, method: "peak-cyclonic-vorticity" }
  });

  assert.deepEqual(aligned.position, { lon: 137, lat: 9.75 });
  assert.equal(aligned.updatedAt, "2026-07-12T18:00:00Z");
});

test("a wind field can never move a different storm", () => {
  const bavi = storm("202609", 118, 33);
  const haishen = storm("202611", 136, 10);
  const field = {
    stormId: bavi.id,
    source: "NOAA/NCEP NOMADS Grib Filter",
    updatedAt: "2026-07-12T18:00:00Z",
    status: "available" as const,
    attribution: "NOAA",
    model: "GFS",
    unit: "m/s" as const,
    points: [],
    analysisCenter: { lon: 117.25, lat: 32.25, method: "peak-cyclonic-vorticity" as const }
  };

  assert.equal(windFieldMatchesStorm(field, bavi), true);
  assert.equal(windFieldMatchesStorm(field, haishen), false);
});

test("canonical storm center prefers the high-resolution core field and never accepts a viewport substitute", () => {
  const bavi = storm("202609", 121, 36.9);
  const snapshot = windField(bavi.id, 119.25, 35.25, 1);
  const core = windField(bavi.id, 119.5, 35.5, 0.25);
  const foreign = windField("202611", 136.75, 11.75, 0.25);

  assert.equal(selectCanonicalStormWindField(bavi, core, snapshot), core);
  assert.equal(selectCanonicalStormWindField(bavi, null, snapshot), snapshot);
  assert.equal(selectCanonicalStormWindField(bavi, foreign, null), null);
});

test("GFS center marker models keep every storm visible while the active storm uses its canonical field", () => {
  const bavi = storm("202609", 121, 36.9);
  const haishen = storm("202611", 136, 10);
  const canonical = windField(bavi.id, 119.5, 35.5, 0.25);
  const models = buildGfsAnalysisCenterMarkerModels([bavi, haishen], bavi.id, canonical, {
    [bavi.id]: {
      stormId: bavi.id,
      source: "NOAA/NCEP NOMADS Grib Filter",
      updatedAt: "2026-07-13T18:00:00Z",
      status: "available",
      analysisCenter: { lon: 119.25, lat: 35.25, method: "peak-cyclonic-vorticity" }
    },
    [haishen.id]: {
      stormId: haishen.id,
      source: "NOAA/NCEP NOMADS Grib Filter",
      updatedAt: "2026-07-13T18:00:00Z",
      status: "available",
      analysisCenter: { lon: 136.75, lat: 11.75, method: "peak-cyclonic-vorticity" }
    }
  });

  assert.deepEqual(models.map((model) => model.stormId), [bavi.id, haishen.id]);
  assert.deepEqual(models[0].center, canonical.analysisCenter);
  assert.equal(models[0].active, true);
  assert.equal(models[0].stormName, bavi.nameZh);
  assert.deepEqual(models[1].center, { lon: 136.75, lat: 11.75, method: "peak-cyclonic-vorticity" });
  assert.equal(models[1].active, false);
});

function windField(stormId: string, lon: number, lat: number, resolution: number): WindFieldPayload {
  return {
    stormId,
    source: "NOAA/NCEP NOMADS Grib Filter",
    updatedAt: "2026-07-13T18:00:00Z",
    status: "available",
    attribution: "NOAA",
    model: "GFS",
    unit: "m/s",
    points: [],
    nativeResolutionDegrees: 0.25,
    displayResolutionDegrees: resolution,
    analysisCenter: { lon, lat, method: "peak-cyclonic-vorticity", confidence: "medium", offsetKm: 73 }
  };
}
