import assert from "node:assert/strict";
import test from "node:test";
import { buildCitySignalBoard } from "../lib/citySignalBoard";
import { buildCityPresentation, type CityBriefing } from "../lib/cityBriefingData";

function sample(overrides: Partial<CityBriefing> = {}): CityBriefing {
  const base: Omit<CityBriefing, "narrative"> = {
    city: { name: "郑州", province: "河南", country: "中国", latitude: 34.75, longitude: 113.63, timezone: "Asia/Shanghai" }, generatedAt: "2026-07-15T08:00:00Z", status: "available", headline: "test",
    current: { sourceId: "qweather-now", evidenceLevel: "observed", observedAt: "2026-07-15T08:00:00Z", temperatureC: 32, apparentTemperatureC: 35, relativeHumidityPct: 88, precipitationMm: 0, windSpeedMps: 3, windGustMps: null, weatherCode: null },
    nextSixHours: { sourceId: "qweather-hourly", startsAt: null, endsAt: null, precipitationMm: 0, maxHourlyPrecipitationMm: 0, maxPrecipitationProbabilityPct: 0, maxWindGustMps: 4, maxCapeJkg: 0 },
    minutelyRain: { available: true, updatedAt: "2026-07-15T08:00:00Z", summary: null, maxFiveMinutePrecipitationMm: 0, precipitationNextTwoHoursMm: 0 }, comparison: { scope: "全国省会样本", fetchedAt: "2026-07-15T08:00:00Z", relativeHumidityRank: { position: 2, total: 31, scope: "全国省会样本" }, apparentTemperatureRank: { position: 3, total: 31, scope: "全国省会样本" }, windSpeedRank: { position: 20, total: 31, scope: "全国省会样本" } },
    recentRain: { total24hMm: 0, observedDate: null, sourceId: "qweather-history", available: true }, officialWarnings: [], risks: [], sources: [], warnings: []
  };
  const merged = { ...base, ...overrides } as Omit<CityBriefing, "narrative">;
  return { ...merged, narrative: buildCityPresentation(merged) };
}

test("signal board promotes ranked humid heat and keeps scoped rank", () => {
  const board = buildCitySignalBoard(sample());
  const humidity = board.signals.find((signal) => signal.id === "humidity");
  assert.equal(humidity?.rank?.position, 2);
  assert.equal(humidity?.rank?.scope, "全国省会样本");
  assert.ok(board.signals.some((signal) => signal.id === "heat"));
});

test("ordinary readings collapse into one calm window", () => {
  const board = buildCitySignalBoard(sample({ current: { sourceId: "qweather-now", evidenceLevel: "observed", observedAt: null, temperatureC: 24, apparentTemperatureC: 25, relativeHumidityPct: 56, precipitationMm: 0, windSpeedMps: 2, windGustMps: null, weatherCode: null }, comparison: null }));
  assert.deepEqual(board.signals.map((signal) => signal.id), ["calm"]);
});

test("rain recovery is promoted before playful weather signals", () => {
  const board = buildCitySignalBoard(sample({ recentRain: { total24hMm: 78, observedDate: "2026-07-14", sourceId: "qweather-history", available: true } }));
  assert.equal(board.signals[0]?.id, "recent-rain");
  assert.match(board.signals[0]?.comment ?? "", /低洼/);
});
