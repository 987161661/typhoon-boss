import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDeterministicNationalSituationBroadcast,
  buildNationalSituationBroadcastPrompt,
  validateLegacyTyphoonNarrative,
  validateNationalSituationBroadcast
} from "../lib/agent/nationalSituationBroadcast.mjs";
import type { NationalSituationSnapshot, NationalWeatherEvent } from "../lib/nationalWeatherTypes";

const NOW = "2026-07-15T10:00:00.000Z";

test("prompt exposes warning summary, main event, freshness and limits without promoting product metadata", () => {
  const prompt = buildNationalSituationBroadcastPrompt(snapshot(), { now: NOW, maxEvents: 5 });
  const facts = prompt.request.facts;
  assert.ok(facts.some((fact) => fact.ref === "summary:official-warnings"));
  assert.ok(facts.some((fact) => fact.ref === "event:warning:beijing-rain" && fact.category === "official_fact"));
  assert.ok(facts.some((fact) => fact.ref === "source:china-weather-warning" && fact.scope === "source-status"));
  assert.ok(facts.some((fact) => fact.ref === "metadata:radar" && fact.scope === "metadata-only"));
  assert.ok(facts.every((fact) => !fact.statement.includes("surface analysis")));
  assert.match(prompt.systemPrompt, /metadata-only/);
  assert.match(prompt.systemPrompt, /不得把全国预警归因/);
});

test("validator accepts cited official, observation and model segments as distinct categories", () => {
  const prompt = buildNationalSituationBroadcastPrompt(snapshot(), { now: NOW });
  const output = {
    schemaVersion: 1,
    segments: [
      {
        category: "official_fact",
        text: "北京市气象台发布暴雨橙色预警，事实时次为本条引用所列时次。",
        factRefs: ["event:warning:beijing-rain"]
      },
      {
        category: "observation",
        text: "全国雷达索引存在可用帧，地理标定仍未确认。",
        factRefs: ["metadata:radar"]
      },
      {
        category: "model",
        text: "模式事件仅记录未来六小时阵风模型值，并保留模型口径。",
        factRefs: ["event:model:gfs-wind"]
      }
    ],
    closing: "播报完毕"
  };
  const result = validateNationalSituationBroadcast(JSON.stringify(output), prompt);
  assert.equal(result.ok, true, result.ok ? "" : result.errors.join("; "));
});

test("validator rejects unknown or cross-category fact references", () => {
  const prompt = buildNationalSituationBroadcastPrompt(snapshot(), { now: NOW });
  const unknown = validateNationalSituationBroadcast({
    schemaVersion: 1,
    segments: [{ category: "official_fact", text: "官方事实已更新。", factRefs: ["event:invented"] }],
    closing: null
  }, prompt);
  assert.equal(unknown.ok, false);

  const crossCategory = validateNationalSituationBroadcast({
    schemaVersion: 1,
    segments: [{ category: "official_fact", text: "官方事实已更新。", factRefs: ["metadata:radar"] }],
    closing: null
  }, prompt);
  assert.equal(crossCategory.ok, false);
  if (!crossCategory.ok) assert.ok(crossCategory.errors.some((error) => error.includes("category")));
});

test("validator rejects schema fields outside the publishable contract", () => {
  const prompt = buildNationalSituationBroadcastPrompt(snapshot(), { now: NOW });
  const result = validateNationalSituationBroadcast({
    schemaVersion: 1,
    segments: [{
      category: "official_fact",
      text: "北京市气象台发布暴雨橙色预警。",
      factRefs: ["event:warning:beijing-rain"],
      reasoning: "hidden"
    }],
    closing: null,
    confidence: 1
  }, prompt);
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some((error) => error.includes("unexpected")));
});

test("validator accepts exactly one JSON object and rejects prose or Markdown wrappers", () => {
  const prompt = buildNationalSituationBroadcastPrompt(snapshot(), { now: NOW });
  const object = {
    schemaVersion: 1,
    segments: [{
      category: "official_fact",
      text: "北京市气象台发布暴雨橙色预警。",
      factRefs: ["event:warning:beijing-rain"]
    }],
    closing: null
  };
  assert.equal(validateNationalSituationBroadcast(JSON.stringify(object), prompt).ok, true);
  assert.equal(validateNationalSituationBroadcast(`播报如下：${JSON.stringify(object)}`, prompt).ok, false);
  assert.equal(validateNationalSituationBroadcast("```json\n" + JSON.stringify(object) + "\n```", prompt).ok, false);
});

