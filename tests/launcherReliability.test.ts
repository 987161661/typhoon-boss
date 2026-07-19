import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const launcher = join(process.cwd(), "scripts", "start_live_with_linglan.ps1");

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
