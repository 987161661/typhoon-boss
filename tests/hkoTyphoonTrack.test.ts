import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeHkoForecastScenarios,
  normalizeHkoName,
  parseHkoTyphoonTrack
} from "../lib/hkoTyphoonTrack";

const fixture = `
<html><body>
<p><em>香 港 天 文 台 於 2026 年 07 月 26 日 06 時 30 分 發 出 之 天 氣 報 告</em></p>
<h2 align="center">颱 風 紅 霞</h2>
<pre>
預 測 的 位 置 和 強 度
2026 年 07 月 28 日 05 時 29.3 N 112.5 E 低 壓 區              每小時  40 公里
2026 年 07 月 27 日 05 時 25.9 N 113.6 E 熱 帶 低 氣 壓        每小時  55 公里
</pre>
<pre>
現 時 的 位 置 和 強 度
2026 年 07 月 26 日 06 時 22.8 N 114.7 E 颱 風                 每小時 145 公里
</pre>
<pre>
過 去 的 位 置 和 強 度
2026 年 07 月 26 日 05 時 22.7 N 114.8 E 颱 風                 每小時 145 公里
2026 年 07 月 26 日 02 時 22.4 N 115.1 E 強 颱 風              每小時 155 公里
</pre>
</body></html>`;

test("HKO text bulletin exposes its current fix without carrying unavailable pressure", () => {
  const report = parseHkoTyphoonTrack(fixture);

  assert.equal(normalizeHkoName(report.nameZh), "红霞");
  assert.equal(report.issuedAt, "2026-07-25T22:30:00.000Z");
  assert.deepEqual(report.current, {
    time: "2026-07-25T22:00:00.000Z",
    lat: 22.8,
    lon: 114.7,
    wind: 40.3,
    pressure: 0,
    stage: "台风"
  });
  assert.equal(report.history.length, 3);
  assert.equal(report.forecast.length, 1);
  assert.equal(report.forecast[0].pressure, 0);
});

test("HKO center recovery replaces only HKO and retains every other agency forecast", () => {
  const report = parseHkoTyphoonTrack(fixture);
  const scenarios = mergeHkoForecastScenarios([
    { id: "CMA-old", agency: "中国", agencyCode: "CMA", points: report.forecast, isPrimary: true },
    { id: "JMA-old", agency: "日本", agencyCode: "JMA", points: report.forecast, isPrimary: false },
    { id: "HKO-old", agency: "中国香港", agencyCode: "HKO", points: [], isPrimary: false }
  ], report);

  assert.deepEqual(scenarios.map((scenario) => scenario.agencyCode), ["HKO", "CMA", "JMA"]);
  assert.equal(scenarios.filter((scenario) => scenario.isPrimary).length, 1);
  assert.equal(scenarios[0].points.length, 1);
});
