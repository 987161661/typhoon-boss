import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { access, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const ASSET_DIR = resolve(process.cwd(), "public", "assets", "weather-boss");
const MANIFEST_PATH = resolve(ASSET_DIR, "manifest.json");
const GENERATOR_ID = "scripts/generate_weather_boss_png_assets.mjs@1.0.0";
const GENERATED_ON = "2026-07-15";
const LICENSE_ID = "LicenseRef-WeatherBoss-Project-Original";
const CHECK_MODE = process.argv.includes("--check");
const sourceArguments = process.argv
  .filter((argument) => argument.startsWith("--source="))
  .map((argument) => {
    const value = argument.slice("--source=".length);
    const separator = value.indexOf("=");
    if (separator < 1) throw new Error("--source must use --source=<asset-id>=<source-path>");
    return [value.slice(0, separator), value.slice(separator + 1)];
  });

const deterministicRenderers = new Map([
  ["scanline-texture", renderScanlineTexture],
  ["national-map-vignette", renderNationalMapVignette]
]);

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function rgbaBuffer(width, height, pixelAt) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const [red, green, blue, alpha] = pixelAt(x, y);
      pixels[offset] = red;
      pixels[offset + 1] = green;
      pixels[offset + 2] = blue;
      pixels[offset + 3] = alpha;
    }
  }
  return pixels;
}

async function encodeRgba(width, height, pixelAt) {
  return sharp(rgbaBuffer(width, height, pixelAt), {
    raw: { width, height, channels: 4 }
  }).png({ compressionLevel: 9, adaptiveFiltering: false, palette: false }).toBuffer();
}

async function renderScanlineTexture(asset) {
  const { width, height } = asset.dimensions;
  return encodeRgba(width, height, (x, y) => {
    const row = y % 8;
    const alpha = row === 0 ? 18 : row === 1 ? 8 : (x + y) % 16 === 0 ? 2 : 0;
    return [236, 251, 255, alpha];
  });
}

async function renderNationalMapVignette(asset) {
  const { width, height } = asset.dimensions;
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  return encodeRgba(width, height, (x, y) => {
    const nx = Math.abs((x + 0.5 - halfWidth) / halfWidth);
    const ny = Math.abs((y + 0.5 - halfHeight) / halfHeight);
    const edgeDistance = Math.max(nx ** 2.35, ny ** 2.35);
    const ramp = Math.max(0, Math.min(1, (edgeDistance - 0.32) / 0.68));
    const eased = ramp * ramp * (3 - 2 * ramp);
    return [5, 8, 10, Math.round(eased * 132)];
  });
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function importImagegenSource(asset, sourcePath) {
  const provenance = asset.provenance;
  if (provenance?.kind !== "imagegen-derived") throw new Error(`${asset.filename}: imagegen provenance is not frozen`);
  if (!provenance.callId || !provenance.prompt || !provenance.sourceFilename || !provenance.sourceSha256) {
    throw new Error(`${asset.filename}: imagegen source metadata is incomplete`);
  }
  const source = await readFile(sourcePath);
  if (sha256(source) !== provenance.sourceSha256) throw new Error(`${asset.filename}: imagegen source sha256 does not match provenance`);
  if (sourcePath.replaceAll("\\", "/").split("/").at(-1) !== provenance.sourceFilename) {
    throw new Error(`${asset.filename}: imagegen source filename does not match provenance`);
  }

  const codexHome = process.env.CODEX_HOME ?? resolve(process.env.USERPROFILE ?? "", ".codex");
  const helper = resolve(codexHome, "skills", ".system", "imagegen", "scripts", "remove_chroma_key.py");
  const keyedPath = resolve(ASSET_DIR, `.${asset.id}-chroma.tmp.png`);
  const resizedPath = resolve(ASSET_DIR, `.${asset.id}-resized.tmp.png`);
  try {
    const chroma = spawnSync("python", [
      helper,
      "--input", sourcePath,
      "--out", keyedPath,
      "--auto-key", "border",
      "--soft-matte",
      "--transparent-threshold", "18",
      "--opaque-threshold", "150",
      "--despill"
    ], { encoding: "utf8" });
    if (chroma.status !== 0) throw new Error(`${asset.filename}: chroma removal failed\n${chroma.stdout}\n${chroma.stderr}`);
    await sharp(keyedPath).resize(asset.dimensions.width, asset.dimensions.height).png().toFile(resizedPath);
    return await sharp(resizedPath)
      .grayscale()
      .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
      .toBuffer();
  } finally {
    await Promise.all([rm(keyedPath, { force: true }), rm(resizedPath, { force: true })]);
  }
}

function validateCommonMetadata(asset, failures) {
  if (asset.transparency !== true) failures.push(`${asset.filename}: transparency must be true`);
  if (asset.containsText !== false) failures.push(`${asset.filename}: containsText must be false`);
  if (!asset.license) failures.push(`${asset.filename}: license is missing`);
}

function validateGeneratedMetadata(asset, failures) {
  if (asset.status !== "generated") return;
  if (asset.license !== LICENSE_ID) failures.push(`${asset.filename}: generated PNG license does not match`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asset.generatedOn ?? "")) failures.push(`${asset.filename}: generatedOn is missing or invalid`);
  if (!/^[a-f0-9]{64}$/.test(asset.sha256 ?? "")) failures.push(`${asset.filename}: sha256 is missing or invalid`);
  if (asset.reproducibility !== `sha256:${asset.sha256}`) failures.push(`${asset.filename}: reproducibility does not match sha256`);
  if (!asset.generator) failures.push(`${asset.filename}: generator is missing`);
  if (!asset.provenance?.kind) failures.push(`${asset.filename}: provenance kind is missing`);
  if (!asset.provenance?.licenseTerms) failures.push(`${asset.filename}: provenance license terms are missing`);
}

