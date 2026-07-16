import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { createAcceptanceCityBriefing } from "@/lib/acceptanceScenarioFixtures";
import { buildCityPanelsModel } from "@/lib/cityPanelsPresentation";

test("ordinary city keeps an explicit no-record boundary without claiming safety", () => {
  const model = buildFixtureModel("ordinary-city");
  const copy = collectModelCopy(model);
  assert.equal(model.shared.warningFeed, "none-reported");
  assert.match(model.info.warning.title, /未报告有效官方预警/);
  assert.doesNotMatch(copy, /(?:绝对|完全)?安全|无风险|风险为零/);
});

test("failed warning refresh retains the last-good red warning instead of becoming no-warning", () => {
  const model = buildFixtureModel("source-failure");
  const copy = collectModelCopy(model);
  assert.equal(model.shared.warningFeed, "active");
  assert.equal(model.info.warning.level, "red");
  assert.equal(model.info.warning.title, "合肥市暴雨红色预警");
  assert.match(copy, /最近成功快照/);
  assert.doesNotMatch(copy, /当前无有效官方预警|当前无预警|预警已解除|安全|风险为零/);
});

test("city controller keeps location acquisition and exactly one full briefing request", async () => {
  const source = await read("components/LiveCityInteraction.tsx");
  assert.match(source, /stage=location/);
  assert.equal(matches(source, /fetch\(cityBriefingUrl\s*,/g), 1);
  assert.equal(matches(source, /fetch\(`\$\{cityBriefingUrl\}&stage=location`\s*,/g), 1);
});

test("battle and information panels are fetch-free views of one synchronized city model", async () => {
  const group = await read("components/CityPanelGroup.tsx");
  const battle = await read("components/CityBattleShow.tsx");
  const info = await read("components/CityInfoDeck.tsx");
  assert.doesNotMatch(`${group}\n${battle}\n${info}`, /\bfetch\s*\(/);
  assert.match(group, /<CityBattleShow[\s\S]*?phase=\{phase\}[\s\S]*?briefing=\{briefing\}[\s\S]*?model=\{model\}/);
  assert.match(group, /<CityInfoDeck[\s\S]*?phase=\{phase\}\s+model=\{model\}/);
  assert.match(group, /data-role="city-panel-group"/);
  assert.match(battle, /data-role="battle-panel"/);
  assert.match(info, /data-role="info-panel"/);
  assert.match(group, /data-role="city-core"/);
  assert.match(group, /data-role="battle-link"/);
  assert.match(group, /data-role="info-link"/);
  for (const contract of ["data-phase", "data-density", "data-warning-feed", "data-severity"]) {
    assert.match(group, new RegExp(`${contract}=`));
  }
});

function collectModelCopy(model: ReturnType<typeof buildCityPanelsModel>) {
  return JSON.stringify(model);
}

function buildFixtureModel(scenario: "ordinary-city" | "source-failure") {
  return buildCityPanelsModel({
    briefing: createAcceptanceCityBriefing(scenario),
    audience: { requestId: `qa-${scenario}`, viewerName: null, accessSource: "unknown" },
    archive: { status: "locked" }
  });
}

function matches(source: string, pattern: RegExp) {
  return source.match(pattern)?.length ?? 0;
}

async function read(path: string) {
  return readFile(resolve(process.cwd(), path), "utf8");
}
