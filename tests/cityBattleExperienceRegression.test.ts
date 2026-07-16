import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { createAcceptanceCityBriefing } from "../lib/acceptanceScenarioFixtures";
import { resolveBattleNarrative, revealDelayFor } from "../lib/cityBattleShowModel";
import { buildCityPanelsModel } from "../lib/cityPanelsPresentation";

const PRODUCT_SOURCES = [
  "components/LiveCityInteraction.tsx",
  "components/CityPanelGroup.tsx",
  "components/CityBattleShow.tsx",
  "lib/cityBattleShowModel.ts"
] as const;

const PRESENTATION_STYLES = [
  "components/LiveCityInteraction.module.css",
  "components/CityPanelGroup.module.css",
  "components/CityPanelMotion.module.css"
] as const;

test("battle remains a staged broadcast show instead of a static summary card", async () => {
  const source = await readAll(PRODUCT_SOURCES);

  assert.match(source, /narrative\.summary/, "the recovered battle show must consume the briefing narrative, not replace it with a fixed summary");
  assert.match(source, /\bTypewriter(?:Text)?\b/, "the main verdict must retain its typewriter presentation");
  assert.match(source, /\bTelemetryDeck\b/, "the original tactical telemetry deck must remain in the show");
  assert.match(source, /\bCityRankIntel\b/, "ranked city weather needs a dedicated high-visibility battle treatment");
  assert.match(source, /\bCitySignalBoard\b/, "the anomaly-led city signal board must remain in the show");
  assert.match(source, /(?:narrative|battle)\.actions/, "the action beat must remain visible after the signal board");
  assert.match(source, /(?:ArchiveSlot|ArchiveFragment|WorldFragment)/, "the archive reward must close the show instead of replacing it");
});

test("typewriter keeps punctuation pacing and reduced motion can reveal immediately", () => {
  const base = revealDelayFor("城", 42);
  assert.equal(base, 42);
  assert.ok(revealDelayFor("，", 42) > base, "a clause boundary needs a longer pause");
  assert.ok(revealDelayFor("。", 42) >= base * 5, "a sentence boundary needs the original dramatic pause");
});

test("dual panel show uses a one-second stagger with a slower complete reveal", async () => {
  const group = await read("components/CityPanelGroup.tsx");
  const motion = await read("components/CityPanelMotion.module.css");
  const controller = await read("components/LiveCityInteraction.tsx");

  assert.match(group, /playPanelOpenSound\(contextRef, "battle"\), 760/);
  assert.match(group, /playPanelOpenSound\(contextRef, "info"\), 1_760/);
  assert.match(group, /typingSound=\{!prefersReducedMotion\}/);
  assert.match(group, /type: "sine", from: 118, to: 46, peak: 0\.14/,
    "battle opening needs a clearly audible impact layer");
  assert.match(group, /type: "triangle", from: 1_520, to: 1_240, peak: 0\.07/,
    "information opening needs a distinct audible confirmation layer");
  assert.match(motion, /cityMotionBattleImpact 1\.16s 760ms/);
  assert.match(motion, /cityMotionInfoAssemble 1\.22s 1\.76s/);
  assert.match(controller, /PANEL_DEPLOY_DURATION_MS = 3_180/);
});

test("battle keeps the original wasteland frame language and decode beat", async () => {
  const source = await readAll(PRODUCT_SOURCES);
  const css = await readAll(PRESENTATION_STYLES);
  const combined = `${source}\n${css}`;

  for (const contract of ["damage", "crack", "corner", "decode"] as const) {
    assert.match(combined, new RegExp(contract, "i"), `missing recovered ${contract} layer`);
  }
  assert.match(combined, /(?:acquisition|signal[\w-]*lock|coordinate[\w-]*lock|坐标锁定)/i,
    "the coordinate acquisition beat must precede panel deployment");
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/,
    "all restored motion needs a reduced-motion path");
});

test("dual-panel orchestrator mounts the recovered show and the factual companion", async () => {
  const group = await read("components/CityPanelGroup.tsx");
  const controller = await read("components/LiveCityInteraction.tsx");

  assert.match(group, /import\s+\{?\s*CityBattleShow\s*\}?\s+from\s+["']\.\/CityBattleShow["']/);
  assert.match(group, /import\s+\{?\s*CityInfoDeck\s*\}?\s+from\s+["']\.\/CityInfoDeck["']/);
  assert.match(group, /<CityBattleShow\b[\s\S]*?briefing=\{briefing\}[\s\S]*?model=\{model\}/);
  assert.match(group, /<CityInfoDeck\b[\s\S]*?model=\{model\}/);
  assert.doesNotMatch(group, /<BattleStatusPanel\b|<CityInfoPanel\b/,
    "the rejected small-card views must not remain mounted beside the recovered components");
  assert.match(controller, /<CityPanelGroup\b[\s\S]*?briefing=\{briefing\}/,
    "the single-fetch controller must pass its original briefing narrative into the recovered show");
});

test("official warning facts remain exclusively in info while battle stays fictionalized", () => {
  const briefing = createAcceptanceCityBriefing("official-red");
  const official = briefing.officialWarnings[0];
  assert.ok(official, "fixture must contain an official warning");

  const model = buildCityPanelsModel({
    briefing,
    audience: { requestId: "battle-regression-official", viewerName: "QA", accessSource: "unknown" },
    archive: { status: "locked" }
  });
  const battleText = JSON.stringify(model.battle);
  const forbidden = [official.title, official.senderName, official.description, official.instruction]
    .filter((value): value is string => Boolean(value));

  for (const fact of forbidden) {
    assert.equal(battleText.includes(fact), false, `battle leaked official fact: ${fact}`);
  }
  assert.doesNotMatch(battleText, /官方预警|发布机构|以属地最新发布为准|这不是整活区/);

  assert.equal(model.info.warning.title, official.title);
  assert.equal(model.info.warning.issuer, official.senderName);
  assert.equal(model.info.warning.description, official.description);
  assert.equal(model.info.warning.instruction, official.instruction);

  const fallback = "环境参数已装入战术终端。";
  briefing.narrative.summary = `${official.title} ${official.senderName ?? ""} ${official.instruction ?? ""}`;
  assert.equal(resolveBattleNarrative(briefing, fallback), fallback,
    "the restored narrative path must fall back instead of leaking official facts into battle");
});

test("battle view never reads official warning body fields", async () => {
  const battle = await read("components/CityBattleShow.tsx");
  const info = await read("components/CityInfoDeck.tsx");

  for (const field of ["title", "issuer", "description", "instruction"] as const) {
    assert.doesNotMatch(battle, new RegExp(`(?:info\\.warning|warning)\\.${field}\\b`),
      `battle panel must not render official warning ${field}`);
    assert.match(info, new RegExp(`warning\\.${field}\\b`),
      `information panel must render official warning ${field}`);
  }
  assert.match(battle, /data-role="battle-panel"[\s\S]*?data-component="city-battle-show"/);
  assert.match(battle, /data-role="battle-rank-intel"/);
  assert.match(info, /data-role="official-warning"/);
  assert.match(info, /data-role="warning-description"/);
  assert.match(info, /data-role="warning-instruction"/);
});

async function readAll(paths: readonly string[]) {
  return (await Promise.all(paths.map(read))).join("\n");
}

async function read(path: string) {
  return readFile(resolve(process.cwd(), path), "utf8");
}