async function validateGeneratedFile(asset, failures) {
  const outputPath = resolve(ASSET_DIR, asset.filename);
  if (!(await fileExists(outputPath))) {
    failures.push(`${asset.filename}: generated file is missing`);
    return;
  }
  const content = await readFile(outputPath);
  const metadata = await sharp(content).metadata();
  if (metadata.format !== "png") failures.push(`${asset.filename}: file is not PNG`);
  if (metadata.width !== asset.dimensions.width || metadata.height !== asset.dimensions.height) {
    failures.push(`${asset.filename}: dimensions do not match manifest`);
  }
  if (metadata.hasAlpha !== true || metadata.channels !== 4) failures.push(`${asset.filename}: PNG must be four-channel RGBA`);
  if (sha256(content) !== asset.sha256) failures.push(`${asset.filename}: manifest sha256 does not match`);

  const { data, info } = await sharp(content).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let transparentPixels = 0;
  let visiblePixels = 0;
  for (let offset = 3; offset < data.length; offset += info.channels) {
    if (data[offset] < 255) transparentPixels += 1;
    if (data[offset] > 0) visiblePixels += 1;
  }
  if (transparentPixels === 0) failures.push(`${asset.filename}: alpha channel has no transparent pixels`);
  if (visiblePixels === 0) failures.push(`${asset.filename}: alpha channel has no visible pixels`);
}

