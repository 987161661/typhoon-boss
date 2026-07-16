import assert from "node:assert/strict";
import test from "node:test";
import type { CityBriefing } from "../lib/cityBriefingData";
import { buildCityPanelsModel } from "../lib/cityPanelsPresentation";

function build(briefing: CityBriefing, accessSource: "observed" | "whitelist" | "unknown" = "unknown") {
  return buildCityPanelsModel({
    briefing,
    audience: {
      requestId: "request-city-1",
      viewerName: "观众甲",
      viewerId: "viewer-1",
      platform: "simulator",
      accessSource
    },
    archive: {
      status: accessSource === "unknown" ? "locked" : "unlocked",
      fragment: accessSource === "unknown" ? null : "第七码头没有船，只有一组比城市快了九分钟的雨痕，在玻璃背面反复校验同一段失踪时间。"
    }
  });
}

function sample(overrides: Partial<CityBriefing> = {}): CityBriefing {
  const base: CityBriefing = {
    city: {
      name: "郑州",
      province: "河南",
      country: "中国",
      latitude: 34.75,
      longitude: 113.63,
      timezone: "Asia/Shanghai",
      cityCode: "410100"
    },
    generatedAt: "2026-07-15T08:00:00Z",
    status: "available",
    headline: "当前天气平稳",
    current: {
      sourceId: "qweather-now",
      evidenceLevel: "observed",
      observedAt: "2026-07-15T07:55:00Z",
      temperatureC: 26,
      apparentTemperatureC: 27,
      relativeHumidityPct: 65,
      precipitationMm: 0,
      windSpeedMps: 2,
      windGustMps: null,
      weatherCode: 1
    },
    nextSixHours: {
      sourceId: "qweather-hourly",
      startsAt: "2026-07-15T08:00:00Z",
      endsAt: "2026-07-15T14:00:00Z",
      precipitationMm: 0,
      maxHourlyPrecipitationMm: 0,
      maxPrecipitationProbabilityPct: 10,
      maxWindGustMps: 4,
      maxCapeJkg: 30
    },
    minutelyRain: {
      available: true,
      updatedAt: "2026-07-15T07:55:00Z",
      summary: "短时无明显降雨",
      maxFiveMinutePrecipitationMm: 0,
      precipitationNextTwoHoursMm: 0
    },
    comparison: null,
    recentRain: { total24hMm: 0, observedDate: "2026-07-14", sourceId: "qweather-history", available: true },
    officialWarnings: [],
    risks: [
      { kind: "rain", level: "low", label: "降雨", summary: "", evidenceLevel: "model", sourceIds: ["qweather-hourly"] },
      { kind: "wind", level: "low", label: "大风", summary: "", evidenceLevel: "model", sourceIds: ["qweather-hourly"] },
      { kind: "convection", level: "low", label: "对流", summary: "", evidenceLevel: "model", sourceIds: ["qweather-hourly"] },
      { kind: "heat", level: "low", label: "高温", summary: "", evidenceLevel: "model", sourceIds: ["qweather-hourly"] }
    ],
    narrative: {
      engine: "template",
      stage: "ordinary_weather",
      template: "calm",
      primaryKind: "calm",
      timeWindow: null,
      summary: "【短时平稳】天气暂时把音量调低，这不是永久免战牌。",
      actions: ["照常安排行程，并留意预警更新。"],
      caveat: null,
      factRefs: ["qweather-now", "qweather-hourly"]
    },
    sources: [
      { id: "qweather-warning", label: "和风天气预警", evidenceLevel: "confirmed", updatedAt: "2026-07-15T07:55:00Z", status: "available", limitation: "仅覆盖有效预警。" }
    ],
    warnings: []
  };
  return { ...base, ...overrides };
}

test("available warning feed with no record is none-reported without claiming safety", () => {
  const model = build(sample());
  assert.equal(model.shared.warningFeed, "none-reported");
  assert.match(model.info.warning.title, /未报告有效官方预警/);
  assert.doesNotMatch(`${model.battle.summary}${model.info.warning.description}`, /安全|无风险/);
  assert.equal(model.battle.title, "短时休战");
  assert.equal(model.info.currentMetrics.length, 6);
  assert.equal(model.info.nowcastMetrics.length, 2);
  assert.equal(model.info.trendMetrics.length, 4);
});

test("a county target displays its authoritative prefecture path instead of collapsing to province and county", () => {
  const model = build(sample({
    city: {
      ...sample().city,
      name: "惠阳",
      province: "广东省",
      administrativePath: { province: "广东省", city: "惠州市", county: "惠阳区" }
    }
  }));
  assert.equal(model.shared.cityLabel, "广东省 · 惠州市 · 惠阳区");
});

