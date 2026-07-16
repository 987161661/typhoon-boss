import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { buildNationalSituationHudModel, buildOfficialWarningQueue } from "../components/nationalSituationHudModel";
import type { NationalSituationSnapshot, NationalWeatherEvent, SourceFreshness } from "../lib/nationalWeatherTypes";

test("HUD independently enforces official red and orange above watch observations", () => {
  const snapshot = fixture([
    event("radar", "radar-watch", "watch", "metadata"),
    event("orange", "official-warning", "orange", "official"),
    event("model", "model-watch", "watch", "model"),
    event("red", "official-warning", "red", "official")
  ]);
  const model = buildNationalSituationHudModel(snapshot);
  assert.equal(model.mainEvent?.id, "red");
  assert.equal(model.mainEvent?.levelLabel, "红色官方风险");
  assert.equal(model.mainEvent?.isOfficialHighRisk, true);
  assert.match(model.mainEvent?.sealAsset ?? "", /risk-seal-red\.svg$/);
});

test("non-official signals always use watch language and watch seal", () => {
  const malformedObservation = event("model", "model-watch", "red", "model");
  const model = buildNationalSituationHudModel(fixture([malformedObservation]));
  assert.equal(model.mainEvent?.level, "watch");
  assert.equal(model.mainEvent?.levelLabel, "观察信号");
  assert.equal(model.mainEvent?.evidenceLabel, "模式观察");
  assert.match(model.mainEvent?.evidenceDetail ?? "", /不能替代官方预警结论/);
  assert.match(model.mainEvent?.sealAsset ?? "", /risk-seal-watch\.svg$/);
});

test("official warning queue gives red a second slot without starving other official levels", () => {
  const events = [
    event("red-a", "official-warning", "red", "official"),
    event("red-b", "official-warning", "red", "official"),
    event("red-c", "official-warning", "red", "official"),
    event("orange", "official-warning", "orange", "official"),
    event("yellow", "official-warning", "yellow", "official"),
    event("blue", "official-warning", "blue", "official"),
    event("watch", "radar-watch", "watch", "metadata")
  ];
  events[0].hazard = "heat";
  events[1].hazard = "rain";
  events[2].hazard = "typhoon";
  const queue = buildOfficialWarningQueue(events);
  assert.deepEqual(queue.map((item) => item.id), ["red-a", "red-b", "orange", "yellow", "blue", "red-c"]);
  assert.deepEqual(queue.map((item) => item.hazard), ["heat", "rain", "rain", "rain", "rain", "typhoon"]);
});

test("all five source states have distinct text and do not rewrite failure as no risk", () => {
  const statuses: SourceFreshness[] = ["fresh", "delayed", "expired", "unavailable", "no-record"];
  const snapshot = fixture([], statuses);
  const model = buildNationalSituationHudModel(snapshot);
  assert.equal(new Set(model.sources.map((source) => source.statusLabel)).size, 5);
  assert.match(model.sources.find((source) => source.status === "unavailable")?.statusDetail ?? "", /不等于无风险/);
  assert.match(model.sources.find((source) => source.status === "no-record")?.statusDetail ?? "", /不等于无风险/);
});

test("empty event and city states keep explicit data boundaries", () => {
  const model = buildNationalSituationHudModel(fixture([]));
  assert.equal(model.mainEvent, null);
  assert.equal(model.eventCount, 0);
  assert.equal(model.city.state, "quiet");
  assert.match(model.city.label, /未发现显著城市战况/);
  assert.match(model.city.detail, /不代表没有风险/);
  assert.match(model.city.coverageLabel, /尚未接入/);
});

test("only deterministic city attribution enters the abnormal-city count", () => {
  const deterministic = event("city", "official-warning", "yellow", "official");
  deterministic.geography.cityAttribution = "deterministic";
  deterministic.geography.cityCode = "511600";
  const ambiguous = event("county", "official-warning", "red", "official");
  ambiguous.geography.cityAttribution = "ambiguous";
  ambiguous.geography.cityCode = null;
  const model = buildNationalSituationHudModel(fixture([ambiguous, deterministic]));
  assert.equal(model.city.eventCount, 1);
  assert.match(model.city.detail, /行政父级已确定/);
});

