import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { claimWorldFragment, getWorldFragmentRuntimeStatus } from "../lib/worldFragmentPool";
import { loadWorldLoreFramework } from "../lib/worldLoreFramework";

const FRAGMENT_ONE = "第七码头没有船，只有一组比城市快了九分钟的雨痕，在玻璃背面反复校验同一段失踪时间。";
const FRAGMENT_TWO = "无声观测站在午夜回传一枚倒置校验码，它指向不存在的坐标，却与昨天遗失的时间片完全重合。";

test("claim is request-idempotent and bound to exact platform plus viewer identity", async () => {
  await withIsolatedState([FRAGMENT_ONE, FRAGMENT_TWO], async ({ poolFile, claimFile }) => {
    const input = {
      requestId: "request-1",
      cityKey: "650100",
      platform: "simulator",
      viewerId: "viewer-1",
      accessSource: "observed" as const
    };
    const first = await claimWorldFragment(input);
    const repeated = await claimWorldFragment(input);
    const wrongViewer = await claimWorldFragment({ ...input, viewerId: "viewer-2" });

    assert.equal(first.status, "revealed");
    assert.ok(first.fragment === FRAGMENT_ONE || first.fragment === FRAGMENT_TWO);
    assert.deepEqual(repeated, first);
    assert.equal(wrongViewer.status, "sealed");
    const pool = JSON.parse(await readFile(poolFile, "utf8")) as { available: unknown[]; consumed: unknown[] };
    const claims = JSON.parse(await readFile(claimFile, "utf8")) as { claims: Record<string, unknown> };
    assert.equal(pool.available.length, 1);
    assert.equal(pool.consumed.length, 1);
    assert.equal(Object.keys(claims.claims).length, 1);
  });
});

test("unknown access never consumes a fragment", async () => {
  await withIsolatedState([FRAGMENT_ONE], async ({ poolFile, claimFile }) => {
    const framework = await loadWorldLoreFramework();
    assert.equal(framework.status, "canon");
    assert.equal(framework.title, "观测回声档案");
    assert.ok(framework.allowedMotifs.includes("倒置校验码"));
    assert.ok(framework.generationCanon.some((fact) => fact.includes("档案的错页")));
    const result = await claimWorldFragment({
      requestId: "request-unknown",
      cityKey: "410100",
      platform: "simulator",
      viewerId: "viewer-unknown",
      accessSource: "unknown"
    });

    assert.equal(result.status, "sealed");
    const pool = JSON.parse(await readFile(poolFile, "utf8")) as { available: unknown[]; consumed: unknown[] };
    assert.equal(pool.available.length, 1);
    assert.equal(pool.consumed.length, 0);
    await assert.rejects(readFile(claimFile, "utf8"), { code: "ENOENT" });
  });
});

test("runtime status reports inventory without consuming a fragment", async () => {
  await withIsolatedState([FRAGMENT_ONE], async ({ poolFile }) => {
    const status = await getWorldFragmentRuntimeStatus();
    assert.equal(status.canon, "ready");
    assert.equal(status.available, 1);
    assert.equal(status.targetSize, 50);
    const pool = JSON.parse(await readFile(poolFile, "utf8")) as { available: unknown[]; consumed: unknown[] };
    assert.equal(pool.available.length, 1);
    assert.equal(pool.consumed.length, 0);
  });
});

test("an eligible empty-pool claim stays syncing and can later promote without relocking", async () => {
  await withIsolatedState([], async ({ poolFile }) => {
    const input = {
      requestId: "request-syncing",
      cityKey: "330100",
      platform: "simulator",
      viewerId: "viewer-syncing",
      accessSource: "whitelist" as const
    };
    const first = await claimWorldFragment(input);
    assert.equal(first.status, "syncing");

    await writePool(poolFile, [FRAGMENT_TWO]);
    const promoted = await claimWorldFragment(input);
    assert.equal(promoted.status, "revealed");
    assert.equal(promoted.fragment, FRAGMENT_TWO);
    assert.equal(promoted.archiveCode, first.archiveCode);
  });
});

async function withIsolatedState(
  fragments: string[],
  run: (paths: { poolFile: string; claimFile: string }) => Promise<void>
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "weather-world-fragments-"));
  const poolFile = path.join(root, "pool.json");
  const claimFile = path.join(root, "claims.json");
  const previous = {
    pool: process.env.WORLD_FRAGMENT_POOL_STATE_FILE,
    claim: process.env.WORLD_FRAGMENT_CLAIM_STATE_FILE,
    lore: process.env.WORLD_LORE_FRAMEWORK_PATH,
    minimax: process.env.MINIMAX_API_KEY
  };
  process.env.WORLD_FRAGMENT_POOL_STATE_FILE = poolFile;
  process.env.WORLD_FRAGMENT_CLAIM_STATE_FILE = claimFile;
  process.env.WORLD_LORE_FRAMEWORK_PATH = path.join(root, "missing-runtime-framework.json");
  delete process.env.MINIMAX_API_KEY;
  await mkdir(root, { recursive: true });
  await writePool(poolFile, fragments);
  try {
    await run({ poolFile, claimFile });
  } finally {
    restoreEnv("WORLD_FRAGMENT_POOL_STATE_FILE", previous.pool);
    restoreEnv("WORLD_FRAGMENT_CLAIM_STATE_FILE", previous.claim);
    restoreEnv("WORLD_LORE_FRAMEWORK_PATH", previous.lore);
    restoreEnv("MINIMAX_API_KEY", previous.minimax);
    await rm(root, { recursive: true, force: true });
  }
}

async function writePool(file: string, fragments: string[]) {
  const createdAt = "2026-07-15T00:00:00.000Z";
  await writeFile(file, JSON.stringify({
    version: 1,
    generation: 1,
    available: fragments.map((text, index) => ({ id: `fragment-${index}`, text, seed: `seed-${index}`, createdAt })),
    consumed: []
  }), "utf8");
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
