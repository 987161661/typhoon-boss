import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLiveTyphoonOutlookView,
  buildTyphoonOutlookMarkerModels,
  type TyphoonEvolutionOutlookPayload
} from "../lib/liveTyphoonOutlook";

const payload: TyphoonEvolutionOutlookPayload = {
  status: "available",
  updatedAt: "2026-07-19T15:12:51.424Z",
  outlook: {
    schemaVersion: 1,
    generatedAt: "2026-07-19T15:12:51.424Z",
    basin: "western-north-pacific",
    summary: "JTWC 当前未列出热带扰动；延伸期有 2 个 CPC 概率区域。",
    sources: {},
    nearTermDisturbances: [],
    extendedRangeAreas: [
      {
        factRef: "cpc:week-2:area-1",
        week: 2,
        probabilityPercent: 20,
        validPeriod: "07/22/2026 - 07/28/2026",
        center: { latitude: 13.6, longitude: 140.3 },
        bounds: { south: 7.5, north: 19.7, west: 125, east: 154.9 },
        sourceUrl: "https://www.cpc.ncep.noaa.gov/products/precip/CWlink/ghaz/kmzs/W2_TC.kml"
      },
      {
        factRef: "cpc:week-3:area-1",
        week: 3,
        probabilityPercent: 20,
        validPeriod: "07/29/2026 - 08/04/2026",
        center: { latitude: 14.4, longitude: 124.1 },
        bounds: { south: 8.8, north: 25.5, west: 117, east: 170.1 },
        sourceUrl: "https://www.cpc.ncep.noaa.gov/products/precip/CWlink/ghaz/kmzs/W3_TC.kml"
      }
    ],
    limitations: []
  }
};

test("builds a timestamped ticker that keeps CPC probability semantics", () => {
  const view = buildLiveTyphoonOutlookView(payload);
  assert.equal(view.available, true);
  assert.match(view.timestampLabel, /07-19 23:12/);
  assert.match(view.tickerText, /第2周区域生成概率 20%/);
  assert.match(view.tickerText, /13\.6°N、140\.3°E/);
  assert.match(view.tickerText, /不是单个胚胎的定点概率/);
});

test("creates one map marker for each numeric probability-area center", () => {
  const markers = buildTyphoonOutlookMarkerModels(payload);
  assert.deepEqual(markers.map(({ longitude, latitude }) => [longitude, latitude]), [
    [140.3, 13.6],
    [124.1, 14.4]
  ]);
  assert.equal(markers[0]?.label, "第2周 · 区域生成概率20%");
});

test("returns an explicit unavailable broadcast without map markers", () => {
  const unavailable: TyphoonEvolutionOutlookPayload = {
    status: "unavailable",
    updatedAt: null,
    outlook: null
  };
  assert.equal(buildLiveTyphoonOutlookView(unavailable).available, false);
  assert.deepEqual(buildTyphoonOutlookMarkerModels(unavailable), []);
});
