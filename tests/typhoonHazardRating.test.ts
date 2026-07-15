import assert from "node:assert/strict";
import test from "node:test";
import { classifyTyphoonHazard } from "../lib/typhoonHazardRating";

test("typhoon hazard rating combines intensity and impact range", () => {
  assert.equal(classifyTyphoonHazard(18, "热带风暴", { r7: 100, r10: 0, r12: 0 }), "狼级");
  assert.equal(classifyTyphoonHazard(38, "台风", { r7: 220, r10: 60, r12: 0 }), "虎级");
  assert.equal(classifyTyphoonHazard(52, "强台风", { r7: 250, r10: 80, r12: 0 }), "鬼级");
  assert.equal(classifyTyphoonHazard(60, "超强台风", { r7: 380, r10: 180, r12: 80 }), "龙级");
});

test("no wind-only input can automatically claim god-level harm", () => {
  assert.notEqual(classifyTyphoonHazard(80, "超强台风", { r7: 200, r10: 100, r12: 50 }), "神级");
});
