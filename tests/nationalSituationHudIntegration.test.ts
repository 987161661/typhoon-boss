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
  assert.match(source, /<IntelPanel[\s\S]+storm=\{storm\}/);
});

test("live standby composes compact national evidence and environment controls in a dedicated rail", async () => {
  const source = await read("components/TyphoonMap.tsx");
  const css = await read("components/NationalSituationRail.module.css");
  assert.match(source, /data-live-standby=\{showLiveStandbyEnvironment \? "true"/);
  assert.match(source, /data-national-side-rail=\{isLiveView \? "true"/);
  assert.match(source, /variant="compact"/);
  assert.match(source, /className=\{nationalRailStyles\.environmentInRail\}/);
  assert.match(css, /grid-template-columns: var\(--live-info-rail-width\) minmax\(0, 1fr\)/);
  assert.match(css, /hasNationalSideRail:global\(\.radar-shell\[data-view="live"\]\[data-live-standby="true"\]\[data-national-side-rail="true"\]\)/);
  assert.match(css, /\.liveRail > :global\(\.environment-panel\)/);
  assert.match(css, /hasStandardNationalRail:global\(\.radar-shell\[data-view="standard"\]\)/);
  assert.match(css, /--live-narrow-rail-width: min\(42vw, 20rem\)/);
});

test("loading and failure states do not describe missing data as no risk", async () => {
  const source = await read("components/TyphoonMap.tsx");
  assert.match(source, /正在加载全国态势快照/);
  assert.match(source, /全国态势快照暂时不可用/);
  assert.match(source, /当前无法据此判断全国风险/);
  assert.match(source, /继续显示最近有效统一快照；这不代表当前无风险/);
  assert.match(source, /重新获取快照/);
});

test("map and live header expose the new product brand without the legacy main brand", async () => {
  const map = await read("components/TyphoonMap.tsx");
  const live = await read("components/LiveBroadcastView.tsx");
  assert.match(map, /aria-label="气象 Boss 雷达全国气象地图"/);
  assert.match(map, />气象 Boss 雷达</);
  assert.match(live, /<span>气象 Boss 雷达<\/span>/);
  assert.doesNotMatch(`${map}\n${live}`, /台风 BOSS 雷达|台风 Boss 雷达地图/);
});

test("compact HUD reuses the same model and keeps textual source and empty-state semantics", async () => {
  const source = await read("components/NationalSituationHud.tsx");
  const css = await read("components/NationalSituationHud.module.css");
  assert.equal(source.match(/buildNationalSituationHudModel\(snapshot\)/g)?.length, 1);
  assert.match(source, /variant === "compact"/);
  assert.match(source, /主证据 \$\{primarySource\.statusLabel\}/);
  assert.match(source, /无事件记录不等于无风险/);
  assert.match(css, /\.compactEvent/);
  assert.match(css, /\.level_watch \.compactBadge/);
});

async function read(path: string) {
  return readFile(resolve(process.cwd(), path), "utf8");
}