test("missing or failed warning source is unavailable rather than no-warning", () => {
  const model = build(sample({
    sources: [{
      id: "qweather-warning",
      label: "和风天气预警",
      evidenceLevel: "unavailable",
      updatedAt: null,
      status: "unavailable",
      limitation: "预警服务请求失败。"
    }]
  }));
  assert.equal(model.shared.warningFeed, "unavailable");
  assert.equal(model.info.warning.title, "预警链路不可用");
  assert.match(model.info.warning.description ?? "", /不能据此判断无预警|请求失败/);
  assert.deepEqual(model.info.limitations, ["预警服务请求失败。"]) ;
});

test("prioritized situation warning overrides legacy narrative and drives official risk", () => {
  const model = build(sample({
    situation: {
      target: { name: "郑州", cityCode: "410100" },
      mode: "official-warning",
      headline: "郑州市气象台发布暴雨红色预警。",
      primaryWarning: {
        id: "warning-1",
        kind: "official-warning",
        hazard: "rain",
        title: "暴雨红色预警",
        level: "red",
        evidenceLevel: "official",
        issuedAt: "2026-07-15T07:30:00Z",
        dataTime: "2026-07-15T07:30:00Z",
        updatedAt: "2026-07-15T07:31:00Z",
        expiresAt: "2026-07-15T13:30:00Z",
        geography: {
          scope: "city",
          locationIds: ["101180101"],
          provinceCode: "410000",
          cityCode: "410100",
          countyCode: null,
          names: ["郑州"],
          centroid: { longitude: 113.63, latitude: 34.75 },
          cityAttribution: "deterministic"
        },
        sourceIds: ["qweather-warning"],
        factSummary: "预计未来三小时有强降雨。",
        limitations: []
      },
      officialWarnings: [],
      anomalies: [],
      ordinarySummary: null,
      limitations: []
    }
  }));
  assert.equal(model.shared.warningFeed, "active");
  assert.equal(model.battle.title, "雨云候场");
  assert.doesNotMatch(JSON.stringify(model.battle), /郑州市气象台发布暴雨红色预警|预计未来三小时有强降雨/);
  assert.equal(model.battle.threatScore, 96);
  assert.equal(model.info.risks.find((risk) => risk.id === "rain")?.evidence, "official");
  assert.equal(model.info.risks.find((risk) => risk.id === "rain")?.level, "severe");
});

test("metric formatting preserves a real zero and labels null as unavailable", () => {
  const model = build(sample({
    current: {
      ...sample().current,
      precipitationMm: 0,
      windGustMps: null
    }
  }));
  const precipitation = model.info.currentMetrics.find((metric) => metric.id === "precipitation-now");
  const gust = model.info.currentMetrics.find((metric) => metric.id === "wind-gust");
  assert.deepEqual({ value: precipitation?.value, unit: precipitation?.unit }, { value: "0", unit: "mm" });
  assert.deepEqual({ value: gust?.value, unit: gust?.unit }, { value: "暂无资料", unit: undefined });
});

test("playful copy is deterministic and battle lists remain capped", () => {
  const rainy = sample({
    current: { ...sample().current, apparentTemperatureC: 35, relativeHumidityPct: 91 },
    nextSixHours: { ...sample().nextSixHours, precipitationMm: 18, maxHourlyPrecipitationMm: 8, maxWindGustMps: 19 },
    minutelyRain: { ...sample().minutelyRain, precipitationNextTwoHoursMm: 12, maxFiveMinutePrecipitationMm: 2 },
    recentRain: { total24hMm: 80, observedDate: "2026-07-14", sourceId: "qweather-history", available: true },
    narrative: { ...sample().narrative, primaryKind: "rain", template: "rain", actions: ["行动一", "行动二", "行动三"] }
  });
  const first = build(rainy);
  const second = build(rainy);
  assert.deepEqual(first.battle.mutators, second.battle.mutators);
  assert.deepEqual(first.battle.archive, second.battle.archive);
  assert.equal(first.battle.mutators.length, 3);
  assert.equal(first.battle.actions.length, 2);
});

test("all four practical risks exist even when data is unavailable", () => {
  const model = build(sample({
    status: "unavailable",
    risks: [],
    situation: {
      target: { name: "郑州", cityCode: "410100" },
      mode: "data-unavailable",
      headline: "资料不可用，无法判断城市预警风险。",
      primaryWarning: null,
      officialWarnings: [],
      anomalies: [],
      ordinarySummary: null,
      limitations: ["城市资料暂不可用。"]
    }
  }));
  assert.equal(model.battle.title, "信号迷雾");
  assert.equal(model.battle.threatScore, 0);
  assert.deepEqual(model.info.risks.map((risk) => risk.id), ["rain", "wind", "convection", "heat"]);
  assert.ok(model.info.risks.every((risk) => risk.level === "unavailable" && risk.evidence === "unavailable"));
});