test("component skin exposes a warning signal card, two-axis hazard tokens, and accessible carousel controls", async () => {
  const component = await readFile(resolve(process.cwd(), "components/NationalSituationHud.tsx"), "utf8");
  const css = await readFile(resolve(process.cwd(), "components/NationalSituationHud.module.css"), "utf8");
  assert.match(component, /气象 Boss 雷达/);
  assert.match(component, /无事件记录不等于无风险/);
  assert.match(component, /type="button"/);
  assert.match(css, /source-health-glyph-symbols\.svg/);
  assert.match(css, /data-hazard="heat"/);
  assert.match(css, /data-hazard="rain"/);
  assert.match(css, /data-hazard="convection"/);
  assert.match(css, /data-hazard="typhoon"/);
  assert.match(component, /WarningSignalCard/);
  assert.match(component, /上一条官方预警/);
  assert.match(component, /暂停自动轮播/);
  assert.match(component, /定位事件/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /@container/);
  assert.doesNotMatch(component, /<path|<polygon|<circle/);
  assert.match(css, /\/assets\/hud-console\/polar-calibration-corner\.png/);
  assert.match(css, /\/assets\/hud-console\/synoptic-contours-overlay\.png/);
  assert.match(css, /\/assets\/hud-console\/radar-sector-overlay\.png/);
});

function fixture(events: NationalWeatherEvent[], statuses: SourceFreshness[] = ["fresh"]): NationalSituationSnapshot {
  return {
    schemaVersion: 1,
    generatedAt: "2026-07-15T02:30:00.000Z",
    sourceHealth: statuses.map((status, index) => ({
      sourceId: `source-${index}`,
      label: `来源 ${index}`,
      status,
      updatedAt: "2026-07-15T02:29:00.000Z",
      lastSuccessfulAt: status === "unavailable" ? null : "2026-07-15T02:29:00.000Z",
      refreshIntervalMinutes: 5,
      error: status === "unavailable" ? "failed" : null,
      limitations: []
    })),
    events,
    warnings: {
      total: events.filter((item) => item.kind === "official-warning").length,
      byLevel: {
        red: events.filter((item) => item.kind === "official-warning" && item.level === "red").length,
        orange: events.filter((item) => item.kind === "official-warning" && item.level === "orange").length,
        yellow: events.filter((item) => item.kind === "official-warning" && item.level === "yellow").length,
        blue: events.filter((item) => item.kind === "official-warning" && item.level === "blue").length
      },
      highestLevel: events.some((item) => item.kind === "official-warning" && item.level === "red")
        ? "red"
        : events.some((item) => item.kind === "official-warning" && item.level === "orange") ? "orange" : null,
      updatedAt: "2026-07-15T02:29:00.000Z",
      sourceId: "source-0"
    },
    radar: { sourceId: "radar", status: "no-record", updatedAt: null, georeferenced: false, frames: [], limitations: [] },
    satellite: { sourceId: "satellite", status: "no-record", updatedAt: null, georeferenced: false, frames: [], limitations: [] },
    products: [],
    storms: [],
    cityRankSnapshot: null
  };
}

function event(
  id: string,
  kind: NationalWeatherEvent["kind"],
  level: NationalWeatherEvent["level"],
  evidenceLevel: NationalWeatherEvent["evidenceLevel"]
): NationalWeatherEvent {
  return {
    id,
    kind,
    hazard: kind === "typhoon" ? "typhoon" : "rain",
    title: `事件 ${id}`,
    level,
    evidenceLevel,
    issuedAt: "2026-07-15T02:20:00.000Z",
    dataTime: "2026-07-15T02:20:00.000Z",
    updatedAt: "2026-07-15T02:25:00.000Z",
    expiresAt: null,
    geography: {
      scope: "national",
      locationIds: [],
      provinceCode: null,
      cityCode: null,
      countyCode: null,
      names: [],
      centroid: null,
      cityAttribution: "not-applicable"
    },
    sourceIds: [id],
    factSummary: `事实 ${id}`,
    limitations: []
  };
}