async function checkOutputs(manifest) {
  const failures = [];
  const pngAssets = manifest.assets.filter((asset) => asset.filename.endsWith(".png"));
  let generatedCount = 0;
  let plannedCount = 0;

  for (const asset of pngAssets) {
    validateCommonMetadata(asset, failures);
    const outputPath = resolve(ASSET_DIR, asset.filename);
    const exists = await fileExists(outputPath);
    if (asset.status === "generated") {
      generatedCount += 1;
      validateGeneratedMetadata(asset, failures);
      await validateGeneratedFile(asset, failures);
      const renderer = deterministicRenderers.get(asset.id);
      if (renderer) {
        if (asset.generator !== GENERATOR_ID) failures.push(`${asset.filename}: deterministic generator does not match`);
        if (asset.provenance?.kind !== "deterministic-script") failures.push(`${asset.filename}: deterministic provenance kind does not match`);
        const expected = await renderer(asset);
        const actual = exists ? await readFile(outputPath) : null;
        if (actual && !actual.equals(expected)) failures.push(`${asset.filename}: output differs from deterministic generator`);
      }
      if (asset.provenance?.kind === "imagegen-derived") {
        for (const field of ["callId", "sourceFilename", "sourceSha256", "prompt", "postProcessing"]) {
          if (!asset.provenance[field]) failures.push(`${asset.filename}: imagegen provenance ${field} is missing`);
        }
        if (!/^[a-f0-9]{64}$/.test(asset.provenance.sourceSha256 ?? "")) failures.push(`${asset.filename}: imagegen source sha256 is invalid`);
      }
    } else if (asset.status === "planned") {
      plannedCount += 1;
      if (exists) failures.push(`${asset.filename}: file exists but manifest status is planned`);
      if (asset.provenance?.kind !== "imagegen-input-required") failures.push(`${asset.filename}: planned PNG must declare its required input provenance`);
      if (!asset.provenance?.requiredSourceFilename) failures.push(`${asset.filename}: planned PNG required source filename is missing`);
      if (!Array.isArray(asset.provenance?.expectedPostProcessing) || asset.provenance.expectedPostProcessing.length === 0) {
        failures.push(`${asset.filename}: planned PNG expected post-processing is missing`);
      }
    } else {
      failures.push(`${asset.filename}: unsupported status ${String(asset.status)}`);
    }
  }

  if (failures.length) throw new Error(`Weather Boss PNG check failed:\n- ${failures.join("\n- ")}`);
  console.log(`Weather Boss PNG check passed (${generatedCount} generated PNG assets, ${plannedCount} planned PNG asset).`);
}

async function generateOutputs(manifest) {
  const metadataById = new Map();
  for (const asset of manifest.assets.filter((entry) => deterministicRenderers.has(entry.id))) {
    const content = await deterministicRenderers.get(asset.id)(asset);
    await writeFile(resolve(ASSET_DIR, asset.filename), content);
    metadataById.set(asset.id, {
      status: "generated",
      generator: GENERATOR_ID,
      generatedOn: GENERATED_ON,
      license: LICENSE_ID,
      sha256: sha256(content),
      reproducibility: `sha256:${sha256(content)}`,
      provenance: {
        kind: "deterministic-script",
        source: "scripts/generate_weather_boss_png_assets.mjs",
        algorithm: asset.id === "scanline-texture" ? "periodic-scanline-alpha-v1" : "symmetric-superellipse-vignette-v1",
        runtime: "sharp@0.34.5",
        licenseTerms: "Project-original deterministic output; repository license applies."
      }
    });
  }

  for (const [assetId, sourcePath] of sourceArguments) {
    const asset = manifest.assets.find((entry) => entry.id === assetId && entry.filename.endsWith(".png"));
    if (!asset) throw new Error(`Unknown Weather Boss PNG asset id: ${assetId}`);
    const content = await importImagegenSource(asset, sourcePath);
    await writeFile(resolve(ASSET_DIR, asset.filename), content);
    metadataById.set(asset.id, {
      status: "generated",
      generator: GENERATOR_ID,
      generatedOn: GENERATED_ON,
      license: LICENSE_ID,
      sha256: sha256(content),
      reproducibility: `sha256:${sha256(content)}`
    });
  }

  const nextManifest = {
    ...manifest,
    status: "partially-generated",
    generatedAssetsPresent: true,
    generation: {
      ...manifest.generation,
      pngGenerator: GENERATOR_ID,
      pngGeneratedOn: GENERATED_ON,
      pngAlgorithm: "deterministic-composable-rgba-primitives-v1"
    },
    assets: manifest.assets.map((asset) => metadataById.has(asset.id) ? { ...asset, ...metadataById.get(asset.id) } : asset)
  };
  await writeFile(MANIFEST_PATH, `${JSON.stringify(nextManifest, null, 2)}\n`, "utf8");
  console.log(`Generated ${metadataById.size} Weather Boss PNG assets (${deterministicRenderers.size} deterministic, ${sourceArguments.length} imagegen-derived).`);
}

async function main() {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  if (CHECK_MODE) await checkOutputs(manifest);
  else await generateOutputs(manifest);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
