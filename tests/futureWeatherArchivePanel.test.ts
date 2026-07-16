import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

test("standard national rail uses the future archive panel while live keeps the compact HUD", async () => {
  const map = await read("components/TyphoonMap.tsx");
  assert.match(map, /import \{ FutureWeatherArchivePanel \}/);
  assert.match(map, /variant === "full" \? \(\s*<FutureWeatherArchivePanel/);
  assert.match(map, /<NationalSituationHud[\s\S]*variant="compact"/);
  assert.match(map, /onSelectEvent=\{onSelectEvent\}/);
});

test("archive panel preserves the warning model, carousel, evidence boundaries and map action", async () => {
  const component = await read("components/FutureWeatherArchivePanel.tsx");
  assert.match(component, /buildNationalSituationHudModel\(snapshot\)/);
  assert.match(component, /useWarningCarousel\(model\.warningQueue\)/);
  assert.match(component, /event\.factSummary/);
  assert.match(component, /event\.limitation/);
  assert.match(component, /source\.statusDetail/);
  assert.match(component, /source\.updatedLabel/);
  assert.match(component, /<details className=\{styles\.evidenceRibbon\}>/);
  assert.match(component, /<summary className=\{styles\.sectionLabel\}>/);
  assert.match(component, /snapshot\.warnings\.byLevel/);
  assert.match(component, /无事件记录不等于无风险/);
  assert.match(component, /投影到地图/);
  assert.match(component, /type="button"/);
  assert.match(component, /上一卷官方预警/);
  assert.match(component, /冻结自动调阅/);
});

test("archive panel exposes the fictional bureau through physical archive artifacts", async () => {
  const component = await read("components/FutureWeatherArchivePanel.tsx");
  const css = await read("components/FutureWeatherArchivePanel.module.css");
  assert.match(component, /未来气象研究档案局/);
  assert.match(component, /F\.M\.R\.A · VAULT 07/);
  assert.match(component, /赤曜自动归档协议/);
  assert.match(component, /当前封存件/);
  assert.match(component, /待入库切片/);
  assert.match(component, /风险信号总览/);
  assert.doesNotMatch(component, /城市核验闸/);
  assert.match(component, /来源凭证链/);
  assert.match(component, /不参与现实行动指令/);
  assert.match(component, /storm-specimen-v1\.webp/);
  assert.match(component, /thunderstorm-show-v2\.webp/);
  assert.match(component, /rainstorm-show-v2\.webp/);
  assert.match(component, /heatwave-show-v2\.webp/);
  assert.match(component, /gale-show-v2\.webp/);
  assert.match(component, /duststorm-show-v2\.webp/);
  assert.match(component, /geological-show-v2\.webp/);
  assert.match(css, /performanceReveal/);
  assert.match(css, /bureau-seal-v1\.webp/);
  assert.match(css, /control-deck-v1\.webp/);
  assert.match(css, /evidence-ticket-v1\.webp/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@container/);
});

async function read(path: string) {
  return readFile(resolve(process.cwd(), path), "utf8");
}