test("validator refuses typhoon attribution not established by warning facts", () => {
  const prompt = buildNationalSituationBroadcastPrompt(snapshot(), { now: NOW });
  const result = validateNationalSituationBroadcast({
    schemaVersion: 1,
    segments: [{
      category: "official_fact",
      text: "北京市暴雨橙色预警由台风赤曜导致。",
      factRefs: ["event:warning:beijing-rain"]
    }],
    closing: null
  }, prompt);
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some((error) => error.includes("causal attribution")));
});

test("validator refuses radar metadata weather inference and model-to-official promotion", () => {
  const prompt = buildNationalSituationBroadcastPrompt(snapshot(), { now: NOW });
  const radar = validateNationalSituationBroadcast({
    schemaVersion: 1,
    segments: [{
      category: "observation",
      text: "雷达显示北京市已经发生暴雨灾害。",
      factRefs: ["metadata:radar"]
    }],
    closing: null
  }, prompt);
  assert.equal(radar.ok, false);

  const model = validateNationalSituationBroadcast({
    schemaVersion: 1,
    segments: [{
      category: "model",
      text: "模式已发布北京市暴雨红色预警。",
      factRefs: ["event:model:gfs-wind"]
    }],
    closing: null
  }, prompt);
  assert.equal(model.ok, false);
  if (!model.ok) assert.ok(model.errors.some((error) => error.includes("warning conclusion")));
});

test("validator refuses disaster outcomes and no-risk claims even with a warning reference", () => {
  const prompt = buildNationalSituationBroadcastPrompt(snapshot(), { now: NOW });
  for (const text of ["北京市暴雨橙色预警已造成交通中断。", "北京市预警之外的其他地区目前没有风险。"] ) {
    const result = validateNationalSituationBroadcast({
      schemaVersion: 1,
      segments: [{ category: "official_fact", text, factRefs: ["event:warning:beijing-rain"] }],
      closing: null
    }, prompt);
    assert.equal(result.ok, false, text);
  }
});

test("missing snapshot falls back to a cited source-status statement, never a safe-weather claim", () => {
  const prompt = buildNationalSituationBroadcastPrompt(null, { now: NOW });
  const fallback = buildDeterministicNationalSituationBroadcast(prompt);
  assert.equal(fallback.segments.length, 1);
  assert.deepEqual(fallback.segments[0].factRefs, ["source:national-situation"]);
  assert.doesNotMatch(fallback.segments[0].text, /无风险|天气安全/);
  const validated = validateNationalSituationBroadcast(fallback, prompt);
  assert.equal(validated.ok, true, validated.ok ? "" : validated.errors.join("; "));
});

test("deterministic broadcast remains contract-valid for the representative national snapshot", () => {
  const prompt = buildNationalSituationBroadcastPrompt(snapshot(), { now: NOW });
  const fallback = buildDeterministicNationalSituationBroadcast(prompt);
  const result = validateNationalSituationBroadcast(fallback, prompt);
  assert.equal(result.ok, true, result.ok ? "" : result.errors.join("; "));
  assert.equal(fallback.segments[0].factRefs[0], "event:warning:beijing-rain");
});

test("legacy typhoon Markdown stays compatible but rejects claims that would require factRefs", () => {
  const valid = validateLegacyTyphoonNarrative(`### 赤曜（202601）

- **当前实况**：10时中心风速30 m/s。
- **与上一轮对比**：上游没有新增实况点。
- **路径预报**：公开详情未提供可用预报点。
- **数据限制**：只陈述路径源事实，不替代官方预警。`);
  assert.equal(valid.ok, true);

  for (const text of [
    "赤曜已造成交通中断。",
    "气象台已发布暴雨红色预警。",
    "北京市强降雨由赤曜台风导致。",
    "赤曜即将在广东登陆。",
    "雷达显示赤曜已经增强。"
  ]) {
    assert.equal(validateLegacyTyphoonNarrative(text).ok, false, text);
  }
});

