import assert from "node:assert/strict";
import test from "node:test";
import { DailySnapshotCache, beijingDayKey } from "../lib/dailySnapshotCache";

test("concurrent requests share one in-flight ranking snapshot load", async () => {
  let loads = 0;
  let release!: (value: { day: string }) => void;
  const deferred = new Promise<{ day: string }>((resolve) => { release = resolve; });
  const cache = new DailySnapshotCache(async () => {
    loads += 1;
    return deferred;
  }, () => new Date("2026-07-15T08:00:00Z"));

  const first = cache.get();
  const second = cache.get();
  release({ day: "2026-07-15" });
  const [left, right] = await Promise.all([first, second]);

  assert.equal(loads, 1);
  assert.strictEqual(left, right);
  assert.strictEqual(await cache.get(), left);
});

test("day-key cache crosses request instances but reloads on the next Beijing day", async () => {
  let now = new Date("2026-07-15T15:59:59Z");
  const loaded: string[] = [];
  const cache = new DailySnapshotCache(async (day) => {
    loaded.push(day);
    return { day };
  }, () => now);

  assert.equal((await cache.get()).day, "2026-07-15");
  assert.equal((await cache.get()).day, "2026-07-15");
  now = new Date("2026-07-15T16:00:01Z");
  assert.equal((await cache.get()).day, "2026-07-16");
  assert.deepEqual(loaded, ["2026-07-15", "2026-07-16"]);
  assert.equal(beijingDayKey(now), "2026-07-16");
});

test("failed loads are not cached and can recover", async () => {
  let loads = 0;
  const cache = new DailySnapshotCache(async () => {
    loads += 1;
    if (loads === 1) throw new Error("upstream unavailable");
    return "recovered";
  });
  await assert.rejects(cache.get(), /upstream unavailable/);
  assert.equal(await cache.get(), "recovered");
  assert.equal(loads, 2);
});

test("non-cacheable null still deduplicates in-flight but retries after an external refresh", async () => {
  let loads = 0;
  let valid = false;
  const cache = new DailySnapshotCache(
    async () => {
      loads += 1;
      await Promise.resolve();
      return valid ? { fetchedAt: "2026-07-15T03:15:00+08:00" } : null;
    },
    () => new Date("2026-07-15T01:00:00Z"),
    beijingDayKey,
    (value) => value !== null
  );

  const [first, second] = await Promise.all([cache.get(), cache.get()]);
  assert.equal(first, null);
  assert.equal(second, null);
  assert.equal(loads, 1);

  valid = true;
  assert.deepEqual(await cache.get(), { fetchedAt: "2026-07-15T03:15:00+08:00" });
  assert.equal(loads, 2);
  assert.equal((await cache.get())?.fetchedAt, "2026-07-15T03:15:00+08:00");
  assert.equal(loads, 2);
});
