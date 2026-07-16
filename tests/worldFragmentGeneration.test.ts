import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWorldFragmentBriefs,
  normalizeGeneratedWorldFragment,
  parseWorldFragmentResponse,
  runWorldFragmentBatches,
  type WorldFragmentBrief
} from "../lib/worldFragmentGeneration";
import type { WorldLoreFramework } from "../lib/worldLoreFramework";

const framework: WorldLoreFramework = {
  arcVersion: 1,
  status: "canon",
  title: "观测回声档案",
  canonFacts: ["2078年处于长晴纪元"],
  generationCanon: ["当前只允许档案错页阶段"],
  allowedMotifs: ["倒置校验码", "玻璃雨痕", "缺失坐标", "静默频段", "封存页"],
  forbiddenTerms: ["现实灾害预测", "准确预言"],
  maxRevealLevel: 1
};

test("fifty fragment briefs preserve the short-standard-long quota and composable task fields", () => {
  const briefs = buildWorldFragmentBriefs({ count: 50, seed: "parallel-preview", framework });
  const lengths = briefs.reduce<Record<string, number>>((counts, brief) => {
    counts[brief.lengthTier] = (counts[brief.lengthTier] ?? 0) + 1;
    return counts;
  }, {});

  assert.equal(briefs.length, 50);
  assert.equal(new Set(briefs.map((brief) => brief.id)).size, 50);
  assert.deepEqual(lengths, { short: 8, standard: 32, long: 10 });
  assert.ok(briefs.every((brief) => framework.allowedMotifs.includes(brief.motif)));
  assert.ok(new Set(briefs.map((brief) => brief.speaker)).size >= 3);
  assert.ok(new Set(briefs.map((brief) => brief.rhetoric)).size >= 6);
});

test("MiniMax response parser accepts the contracted object and the observed top-level array", () => {
  const item = { brief_id: "brief-1", text: "雨痕先于天空抵达。" };
  const objectResult = parseWorldFragmentResponse(`<think>private</think>\n\`\`\`json\n${JSON.stringify({ items: [item] })}\n\`\`\``);
  const arrayResult = parseWorldFragmentResponse(JSON.stringify([item]));

  assert.equal(objectResult.length, 1);
  assert.equal(arrayResult.length, 1);
  assert.equal(objectResult[0]?.text, item.text);
  assert.equal(arrayResult[0]?.brief_id, item.brief_id);
});

test("local quality gate enforces the global length boundary, reclassifies actual length, and blocks reveal hazards", () => {
  const brief: WorldFragmentBrief = {
    id: "brief-safe",
    speaker: "archive",
    motif: "玻璃雨痕",
    thesis: "记忆可能先于事件抵达",
    rhetoric: "时间错位",
    lengthTier: "short",
    revealLevel: 1,
    mustAvoid: ["预言"]
  };
  const base = { brief_id: brief.id, semantic_key: "记忆/抵达" };

  const accepted = normalizeGeneratedWorldFragment({ value: { ...base, text: "雨痕先于天空抵达。" }, brief, framework });
  const reclassified = normalizeGeneratedWorldFragment({ value: { ...base, text: "玻璃上的雨痕已经抵达，而天空仍然没有获得降雨权限。" }, brief, framework });
  const tooLong = normalizeGeneratedWorldFragment({ value: { ...base, text: "这条档案记录使用了超过四十八个汉字来反复解释同一个判断，因此即使它语法完整也不适合在解锁界面中作为短句被正式展示给任何观测员。" }, brief, framework });
  const forbidden = normalizeGeneratedWorldFragment({ value: { ...base, text: "这不是误差而是预言。" }, brief, framework });

  assert.equal(accepted?.text, "雨痕先于天空抵达。");
  assert.equal(accepted?.revealLevel, 1);
  assert.equal(reclassified?.lengthTier, "standard");
  assert.equal(tooLong, null);
  assert.equal(forbidden, null);
});

test("five ten-item calls run concurrently and retain four successful batches when one fails", async () => {
  const briefs = buildWorldFragmentBriefs({ count: 50, seed: "concurrency", framework });
  let active = 0;
  let peak = 0;
  const outcome = await runWorldFragmentBatches({
    briefs,
    batchSize: 10,
    maxConcurrency: 5,
    generate: async (batch, batchIndex) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active -= 1;
      if (batchIndex === 1) throw new Error("provider batch failed");
      return batch.map((brief) => brief.id);
    }
  });

  assert.equal(peak, 5);
  assert.equal(outcome.items.length, 40);
  assert.deepEqual(outcome.failures, [{ batchIndex: 1, message: "provider batch failed" }]);
});
