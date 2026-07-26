import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  applyNationalCitySituation,
  buildCityComparisonFromSnapshot,
  buildCityPresentation,
  classifyCityBriefingAvailability,
  collectCityGeocodingResults,
  createCityFactsCache,
  createCityComparisonSnapshotCache,
  retryCitySource,
  summarizeQWeatherForecastCurrent,
  withCitySourceDeadline,
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

test("the national comparison remains available when city weather falls back to Open-Meteo", () => {
  const current = {
    ...briefing().current,
    sourceId: "open-meteo" as const,
    apparentTemperatureC: 24,
    relativeHumidityPct: 93,
    windSpeedMps: 12.1,
    precipitationMm: 1.9
  };
  const values = Array.from({ length: 30 }, (_, index) => ({
    ...current,
    sourceId: "qweather-now" as const,
    apparentTemperatureC: 20 + index / 2,
    relativeHumidityPct: 60 + index,
    windSpeedMps: 2 + index / 2,
    precipitationMm: index / 10
  }));

  const comparison = buildCityComparisonFromSnapshot(current, {
    fetchedAt: "2026-07-26T00:00:00.000Z",
    values
  });

  assert.ok(comparison);
  assert.equal(comparison.scope, "全国参考排名");
  assert.equal(comparison.windSpeedRank?.total, 30);
  assert.equal(comparison.precipitationRank?.total, 30);
});

test("city facts use a short TTL and deduplicate concurrent refreshes", async () => {
  let now = 1_000;
  let loads = 0;
  const cache = createCityFactsCache(async (query) => {
    loads += 1;
    await Promise.resolve();
    return `${query}:${loads}`;
  }, 300_000, () => now);

  const [first, duplicate] = await Promise.all([cache.get("惠州"), cache.get("惠州")]);
  assert.equal(first, "惠州:1");
  assert.equal(duplicate, first);
  assert.equal(loads, 1);
  now += 299_999;
  assert.equal(await cache.get("惠州"), first);
  now += 2;
  assert.equal(await cache.get("惠州"), "惠州:2");
  assert.equal(loads, 2);
});

test("city source deadline rejects a stalled provider instead of blocking the city card", async () => {
  const startedAt = Date.now();
  await assert.rejects(
    withCitySourceDeadline(new Promise<never>(() => undefined), "stalled-provider", 20),
    /stalled-provider.*20ms/
  );
  assert.ok(Date.now() - startedAt < 500, "a stalled city provider must be bounded");
});

