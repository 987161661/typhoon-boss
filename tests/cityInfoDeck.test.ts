import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const componentPath = "components/CityInfoDeck.tsx";
const cssPath = "components/CityInfoDeck.module.css";

test("information deck renders the complete factual decision model", async () => {
  const source = await read(componentPath);

  assert.match(source, /model\.info\.warning/);
  assert.match(source, /warning\.title/);
  assert.match(source, /warning\.issuer/);
  assert.match(source, /warning\.description/);
  assert.match(source, /warning\.instruction/);
  assert.match(source, /model\.info\.currentMetrics\.map/);
  assert.match(source, /model\.info\.nowcastMetrics\.map/);
  assert.match(source, /model\.info\.trendMetrics\.map/);
  assert.match(source, /model\.info\.risks\.map/);
  assert.match(source, /model\.info\.actions\.map/);
  assert.doesNotMatch(source, /model\.battle\.actions\.map/);
  assert.match(source, /model\.info\.limitations\.map/);
  assert.doesNotMatch(source, /\.slice\s*\(/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
});

test("information deck exposes stable semantic and evidence hooks", async () => {
  const source = await read(componentPath);
  for (const role of [
    "info-panel",
    "official-warning",
    "current-observations",
    "nowcast-metrics",
    "trend-metrics",
    "risk-matrix",
    "action-guidance",
    "data-limitations",
    "evidence"
  ]) {
    assert.match(source, new RegExp(`data-role=\\"${role}\\"`));
  }
  assert.match(source, /data-evidence=/);
  assert.match(source, /data-warning-feed=/);
  assert.match(source, /data-severity=/);
  assert.match(source, /data-phase=/);
});

test("information deck obeys resolver geometry without hiding or scrolling content", async () => {
  const css = await read(cssPath);

  assert.match(css, /width:\s*100%/);
  assert.match(css, /height:\s*100%/);
  assert.match(css, /min-width:\s*0/);
  assert.match(css, /min-height:\s*0/);
  assert.doesNotMatch(css, /min-width:\s*(?:4|5)\d\dpx/);
  assert.doesNotMatch(css, /min-height:\s*6\d\dpx/);
  assert.doesNotMatch(css, /\.deck\s*\{[^}]*display:\s*none/);
  assert.doesNotMatch(css, /overflow(?:-y)?:\s*(?:auto|scroll|hidden)/);
  assert.match(css, /@media\s*\(max-height:\s*700px\)[\s\S]*\.deck\s*\{[\s\S]*gap:\s*6px/);
  assert.match(css, /@container\s*\(max-width:\s*430px\)[\s\S]*\.riskGrid\s*\{[^}]*repeat\(2/);
  assert.match(css, /@container\s*\(max-width:\s*430px\)[\s\S]*\.footer\s*\{[^}]*repeat\(2/);
});

async function read(path: string) {
  return readFile(resolve(process.cwd(), path), "utf8");
}
