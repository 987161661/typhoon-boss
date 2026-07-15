import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  ACCEPTANCE_SCENARIOS,
  normalizeAcceptanceScenario,
  withAcceptanceScenario
} from "@/lib/acceptanceScenario";
import {
  createAcceptanceNationalSituation,
  createAcceptanceRadarSnapshot,
  createAcceptanceStorms,
  createOrdinaryCityBriefing
} from "@/lib/acceptanceScenarioFixtures";
import { resolveServerAcceptanceScenario } from "@/lib/acceptanceScenarioServer";

test("acceptance query is inert unless the explicit non-production server switch is enabled", () => {
  assert.equal(resolveServerAcceptanceScenario("single-storm", { NODE_ENV: "development" }), null);
  assert.equal(resolveServerAcceptanceScenario("single-storm", { NODE_ENV: "production", WEATHER_ACCEPTANCE_FIXTURES: "1" }), null);
  assert.equal(resolveServerAcceptanceScenario("not-a-scenario", { NODE_ENV: "test", WEATHER_ACCEPTANCE_FIXTURES: "1" }), null);
  assert.equal(resolveServerAcceptanceScenario("single-storm", { NODE_ENV: "test", WEATHER_ACCEPTANCE_FIXTURES: "1" }), "single-storm");
  assert.equal(normalizeAcceptanceScenario(null), null);
  assert.equal(normalizeAcceptanceScenario("ordinary-city"), "ordinary-city");
});

test("client propagation preserves production URLs when no scenario is selected", () => {
  assert.equal(withAcceptanceScenario("/api/national-situation", null), "/api/national-situation");
  assert.equal(
    withAcceptanceScenario("/api/radar/snapshot?t=1", "multi-storm"),
    "/api/radar/snapshot?t=1&acceptanceScenario=multi-storm"
  );
});

test("no, single, and multi storm fixtures exercise stable storm identity contracts", () => {
  assert.equal(createAcceptanceStorms("no-storm").length, 0);
  assert.equal(createAcceptanceStorms("single-storm").length, 1);
  const storms = createAcceptanceStorms("multi-storm");
  assert.equal(storms.length, 2);
  assert.equal(new Set(storms.map((storm) => storm.id)).size, 2);
  assert.equal(new Set(storms.map((storm) => storm.nameZh)).size, 2);
  for (const storm of storms) {
    assert.ok(storm.track.length >= 3);
    assert.ok(storm.forecast.length >= 2);
    assert.ok(storm.forecastScenarios.every((forecast) => forecast.id.startsWith(storm.id)));
    assert.ok(storm.skills.every((skill) => skill.detail.includes(storm.id)));
  }
  const radar = createAcceptanceRadarSnapshot("multi-storm");
  assert.equal(radar.activeStormId, storms[0].id);
  assert.deepEqual(Object.keys(radar.environment.windCenters).sort(), storms.map((storm) => storm.id).sort());
  assert.equal(radar.cache.stale, false);
});

test("official-red fixture is official, deterministic, and city-scoped", () => {
  const snapshot = createAcceptanceNationalSituation("official-red");
  assert.equal(snapshot.warnings.highestLevel, "red");
  assert.equal(snapshot.warnings.byLevel.red, 1);
  const event = snapshot.events.find((candidate) => candidate.level === "red");
  assert.ok(event);
  assert.equal(event.kind, "official-warning");
  assert.equal(event.evidenceLevel, "official");
  assert.equal(event.geography.cityAttribution, "deterministic");
  assert.equal(event.geography.cityCode, "340100");
});

test("source-failure fixture retains the last good warning and never converts failure to no-risk", () => {
  const snapshot = createAcceptanceNationalSituation("source-failure");
  const failedSource = snapshot.sourceHealth.find((source) => source.sourceId === "china-weather-alert");
  assert.equal(failedSource?.status, "delayed");
  assert.ok(failedSource?.lastSuccessfulAt);
  assert.match(failedSource?.error ?? "", /503/);
  assert.equal(snapshot.warnings.highestLevel, "red");
  assert.equal(snapshot.events.some((event) => event.level === "red"), true);
  assert.match(snapshot.events[0]?.factSummary ?? "", /最近成功快照/);

  const radar = createAcceptanceRadarSnapshot("source-failure");
  assert.equal(radar.status, "stale");
  assert.equal(radar.cache.stale, true);
  assert.match(radar.warnings.join(" "), /不能据此表述为无风险/);
});

test("ordinary-city fixture stays in ordinary weather semantics without fabricated official warnings", () => {
  const briefing = createOrdinaryCityBriefing();
  assert.equal(briefing.city.cityAttribution, "deterministic");
  assert.equal(briefing.officialWarnings.length, 0);
  assert.equal(briefing.narrative.stage, "ordinary_weather");
  assert.equal(briefing.narrative.template, "calm");
  assert.equal(briefing.risks.every((risk) => risk.level === "low"), true);
  assert.doesNotMatch(briefing.headline, /已发布|红色|橙色|灾害已发生/);
});

test("all six scenarios are routed through the real national, radar, and city API paths", async () => {
  assert.deepEqual(ACCEPTANCE_SCENARIOS, [
    "no-storm",
    "single-storm",
    "multi-storm",
    "official-red",
    "ordinary-city",
    "source-failure"
  ]);
  const nationalRoute = await read("app/api/national-situation/route.ts");
  const radarRoute = await read("app/api/radar/snapshot/route.ts");
  const cityRoute = await read("app/api/city-briefing/route.ts");
  const nationalHook = await read("components/useNationalSituation.ts");
  const radarHook = await read("components/useRadarSnapshot.ts");
  const cityCard = await read("components/LiveCityInteraction.tsx");

  for (const source of [nationalRoute, radarRoute, cityRoute]) {
    assert.match(source, /resolveServerAcceptanceScenario/);
  }
  for (const source of [nationalHook, radarHook, cityCard]) {
    assert.match(source, /withAcceptanceScenario/);
  }
  assert.doesNotMatch(nationalHook, /acceptanceScenario=["']/);
  assert.doesNotMatch(radarHook, /acceptanceScenario=["']/);
});

async function read(path: string) {
  return readFile(resolve(process.cwd(), path), "utf8");
}
