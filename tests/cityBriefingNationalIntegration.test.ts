import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  applyNationalCitySituation,
  createCityComparisonSnapshotCache,
  type CityBriefing
} from "../lib/cityBriefingData";
import type { NationalSituationSnapshot, NationalWeatherEvent } from "../lib/nationalWeatherTypes";

test("city briefing compatibility fields are rebuilt from deterministic national warnings", () => {
  const deterministic = warning("deterministic", "511600");
  const ambiguous = warning("ambiguous", null, "ambiguous");
  const rawCoordinateWarning: CityBriefing["officialWarnings"][number] = {
    title: "不应保留的坐标预警",
    severity: "red",
    issuedAt: null,
    senderName: null,
    effectiveAt: null,
    expiresAt: null,
    description: null,
    instruction: null
  };
  const result = applyNationalCitySituation(
    briefing({ officialWarnings: [rawCoordinateWarning] }),
    snapshot([ambiguous, deterministic]),
    "511600"
  );

  assert.equal(result.situation?.mode, "official-warning");
  assert.deepEqual(result.officialWarnings.map((item) => item.title), ["广安暴雨橙色预警"]);
  assert.match(result.headline, /广安/);
  assert.equal(result.current.temperatureC, 33);
});

test("a conflicting city root cannot be rescued by a matching raw provider location id", () => {
  const conflict = warning("conflict", "510100");
  conflict.geography.locationIds = ["101270803"];
  const result = applyNationalCitySituation(briefing(), snapshot([conflict]), "511600");
  assert.deepEqual(result.officialWarnings, []);
  assert.doesNotMatch(result.headline, /安全/);
});

test("city briefing labels a missing national snapshot as unavailable, not ordinary", () => {
  const result = applyNationalCitySituation(briefing({ risks: [] }), null, "511600");
  assert.equal(result.situation?.mode, "data-unavailable");
  assert.match(result.headline, /全国预警快照不可用/);
  assert.match(result.headline, /无法判断城市预警风险/);
  assert.doesNotMatch(result.headline, /未发现显著战况/);
});

test("the production city-rank adapter deduplicates concurrent requests by Beijing day", async () => {
  let loads = 0;
  const cache = createCityComparisonSnapshotCache(async (dayKey) => {
    loads += 1;
    await Promise.resolve();
    return { fetchedAt: `${dayKey}T00:00:00+08:00`, values: [] };
  }, () => new Date("2026-07-15T08:00:00Z"));
  const [first, second] = await Promise.all([cache.get(), cache.get()]);
  assert.strictEqual(first, second);
  assert.equal(loads, 1);
});

test("the production adapter retries after the independent rank task makes its file valid", async () => {
  let loads = 0;
  let fileReady = false;
  const cache = createCityComparisonSnapshotCache(async () => {
    loads += 1;
    return fileReady ? { fetchedAt: "2026-07-15T03:15:00+08:00", values: [] } : null;
  }, () => new Date("2026-07-15T01:00:00Z"));

  assert.equal(await cache.get(), null);
  fileReady = true;
  assert.equal((await cache.get())?.fetchedAt, "2026-07-15T03:15:00+08:00");
  assert.equal(loads, 2);
  assert.equal((await cache.get())?.fetchedAt, "2026-07-15T03:15:00+08:00");
  assert.equal(loads, 2);
});

test("React queue and director are thin adapters over the pure scheduling and lens core", async () => {
  const queue = await readFile(resolve(process.cwd(), "components/useLiveCityInteractionQueue.ts"), "utf8");
  const director = await readFile(resolve(process.cwd(), "components/LiveDirector.tsx"), "utf8");
  assert.match(queue, /transitionLiveDirectorQueue/);
  assert.match(queue, /CITY_SCENE_MIN_MS/);
  assert.match(queue, /CITY_SCENE_MAX_IDLE_MS/);
  assert.doesNotMatch(queue, /const MIN_ACTIVE_MS/);
  assert.match(director, /data-camera-intent/);
  assert.match(director, /highestOfficialWarningLevel/);
});

function briefing(overrides: Partial<Omit<CityBriefing, "narrative">> = {}): Omit<CityBriefing, "narrative"> {
  return {
    city: { name: "广安", province: "四川", country: "中国", latitude: 30.47, longitude: 106.63, timezone: "Asia/Shanghai", locationId: "101270801", cityCode: "511600", cityAttribution: "deterministic" },
    generatedAt: "2026-07-15T08:00:00Z",
    status: "available",
    headline: "原始标题",
    current: { sourceId: "qweather-now", evidenceLevel: "observed", observedAt: "2026-07-15T08:00:00Z", temperatureC: 33, apparentTemperatureC: 36, relativeHumidityPct: 72, precipitationMm: 0, windSpeedMps: 2, windGustMps: null, weatherCode: null },
    nextSixHours: { sourceId: "qweather-hourly", startsAt: null, endsAt: null, precipitationMm: 0, maxHourlyPrecipitationMm: 0, maxPrecipitationProbabilityPct: 10, maxWindGustMps: null, maxCapeJkg: null },
    minutelyRain: { available: false, updatedAt: null, summary: null, maxFiveMinutePrecipitationMm: null, precipitationNextTwoHoursMm: null },
    comparison: null,
    officialWarnings: [],
    risks: [{ kind: "heat", level: "high", label: "高温", summary: "体感温度偏高。", evidenceLevel: "observed", sourceIds: ["qweather-now"] }],
    sources: [],
    warnings: [],
    ...overrides
  };
}

function warning(id: string, cityCode: string | null, attribution: "deterministic" | "ambiguous" = "deterministic"): NationalWeatherEvent {
  return {
    id,
    kind: "official-warning",
    hazard: "rain",
    title: "广安暴雨橙色预警",
    level: "orange",
    evidenceLevel: "official",
    issuedAt: "2026-07-15T07:00:00Z",
    dataTime: "2026-07-15T07:00:00Z",
    updatedAt: "2026-07-15T07:05:00Z",
    expiresAt: null,
    geography: { scope: "county", locationIds: ["101270803"], provinceCode: "510000", cityCode, countyCode: "511622", names: ["武胜县"], centroid: null, cityAttribution: attribution },
    sourceIds: ["china-weather-national-warnings"],
    factSummary: "广安市属地发布暴雨橙色预警。",
    limitations: ["以属地最新发布为准。"]
  };
}

function snapshot(events: NationalWeatherEvent[]): NationalSituationSnapshot {
  return {
    schemaVersion: 1,
    generatedAt: "2026-07-15T08:00:00Z",
    sourceHealth: [],
    events,
    warnings: { total: events.length, byLevel: { red: 0, orange: events.length, yellow: 0, blue: 0 }, highestLevel: events.length ? "orange" : null, updatedAt: null, sourceId: "china-weather-national-warnings" },
    radar: { sourceId: "radar", status: "no-record", updatedAt: null, georeferenced: false, frames: [], limitations: [] },
    satellite: { sourceId: "satellite", status: "no-record", updatedAt: null, georeferenced: false, frames: [], limitations: [] },
    products: [],
    storms: [],
    cityRankSnapshot: null
  };
}
