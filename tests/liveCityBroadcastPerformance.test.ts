import assert from "node:assert/strict";
import test from "node:test";
import {
  LIVE_CITY_BROADCAST_RENDER_MILESTONES,
  LIVE_CITY_BROADCAST_TIMELINE,
  resolveLiveCityBroadcastAct,
  resolveLiveScoreAt,
  resolveLiveSummarySpeed
} from "../lib/liveCityBroadcastPerformance";

test("broadcast timeline preserves the full 2.45-second performance", () => {
  assert.equal(resolveLiveCityBroadcastAct(0), "battle");
  assert.equal(resolveLiveCityBroadcastAct(799), "battle");
  assert.equal(resolveLiveCityBroadcastAct(800), "info");
  assert.equal(resolveLiveCityBroadcastAct(1_800), "stamp");
  assert.equal(resolveLiveCityBroadcastAct(2_449), "stamp");
  assert.equal(resolveLiveCityBroadcastAct(2_450), "settled");
  assert.equal(LIVE_CITY_BROADCAST_TIMELINE.settledMs, 2_450);
  assert.equal(resolveLiveCityBroadcastAct(0, true), "settled");
});

test("broadcast animation updates React only at bounded visual milestones", () => {
  assert.deepEqual(LIVE_CITY_BROADCAST_RENDER_MILESTONES, [300, 800, 1_800, 2_450]);
  assert.ok(
    LIVE_CITY_BROADCAST_RENDER_MILESTONES.length <= 4,
    "the full dual-panel tree must not rerender on every animation frame"
  );
});

test("summary pacing stays readable while fitting the two-second broadcast budget", () => {
  assert.equal(resolveLiveSummarySpeed("短句"), 58);
  const speed = resolveLiveSummarySpeed("短时雨势增强，请避开低洼路段，并继续留意官方更新。");
  assert.ok(speed >= 34 && speed <= 58);
});

test("score count-up is monotonic and capped at the actual score", () => {
  assert.equal(resolveLiveScoreAt(0, 84), 0);
  assert.ok(resolveLiveScoreAt(600, 84) > 0);
  assert.equal(resolveLiveScoreAt(900, 84), 84);
  assert.equal(resolveLiveScoreAt(9_000, 130), 100);
});
