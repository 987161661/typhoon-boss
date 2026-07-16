import assert from "node:assert/strict";
import test from "node:test";
import {
  liveCityBroadcastMapOffset,
  resolveLiveCityBroadcastLayout
} from "../lib/liveCityBroadcastLayout";

test("720p enlarges the battle chassis while preserving an optical city-lock corridor", () => {
  const layout = resolveLiveCityBroadcastLayout({ width: 1280, height: 720 });

  assert.deepEqual(layout.battleRect, { x: 0, y: 12, width: 800, height: 450 });
  assert.deepEqual(layout.infoRect, { x: 880, y: 12, width: 400, height: 696 });
  assert.deepEqual(layout.corridorRect, { x: 800, y: 0, width: 80, height: 720 });
  assert.deepEqual(layout.target, { x: 840, y: 360 });
  assert.deepEqual(liveCityBroadcastMapOffset({ width: 1280, height: 720 }), [200, 0]);
});

test("1080p grows both towers while materially widening the map corridor", () => {
  const layout = resolveLiveCityBroadcastLayout({ width: 1920, height: 1080 });

  assert.deepEqual(layout.battleRect, { x: 0, y: 80, width: 1100, height: 619 });
  assert.deepEqual(layout.infoRect, { x: 1320, y: 80, width: 600, height: 920 });
  assert.equal(layout.corridorRect.width, 220);
  assert.equal(layout.target.x, 1210);
  assert.deepEqual(liveCityBroadcastMapOffset({ width: 1920, height: 1080 }), [250, 0]);
});

test("intermediate broadcast sizes never overlap the city corridor", () => {
  for (const viewport of [{ width: 1366, height: 768 }, { width: 1600, height: 900 }]) {
    const layout = resolveLiveCityBroadcastLayout(viewport);
    assert.equal(layout.battleRect.x + layout.battleRect.width, layout.corridorRect.x);
    assert.equal(layout.infoRect.x, layout.corridorRect.x + layout.corridorRect.width);
    assert.ok(layout.corridorRect.width >= 80);
  }
});

test("map offset is resolved against the real live canvas rather than the browser center", () => {
  const offset = liveCityBroadcastMapOffset(
    { width: 1280, height: 720 },
    { x: 421, y: -6, width: 859, height: 656 }
  );
  assert.deepEqual(offset, [-10.5, 38]);
});
