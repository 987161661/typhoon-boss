import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCityReportEngagementPrompt,
  extractChinaCityMention,
  isHostLiveComment,
  isHostViewerRelationEvent,
  toCityInteractionRequest,
  viewerIdentityKey
} from "../lib/liveCityInteraction";

const ordinaryBriefing = {
  city: { name: "上海" },
  current: {
    temperatureC: 36,
    apparentTemperatureC: 42,
    relativeHumidityPct: 78,
    precipitationMm: 0,
    windSpeedMps: 2.1,
    weatherText: "晴"
  },
  comparison: {
    scope: "全国城市",
    apparentTemperatureRank: { position: 2, total: 300 }
  },
  officialWarnings: [],
  situation: { mode: "ordinary" as const, anomalies: [] }
};

test("successful city reports create a viewer-specific result event without a CTA trigger", () => {
  const prompt = buildCityReportEngagementPrompt({
    cityQuery: "伊宁市",
    viewerName: "小雨",
    followEvidence: "unknown"
  }, { ...ordinaryBriefing, city: { name: "伊宁" } });

  assert.ok(prompt);
  assert.match(prompt, /<city_report_engagement>/);
  assert.match(prompt, /@小雨/);
  assert.match(prompt, /查询城市：伊宁/);
  assert.match(prompt, /气温36℃/);
  assert.match(prompt, /体感温度第2\/300/);
  assert.match(prompt, /幽默毒舌/);
  assert.match(prompt, /你们人类/);
  assert.match(prompt, /不索取关注点赞礼物/);
  assert.match(prompt, /不要说“战报已经展开”/);
  assert.ok(prompt.length <= 500, "avatar bridge rejects prompts longer than 500 characters");
});

test("official warnings stay lively without disaster jokes", () => {
  const prompt = buildCityReportEngagementPrompt({ cityQuery: "上海", viewerName: "阿海", followEvidence: "unknown" }, {
    ...ordinaryBriefing,
    officialWarnings: [{ title: "高温橙色预警", severity: "orange" }],
    situation: { mode: "official-warning", anomalies: [] }
  }) ?? "";
  assert.match(prompt, /官方预警：高温橙色预警/);
  assert.match(prompt, /有趣但不玩灾害梗/);
  assert.match(prompt, /不夸大成已发生灾害/);
  assert.doesNotMatch(prompt, /普通天气：幽默毒舌/);
});

test("only explicitly confirmed disasters switch the host to serious safety-first speech", () => {
  const prompt = buildCityReportEngagementPrompt({ cityQuery: "某地", viewerName: "小雨", followEvidence: "unknown" }, {
    ...ordinaryBriefing,
    city: { name: "某地" },
    situation: { mode: "observed-anomaly", anomalies: [{ severity: "severe", factSummary: "体感温度达到40℃" }] },
    confirmedDisaster: { factSummary: "城区已确认发生内涝并正在救援" }
  }) ?? "";
  assert.match(prompt, /已确认灾害实况：城区已确认发生内涝并正在救援/);
  assert.match(prompt, /严肃、清晰、安全优先，不调侃/);
});

test("a severe weather anomaly alone is not mislabeled as an occurring disaster", () => {
  const prompt = buildCityReportEngagementPrompt({ cityQuery: "上海", viewerName: "阿海", followEvidence: "unknown" }, {
    ...ordinaryBriefing,
    situation: { mode: "observed-anomaly", anomalies: [{ severity: "severe", factSummary: "体感温度达到40℃" }] }
  }) ?? "";
  assert.match(prompt, /普通天气：幽默毒舌/);
  assert.doesNotMatch(prompt, /已确认灾害实况|严肃、清晰/);
});

test("city engagement ignores follow evidence and requires a real viewer name", () => {
  const prompt = buildCityReportEngagementPrompt({
    cityQuery: "上海",
    viewerName: "@阿海",
    followEvidence: "observed"
  }, ordinaryBriefing);

  assert.ok(prompt);
  assert.match(prompt, /@阿海/);
  assert.doesNotMatch(prompt, /@@阿海/);
  assert.doesNotMatch(prompt, /平台已确认|当前未知|关注依据/);
  assert.equal(buildCityReportEngagementPrompt({
    cityQuery: "上海",
    viewerName: null,
    followEvidence: "unknown"
  }, ordinaryBriefing), null);
});

test("city interaction only accepts a bounded Chinese @city mention", () => {
  assert.equal(extractChinaCityMention("请看 @杭州"), "杭州");
  assert.equal(extractChinaCityMention("@杭州市，天气怎样"), "杭州市");
  assert.equal(extractChinaCityMention("@深圳#战况"), "深圳");
  assert.equal(extractChinaCityMention("杭州天气如何"), null);
  assert.equal(extractChinaCityMention("@Auckland"), null);
  assert.equal(extractChinaCityMention("@杭州今天会不会下雨"), null);
});

test("city mentions retain administrative context for live-room resolution", () => {
  assert.equal(extractChinaCityMention("@吉林市"), "吉林市");
  assert.equal(extractChinaCityMention("@广东省广州市"), "广东省广州市");
  assert.equal(extractChinaCityMention("@中国北京"), "中国北京");
});

test("host bridge comment is shape-checked before it can enter the city queue", () => {
  const comment = {
    type: "aituber:live-comment",
    version: 1,
    id: "comment-1",
    text: "@北京",
    viewerName: "测试观众",
    receivedAt: 1_783_000_000_000
  } as const;
  assert.equal(isHostLiveComment(comment), true);
  assert.deepEqual(toCityInteractionRequest(comment), {
    id: "comment-1",
    cityQuery: "北京",
    viewerId: null,
    viewerName: "测试观众",
    platform: null,
    followEvidence: "unknown",
    followObservedAt: null,
    receivedAt: 1_783_000_000_000
  });
  assert.equal(isHostLiveComment({ ...comment, text: "" }), false);
  assert.equal(isHostLiveComment({ ...comment, version: 2 }), false);
});

test("viewer relation requires an exact platform and viewer id", () => {
  const event = {
    type: "aituber:viewer-relation",
    version: 1,
    id: "follow-1",
    relation: "follow",
    state: "verified",
    viewerId: "U-42",
    viewerName: "同名观众",
    platform: "BILIBILI",
    observedAt: 1_783_000_000_100
  } as const;
  assert.equal(isHostViewerRelationEvent(event), true);
  assert.equal(viewerIdentityKey(event.platform, event.viewerId), "bilibili:U-42");
  assert.notEqual(viewerIdentityKey("bilibili", "U-42"), viewerIdentityKey("douyin", "U-42"));
  assert.notEqual(viewerIdentityKey("bilibili", "U-42"), viewerIdentityKey("bilibili", "u-42"));
  assert.equal(isHostViewerRelationEvent({ ...event, viewerId: " " }), false);
});
