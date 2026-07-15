import assert from "node:assert/strict";
import test from "node:test";
import type { CityBriefing } from "../lib/cityBriefingData";
import type { CityPanelsModel } from "../lib/cityPanelsPresentation";
import { buildCityBattleShowModel, resolveBattleNarrative, revealDelayFor, splitRevealText } from "../lib/cityBattleShowModel";

test("battle show keeps the safe narrative summary and stages at most two actions", () => {
  const briefing = sampleBriefing();
  const model = sampleModel();
  const show = buildCityBattleShowModel({ briefing, model });
  assert.equal(show.summary, briefing.narrative.summary);
  assert.equal(show.mutators.length, 3);
  assert.deepEqual(show.actions.map((action) => action.delayMs), [180, 330]);
  assert.equal(show.actions.length, 2);
  assert.equal(show.archive.statusText, "未检测到关注凭证");
  assert.doesNotMatch(show.archive.statusText, /关注主播/);
});

test("battle show refuses official title, issuer, description and instruction copy", () => {
  const briefing = sampleBriefing({
    narrative: { ...sampleBriefing().narrative, summary: "乌鲁木齐市气象台发布高温橙色预警信号" }
  });
  const show = buildCityBattleShowModel({ briefing, model: sampleModel() });
  const serialized = JSON.stringify(show);
  assert.doesNotMatch(serialized, /乌鲁木齐市气象台发布高温橙色预警信号/);
  assert.doesNotMatch(serialized, /乌鲁木齐市气象台/);
  assert.doesNotMatch(serialized, /停止高温时段户外作业/);
  assert.equal(show.summary, "热压副本已经装载，正午移动需要额外耐力。");
  assert.equal(resolveBattleNarrative(briefing, "热压副本已经装载，正午移动需要额外耐力。"), show.summary);
});

test("an archive fragment containing official copy degrades without relocking access", () => {
  const model = sampleModel();
  const show = buildCityBattleShowModel({
    briefing: sampleBriefing(),
    model,
    archive: { ...model.battle.archive, status: "unlocked", fragment: "乌鲁木齐市气象台：停止高温时段户外作业" }
  });
  assert.equal(show.archive.status, "unavailable");
  assert.equal(show.archive.fragment, null);
  assert.match(show.archive.statusText, /权限已确认/);
});

test("typewriter timing pauses on punctuation and preserves unicode code points", () => {
  assert.deepEqual(splitRevealText("雨☂。"), ["雨", "☂", "。"].map((value) => value.slice(0, 1)));
  assert.equal(revealDelayFor("雨", 42), 42);
  assert.equal(revealDelayFor("，", 42), 100.8);
  assert.equal(revealDelayFor("。", 42), 210);
});

function sampleModel(): CityPanelsModel {
  return {
    shared: {
      cityLabel: "新疆 · 乌鲁木齐",
      generatedAt: "2026-07-15T08:00:00Z",
      observedAt: "2026-07-15T07:55:00Z",
      dataStatus: "available",
      warningFeed: "active",
      viewerName: "小雨"
    },
    battle: {
      title: "赤昼占领",
      threatScore: 84,
      statusSeal: "ORANGE EVENT / HEAT",
      summary: "热压副本已经装载，正午移动需要额外耐力。",
      mutators: [
        { id: "heat", label: "正午移速", value: "DEBUFF", detail: "体感 38℃", comment: "阴凉处今天属于战略资源。", tone: "critical" },
        { id: "water", label: "补水冷却", value: "BUFF", detail: "循环补给", comment: "水杯正在争夺常驻装备位。", tone: "watch" },
        { id: "shade", label: "阴影资源", value: "RARE", detail: "路线资源", comment: "路线规划进入找阴影模式。", tone: "notable" },
        { id: "extra", label: "多余项", value: "DROP", detail: "不应出现", comment: "不应出现。", tone: "calm" }
      ],
      actions: ["避开正午暴晒窗口。", "补水并给行程留余量。", "第三条不应出现。"],
      archive: {
        status: "locked",
        code: "CA-650100-19",
        clearance: "OBSERVER // SEALED",
        teaserTokens: ["失去的时间片", "倒置校验码"],
        fragment: null,
        statusText: "未检测到关注凭证｜关注主播，登记为观测员并解锁本次档案。"
      }
    },
    info: {
      actions: ["避开午后高温时段。", "持续补水。"],
      warning: {
        status: "active",
        title: "乌鲁木齐市气象台发布高温橙色预警信号",
        level: "orange",
        issuer: "乌鲁木齐市气象台",
        issuedAt: "2026-07-15T06:00:00Z",
        effectiveAt: null,
        expiresAt: null,
        description: "预计午后部分区域最高气温超过37℃。",
        instruction: "停止高温时段户外作业",
        evidence: "official"
      },
      currentMetrics: [], nowcastMetrics: [], trendMetrics: [], risks: [], limitations: []
    }
  };
}

function sampleBriefing(overrides: Partial<CityBriefing> = {}): CityBriefing {
  const base = {
    city: { name: "乌鲁木齐", province: "新疆", country: "中国", latitude: 43.82, longitude: 87.62, timezone: "Asia/Shanghai" },
    generatedAt: "2026-07-15T08:00:00Z",
    status: "available" as const,
    headline: "高温环境持续",
    current: { sourceId: "qweather-now" as const, evidenceLevel: "observed" as const, observedAt: "2026-07-15T07:55:00Z", temperatureC: 36, apparentTemperatureC: 38, relativeHumidityPct: 31, precipitationMm: 0, windSpeedMps: 4, windGustMps: 7, weatherCode: 100 },
    nextSixHours: { sourceId: "qweather-hourly" as const, startsAt: "2026-07-15T08:00:00Z", endsAt: "2026-07-15T14:00:00Z", precipitationMm: 0, maxHourlyPrecipitationMm: 0, maxPrecipitationProbabilityPct: 10, maxWindGustMps: 9, maxCapeJkg: 120 },
    comparison: null,
    recentRain: { total24hMm: 0, observedDate: "2026-07-14", sourceId: "qweather-history" as const, available: true },
    minutelyRain: { available: true, updatedAt: "2026-07-15T07:55:00Z", precipitationNextTwoHoursMm: 0, maxFiveMinutePrecipitationMm: 0, summary: "未来两小时降水不明显" },
    officialWarnings: [{ title: "乌鲁木齐市气象台发布高温橙色预警信号", senderName: "乌鲁木齐市气象台", severity: "Orange", issuedAt: "2026-07-15T06:00:00Z", effectiveAt: null, expiresAt: null, description: "预计午后部分区域最高气温超过37℃。", instruction: "停止高温时段户外作业" }],
    risks: [],
    narrative: { engine: "template" as const, stage: "active" as const, template: "heat" as const, primaryKind: "heat" as const, timeWindow: { startsAt: "2026-07-15T08:00:00Z", endsAt: "2026-07-15T14:00:00Z" }, summary: "热浪把午后地图改成了耐力副本。", actions: ["补水"], caveat: null, factRefs: [] },
    sources: [], warnings: []
  } satisfies CityBriefing;
  return { ...base, ...overrides };
}
