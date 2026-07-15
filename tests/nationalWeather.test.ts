import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { createNationalSituationResponse } from "../lib/nationalWeatherResponse";
import { createAdministrativeHierarchy, parseAdministrativeHierarchyCsv } from "../lib/administrativeMapping";
import type { ChinaWeatherProductSnapshot } from "../lib/chinaWeatherProductFeed";
import type { ChinaWeatherVisualSnapshot } from "../lib/chinaWeatherVisualFeed";
import type { ChinaWeatherWarningSnapshot } from "../lib/chinaWeatherWarningFeed";
import {
  buildNationalSituationSnapshot,
  evaluateSourceFreshness,
  evidenceLevelForEventKind,
  isEvidenceLevelAllowed,
  retainLastValidSources,
  sortNationalWeatherEvents,
  type NationalSituationInputs
} from "../lib/nationalWeather";
import type { NationalWeatherEvent } from "../lib/nationalWeatherTypes";
import type { TrackSnapshot } from "../lib/realTyphoonData";
import type { Storm } from "../lib/types";

const now = "2026-07-15T02:30:00.000Z";

const administrativeHierarchy = createAdministrativeHierarchy(parseAdministrativeHierarchyCsv(`
Location_ID,Location_Name_ZH,Adm1_Name_ZH,Adm2_Name_ZH,AD_code
101270801,广安,四川省,广安市,511600
101270803,武胜,四川省,广安市,511622
`), { source: "fixture", fetchedAt: "2026-07-15T00:00:00.000Z" });

const storm = {
  id: "202609",
  code: "202609",
  nameZh: "巴威",
  nameEn: "BAVI",
  stage: "台风",
  rating: "虎级",
  status: "实时监测中",
  position: { lon: 130, lat: 20 },
  maxWind: 40,
  minPressure: 960,
  moveDirection: "西北",
  moveSpeed: 15,
  updatedAt: "2026-07-15T02:25:00.000Z",
  windRadiiKm: {
    r7: 300,
    r10: 100,
    r12: 50,
    quadrants: {
      r7: { ne: 300, se: 280, sw: 200, nw: 220, max: 300 },
      r10: { ne: 100, se: 90, sw: 80, nw: 70, max: 100 },
      r12: { ne: 50, se: 40, sw: 30, nw: 20, max: 50 }
    }
  },
  track: [{ time: "2026-07-15T02:25:00.000Z", lon: 130, lat: 20, wind: 40, pressure: 960 }],
  forecast: [{ time: "2026-07-15T08:25:00.000Z", lon: 129, lat: 21, wind: 38, pressure: 965 }],
  forecastScenarios: [{ id: "CMA", agency: "中国", agencyCode: "CMA", isPrimary: true, points: [] }],
  landfalls: [{ time: "2026-07-14T10:00:00.000Z", place: "测试登陆点", lat: 19, lon: 131 }],
  skills: [{ name: "风圈压制", detail: "测试", severity: 5 }],
  notice: "测试来源声明"
} satisfies Storm;

const track: TrackSnapshot = {
  source: "track-source",
  observedAt: storm.updatedAt,
  fetchedAt: "2026-07-15T02:29:00.000Z",
  status: "fresh",
  storms: [storm],
  lastTrackedStorm: null,
  warnings: []
};

const warnings: ChinaWeatherWarningSnapshot = {
  fetchedAt: "2026-07-15T02:29:00.000Z",
  source: "warning-source",
  total: 2,
  warnings: [
    {
      id: "101270803-red",
      issuer: "四川省广安市武胜县",
      locationId: "101270803",
      issuedAt: "2026-07-15T10:09:28+08:00",
      typeCode: "07",
      gradeCode: "04",
      grade: "red",
      severity: 4,
      longitude: 106.29,
      latitude: 30.34,
      title: "武胜县发布高温红色预警信号",
      detailUrl: "https://example.invalid/red"
    },
    {
      id: "10127-blue",
      issuer: "四川省",
      locationId: "10127",
      issuedAt: "2026-07-15T09:00:00+08:00",
      typeCode: "02",
      gradeCode: "01",
      grade: "blue",
      severity: 1,
      longitude: null,
      latitude: null,
      title: "四川省发布暴雨蓝色预警",
      detailUrl: "https://example.invalid/blue"
    }
  ]
};

