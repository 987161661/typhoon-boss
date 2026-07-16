import assert from "node:assert/strict";
import test from "node:test";
import { buildCitySituation, type CityObservedAnomaly } from "../lib/citySituationCore";
import type { NationalSituationSnapshot, NationalWeatherEvent } from "../lib/nationalWeatherTypes";

function event(overrides: Partial<NationalWeatherEvent> = {}): NationalWeatherEvent {
  return {
    id: "warning-1",
    kind: "official-warning",
    hazard: "rain",
    title: "暴雨橙色预警",
    level: "orange",
    evidenceLevel: "official",
    issuedAt: "2026-07-15T08:00:00Z",
    dataTime: "2026-07-15T08:00:00Z",
    updatedAt: "2026-07-15T08:01:00Z",
    expiresAt: null,
    geography: {
      scope: "county",
      locationIds: ["101270803"],
      provinceCode: "510000",
      cityCode: "511600",
      countyCode: "511622",
      names: ["武胜县"],
      centroid: null,
      cityAttribution: "deterministic"
    },
    sourceIds: ["qweather-warning"],
    factSummary: "武胜县发布暴雨橙色预警。",
    limitations: ["以属地最新发布为准。"],
    ...overrides
  };
}

function snapshot(events: NationalWeatherEvent[]): NationalSituationSnapshot {
  return {
    schemaVersion: 1,
    generatedAt: "2026-07-15T08:02:00Z",
    sourceHealth: [],
    events,
    warnings: { total: events.length, byLevel: { red: 0, orange: events.length, yellow: 0, blue: 0 }, highestLevel: events.length ? "orange" : null, updatedAt: null, sourceId: "qweather-warning" },
    radar: { sourceId: "radar", status: "no-record", updatedAt: null, georeferenced: false, frames: [], limitations: [] },
    satellite: { sourceId: "satellite", status: "no-record", updatedAt: null, georeferenced: false, frames: [], limitations: [] },
    products: [],
    storms: [],
    cityRankSnapshot: null
  };
}

const anomaly: CityObservedAnomaly = {
  id: "heat-1",
  hazard: "heat",
  label: "显著高温",
  severity: "severe",
  factSummary: "体感温度进入显著异常区间。",
  observedAt: "2026-07-15T08:00:00Z",
  sourceIds: ["qweather-now"],
  limitations: ["单站值不代表整座城市。"]
};

test("deterministically attributed official warning outranks a severe observed anomaly", () => {
  const result = buildCitySituation(snapshot([event()]), { name: "广安", cityCode: "511600" }, [anomaly], "气温偏高");
  assert.equal(result.mode, "official-warning");
  assert.equal(result.primaryWarning?.id, "warning-1");
  assert.equal(result.anomalies[0]?.id, "heat-1");
});

test("ambiguous or differently attributed warnings never enter the city card", () => {
  const ambiguous = event({ id: "ambiguous", geography: { ...event().geography, cityAttribution: "ambiguous" } });
  const otherCity = event({ id: "other", geography: { ...event().geography, cityCode: "510100" } });
  const result = buildCitySituation(
    snapshot([ambiguous, otherCity]),
    { name: "广安", cityCode: "511600", locationIds: ["101270803"] },
    [anomaly]
  );
  assert.equal(result.mode, "observed-anomaly");
  assert.deepEqual(result.officialWarnings, []);
});

test("an exact county-level target rejects a sibling county but still inherits city-wide warnings", () => {
  const sibling = event({
    id: "sibling",
    geography: {
      ...event().geography,
      locationIds: ["101131004"],
      cityCode: "654000",
      countyCode: "654021",
      names: ["伊宁县"]
    }
  });
  const exact = event({
    id: "exact",
    geography: {
      ...event().geography,
      locationIds: ["101131001"],
      cityCode: "654000",
      countyCode: "654002",
      names: ["伊宁市"]
    }
  });
  const cityWide = event({
    id: "city-wide",
    geography: {
      ...event().geography,
      scope: "city",
      locationIds: ["101131000"],
      cityCode: "654000",
      countyCode: null,
      names: ["伊犁哈萨克自治州"]
    }
  });

  const result = buildCitySituation(
    snapshot([sibling, exact, cityWide]),
    { name: "伊宁", cityCode: "654000", locationIds: ["101131001"] },
    []
  );

  assert.deepEqual(result.officialWarnings.map((warning) => warning.id).sort(), ["city-wide", "exact"]);
});

test("ordinary weather is compressed and never claims safety", () => {
  const result = buildCitySituation(snapshot([]), { name: "杭州", cityCode: "330100" }, [], "24°C，微风");
  assert.equal(result.mode, "ordinary");
  assert.equal(result.ordinarySummary, "24°C，微风");
  assert.doesNotMatch(result.headline, /安全/);
  assert.match(result.headline, /不代表没有风险/);
});

test("missing national snapshot is a data gap rather than ordinary weather", () => {
  const result = buildCitySituation(null, { name: "杭州", cityCode: "330100" }, [], "24°C，微风");
  assert.equal(result.mode, "data-unavailable");
  assert.match(result.headline, /全国预警快照不可用/);
  assert.match(result.headline, /无法判断城市预警风险/);
  assert.doesNotMatch(result.headline, /未发现显著战况/);
});
