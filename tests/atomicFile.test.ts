import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { writeFileAtomic } from "../lib/atomicFile";

test("concurrent snapshot writers never collide on a shared temporary file", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "radar-atomic-write-"));
  const target = path.join(directory, "snapshot.json");
  try {
    await Promise.all(
      Array.from({ length: 24 }, (_, index) =>
        writeFileAtomic(target, JSON.stringify({ index }))
      )
    );
    const snapshot = JSON.parse(await readFile(target, "utf8")) as { index: number };
    assert.ok(snapshot.index >= 0 && snapshot.index < 24);
    assert.deepEqual((await readdir(directory)).filter((name) => name.endsWith(".tmp")), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
