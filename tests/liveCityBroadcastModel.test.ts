import assert from "node:assert/strict";
import test from "node:test";
import type { CityBriefing, CityHazardKind } from "../lib/cityBriefingData";
import { buildLiveCityBroadcastModel } from "../lib/liveCityBroadcastModel";
import { buildCityPanelsModel } from "../lib/cityPanelsPresentation";

function briefing(primaryKind: CityHazardKind = "rain", unavailable = false): CityBriefing {
  return {
    city: {
      name: "惠阳",
      province: "广东省",
      country: "中国",
      latitude: 22.79,
      longitude: 114.47,
      timezone: "Asia/Shanghai",
      cityCode: "441303",
      administrativePath: { province: "广东省", city: "惠州市", county: "惠阳区" }
    },
    generatedAt: "2026-07-16T08:00:00Z",
    status: unavailable ? "unavailable" : "available",
    headline: unavailable ? "资料暂不可用" : "短时降雨增强",
    current: {
      sourceId: unavailable ? null : "qweather-now",
      evidenceLevel: unavailable ? "unavailable" : "observed",
      observedAt: unavailable ? null : "2026-07-16T07:55:00Z",
      temperatureC: unavailable ? null : 31,
      apparentTemperatureC: unavailable ? null : 36,
      relativeHumidityPct: unavailable ? null : 78,
      precipitationMm: unavailable ? null : 4.2,
      windSpeedMps: unavailable ? null : 5.4,
      windGustMps: unavailable ? null : 9.8,
      weatherCode: unavailable ? null : 95
    },
    nextSixHours: {
      sourceId: unavailable ? null : "qweather-hourly",
      startsAt: unavailable ? null : "2026-07-16T08:00:00Z",
      endsAt: unavailable ? null : "2026-07-16T14:00:00Z",
      precipitationMm: unavailable ? null : 32,
      maxHourlyPrecipitationMm: unavailable ? null : 18,
      maxPrecipitationProbabilityPct: unavailable ? null : 90,
      maxWindGustMps: unavailable ? null : 16,
      maxCapeJkg: unavailable ? null : 1600
    },
    minutelyRain: {
      available: !unavailable,
      updatedAt: unavailable ? null : "2026-07-16T07:55:00Z",
      summary: unavailable ? null : "未来两小时雨势先增强后减弱",
      maxFiveMinutePrecipitationMm: unavailable ? null : 3.2,
      precipitationNextTwoHoursMm: unavailable ? null : 21
    },
    comparison: unavailable ? null : {
      scope: "全国城市",
      fetchedAt: "2026-07-16T07:55:00Z",
      precipitationRank: { position: 8, total: 300, scope: "全国城市" },
      relativeHumidityRank: { position: 180, total: 300, scope: "全国城市" }
    },
    recentRain: { total24hMm: unavailable ? null : 42, observedDate: "2026-07-15", sourceId: "qweather-history", available: !unavailable },
    officialWarnings: [],
    risks: ["rain", "wind", "convection", "heat"].map((kind) => ({
      kind: kind as CityHazardKind,
      level: kind === primaryKind ? "high" : "low",
      label: kind,
      summary: "",
      evidenceLevel: unavailable ? "unavailable" : "model",
      sourceIds: unavailable ? [] : ["qweather-hourly"]
    })),
    narrative: {
      engine: "template",
      stage: unavailable ? "data_gap" : "active",
      template: primaryKind === "calm" || primaryKind === "warning" ? "calm" : primaryKind,
      primaryKind,
      timeWindow: null,
      summary: unavailable ? "当前资料不足，无法形成可信判断。" : "短时信号已经抬升，请留意最新变化。",
      actions: ["避开低洼路段。", "持续留意官方预警更新。", "这条不应进入直播版。"],
      caveat: null,
      factRefs: []
    },
    sources: [{
      id: "qweather-warning",
      label: "和风天气预警",
      evidenceLevel: unavailable ? "unavailable" : "confirmed",
      updatedAt: unavailable ? null : "2026-07-16T07:55:00Z",
      status: unavailable ? "unavailable" : "available",
      limitation: unavailable ? "预警链路请求失败。" : "仅覆盖有效预警。"
    }],
    warnings: []
  };
}

function broadcast(input: CityBriefing) {
  const model = buildCityPanelsModel({
    briefing: input,
    audience: { requestId: "live-1", viewerName: "观众甲", viewerId: "viewer-1", platform: "simulator", accessSource: "unknown" },
    archive: { status: "locked", fragment: null }
  });
  return buildLiveCityBroadcastModel({ briefing: input, model });
}

test("broadcast preserves the authoritative county path and limits viewer actions", () => {
  const model = broadcast(briefing());
  assert.equal(model.cityLabel, "广东省 · 惠州市 · 惠阳区");
  assert.ok(Array.from(model.battle.summary).length <= 38);
  assert.equal(model.battle.actions.length, 2);
  assert.equal(model.info.metrics.length, 3);
});

test("hazard selection promotes the most useful signal without expanding the deck", () => {
  const expected: Array<[CityHazardKind, RegExp]> = [
    ["rain", /雨量|降水/],
    ["wind", /阵风|风速/],
    ["convection", /对流/],
    ["heat", /体感|温度/]
  ];
  for (const [hazard, label] of expected) {
    const model = broadcast(briefing(hazard));
    assert.match(model.battle.spotlight.label, label);
    assert.ok(model.info.metrics.length <= 3);
  }
});

test("broadcast restores the two strongest valid city ranks without a top-20-percent gate", () => {
  const ranked = broadcast(briefing());
  assert.deepEqual(ranked.battle.ranks.map((item) => item.position), [8, 180]);

  const ordinaryInput = briefing();
  ordinaryInput.comparison = {
    scope: "全国城市",
    fetchedAt: ordinaryInput.generatedAt,
    precipitationRank: { position: 120, total: 300, scope: "全国城市" }
  };
  assert.deepEqual(broadcast(ordinaryInput).battle.ranks.map((item) => item.position), [120]);

  const withoutComparison = briefing();
  withoutComparison.comparison = null;
  assert.deepEqual(broadcast(withoutComparison).battle.ranks, []);
});

test("broadcast carries the complete archive presentation instead of inventing a second access flow", () => {
  const input = briefing();
  const locked = broadcast(input);
  assert.equal(locked.battle.archive.status, "locked");
  assert.ok(locked.battle.archive.code.length > 0);

  const panels = buildCityPanelsModel({
    briefing: input,
    audience: { requestId: "live-unlocked", viewerName: "观众甲", accessSource: "observed" },
    archive: { status: "unlocked", fragment: "一段来自世界池的短档案。", code: "CA-LIVE-7" }
  });
  const unlocked = buildLiveCityBroadcastModel({ briefing: input, model: panels });
  assert.equal(unlocked.battle.archive.status, "unlocked");
  assert.equal(unlocked.battle.archive.fragment, "一段来自世界池的短档案。");
});

test("no-warning and missing-data states remain explicit rather than inventing safety", () => {
  const normal = broadcast(briefing());
  assert.match(normal.info.warning.title, /未报告有效官方预警/);
  assert.match(normal.info.warning.description ?? "", /不代表没有天气风险|不等于无风险/);

  const missing = broadcast(briefing("rain", true));
  assert.equal(missing.info.dataStatus, "unavailable");
  assert.ok(missing.info.metrics.every((metric) => metric.evidence === "unavailable"));
  assert.doesNotMatch(`${missing.battle.summary}${missing.info.warning.description}`, /安全|无风险$/);
});