const visuals: ChinaWeatherVisualSnapshot = {
  fetchedAt: "2026-07-15T02:29:00.000Z",
  source: "visual-source",
  radar: {
    status: "available",
    frames: [{ observedAt: "2026-07-15 10:24", filename: "radar.png", imageUrl: "https://example.invalid/radar.png" }]
  },
  satellite: {
    status: "available",
    sourceEndpoint: "https://example.invalid/satellite-index",
    frames: [{ observedAt: "2026-07-15 10:15", filename: "satellite-frame", imageUrl: null }]
  }
};

const products: ChinaWeatherProductSnapshot = {
  fetchedAt: "2026-07-15T02:20:00.000Z",
  source: "product-source",
  refreshIntervalMinutes: 30,
  products: [{
    id: "YB_DZZH_24",
    kind: "risk",
    label: "geological hazard meteorological risk",
    target: "battle",
    status: "available",
    frames: [{
      filename: "risk.png",
      imageUrl: "https://example.invalid/risk.png",
      productTime: "2026-07-15 08:00",
      ingestedAt: "2026-07-15 08:10"
    }]
  }]
};

function inputs(overrides: Partial<NationalSituationInputs> = {}): NationalSituationInputs {
  return {
    warnings,
    visuals,
    products,
    track,
    administrativeHierarchy,
    administrativeHierarchyError: null,
    ...overrides
  };
}

test("freshness distinguishes fresh, delayed, expired, unavailable and no-record", () => {
  const base = { now, refreshIntervalMinutes: 5, hasRecords: true, available: true };
  assert.equal(evaluateSourceFreshness({ ...base, lastSuccessfulAt: "2026-07-15T02:21:00.000Z" }), "fresh");
  assert.equal(evaluateSourceFreshness({ ...base, lastSuccessfulAt: "2026-07-15T02:19:00.000Z" }), "delayed");
  assert.equal(evaluateSourceFreshness({ ...base, lastSuccessfulAt: "2026-07-15T01:59:00.000Z" }), "expired");
  assert.equal(evaluateSourceFreshness({ ...base, lastSuccessfulAt: null, available: false, error: "upstream failed" }), "unavailable");
  assert.equal(evaluateSourceFreshness({ ...base, lastSuccessfulAt: now, hasRecords: false }), "no-record");
  assert.equal(
    evaluateSourceFreshness({ ...base, lastSuccessfulAt: "2026-07-15T02:29:00.000Z", available: false, error: "refresh failed" }),
    "delayed"
  );
});

test("explicit event categories keep blue warnings below typhoons and every watch last", () => {
  const sorted = sortNationalWeatherEvents([
    event("model", "model-watch", "watch", "model"),
    event("orange", "official-warning", "orange", "official"),
    event("storm", "typhoon", "red", "official"),
    event("risk", "official-risk", "yellow", "official"),
    event("red", "official-warning", "red", "official"),
    event("blue", "official-warning", "blue", "official"),
    event("radar", "radar-watch", "watch", "metadata")
  ]);
  assert.deepEqual(sorted.map((item) => item.id), ["red", "orange", "risk", "storm", "blue", "radar", "model"]);
  assert.ok(sorted.indexOf(sorted.find((item) => item.id === "blue")!) > sorted.indexOf(sorted.find((item) => item.id === "storm")!));
  assert.ok(sorted.indexOf(sorted.find((item) => item.id === "radar")!) > sorted.indexOf(sorted.find((item) => item.id === "orange")!));
});

test("typhoon display rating cannot outrank official red/orange warnings or official risk", () => {
  const sorted = sortNationalWeatherEvents([
    event("god-tier-storm", "typhoon", "red", "official"),
    event("official-risk", "official-risk", "blue", "official"),
    event("orange-warning", "official-warning", "orange", "official"),
    event("red-warning", "official-warning", "red", "official")
  ]);
  assert.deepEqual(sorted.map((item) => item.id), ["red-warning", "orange-warning", "official-risk", "god-tier-storm"]);
});