test("orange heat warning becomes a playful heat battle while official facts stay info-only", () => {
  const officialTitle = "新疆维吾尔自治区乌鲁木齐市头屯河区发布高温橙色预警信号";
  const issuer = "乌鲁木齐市头屯河区气象台";
  const instruction = "请有关单位和人员做好防暑降温准备。";
  const briefing = sample({
    city: { ...sample().city, name: "乌鲁木齐", province: "新疆维吾尔自治区", cityCode: "650100" },
    current: { ...sample().current, temperatureC: 38, apparentTemperatureC: 42 },
    officialWarnings: [{
      title: officialTitle,
      severity: "orange",
      issuedAt: "2026-07-15T06:00:00Z",
      senderName: issuer,
      effectiveAt: "2026-07-15T06:00:00Z",
      expiresAt: "2026-07-15T18:00:00Z",
      description: "预计白天最高气温将升至37℃以上。",
      instruction
    }],
    narrative: { ...sample().narrative, primaryKind: "heat", template: "heat" },
    risks: sample().risks.map((risk) => risk.kind === "heat" ? { ...risk, level: "severe" as const } : risk)
  });
  const model = build(briefing);
  const battleText = JSON.stringify(model.battle);

  assert.equal(model.battle.title, "赤昼占领");
  assert.equal(model.battle.threatScore, 84);
  assert.equal(model.battle.statusSeal, "ORANGE EVENT / HEAT");
  assert.doesNotMatch(battleText, new RegExp([officialTitle, issuer, instruction, "官方预警", "以属地最新发布为准", "这不是整活区"].join("|")));
  assert.equal(model.info.warning.title, officialTitle);
  assert.equal(model.info.warning.issuer, issuer);
  assert.equal(model.info.warning.instruction, instruction);
});

test("information channel removes duplicate official copy and does not repeat battle tactics", () => {
  const title = "新疆维吾尔自治区乌鲁木齐市头屯河区发布高温橙色预警信号";
  const briefing = sample({
    officialWarnings: [{
      title,
      severity: "orange",
      issuedAt: "2026-07-15T06:00:00Z",
      senderName: "乌鲁木齐市头屯河区气象台",
      effectiveAt: "2026-07-15T06:00:00Z",
      expiresAt: null,
      description: ` ${title}。 `,
      instruction: "预警有效期和防御指引以发布机构详情原文为准。"
    }],
    narrative: { ...sample().narrative, primaryKind: "heat", template: "heat" }
  });
  const model = build(briefing);

  assert.equal(model.info.warning.title, title);
  assert.equal(model.info.warning.description, null);
  assert.notDeepEqual(model.info.actions, model.battle.actions);
  assert.equal(model.info.actions.length, 2);
});

test("information model keeps same-city secondary official warnings without replacing the primary", () => {
  const briefing = sample({
    officialWarnings: [
      { title: "暴雨红色预警", severity: "red", issuedAt: "2026-07-15T07:00:00Z", senderName: "甲气象台", effectiveAt: null, expiresAt: null, description: "暴雨持续", instruction: "减少外出" },
      { title: "雷电黄色预警", severity: "yellow", issuedAt: "2026-07-15T08:00:00Z", senderName: "甲气象台", effectiveAt: null, expiresAt: null, description: "伴有雷电", instruction: "远离空旷处" },
      { title: "大风蓝色预警", severity: "blue", issuedAt: "2026-07-15T09:00:00Z", senderName: "甲气象台", effectiveAt: null, expiresAt: null, description: "阵风增强", instruction: "加固易坠物" }
    ]
  });
  const model = build(briefing);

  assert.equal(model.info.warning.title, "暴雨红色预警");
  assert.deepEqual(model.info.relatedWarnings.map((warning) => warning.title), ["雷电黄色预警", "大风蓝色预警"]);
  assert.equal(model.info.relatedWarnings.every((warning) => warning.evidence === "official"), true);
});

test("archive exposes one conversion prompt only while weather remains available", () => {
  const locked = build(sample());
  const unlocked = build(sample(), "observed");

  assert.equal(locked.battle.archive.status, "locked");
  assert.match(locked.battle.archive.statusText, /未检测到关注凭证/);
  assert.equal((JSON.stringify(locked).match(/关注主播/g) ?? []).length, 1);
  assert.equal(unlocked.battle.archive.status, "unlocked");
  assert.ok(unlocked.battle.archive.fragment);
  assert.equal(unlocked.info.currentMetrics.length, locked.info.currentMetrics.length);
});

test("unknown access cannot reveal a fragment even if an inconsistent caller marks it unlocked", () => {
  const model = buildCityPanelsModel({
    briefing: sample(),
    audience: { requestId: "request-guard", viewerName: "观众乙", accessSource: "unknown" },
    archive: { status: "unlocked", fragment: "这条碎片不应向未知访问状态公开。" }
  });
  assert.equal(model.battle.archive.status, "locked");
  assert.equal(model.battle.archive.fragment, null);
  assert.match(model.battle.archive.statusText, /未检测到关注凭证/);
});
