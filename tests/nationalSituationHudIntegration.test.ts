import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

test("standard and live maps share one national-situation hook without duplicate fetch logic", async () => {
  const source = await read("components/TyphoonMap.tsx");
  assert.match(source, /useNationalSituation\(\{ enabled: true \}\)/);
  assert.equal(source.match(/useNationalSituation\(/g)?.length, 1);
  assert.doesNotMatch(source, /fetch\(["']\/api\/national-situation/);
  assert.match(source, /nationalMapState\.mode === "national"/);
});

test("live standby composes compact national evidence and environment controls in a dedicated rail", async () => {
  const source = await read("components/TyphoonMap.tsx");
  const css = await read("components/NationalSituationRail.module.css");
  assert.match(source, /data-live-standby=\{showLiveStandbyEnvironment \? "true"/);
  assert.match(source, /variant="compact"/);
  assert.match(source, /className=\{nationalRailStyles\.environmentInRail\}/);
  assert.match(css, /\.environmentInRail:global\(\.is-collapsed\)/);
  assert.match(css, /data-live-rail-collapsed="true"/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /\.liveRail > :global\(\.environment-panel\)\s*\{\s*display: none/);
});

test("both HUD variants share the 2.5-second official warning carousel and a data-boundary fallback", async () => {
  const source = await read("components/NationalSituationHud.tsx");
  const model = await read("components/nationalSituationHudModel.ts");
  const hook = await read("components/useWarningCarousel.ts");
  const css = await read("components/NationalSituationHud.module.css");
  assert.equal(source.match(/buildNationalSituationHudModel\(snapshot\)/g)?.length, 1);
  assert.match(source, /useWarningCarousel\(model\.warningQueue\)/);
  assert.match(source, /WarningSignalCard/);
  assert.match(source, /no risk|无风险/);
  assert.match(model, /buildOfficialWarningQueue/);
  assert.match(model, /\["red", "red", "orange", "yellow", "blue"\]/);
  assert.match(hook, /WARNING_CAROUSEL_INTERVAL_MS = 2_500/);
  assert.match(hook, /visibilitychange/);
  assert.match(hook, /prefers-reduced-motion/);
  assert.match(css, /\.signal_compact/);
  assert.match(css, /\.cycleProgress/);
});

test("full HUD is a themed signal desk while compact live HUD keeps its shared card contract", async () => {
  const component = await read("components/NationalSituationHud.tsx");
  const css = await read("components/NationalSituationHud.module.css");
  assert.match(component, /data-signal-desk="national"/);
  assert.match(component, /deskReadout/);
  assert.match(component, /queueChannel/);
  assert.match(component, /即将播报/);
  assert.match(css, /\.signal_full \.signalControls::before/);
  assert.match(css, /预警控制/);
  assert.match(css, /\.deskGridMark/);
  assert.doesNotMatch(component, /NATIONAL WEATHER SIGNAL DESK|QUEUE \/ NEXT SIGNALS/);
  assert.doesNotMatch(css, /COMMAND DECK|deskSweep/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /\.signal_compact/);
  assert.match(css, /:focus-visible/);
});

async function read(path: string) {
  return readFile(resolve(process.cwd(), path), "utf8");
}
