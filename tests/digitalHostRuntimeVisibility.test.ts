import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";

test("city broadcasts never hide the iframe that owns the digital-human runtime", () => {
  const css = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");
  const cityBroadcastSelectors = Array.from(
    css.matchAll(/([^{}]*data-city-broadcast-active[^{}]*)\{/g),
    (match) => match[1]
  );

  assert.ok(cityBroadcastSelectors.length > 0);
  for (const selector of cityBroadcastSelectors) {
    assert.doesNotMatch(
      selector,
      /\.digital-host-window/,
      "hiding the host window freezes its cross-origin runtime in OBS"
    );
  }
});
