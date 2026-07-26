import assert from "node:assert/strict";
import test from "node:test";
import { buildLiveBroadcastModel } from "../components/LiveBroadcastView";
import { narrateCitySituation } from "../lib/cityNarration";
import type { BossProfile } from "../lib/bossEngine/types";
import type { Storm } from "../lib/types";

test("a provider distance description is broadcast as a center-position report, not a city arrival", () => {
  const observedAt = new Date().toISOString();
  const storm = stormFixture({
    time: observedAt,
    lon: 123,
    lat: 18.7,
    wind: 20,
    pressure: 995,
    locationDescription: "距离广东省汕尾市东偏南方向约910公里"
  });

  const model = buildLiveBroadcastModel({
    storm,
    sourceLabel: "公开路径",
    lastUpdated: observedAt
  });

  assert.deepEqual(model.cityTickerItems, [{
    id: `${observedAt}-距离广东省汕尾市东偏南方向约910公里`,
    message: `${compactTime(observedAt)} 公开实况：台风中心距离广东省汕尾市东偏南方向约910公里，中心最大风力 8 级`
  }]);
  assert.doesNotMatch(model.cityTickerItems[0]?.message ?? "", /已抵达|预计.*抵达/);
});

test("a future-dated track point is not converted into a current position report", () => {
  const pointTime = new Date(Date.now() + 30 * 60_000).toISOString();
  const model = buildLiveBroadcastModel({
    storm: stormFixture({
      time: pointTime,
      lon: 123,
      lat: 18.7,
      wind: 20,
      pressure: 995,
      locationDescription: "距离广东省汕尾市东偏南方向约910公里"
    }),
    sourceLabel: "公开路径",
    lastUpdated: pointTime
  });

  assert.deepEqual(model.cityTickerItems, []);
});

test("an inferred landfall window remains labeled as a path scenario after its estimated time", () => {
  const observedAt = new Date().toISOString();
  const estimatedAt = new Date(Date.now() - 60_000).toISOString();
  const model = buildLiveBroadcastModel({
    storm: stormFixture({ time: observedAt, wind: 20, lon: 123, lat: 18.7, pressure: 995 }),
    bossProfile: inferredLandfallProfile(estimatedAt),
    sourceLabel: "公开路径",
    lastUpdated: observedAt
  });

  const priority = model.landfallScenarios.find((scenario) => scenario.isPriority);
  assert.equal(priority?.priorityReason, "路径推演 · 预计时段已到");
  assert.doesNotMatch(priority?.priorityReason ?? "", /登陆后|官方确认/);
});

test("an official landfall record overrides a later inferred forecast in the headline", () => {
  const observedAt = new Date().toISOString();
  const officialAt = new Date(Date.now() - 4 * 60 * 60_000).toISOString();
  const forecastAt = new Date(Date.now() + 5 * 60 * 60_000).toISOString();
  const storm = stormFixture({ time: observedAt, wind: 35, lon: 114.6, lat: 22.7, pressure: 970 });
  storm.landfalls = [{
    time: officialAt,
    place: "广东省惠州市惠东县平海镇登",
    lat: 22.59,
    lon: 114.81,
    note: "第12号台风“红霞”已于7月26日03时50分前后在广东省惠州市惠东县平海镇登陆"
  }];

  const model = buildLiveBroadcastModel({
    storm,
    bossProfile: inferredLandfallProfile(forecastAt),
    sourceLabel: "公开路径",
    lastUpdated: observedAt
  });

  assert.equal(model.landfall.label, "已登陆");
  assert.equal(model.landfall.place, "广东省惠州市惠东县平海镇");
  assert.equal(model.landfall.time, `${compactTime(officialAt)} 前后`);
  assert.match(model.landfall.detail, /正式登陆记录/);
  assert.doesNotMatch(`${model.landfall.label}${model.landfall.detail}`, /预计登陆|路径推算/);
});

test("missing eye-wall analysis falls back to verified intensity and wind-radius facts", () => {
  const observedAt = new Date().toISOString();
  const storm = stormFixture({ time: observedAt, wind: 35, lon: 114.6, lat: 22.7, pressure: 970 });
  storm.maxWind = 35;
  storm.minPressure = 970;
  storm.windRadiiKm = {
    r7: 0,
    r10: 0,
    r12: 0,
    quadrants: storm.windRadiiKm.quadrants
  };
  storm.windRadiiReports = {
    r7: { ne: 200, se: 250, sw: 180, nw: 200, max: 250, observedAt, position: storm.position },
    r10: { ne: 70, se: 90, sw: 60, nw: 70, max: 90, observedAt, position: storm.position },
    r12: { ne: 40, se: 50, sw: 30, nw: 40, max: 50, observedAt, position: storm.position }
  };

  const model = buildLiveBroadcastModel({
    storm,
    bossProfile: inferredLandfallProfile(observedAt),
    sourceLabel: "公开路径",
    lastUpdated: observedAt
  });

  assert.equal(model.structure.title, "强度与风圈实况");
  assert.equal(model.structure.evidenceLevel, "confirmed");
  assert.match(model.structure.detail, /35 m\/s/);
  assert.match(model.structure.detail, /970 hPa/);
  assert.match(model.structure.detail, /12级风圈 50 km/);
  assert.match(model.structure.detail, /不推断眼墙/);
});

