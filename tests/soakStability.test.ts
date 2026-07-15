import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const runner = join(root, "scripts", "run_soak_stability.mjs");
const hiddenLauncher = join(root, "scripts", "start_soak_stability_hidden.ps1");

test("soak runner self-test covers schema, cadence, CSV and growth detection", () => {
  const result = spawnSync(process.execPath, [runner, "--self-test"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout.trim()) as { passed: boolean; checks: string[] };
  assert.equal(payload.passed, true);
  assert.deepEqual(payload.checks, ["csv", "growth-detector", "national-schema", "radar-schema", "cadence", "conditional-refresh"]);
});

test("PowerShell launcher uses a hidden child and preserves the two-hour defaults", () => {
  const source = readFileSync(hiddenLauncher, "utf8");
  assert.match(source, /\[int\]\$DurationMinutes = 120/);
  assert.match(source, /\[int\]\$SampleIntervalSeconds = 10/);
  assert.match(source, /\[int\]\$NationalIntervalSeconds = 300/);
  assert.match(source, /\[int\]\$RadarIntervalSeconds = 10/);
  assert.match(source, /WindowStyle = "Hidden"/);
  assert.match(source, /Start-Process @start/);
  assert.match(source, /RedirectStandardOutput/);
  assert.match(source, /RedirectStandardError/);
});