function snapshot(): NationalSituationSnapshot {
  return {
    schemaVersion: 1,
    generatedAt: "2026-07-15T09:58:00.000Z",
    sourceHealth: [
      {
        sourceId: "china-weather-warning",
        label: "全国预警",
        status: "fresh",
        updatedAt: "2026-07-15T09:57:00.000Z",
        lastSuccessfulAt: "2026-07-15T09:57:00.000Z",
        refreshIntervalMinutes: 5,
        error: null,
        limitations: ["预警详情以发布机构原文为准。"]
      },
      {
        sourceId: "ncep-gfs",
        label: "GFS 模式",
        status: "delayed",
        updatedAt: "2026-07-15T08:00:00.000Z",
        lastSuccessfulAt: "2026-07-15T08:00:00.000Z",
        refreshIntervalMinutes: 60,
        error: null,
        limitations: ["模式不等同于官方预警。"]
      }
    ],
    events: [warningEvent(), modelEvent(), radarEvent()],
    warnings: {
      total: 2,
      byLevel: { red: 0, orange: 1, yellow: 1, blue: 0 },
      highestLevel: "orange",
      updatedAt: "2026-07-15T09:57:00.000Z",
      sourceId: "china-weather-warning"
    },
    radar: {
      sourceId: "china-weather-radar",
      status: "fresh",
      updatedAt: "2026-07-15T09:55:00.000Z",
      georeferenced: false,
      frames: [{ id: "radar-1", observedAt: "2026-07-15T09:54:00.000Z", imageUrl: "https://example.invalid/radar.png" }],
      limitations: ["雷达索引未解码回波强度。"]
    },
    satellite: {
      sourceId: "china-weather-satellite",
      status: "no-record",
      updatedAt: null,
      georeferenced: false,
      frames: [],
      limitations: ["稳定图像 URL 与地理标定未验证。"]
    },
    products: [{
      id: "surface-analysis",
      label: "surface analysis",
      kind: "analysis",
      status: "fresh",
      productTime: "2026-07-15T08:00:00.000Z",
      evidenceLevel: "metadata",
      limitations: ["目录元数据不能生成天气结论。"]
    }],
    storms: [],
    cityRankSnapshot: null
  };
}

function warningEvent(): NationalWeatherEvent {
  return event({
    id: "warning:beijing-rain",
    kind: "official-warning",
    hazard: "rain",
    title: "北京市气象台发布暴雨橙色预警",
    level: "orange",
    evidenceLevel: "official",
    geography: {
      scope: "city",
      locationIds: ["101010100"],
      provinceCode: "110000",
      cityCode: "110000",
      countyCode: null,
      names: ["北京市", "北京"],
      centroid: { longitude: 116.4, latitude: 39.9 },
      cityAttribution: "deterministic"
    },
    sourceIds: ["china-weather-warning"],
    factSummary: "北京市气象台发布暴雨橙色预警。"
  });
}

function modelEvent(): NationalWeatherEvent {
  return event({
    id: "model:gfs-wind",
    kind: "model-watch",
    hazard: "wind",
    title: "GFS 阵风模式观察",
    level: "watch",
    evidenceLevel: "model",
    geography: {
      scope: "national",
      locationIds: [],
      provinceCode: null,
      cityCode: null,
      countyCode: null,
      names: ["全国"],
      centroid: null,
      cityAttribution: "not-applicable"
    },
    sourceIds: ["ncep-gfs"],
    factSummary: "未来六小时最大阵风模型值为12米每秒。"
  });
}

function radarEvent(): NationalWeatherEvent {
  return event({
    id: "radar:index-1",
    kind: "radar-watch",
    hazard: "other",
    title: "全国雷达索引已有可用帧",
    level: "watch",
    evidenceLevel: "metadata",
    geography: {
      scope: "national",
      locationIds: [],
      provinceCode: null,
      cityCode: null,
      countyCode: null,
      names: ["全国"],
      centroid: null,
      cityAttribution: "not-applicable"
    },
    sourceIds: ["china-weather-radar"],
    factSummary: "雷达索引提供图像帧和时次元数据。"
  });
}

function event(overrides: Partial<NationalWeatherEvent>): NationalWeatherEvent {
  return {
    id: "event",
    kind: "official-warning",
    hazard: "other",
    title: "event",
    level: "yellow",
    evidenceLevel: "official",
    issuedAt: "2026-07-15T09:50:00.000Z",
    dataTime: "2026-07-15T09:50:00.000Z",
    updatedAt: "2026-07-15T09:57:00.000Z",
    expiresAt: null,
    geography: {
      scope: "national",
      locationIds: [],
      provinceCode: null,
      cityCode: null,
      countyCode: null,
      names: ["全国"],
      centroid: null,
      cityAttribution: "not-applicable"
    },
    sourceIds: [],
    factSummary: "",
    limitations: ["仅按输入事实播报。"],
    ...overrides
  };
}