test("city LLM narration cannot publish an unsupported disaster claim merely by citing an allowed source", async (context) => {
  const previousEnabled = process.env.CITY_LLM_NARRATION_ENABLED;
  const previousKey = process.env.MINIMAX_API_KEY;
  process.env.CITY_LLM_NARRATION_ENABLED = "true";
  process.env.MINIMAX_API_KEY = "test-key";
  context.after(() => {
    if (previousEnabled === undefined) delete process.env.CITY_LLM_NARRATION_ENABLED;
    else process.env.CITY_LLM_NARRATION_ENABLED = previousEnabled;
    if (previousKey === undefined) delete process.env.MINIMAX_API_KEY;
    else process.env.MINIMAX_API_KEY = previousKey;
  });

  const invented = "城区已经发生严重内涝并造成交通中断，多条道路无法通行，请所有居民立刻停止外出并等待相关部门进一步通知。";
  context.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({
      spoken: invented,
      caveat: "",
      fact_refs: ["qweather-now"]
    }) } }]
  }), { status: 200, headers: { "Content-Type": "application/json" } }));

  const fallback = {
    engine: "rules",
    summary: "当前城市代表点气温和近地风已有读数，未来短时判断仍以属地官方预警和后续实况为准。",
    caveat: null,
    factRefs: ["qweather-now"],
    actions: [],
    stage: "ordinary_weather",
    primaryKind: "temperature"
  } as const;
  const briefing = {
    city: { name: "汕尾" },
    current: { temperatureC: 30, precipitationMm: 0, windSpeedMps: 3 },
    nextSixHours: {},
    recentRain: null,
    minutelyRain: null,
    officialWarnings: []
  };

  const result = await narrateCitySituation(briefing as never, fallback as never);

  assert.equal(result.summary, fallback.summary);
  assert.equal(result.engine, "rules");
});

function stormFixture(point: Storm["track"][number]): Storm {
  return {
    id: "202612",
    code: "202612",
    nameZh: "红霞",
    nameEn: "NOUL",
    stage: "热带风暴",
    rating: "虎级",
    status: "实时监测中",
    position: { lon: 123, lat: 18.7 },
    maxWind: point.wind,
    minPressure: 995,
    moveDirection: "西北西",
    moveSpeed: 28,
    updatedAt: point.time,
    windRadiiKm: {
      r7: 320,
      r10: 0,
      r12: 0,
      quadrants: {
        r7: { ne: 100, se: 150, sw: 280, nw: 320, max: 320 },
        r10: { ne: 0, se: 0, sw: 0, nw: 0, max: 0 },
        r12: { ne: 0, se: 0, sw: 0, nw: 0, max: 0 }
      }
    },
    track: [point],
    forecast: [],
    forecastScenarios: [],
    landfalls: [],
    skills: [],
    notice: "测试"
  };
}

function inferredLandfallProfile(estimatedAt: string): BossProfile {
  return {
    structure: { source: "unavailable", state: "unknown", sourceLabel: "结构源", observedAt: estimatedAt, stale: false },
    ahi: { status: "unavailable", availableBands: [], updatedAt: "", bands: [] },
    satellite: { status: "unavailable", products: [], updatedAt: "" },
    sourcePolicy: { machineReadableTrackSource: "公开路径" },
    events: [],
    landfallScenarios: [{
      province: "广东",
      estimatedAt,
      evidenceLevel: "inferred"
    }],
    provinceBriefings: [{
      province: "广东",
      headlineLabel: "路径入省推演",
      impactStatus: "landfall",
      impactLabel: "模式路径入省",
      estimatedAt,
      stormWindSpeedMs: 30,
      stormWindForceLevel: "11",
      closestApproachKm: 0,
      agencySupport: 1,
      agencyTotal: 3,
      displayDurationMs: 2500,
      currentConditions: {
        averageWindSpeedMs: null,
        windForceLevel: "--",
        windDirection: null,
        windSampleCount: 0,
        windObservedAt: null,
        windDataStale: false
      }
    }]
  } as unknown as BossProfile;
}

function compactTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}
