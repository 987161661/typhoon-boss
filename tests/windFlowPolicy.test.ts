import assert from "node:assert/strict";
import test from "node:test";
import { computeWindFlowPolicy, trimWindTrailToPixelLength } from "../lib/windFlowPolicy";

test("wind flow policy makes distant views denser with longer screen-space trails", () => {
  const distant = computeWindFlowPolicy({
    zoom: 3.25,
    viewportWidth: 1920,
    viewportHeight: 1080,
    adaptiveQuality: 1,
    livePerformanceMode: true
  });
  const close = computeWindFlowPolicy({
    zoom: 7.25,
    viewportWidth: 1920,
    viewportHeight: 1080,
    adaptiveQuality: 1,
    livePerformanceMode: true
  });

  assert.equal(distant.headSpacingPx, 30);
  assert.equal(distant.targetTrailPx, 110);
  assert.equal(distant.targetParticleCount, 1320);
  assert.equal(close.headSpacingPx, 52);
  assert.equal(close.targetTrailPx, 58);
  assert.ok(close.targetParticleCount >= 520 && close.targetParticleCount < distant.targetParticleCount);
});

test("wind flow policy changes continuously across nearby zoom values", () => {
  const before = computeWindFlowPolicy({ zoom: 5.49, viewportWidth: 1920, viewportHeight: 1080, adaptiveQuality: 1, livePerformanceMode: true });
  const after = computeWindFlowPolicy({ zoom: 5.51, viewportWidth: 1920, viewportHeight: 1080, adaptiveQuality: 1, livePerformanceMode: true });

  assert.ok(Math.abs(after.headSpacingPx - before.headSpacingPx) < 1);
  assert.ok(Math.abs(after.targetTrailPx - before.targetTrailPx) < 1);
  assert.ok(Math.abs(after.targetParticleCount - before.targetParticleCount) < 80);
});

test("projected wind trails are clipped to a pixel length with an interpolated start", () => {
  const trail = Array.from({ length: 11 }, (_, index) => ({ x: index * 10, y: 0 }));
  const clipped = trimWindTrailToPixelLength(trail, { x: 110, y: 0 }, 58);

  assert.equal(clipped.lengthPx, 58);
  assert.equal(clipped.points.at(-1)?.x, 110);
  assert.equal(clipped.points[0].x, 52);
});
