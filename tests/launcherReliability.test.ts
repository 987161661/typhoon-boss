import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const launcher = join(process.cwd(), "scripts", "start_live_with_linglan.ps1");
const readinessGate = join(process.cwd(), "scripts", "test_live_readiness.ps1");
const chunkAliasRepair = join(process.cwd(), "scripts", "alias_next_chunks.js");

test("live launcher retries the data health check across cold route compilation", () => {
  const source = readFileSync(launcher, "utf8");

  assert.match(source, /function Wait-TyphoonHealth/);
  assert.match(source, /while \(\$stopwatch\.Elapsed\.TotalSeconds -lt \$TimeoutSeconds\)/);
  assert.match(source, /\$healthUrl = "\$BaseUrl\/api\/health"/);
  assert.match(source, /Invoke-RestMethod -Uri \$healthUrl -TimeoutSec \$RequestTimeoutSeconds/);
  assert.match(source, /catch \{/);
  assert.match(source, /Start-Sleep -Milliseconds 500/);
  assert.doesNotMatch(source, /\$health\s*=\s*Invoke-RestMethod[^\r\n]*\/api\/health[^\r\n]*-TimeoutSec 8/);
});

test("live launcher replaces the retired Bilibili listener before starting Linglan", () => {
  const source = readFileSync(launcher, "utf8");

  assert.match(source, /function Remove-RetiredBilibiliListener/);
  assert.match(source, /http:\/\/127\.0\.0\.1:\$GatewayPort\/health/);
  assert.match(source, /\$health\.connectorId -eq 'ordinaryroad'/);
  assert.match(source, /scripts\\bilibili-room-supervisor\.mjs/);
  assert.match(source, /Stop-Process -Id \$listenerProcess\.ProcessId -Force/);
  assert.match(source, /Remove-RetiredBilibiliListener -GatewayPort 8197/);
});

test("live launcher defaults to an isolated production build and keeps development explicit", () => {
  const source = readFileSync(launcher, "utf8");

  assert.match(source, /\[switch\]\$Development/);
  assert.match(source, /if \(\$Development\)/);
  assert.match(source, /& 'npm\.cmd' run build/);
  assert.match(source, /@?\('run', 'start'/);
  assert.match(source, /@?\('run', 'dev'/);
});

test("production chunk repair follows the launcher's isolated dist directory", () => {
  const source = readFileSync(chunkAliasRepair, "utf8");

  assert.match(source, /process\.env\.NEXT_DIST_DIR\?\.trim\(\) \|\| "\.next"/);
  assert.match(source, /path\.join\(process\.cwd\(\), distDir, "server"\)/);
});

test("one readiness gate verifies radar assets, fresh GFS and the digital-host runtime", () => {
  const source = readFileSync(readinessGate, "utf8");

  assert.match(source, /Test-TyphoonLiveAssets/);
  assert.match(source, /function Invoke-ReadinessJson/);
  assert.match(source, /while \(\$stopwatch\.Elapsed\.TotalSeconds -lt \$BudgetSeconds\)/);
  assert.match(source, /\/api\/environment\/wind-field/);
  assert.match(source, /NOAA\/NCEP NOMADS Grib Filter/);
  assert.match(source, /\/api\/digital-host\/health/);
  assert.match(source, /runtimeOwner/);
  assert.match(source, /lastFaults/);
  assert.doesNotMatch(source, /\$host\s*=/i);
});
