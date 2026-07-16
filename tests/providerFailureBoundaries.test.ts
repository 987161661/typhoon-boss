import assert from "node:assert/strict";
import test from "node:test";
import { parseChinaWeatherProductPayload } from "../lib/chinaWeatherProductFeed";
import { parseChinaWeatherJsonp } from "../lib/chinaWeatherVisualFeed";
import { parseChinaWeatherAlarmScript } from "../lib/chinaWeatherWarningFeed";
import { evaluateSourceFreshness } from "../lib/nationalWeather";
import { assertWeatherProviderResponse, describeWeatherProviderFailure } from "../lib/weatherProviderBoundary";

test("provider boundary explains timeout and 403 without rewriting them as no-risk", () => {
  const timeout = describeWeatherProviderFailure("radar", new DOMException("request timed out", "TimeoutError"));
  assert.equal(timeout.kind, "timeout");
  assert.match(timeout.message, /unavailable, not no-risk/);

  assert.throws(
    () => assertWeatherProviderResponse({ ok: false, status: 403 }, "product feed"),
    /forbidden by upstream; last-good snapshot remains authoritative/
  );
  const forbidden = describeWeatherProviderFailure("product feed", new Error("HTTP 403"));
  assert.equal(forbidden.kind, "forbidden");
  assert.match(forbidden.message, /last-good snapshot is retained/);
});

test("invalid JSON and JSONP are rejected before they can become weather facts", () => {
  assert.throws(() => parseChinaWeatherProductPayload("{broken"), SyntaxError);
  assert.throws(() => parseChinaWeatherAlarmScript("var alarminfo = {broken};"), SyntaxError);
  assert.throws(() => parseChinaWeatherJsonp("readerinfo({broken})", "readerinfo"), SyntaxError);
  assert.throws(() => parseChinaWeatherJsonp("alert('not data')", "readerinfo"), /Unexpected JSONP payload/);
});

test("valid empty feeds become no-record rather than unavailable or safe", () => {
  assert.equal(parseChinaWeatherAlarmScript('var alarminfo = {"count":0,"data":[]};').data.length, 0);
  assert.deepEqual(parseChinaWeatherJsonp("readerinfo({'radars':[]})", "readerinfo"), { radars: [] });
  assert.deepEqual(parseChinaWeatherProductPayload('{"status":"ok","result":{"list":[]}}').result?.list, []);
  assert.equal(evaluateSourceFreshness({
    lastSuccessfulAt: "2026-07-15T06:00:00.000Z",
    now: "2026-07-15T06:01:00.000Z",
    refreshIntervalMinutes: 5,
    available: true,
    hasRecords: false
  }), "no-record");
});
