import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import sharp from "sharp";

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
  provenance?: {
    kind?: string;
    source?: string;
    algorithm?: string;
    runtime?: string;
    callId?: string;
    sourceFilename?: string;
    sourceSha256?: string;
    prompt?: string;
    postProcessing?: string[];
    reproduction?: string;
    licenseTerms?: string;
  };
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

function hash(content: string | Buffer) {
  return createHash("sha256").update(content).digest("hex");
}

function canonicalSvg(content: string) {
  return content.replace(/\r\n?/g, "\n");
}

test("Weather Boss manifest freezes generated vector and bitmap outputs", () => {
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

  for (const asset of pngAssets) {
    assert.equal(asset.status, "generated");
    assert.equal(asset.generator, "scripts/generate_weather_boss_png_assets.mjs@1.0.0");
    assert.match(asset.generatedOn ?? "", /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(asset.license, "LicenseRef-WeatherBoss-Project-Original");
    assert.match(asset.sha256 ?? "", /^[a-f0-9]{64}$/);
    assert.equal(asset.reproducibility, `sha256:${asset.sha256}`);
    assert.ok(asset.provenance?.kind);
    assert.ok(asset.provenance?.licenseTerms);
  }
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
    assert.equal(hash(canonicalSvg(content)), asset.sha256);
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

test("generated PNGs match dimensions, RGBA transparency, sha256, and provenance", async () => {
  for (const asset of pngAssets) {
    const content = readFileSync(resolve(assetRoot, asset.filename));
    const metadata = await sharp(content).metadata();
    assert.equal(metadata.format, "png");
    assert.equal(metadata.width, asset.dimensions.width);
    assert.equal(metadata.height, asset.dimensions.height);
    assert.equal(metadata.channels, 4);
    assert.equal(metadata.hasAlpha, true);
    assert.equal(hash(content), asset.sha256);

    const { data, info } = await sharp(content).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let transparentPixels = 0;
    let visiblePixels = 0;
    for (let offset = 3; offset < data.length; offset += info.channels) {
      if (data[offset] < 255) transparentPixels += 1;
      if (data[offset] > 0) visiblePixels += 1;
    }
    assert.ok(transparentPixels > 0, `${asset.filename} lacks transparent pixels`);
    assert.ok(visiblePixels > 0, `${asset.filename} lacks visible pixels`);
  }

  const deterministicAssets = pngAssets.filter((asset) => asset.provenance?.kind === "deterministic-script");
  assert.deepEqual(deterministicAssets.map((asset) => asset.id).sort(), ["national-map-vignette", "scanline-texture"]);
  for (const asset of deterministicAssets) {
    assert.equal(asset.provenance?.source, "scripts/generate_weather_boss_png_assets.mjs");
    assert.match(asset.provenance?.algorithm ?? "", /-v1$/);
    assert.match(asset.provenance?.runtime ?? "", /^sharp@\d+\.\d+\.\d+$/);
  }

  const imagegenAssets = pngAssets.filter((asset) => asset.provenance?.kind === "imagegen-derived");
  assert.deepEqual(imagegenAssets.map((asset) => asset.id).sort(), ["archive-paper-grain", "terminal-abrasion"]);
  for (const asset of imagegenAssets) {
    assert.match(asset.provenance?.callId ?? "", /^exec-[a-f0-9-]+$/);
    assert.equal(asset.provenance?.sourceFilename, `${asset.provenance?.callId}.png`);
    assert.match(asset.provenance?.sourceSha256 ?? "", /^[a-f0-9]{64}$/);
    assert.match(asset.provenance?.prompt ?? "", /#00ff00 chroma-key background/);
    assert.ok((asset.provenance?.postProcessing?.length ?? 0) >= 2);
    assert.match(asset.provenance?.reproduction ?? "", /^node scripts\/generate_weather_boss_png_assets\.mjs --source=/);
  }
});

test("generator check mode proves committed SVGs are reproducible", () => {
  const result = spawnSync(process.execPath, ["scripts/generate_weather_boss_svg_assets.mjs", "--check"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /check passed \(25 generated SVG assets, 4 generated PNG assets, 0 planned PNG assets\)/);
});

test("PNG generator check proves deterministic outputs and imported provenance", () => {
  const result = spawnSync(process.execPath, ["scripts/generate_weather_boss_png_assets.mjs", "--check"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /check passed \(4 generated PNG assets, 0 planned PNG asset\)/);
});
