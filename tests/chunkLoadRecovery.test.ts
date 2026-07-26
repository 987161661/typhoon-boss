import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { CHUNK_LOAD_RECOVERY_SCRIPT } from "../lib/chunkLoadRecovery";

function createHarness(now = 20_000) {
  const listeners = new Map<string, (event: Record<string, unknown>) => void>();
  const storage = new Map<string, string>();
  const replacements: string[] = [];
  vm.runInNewContext(CHUNK_LOAD_RECOVERY_SCRIPT, {
    URL,
    Date: { now: () => now },
    location: {
      href: "http://127.0.0.1:3038/live",
      replace: (url: string) => replacements.push(url)
    },
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value)
    },
    addEventListener: (
      type: string,
      listener: (event: Record<string, unknown>) => void
    ) => listeners.set(type, listener)
  });
  return { listeners, replacements };
}

test("a Next.js ChunkLoadError reloads the page onto the current build", () => {
  const harness = createHarness();
  harness.listeners.get("unhandledrejection")?.({
    reason: {
      name: "ChunkLoadError",
      message: "Loading chunk app-pages-browser failed."
    }
  });
  assert.equal(harness.replacements.length, 1);
  assert.match(harness.replacements[0], /\/live\?__chunk_retry=20000$/);
});

test("ordinary runtime errors do not reload the live page", () => {
  const harness = createHarness();
  harness.listeners.get("error")?.({
    error: new Error("ordinary render failure")
  });
  assert.deepEqual(harness.replacements, []);
});

test("the recovery cooldown prevents a reload loop", () => {
  const harness = createHarness();
  const listener = harness.listeners.get("unhandledrejection");
  listener?.({ reason: new Error("ChunkLoadError: Loading chunk one failed.") });
  listener?.({ reason: new Error("ChunkLoadError: Loading chunk two failed.") });
  assert.equal(harness.replacements.length, 1);
});
