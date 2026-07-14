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

test("wind-led city does not fall back to a rain-first headline", () => {
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
  assert.match(result.summary, /阵风/);
});

test("quiet city reports a model signal rather than claiming no risk", () => {
  const result = buildCityPresentation(briefing());
  assert.equal(result.template, "calm");
  assert.match(result.summary, /当前模式未显示未来六小时突出的风雨信号/);
});

test("live-room mention accepts country and province-city forms", () => {
  assert.deepEqual(parseCityMention("@广东省广州市"), { raw: "广东省广州市", province: "广东", cityQuery: "广州市" });
  assert.deepEqual(parseCityMention("@中国北京"), { raw: "北京", province: "北京", cityQuery: "北京" });
});

test("a city-level mention never falls through to a same-name village", () => {
  const result = chooseCity([
    { name: "吉林", admin1: "广西", feature_code: "PPL", population: 0, latitude: 23.5, longitude: 107.4 },
    { name: "吉林市", admin1: "吉林", feature_code: "PPLA2", population: 1895865, latitude: 43.8, longitude: 126.5 }
  ], parseCityMention("@吉林市"));
  assert.equal(result.admin1, "吉林");
  assert.equal(result.name, "吉林市");
});