test("evidence boundaries are deterministic and reject watch promotion", () => {
  assert.equal(evidenceLevelForEventKind("official-warning"), "official");
  assert.equal(evidenceLevelForEventKind("radar-watch"), "metadata");
  assert.equal(evidenceLevelForEventKind("model-watch"), "model");
  assert.equal(isEvidenceLevelAllowed({ kind: "radar-watch", evidenceLevel: "official" }), false);
  assert.equal(isEvidenceLevelAllowed({ kind: "official-risk", evidenceLevel: "metadata" }), false);
  assert.equal(isEvidenceLevelAllowed({ kind: "typhoon", evidenceLevel: "official" }), true);
});

test("aggregation preserves the complete Storm contract and keeps image/catalog evidence as metadata", () => {
  const snapshot = buildNationalSituationSnapshot(inputs(), now);
  assert.strictEqual(snapshot.storms, track.storms);
  assert.deepEqual(snapshot.storms[0], storm);
  assert.equal(snapshot.satellite.georeferenced, false);
  assert.equal(snapshot.satellite.frames[0].imageUrl, null);
  assert.equal(snapshot.products[0].evidenceLevel, "metadata");
  assert.equal(snapshot.events.some((item) => item.kind === "official-risk"), false, "catalog metadata must not become a risk event");
  const radarEvent = snapshot.events.find((item) => item.kind === "radar-watch");
  assert.equal(radarEvent?.evidenceLevel, "metadata");
  assert.match(radarEvent?.limitations.join(" ") ?? "", /不能作为灾害/);

  const countyWarning = snapshot.events.find((item) => item.id.includes("101270803-red"));
  assert.equal(countyWarning?.geography.cityAttribution, "deterministic");
  assert.equal(countyWarning?.geography.provinceCode, "510000");
  assert.equal(countyWarning?.geography.cityCode, "511600");
  assert.equal(countyWarning?.geography.countyCode, "511622");
  const provinceWarning = snapshot.events.find((item) => item.id.includes("10127-blue"));
  assert.equal(provinceWarning?.geography.cityAttribution, "ambiguous");
  assert.equal(provinceWarning?.geography.cityCode, null);
});

test("an unavailable source retains its last valid facts and is not rewritten as no risk", () => {
  const previous = buildNationalSituationSnapshot(inputs(), now);
  const current = buildNationalSituationSnapshot(inputs({ warnings: null }), "2026-07-15T02:31:00.000Z");
  const retained = retainLastValidSources(current, previous, "2026-07-15T02:31:00.000Z");
  assert.equal(retained.warnings.total, 2);
  assert.equal(retained.events.filter((item) => item.kind === "official-warning").length, 2);
  const health = retained.sourceHealth.find((item) => item.sourceId === previous.warnings.sourceId);
  assert.equal(health?.status, "delayed");
  assert.notEqual(health?.status, "no-record");
  assert.match(health?.limitations.join(" ") ?? "", /保留.*最近有效数据/);
});