test("optional QWeather enrichments cannot hold the core city report beyond one second", async () => {
  const source = await readFile(resolve(process.cwd(), "lib/cityBriefingData.ts"), "utf8");
  assert.match(source, /const CITY_OPTIONAL_SOURCE_DEADLINE_MS = 900/);
  assert.match(
    source,
    /withCitySourceDeadline\(\s*fetchQWeather\([\s\S]*?\/v7\/minutely\/5m[\s\S]*?CITY_OPTIONAL_SOURCE_DEADLINE_MS\s*\)/
  );
  assert.match(
    source,
    /withCitySourceDeadline\(\s*locationIdPromise\.then\(\(id\) => loadQWeatherYesterdayRain[\s\S]*?CITY_OPTIONAL_SOURCE_DEADLINE_MS\s*\)/
  );
});

test("a redundant weather source timeout does not turn a complete city card into a data gap", () => {
  const current = briefing().current;
  const nextSixHours = briefing().nextSixHours;
  const status = classifyCityBriefingAvailability({
    current,
    nextSixHours,
    warningSourceAvailable: true
  });
  const result = briefing({
    status,
    sources: [
      {
        id: "open-meteo",
        label: "Open-Meteo 城市数值天气",
        evidenceLevel: "unavailable",
        updatedAt: null,
        status: "unavailable",
        limitation: "模式辅助源暂不可用。"
      },
      {
        id: "qweather-now",
        label: "和风天气城市代表点近实时天气",
        evidenceLevel: "observed",
        updatedAt: current.observedAt,
        status: "available",
        limitation: "城市代表点资料。"
      }
    ]
  });

  assert.equal(status, "available");
  assert.notEqual(buildCityPresentation(result).stage, "data_gap");
});

test("city availability still degrades when a required forecast or warning capability is missing", () => {
  const base = briefing();
  assert.equal(classifyCityBriefingAvailability({
    current: base.current,
    nextSixHours: { ...base.nextSixHours, sourceId: null },
    warningSourceAvailable: true
  }), "degraded");
  assert.equal(classifyCityBriefingAvailability({
    current: base.current,
    nextSixHours: base.nextSixHours,
    warningSourceAvailable: false
  }), "degraded");
  assert.equal(classifyCityBriefingAvailability({
    current: { ...base.current, sourceId: null },
    nextSixHours: base.nextSixHours,
    warningSourceAvailable: true
  }), "unavailable");
});

test("city location and full briefing share the same cached resolution path", async () => {
  const source = await readFile(resolve(process.cwd(), "lib/cityBriefingData.ts"), "utf8");
  assert.match(source, /const cityLocations = createCityFactsCache\(\s*\(query\) => retryCitySource\(\(\) => resolveCity\(query\)\)/);
  assert.match(source, /__typhoonCityLocationCacheV2/);
  assert.match(source, /__typhoonCityFactsCacheV3/);
  assert.match(source, /return cityLocations\.get\(cityQuery\)/);
  assert.match(source, /\(briefing\) => briefing\.status !== "unavailable"/);
});

test("an incomplete city result is not pinned in the five-minute facts cache", async () => {
  let loads = 0;
  const statuses = ["unavailable", "degraded", "available"] as const;
  const cache = createCityFactsCache(
    async () => ({ status: statuses[loads++] }),
    5 * 60_000,
    () => 0,
    (value) => value.status === "available"
  );

  assert.equal((await cache.get("惠州")).status, "unavailable");
  assert.equal((await cache.get("惠州")).status, "degraded");
  assert.equal((await cache.get("惠州")).status, "available");
  assert.equal(loads, 3);
});

test("a degraded city report with usable weather is cached instead of hammering every upstream again", async () => {
  let loads = 0;
  const cache = createCityFactsCache(
    async (): Promise<{
      status: CityBriefing["status"];
      current: { sourceId: "qweather-hourly" };
    }> => {
      loads += 1;
      return { status: "degraded", current: { sourceId: "qweather-hourly" } };
    },
    5 * 60_000,
    () => 0,
    (value) => value.status !== "unavailable"
  );

  const first = await cache.get("通辽");
  const second = await cache.get("通辽");

  assert.strictEqual(second, first);
  assert.equal(loads, 1);
});

test("city cache can retain resolved locations across module cache owners", async () => {
  const values = new Map<string, {
    expiresAt: number;
    value: { name: string };
  }>();
  let loads = 0;
  const first = createCityFactsCache(
    async () => ({ name: `city-${++loads}` }),
    60_000,
    () => 1_000,
    () => true,
    values
  );
  const second = createCityFactsCache(
    async () => ({ name: `city-${++loads}` }),
    60_000,
    () => 1_000,
    () => true,
    values
  );

  assert.equal((await first.get("通辽")).name, "city-1");
  assert.equal((await second.get("通辽")).name, "city-1");
  assert.equal(loads, 1);
});

test("essential city weather sources retry one transient failure", async () => {
  let attempts = 0;
  const value = await retryCitySource(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("fetch failed");
    return "weather";
  }, 2, 0);

  assert.equal(value, "weather");
  assert.equal(attempts, 2);
});

test("QWeather hourly first point becomes an explicitly modelled current baseline", () => {
  const current = summarizeQWeatherForecastCurrent({
    updateTime: "2026-07-26T08:45+08:00",
    hourly: [{
      fxTime: "2026-07-26T09:00+08:00",
      temp: "23",
      feelsLike: "22",
      humidity: "58",
      precip: "0",
      windSpeed: "18",
      icon: "101",
      text: "多云"
    }]
  });

  assert.equal(current?.sourceId, "qweather-hourly");
  assert.equal(current?.evidenceLevel, "model");
  assert.equal(current?.observedAt, "2026-07-26T09:00+08:00");
  assert.equal(current?.temperatureC, 23);
  assert.equal(current?.windSpeedMps, 5);
});

test("redundant core weather providers cannot create an eight-second pre-show stall", async () => {
  const source = await readFile(resolve(process.cwd(), "lib/cityBriefingData.ts"), "utf8");
  assert.match(source, /const CITY_CORE_WEATHER_DEADLINE_MS = 4_000/);
  assert.match(
    source,
    /withCitySourceDeadline\(\s*loadOpenMeteo\(city\),\s*"Open-Meteo core weather",\s*CITY_CORE_WEATHER_DEADLINE_MS\s*\)/
  );
  assert.match(
    source,
    /withCitySourceDeadline\(\s*loadQWeather\(city\),\s*"QWeather core weather",\s*CITY_CORE_WEATHER_DEADLINE_MS\s*\)/
  );
});

test("one failed geocoding spelling variant does not discard another valid city result", async () => {
  const valid = { name: "东莞", latitude: 23.02, longitude: 113.75 };
  const results = await collectCityGeocodingResults([
    Promise.reject(new Error("fetch failed")),
    Promise.resolve([valid])
  ]);

  assert.deepEqual(results, [valid]);
});

test("React queue and director are thin adapters over the pure scheduling and lens core", async () => {
  const queue = await readFile(resolve(process.cwd(), "components/useLiveCityInteractionQueue.ts"), "utf8");
  const director = await readFile(resolve(process.cwd(), "components/LiveDirector.tsx"), "utf8");
  const controller = await readFile(resolve(process.cwd(), "components/LiveCityInteraction.tsx"), "utf8");
  assert.match(queue, /transitionLiveDirectorQueue/);
  assert.match(queue, /CITY_SCENE_MIN_MS/);
  assert.match(queue, /CITY_SCENE_MAX_IDLE_MS/);
  assert.match(queue, /const CITY_COOLDOWN_MS = 10_000/);
  assert.doesNotMatch(queue, /const CITY_COOLDOWN_MS = 90_000/);
  assert.doesNotMatch(queue, /const MIN_ACTIVE_MS/);
  assert.match(controller, /shouldRetryResult: \(briefing\) => briefing\.status === "unavailable"/);
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
    geography: { scope: "city", locationIds: ["101270800"], provinceCode: "510000", cityCode, countyCode: null, names: ["广安市"], centroid: null, cityAttribution: attribution },
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
