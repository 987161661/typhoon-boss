import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("live broadcast keeps ranks, archive, two frame skins and sequential reveal contracts", async () => {
  const [component, css, controller] = await Promise.all([
    readFile("components/CityLiveBroadcastGroup.tsx", "utf8"),
    readFile("components/CityLiveBroadcastGroup.module.css", "utf8"),
    readFile("components/LiveCityInteraction.tsx", "utf8")
  ]);
  assert.match(component, /data-role="live-city-ranks"/);
  assert.match(component, /className=\{styles\.rankValue\}>\{rank\.value\}/);
  assert.match(component, /className=\{styles\.rankLead\}>全国排名第/);
  assert.match(component, /className=\{styles\.rankPosition\}>\{rank\.position\}/);
  assert.doesNotMatch(component, />#\{rank\.position\}·\{rank\.value\}</);
  assert.match(component, /data-role="live-battle-archive"/);
  assert.match(component, /battle-frame\.png/);
  assert.match(component, /official-lab-frame\.png/);
  assert.match(component, /CityTypewriterText/);
  assert.match(css, /--broadcast-type-floor:\s*clamp\(23px,\s*1\.5vw,\s*29px\)/);
  assert.match(css, /battleTowerImpact/);
  assert.match(css, /infoTowerCalibrate/);
  assert.match(css, /rankStamp/);
  assert.match(css, /\.rankPosition\s*\{[\s\S]*?clamp\(30px,\s*2\.1vw,\s*42px\)/);
  assert.doesNotMatch(css, /\.rankCard\s*\{\s*display:\s*none/);
  assert.match(controller, /BROADCAST_FLASH_DURATION_MS = 550/);
  assert.match(controller, /BROADCAST_PANEL_DEPLOY_DURATION_MS = 2_450/);
  assert.match(controller, /PANEL_DEPLOY_DURATION_MS = 3_180/);
});

test("live controls persist an independent switch and three city-report volume levels", async () => {
  const controls = await readFile("components/LiveOperatorControls.tsx", "utf8");
  assert.match(controls, /cityReportEffectsEnabled/);
  assert.match(controls, /cityReportEffectsVolume/);
  for (const value of ["low", "standard", "high"]) {
    assert.match(controls, new RegExp(`option value="${value}"`));
  }
});
