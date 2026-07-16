import assert from "node:assert/strict";
import test from "node:test";
import { resolveCityPanelLayout, type LayoutRect } from "../lib/cityPanelLayout";

const panelSizes = {
  battleSize: { width: 420, height: 620 },
  infoSize: { width: 390, height: 620 }
};

test("wide view keeps battle left, information right and a 76px city core", () => {
  const layout = resolveCityPanelLayout({
    viewport: { width: 1920, height: 1080 },
    anchor: { x: 960, y: 520 },
    ...panelSizes
  });
  assert.equal(layout.mode, "split");
  assert.equal(layout.density, "full");
  assert.equal(layout.battleRect.x + layout.battleRect.width, 922);
  assert.equal(layout.infoRect.x, 998);
  assert.equal(layout.infoRect.x - layout.battleRect.x - layout.battleRect.width, 76);
  assert.ok(layout.battleRect.width >= 680);
  assert.ok(layout.infoRect.width >= 550);
  assert.ok(layout.battleRect.height >= 680);
  assert.ok(layout.infoRect.height >= 680);
  assert.equal(layout.connectorsVisible, true);
  assertValidPair(layout.battleRect, layout.infoRect, { x: 18, y: 18, width: 1884, height: 1044 });
});

test("1366x768 remains a readable full-density desktop split", () => {
  const layout = resolveCityPanelLayout({
    viewport: { width: 1366, height: 768 },
    anchor: { x: 683, y: 380 },
    ...panelSizes
  });
  assert.equal(layout.mode, "split");
  assert.equal(layout.density, "full");
  assert.ok(layout.battleRect.width >= 620);
  assert.ok(layout.infoRect.width >= 550);
  assert.equal(layout.battleRect.height, 680);
  assert.equal(layout.infoRect.height, 680);
});

test("1280x720 centered split keeps full content instead of summary density", () => {
  const layout = resolveCityPanelLayout({
    viewport: { width: 1280, height: 720 },
    anchor: { x: 640, y: 350 },
    ...panelSizes
  });
  assert.equal(layout.mode, "split");
  assert.equal(layout.density, "full");
  assert.ok(layout.battleRect.width >= 580);
  assert.ok(layout.infoRect.width >= 550);
  assert.equal(layout.battleRect.height, 680);
  assert.equal(layout.infoRect.height, 680);
});

test("off-center 1280 city keeps split by adapting the information width", () => {
  const layout = resolveCityPanelLayout({
    viewport: { width: 1280, height: 720 },
    anchor: { x: 850, y: 330 },
    safeInsets: { top: 20, right: 16, bottom: 20, left: 16 },
    ...panelSizes
  });
  assert.equal(layout.mode, "split");
  assert.equal(layout.density, "full");
  assert.equal(layout.battleRect.height, 680);
  assert.equal(layout.infoRect.height, 680);
  assert.ok(layout.infoRect.width >= 320);
  assert.equal(layout.infoRect.x + layout.infoRect.width, 1264);
});

test("genuinely short desktop uses a larger compact canvas rather than the old 340px cap", () => {
  const layout = resolveCityPanelLayout({
    viewport: { width: 1280, height: 640 },
    anchor: { x: 640, y: 315 },
    ...panelSizes
  });
  assert.equal(layout.mode, "split");
  assert.equal(layout.density, "compact");
  assert.ok(layout.battleRect.height >= 520);
  assert.ok(layout.infoRect.height >= 520);
});

test("narrow viewport stacks both cards and keeps them in the safe area", () => {
  const safe = { x: 16, y: 12, width: 728, height: 690 };
  const layout = resolveCityPanelLayout({
    viewport: { width: 760, height: 720 },
    anchor: { x: 380, y: 360 },
    safeInsets: { top: 12, right: 16, bottom: 18, left: 16 },
    ...panelSizes
  });
  assert.equal(layout.mode, "stacked");
  assert.equal(layout.density, "compact");
  assert.equal(layout.connectorsVisible, false);
  assert.ok(layout.battleRect.y < layout.infoRect.y);
  assertValidPair(layout.battleRect, layout.infoRect, safe);
  assert.equal(intersects(layout.battleRect, { x: 342, y: 322, width: 76, height: 76 }), false);
  assert.equal(intersects(layout.infoRect, { x: 342, y: 322, width: 76, height: 76 }), false);
});

test("missing anchor uses a centered group fallback", () => {
  const layout = resolveCityPanelLayout({
    viewport: { width: 1280, height: 900 },
    anchor: null,
    ...panelSizes
  });
  assert.equal(layout.mode, "stacked");
  assert.equal(layout.connectorsVisible, false);
  assert.ok(Math.abs((layout.battleRect.x + layout.battleRect.width / 2) - 640) < 1);
  assertValidPair(layout.battleRect, layout.infoRect, { x: 18, y: 18, width: 1244, height: 864 });
});

test("edge anchor stacks instead of squeezing a split card over the city", () => {
  const layout = resolveCityPanelLayout({
    viewport: { width: 1280, height: 720 },
    anchor: { x: 120, y: 330 },
    ...panelSizes
  });
  assert.equal(layout.mode, "stacked");
  const core = { x: 82, y: 292, width: 76, height: 76 };
  assert.equal(intersects(layout.battleRect, core), false);
  assert.equal(intersects(layout.infoRect, core), false);
});

test("reserved HUD collision rejects split placement", () => {
  const layout = resolveCityPanelLayout({
    viewport: { width: 1920, height: 1080 },
    anchor: { x: 960, y: 540 },
    reservedRects: [{ x: 500, y: 300, width: 450, height: 500 }],
    ...panelSizes
  });
  assert.equal(layout.mode, "stacked");
  assert.equal(layout.connectorsVisible, false);
});

function assertValidPair(battle: LayoutRect, info: LayoutRect, safe: LayoutRect) {
  for (const rect of [battle, info]) {
    assert.ok(rect.x >= safe.x);
    assert.ok(rect.y >= safe.y);
    assert.ok(rect.x + rect.width <= safe.x + safe.width + 0.001);
    assert.ok(rect.y + rect.height <= safe.y + safe.height + 0.001);
  }
  assert.equal(intersects(battle, info), false);
}

function intersects(a: LayoutRect, b: LayoutRect) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
