import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

type Dimensions = { width: number; height: number; unit: string };
type Asset = {
  id: string;
  filename: string;
  usage: string;
  dimensions: Dimensions;
  transparency: boolean;
  theme: string;
  license: string;
  containsText: boolean;
  status: string;
  generator?: string;
  generatedOn?: string;
  sha256?: string;
  reproducibility?: string;
  composition?: string[];
  derivedFrom?: string;
};

type Manifest = {
  status: string;
  generatedAssetsPresent: boolean;
  assets: Asset[];
};

const repoRoot = process.cwd();
const assetRoot = resolve(repoRoot, "public/assets/weather-boss");
const manifest = JSON.parse(readFileSync(resolve(assetRoot, "manifest.json"), "utf8")) as Manifest;
const svgAssets = manifest.assets.filter((asset) => asset.filename.endsWith(".svg"));
const pngAssets = manifest.assets.filter((asset) => asset.filename.endsWith(".png"));

function hash(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

test("Weather Boss manifest keeps SVG outputs generated and bitmap work planned", () => {
  assert.equal(manifest.status, "partially-generated");
  assert.equal(manifest.generatedAssetsPresent, true);
  assert.equal(svgAssets.length, 25);
  assert.equal(pngAssets.length, 4);

  for (const asset of manifest.assets) {
    assert.ok(asset.id && asset.filename && asset.usage && asset.theme && asset.license);
    assert.ok(asset.dimensions.width > 0 && asset.dimensions.height > 0);
    assert.equal(asset.dimensions.unit, "px");
    assert.equal(asset.transparency, true);
    assert.equal(asset.containsText, false);
  }

  for (const asset of svgAssets) {
    assert.equal(asset.status, "generated");
    assert.match(asset.generator ?? "", /^scripts\/generate_weather_boss_svg_assets\.mjs@\d+\.\d+\.\d+$/);
    assert.match(asset.generatedOn ?? "", /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(asset.license, "LicenseRef-WeatherBoss-Project-Original");
    assert.match(asset.sha256 ?? "", /^[a-f0-9]{64}$/);
    assert.equal(asset.reproducibility, `sha256:${asset.sha256}`);
  }

  for (const asset of pngAssets) assert.equal(asset.status, "planned");
});

test("every generated SVG matches dimensions, viewBox, text policy, and sha256", () => {
  for (const asset of svgAssets) {
    const content = readFileSync(resolve(assetRoot, asset.filename), "utf8");
    const { width, height } = asset.dimensions;
    assert.match(content, new RegExp(`<svg[^>]*width="${width}"[^>]*height="${height}"[^>]*viewBox="0 0 ${width} ${height}"`));
    assert.doesNotMatch(content, /<(?:text|title|desc|foreignObject|script|style|image)\b/i);
    assert.doesNotMatch(content, /[^\x09\x0A\x0D\x20-\x7E]/);
    assert.equal(content.replace(/<[^>]+>/g, "").trim(), "");
    assert.match(content, /fill="none"/);
    assert.match(content, /aria-hidden="true"/);
    assert.equal(hash(content), asset.sha256);
  }
});

test("asset families share masters and cover the complete primitive vocabulary", () => {
  const primitiveCoverage = new Set(svgAssets.flatMap((asset) => asset.composition ?? []));
  for (const primitive of ["frame", "corner", "tick", "notch", "glyph", "seal", "connector", "dossier"]) {
    assert.ok(primitiveCoverage.has(primitive), `missing primitive coverage: ${primitive}`);
  }

  const eventOutputs = svgAssets.filter((asset) => asset.id.startsWith("event-") && asset.id !== "event-badge-master");
  assert.deepEqual(eventOutputs.map((asset) => asset.id).sort(), [
    "event-composite",
    "event-convection",
    "event-gale-dust",
    "event-heat",
    "event-rainstorm",
    "event-typhoon"
  ]);
  for (const asset of eventOutputs) assert.equal(asset.derivedFrom, "event-badge-master");

  const sealOutputs = svgAssets.filter((asset) => asset.id.startsWith("risk-") && asset.id !== "risk-seal-master");
  assert.deepEqual(sealOutputs.map((asset) => asset.id).sort(), ["risk-blue", "risk-orange", "risk-red", "risk-watch", "risk-yellow"]);
  for (const asset of sealOutputs) assert.equal(asset.derivedFrom, "risk-seal-master");

  const stateGlyphs = readFileSync(resolve(assetRoot, "source-health-glyph-symbols.svg"), "utf8");
  for (const state of ["latest", "delayed", "expired", "unavailable", "no-record"]) {
    assert.match(stateGlyphs, new RegExp(`id="source-health-${state}"`));
  }

  assert.equal(new Set(eventOutputs.map((asset) => asset.sha256)).size, eventOutputs.length);
  assert.equal(new Set(sealOutputs.map((asset) => asset.sha256)).size, sealOutputs.length);
});

test("generator check mode proves committed SVGs are reproducible", () => {
  const result = spawnSync(process.execPath, ["scripts/generate_weather_boss_svg_assets.mjs", "--check"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /check passed \(25 generated SVG assets, 4 planned PNG assets\)/);
});
