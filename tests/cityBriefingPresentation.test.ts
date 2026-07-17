import assert from "node:assert/strict";
import test from "node:test";
import { buildCityPresentation, chooseCity, parseCityMention, type CityBriefing } from "../lib/cityBriefingData";

function briefing(overrides: Partial<CityBriefing> = {}): Omit<CityBriefing, "narrative"> {
  const base: Omit<CityBriefing, "narrative"> = {
    city: { name: "Test City", province: null, country: "China", latitude: 0, longitude: 0, timezone: "Asia/Shanghai" },
    generatedAt: "2026-07-14T12:00:00Z",
    status: "available",
    headline: "test",
    current: { sourceId: "open-meteo", evidenceLevel: "model", observedAt: "2026-07-14T12:00:00Z", temperatureC: 26, apparentTemperatureC: 27, relativeHumidityPct: 70, precipitationMm: 0, windSpeedMps: 3, windGustMps: 5, weatherCode: 1 },
    nextSixHours: { sourceId: "open-meteo", startsAt: "2026-07-14T12:00:00Z", endsAt: "2026-07-14T18:00:00Z", precipitationMm: 0.3, maxHourlyPrecipitationMm: 0.1, maxPrecipitationProbabilityPct: 12, maxWindGustMps: 4, maxCapeJkg: 50 },
    minutelyRain: { available: false, updatedAt: null, summary: null, maxFiveMinutePrecipitationMm: null, precipitationNextTwoHoursMm: null },
    comparison: null,
    officialWarnings: [],
    risks: [
      { kind: "rain", level: "low", label: "rain", summary: "", evidenceLevel: "model", sourceIds: ["open-meteo"] },
      { kind: "wind", level: "low", label: "wind", summary: "", evidenceLevel: "model", sourceIds: ["open-meteo"] },
      { kind: "convection", level: "low", label: "convection", summary: "", evidenceLevel: "model", sourceIds: ["open-meteo"] },
      { kind: "heat", level: "low", label: "heat", summary: "", evidenceLevel: "model", sourceIds: ["open-meteo"] }
    ],
    sources: [],
    warnings: []
  };
  return { ...base, ...overrides };
}

test("official warning always overrides model-derived city risk", () => {
  const result = buildCityPresentation(briefing({
    officialWarnings: [{
      title: "暴雨橙色预警",
      severity: "orange",
      issuedAt: "2026-07-14T12:00:00Z",
      senderName: "测试气象台",
      effectiveAt: "2026-07-14T12:00:00Z",
      expiresAt: "2026-07-14T18:00:00Z",
      description: "测试预警正文",
      instruction: "测试防御指引"
    }]
  }));
  assert.equal(result.template, "warning");
  assert.match(result.summary, /暴雨橙色预警/);
});

test("wind-led city renders a wind battle report", () => {
  const result = buildCityPresentation(briefing({
    risks: [
      { kind: "rain", level: "low", label: "rain", summary: "", evidenceLevel: "model", sourceIds: ["open-meteo"] },
      { kind: "wind", level: "high", label: "wind", summary: "", evidenceLevel: "model", sourceIds: ["open-meteo"] },
      { kind: "convection", level: "low", label: "convection", summary: "", evidenceLevel: "model", sourceIds: ["open-meteo"] },
      { kind: "heat", level: "low", label: "heat", summary: "", evidenceLevel: "model", sourceIds: ["open-meteo"] }
    ],
    nextSixHours: { ...briefing().nextSixHours, maxWindGustMps: 21 }
  }));
  assert.equal(result.template, "wind");
  assert.match(result.summary, /风场扰动/);
});

test("quiet city uses a calm battle-report voice without claiming safety", () => {
  const result = buildCityPresentation(briefing());
  assert.equal(result.template, "calm");
  assert.match(result.summary, /短时平稳/);
  assert.doesNotMatch(result.summary, /安全/);
});

test("heat-led city with an incoming rain signal uses the combined state", () => {
  const result = buildCityPresentation(briefing({
    risks: [
      { kind: "rain", level: "moderate", label: "rain", summary: "", evidenceLevel: "model", sourceIds: ["open-meteo"] },
      { kind: "wind", level: "low", label: "wind", summary: "", evidenceLevel: "model", sourceIds: ["open-meteo"] },
      { kind: "convection", level: "low", label: "convection", summary: "", evidenceLevel: "model", sourceIds: ["open-meteo"] },
      { kind: "heat", level: "high", label: "heat", summary: "", evidenceLevel: "model", sourceIds: ["open-meteo"] }
    ],
    current: { ...briefing().current, temperatureC: 32, apparentTemperatureC: 35 },
    nextSixHours: { ...briefing().nextSixHours, precipitationMm: 6.3, maxHourlyPrecipitationMm: 4.6, maxPrecipitationProbabilityPct: 78 }
  }));
  assert.match(result.summary, /闷热待雨/);
  assert.match(result.summary, /伞|雨/);
});

test("QWeather rain is narrated as a representative-point condition, not a whole-city fact", () => {
  const result = buildCityPresentation(briefing({
    current: {
      ...briefing().current,
      sourceId: "qweather-now",
      evidenceLevel: "observed",
      precipitationMm: 10,
      weatherCode: 305,
      weatherText: "小雨"
    },
    risks: [
      { kind: "rain", level: "moderate", label: "rain", summary: "", evidenceLevel: "model", sourceIds: ["qweather-minutely"] }
    ]
  }));
  assert.match(result.summary, /代表点小雨/);
  assert.match(result.summary, /不代表全城同步降雨/);
  assert.doesNotMatch(result.summary, /雨幕进行中|雨云已占领/);
});

test("live-room mention accepts country and province-city forms", () => {
  assert.deepEqual(parseCityMention("@广东省广州市"), { raw: "广东省广州市", province: "广东", cityQuery: "广州市" });
  assert.deepEqual(parseCityMention("@中国北京"), { raw: "北京", province: "北京", cityQuery: "北京" });
});

test("Hong Kong and Macao can be queried as city-level mentions", () => {
  assert.deepEqual(parseCityMention("@香港"), { raw: "香港", province: "香港", cityQuery: "香港" });
  assert.deepEqual(parseCityMention("@澳门"), { raw: "澳门", province: "澳门", cityQuery: "澳门" });
});

test("a city-level mention never falls through to a same-name village", () => {
  const result = chooseCity([
    { name: "吉林", admin1: "广西", feature_code: "PPL", population: 0, latitude: 23.5, longitude: 107.4 },
    { name: "吉林市", admin1: "吉林", feature_code: "PPLA2", population: 1895865, latitude: 43.8, longitude: 126.5 }
  ], parseCityMention("@吉林市"));
  assert.equal(result.admin1, "吉林");
  assert.equal(result.name, "吉林市");
});

test("a prefecture-level city keeps its matching admin2 result when Open-Meteo labels it PPL", () => {
  const result = chooseCity([
    { name: "蚌埠", admin1: "安徽", admin2: "蚌埠市", country_code: "CN", feature_code: "PPL", population: 972784, latitude: 32.94, longitude: 117.36 }
  ], parseCityMention("@蚌埠"));
  assert.equal(result.name, "蚌埠");
});
