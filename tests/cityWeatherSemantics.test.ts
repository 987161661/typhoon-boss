import assert from "node:assert/strict";
import test from "node:test";
import { currentWeatherText, isCurrentPrecipitation } from "../lib/cityWeatherSemantics";

test("QWeather precipitation amount does not override an explicit sunny condition", () => {
  const signal = { sourceId: "qweather-now" as const, weatherCode: 100, weatherText: "晴", precipitationMm: 10 };
  assert.equal(currentWeatherText(signal), "晴");
  assert.equal(isCurrentPrecipitation(signal), false);
});

test("explicit QWeather rain text and Open-Meteo rain codes identify current precipitation", () => {
  assert.equal(isCurrentPrecipitation({ sourceId: "qweather-now", weatherCode: 305, weatherText: "小雨" }), true);
  assert.equal(isCurrentPrecipitation({ sourceId: "open-meteo", weatherCode: 80 }), true);
  assert.equal(isCurrentPrecipitation({ sourceId: "open-meteo", weatherCode: 1 }), false);
});