test("simultaneous upstream failures retain radar, satellite, products and storms without claiming no-record", () => {
  const previous = buildNationalSituationSnapshot(inputs(), now);
  const failedTrack: TrackSnapshot = {
    ...track,
    status: "unavailable",
    storms: [],
    warnings: ["403 from track provider"]
  };
  const failureTime = "2026-07-15T02:31:00.000Z";
  const current = buildNationalSituationSnapshot(inputs({
    warnings: null,
    visuals: null,
    products: null,
    track: failedTrack,
    administrativeHierarchy: null,
    administrativeHierarchyError: "invalid hierarchy JSON"
  }), failureTime);
  const retained = retainLastValidSources(current, previous, failureTime);

  assert.equal(retained.warnings.total, previous.warnings.total);
  assert.deepEqual(retained.radar.frames, previous.radar.frames);
  assert.deepEqual(retained.satellite.frames, previous.satellite.frames);
  assert.deepEqual(retained.products, previous.products);
  assert.deepEqual(retained.storms, previous.storms);
  assert.equal(retained.events.filter((item) => item.kind === "official-warning").length, 2);
  assert.equal(retained.events.filter((item) => item.kind === "typhoon").length, 1);

  const failedSourceIds = new Set([
    "china-weather-national-warnings",
    "china-weather-national-radar-index",
    "china-weather-satellite-index",
    "china-weather-product-directory",
    "zhejiang-water-typhoon-track",
    "qweather-administrative-hierarchy"
  ]);
  retained.sourceHealth
    .filter((health) => failedSourceIds.has(health.sourceId))
    .forEach((health) => {
      assert.notEqual(health.status, "unavailable", `${health.sourceId} should expose retained data`);
      assert.notEqual(health.status, "no-record", `${health.sourceId} failure cannot mean no risk`);
      assert.match(health.limitations.join(" "), /最近有效数据|沿用|精确 Location_ID/);
    });
});

test("hierarchy failure only retains attribution for the identical previously resolved warning", () => {
  const previous = buildNationalSituationSnapshot(inputs(), now);
  const current = buildNationalSituationSnapshot(inputs({
    administrativeHierarchy: null,
    administrativeHierarchyError: "hierarchy refresh failed"
  }), "2026-07-15T02:31:00.000Z");
  const retained = retainLastValidSources(current, previous, "2026-07-15T02:31:00.000Z");
  const county = retained.events.find((event) => event.id.includes("101270803-red"));
  assert.equal(county?.geography.cityAttribution, "deterministic");
  assert.equal(county?.geography.cityCode, "511600");
  assert.match(county?.limitations.join(" ") ?? "", /沿用上一统一快照/);
  const hierarchyHealth = retained.sourceHealth.find((health) => health.sourceId === "qweather-administrative-hierarchy");
  assert.equal(hierarchyHealth?.status, "delayed");
  assert.notEqual(hierarchyHealth?.status, "no-record");
});

test("new API response is no-store, uses ETag, and supports conditional 304", async () => {
  const snapshot = buildNationalSituationSnapshot(inputs(), now);
  const response = createNationalSituationResponse(snapshot, null);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  const etag = response.headers.get("etag");
  assert.ok(etag);
  assert.deepEqual(await response.json(), snapshot);
  const notModified = createNationalSituationResponse(snapshot, etag);
  assert.equal(notModified.status, 304);
  assert.equal(notModified.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(notModified.headers.get("etag"), etag);
});

test("national contract coexists with the unchanged legacy radar snapshot route", async () => {
  const legacyRoute = await readFile(resolve(process.cwd(), "app/api/radar/snapshot/route.ts"), "utf8");
  assert.match(legacyRoute, /getRadarSnapshot/);
  assert.match(legacyRoute, /activeStormId/);
  assert.match(legacyRoute, /bosses/);
  const snapshot = buildNationalSituationSnapshot(inputs(), now);
  assert.equal(snapshot.schemaVersion, 1);
  assert.deepEqual(snapshot.storms, track.storms);
  assert.equal("bosses" in snapshot, false);
});

function event(
  id: string,
  kind: NationalWeatherEvent["kind"],
  level: NationalWeatherEvent["level"],
  evidenceLevel: NationalWeatherEvent["evidenceLevel"]
): NationalWeatherEvent {
  return {
    id,
    kind,
    hazard: kind === "typhoon" ? "typhoon" : "other",
    title: id,
    level,
    evidenceLevel,
    issuedAt: now,
    dataTime: now,
    updatedAt: now,
    expiresAt: null,
    geography: {
      scope: "national",
      locationIds: [],
      provinceCode: null,
      cityCode: null,
      countyCode: null,
      names: [],
      centroid: null,
      cityAttribution: "not-applicable"
    },
    sourceIds: [id],
    factSummary: id,
    limitations: []
  };
}
