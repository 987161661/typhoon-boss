import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { resolveCityPanelLayout } from "../lib/cityPanelLayout";

const DESKTOP_CASES = [
  { label: "720p live canvas", width: 1280, height: 720, minimumBattleWidth: 580 },
  { label: "768p live canvas", width: 1366, height: 768, minimumBattleWidth: 620 },
  { label: "1080p live canvas", width: 1920, height: 1080, minimumBattleWidth: 680 }
] as const;

const RESTORED_CONTENT_SIZE = {
  battleSize: { width: 720, height: 680 },
  infoSize: { width: 550, height: 680 }
};

for (const viewport of DESKTOP_CASES) {
  test(`${viewport.label} keeps both panels readable at full density`, () => {
    const layout = resolveCityPanelLayout({
      viewport,
      anchor: { x: viewport.width / 2, y: viewport.height / 2 },
      ...RESTORED_CONTENT_SIZE
    });

    assert.equal(layout.mode, "split");
    assert.equal(layout.density, "full", `${viewport.width}x${viewport.height} must never enter content-deleting compact mode`);
    assert.ok(layout.battleRect.width >= viewport.minimumBattleWidth, `battle width regressed to ${layout.battleRect.width}px`);
    assert.ok(layout.infoRect.width >= 550, `info width regressed to ${layout.infoRect.width}px`);
    assert.ok(layout.battleRect.height >= 680, `battle height regressed to ${layout.battleRect.height}px`);
    assert.ok(layout.infoRect.height >= 680, `info height regressed to ${layout.infoRect.height}px`);
    assert.ok(layout.infoRect.x - (layout.battleRect.x + layout.battleRect.width) >= 76,
      "the city core must retain at least 76px of clear space");
  });
}

test("desktop density CSS never hides battle mutators, actions or archive rewards", async () => {
  const css = [
    await read("components/CityPanelGroup.module.css"),
    await read("components/CityBattleShow.module.css"),
    await read("components/LiveCityInteraction.module.css")
  ].join("\n");
  const hiddenCoreBeats = cssRules(css)
    .filter(({ selector, declarations }) => /(?:mutator|action|archive|fragment)/i.test(selector) && /display\s*:\s*none\b/i.test(declarations));

  assert.deepEqual(hiddenCoreBeats, [],
    `core battle beats may be reflowed but not hidden:\n${hiddenCoreBeats.map((rule) => rule.selector).join("\n")}`);
});

test("desktop panel policy is materially larger than the rejected small-card ranges", async () => {
  const layoutSource = await read("lib/cityPanelLayout.ts");
  const groupSource = await read("components/CityPanelGroup.tsx");
  const source = `${layoutSource}\n${groupSource}`;

  assert.match(source, /battle:\s*\{[^}]*preferred:\s*680\b/,
    "battle preferred width must retain the mobile-stream readability increase");
  assert.match(source, /info:\s*\{[^}]*preferred:\s*550\b/,
    "info preferred width must retain the mobile-stream readability increase");
});

test("animated panel transforms never feed visual scale back into layout state", async () => {
  const groupSource = await read("components/CityPanelGroup.tsx");

  assert.match(groupSource, /const EMPTY_RESERVED_RECTS: LayoutRect\[\] = \[\]/,
    "the default reserved rect collection must stay referentially stable across layout updates");
  assert.match(groupSource, /node\.offsetWidth/);
  assert.match(groupSource, /node\.offsetHeight/);
  assert.doesNotMatch(groupSource, /getBoundingClientRect\(\)/,
    "layout measurement must exclude the deploy animation's CSS transforms");
  assert.match(groupSource, /new ResizeObserver\(scheduleUpdate\)/,
    "observer updates must be coalesced outside the synchronous resize callback");
});

test("mobile-stream typography keeps primary information above the rejected micro-copy scale", async () => {
  const battleCss = await read("components/CityBattleShow.module.css");
  const infoCss = await read("components/CityInfoDeck.module.css");

  assert.match(battleCss, /\.typewriter\s*\{[^}]*font:\s*800\s+16px\//);
  assert.match(battleCss, /\.actions b\s*\{[^}]*font:\s*800\s+12px\//);
  assert.match(infoCss, /\.identity h3\s*\{[^}]*font-size:\s*24px/);
  assert.match(infoCss, /\.warningTitle\s*\{[^}]*font-size:\s*14px/);
  assert.match(infoCss, /\.metric > strong\s*\{[^}]*font:\s*650\s+17px\//);
  assert.match(infoCss, /\.footer p\s*\{[^}]*font-size:\s*9\.5px/);
});

function cssRules(css: string) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: Array<{ selector: string; declarations: string }> = [];
  for (const match of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    rules.push({ selector: match[1].trim(), declarations: match[2] });
  }
  return rules;
}

async function read(path: string) {
  return readFile(resolve(process.cwd(), path), "utf8");
}
