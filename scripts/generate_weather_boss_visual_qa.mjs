#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const root = process.cwd();
const assetRoot = resolve(root, "public", "assets", "weather-boss");
const outputRoot = resolve(root, "evidence", "screenshots");
const manifest = JSON.parse(await readFile(resolve(assetRoot, "manifest.json"), "utf8"));
const assets = manifest.assets.filter((asset) => asset.status === "generated");
const targets = [
  { width: 1920, height: 1080, label: "1920x1080" },
  { width: 1366, height: 768, label: "1366x768" },
  { width: 1280, height: 720, label: "1280x720-live" }
];

const swatches = {
  "official-red": "#ff3b32",
  "official-orange": "#ff8a2a",
  "official-yellow": "#ffb000",
  "official-blue": "#00d8ff",
  "official-risk": "#ff3b32"
};

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function tileChrome(width, height, label) {
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs><pattern id="grid" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="12" height="12" fill="#091015"/><rect width="6" height="6" fill="#101a20"/><rect x="6" y="6" width="6" height="6" fill="#101a20"/></pattern></defs>
    <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="4" fill="url(#grid)" stroke="#00d8ff" stroke-opacity="0.28"/>
    <rect y="${height - 22}" width="${width}" height="22" fill="#05080a" fill-opacity="0.94"/>
    <text x="8" y="${height - 7}" fill="#ecfbff" fill-opacity="0.78" font-family="Consolas, Microsoft YaHei UI" font-size="11">${escapeXml(label)}</text>
  </svg>`);
}

async function renderAsset(asset, width, height) {
  const input = await readFile(resolve(assetRoot, asset.filename));
  const color = swatches[asset.theme] ?? "#00d8ff";
  const normalized = asset.filename.endsWith(".svg")
    ? Buffer.from(input.toString("utf8").replaceAll("currentColor", color))
    : input;
  return sharp(normalized, asset.filename.endsWith(".svg") ? { density: 180 } : undefined)
    .resize({ width, height, fit: "inside", withoutEnlargement: false })
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer();
}

async function renderTarget(target) {
  const margin = Math.max(12, Math.round(target.width * 0.01));
  const header = Math.max(48, Math.round(target.height * 0.06));
  const gap = Math.max(8, Math.round(target.width * 0.006));
  const columns = 5;
  const rows = Math.ceil(assets.length / columns);
  const tileWidth = Math.floor((target.width - margin * 2 - gap * (columns - 1)) / columns);
  const tileHeight = Math.floor((target.height - header - margin * 2 - gap * (rows - 1)) / rows);
  const thumbnailHeight = Math.max(20, tileHeight - 30);
  const thumbnailWidth = Math.max(20, tileWidth - 18);
  const composites = [{
    input: Buffer.from(`<svg width="${target.width}" height="${header}" xmlns="http://www.w3.org/2000/svg"><text x="${margin}" y="${Math.round(header * 0.66)}" fill="#ecfbff" font-family="Bahnschrift, Microsoft YaHei UI" font-size="${Math.max(18, Math.round(header * 0.42))}" font-weight="700">Weather Boss HUD Kit · ${target.label} · ${assets.length} generated assets</text></svg>`),
    left: 0,
    top: 0
  }];

  for (const [index, asset] of assets.entries()) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = margin + column * (tileWidth + gap);
    const top = header + margin + row * (tileHeight + gap);
    composites.push({ input: tileChrome(tileWidth, tileHeight, asset.filename), left, top });
    const thumbnail = await renderAsset(asset, thumbnailWidth, thumbnailHeight);
    const metadata = await sharp(thumbnail).metadata();
    composites.push({
      input: thumbnail,
      left: left + Math.floor((tileWidth - (metadata.width ?? 0)) / 2),
      top: top + Math.max(4, Math.floor((thumbnailHeight - (metadata.height ?? 0)) / 2))
    });
  }

  const output = resolve(outputRoot, `weather-boss-assets-${target.label}.png`);
  await sharp({
    create: { width: target.width, height: target.height, channels: 4, background: "#05080a" }
  }).composite(composites).png({ compressionLevel: 9, adaptiveFiltering: false, palette: false }).toFile(output);
  return { ...target, output, columns, rows, tileWidth, tileHeight };
}

async function renderBitmapScaleQa() {
  const bitmaps = assets.filter((asset) => asset.filename.endsWith(".png"));
  const width = 1600;
  const height = 900;
  const margin = 28;
  const gap = 20;
  const columns = 2;
  const tileWidth = Math.floor((width - margin * 2 - gap) / columns);
  const tileHeight = Math.floor((height - 84 - margin * 2 - gap) / 2);
  const composites = [{
    input: Buffer.from(`<svg width="${width}" height="84" xmlns="http://www.w3.org/2000/svg"><text x="${margin}" y="48" fill="#ecfbff" font-family="Bahnschrift, Microsoft YaHei UI" font-size="28" font-weight="700">Weather Boss bitmap alpha edge and 2× scale QA</text></svg>`),
    left: 0,
    top: 0
  }];
  const metrics = [];

  for (const [index, asset] of bitmaps.entries()) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = margin + column * (tileWidth + gap);
    const top = 84 + margin + row * (tileHeight + gap);
    composites.push({ input: tileChrome(tileWidth, tileHeight, asset.filename), left, top });
    const content = await readFile(resolve(assetRoot, asset.filename));
    const raw = await sharp(content).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let edgeAlphaMax = 0;
    let visiblePixels = 0;
    for (let y = 0; y < raw.info.height; y += 1) {
      for (let x = 0; x < raw.info.width; x += 1) {
        const alpha = raw.data[(y * raw.info.width + x) * raw.info.channels + 3];
        if (alpha > 0) visiblePixels += 1;
        if (x === 0 || y === 0 || x === raw.info.width - 1 || y === raw.info.height - 1) edgeAlphaMax = Math.max(edgeAlphaMax, alpha);
      }
    }
    const oneX = await sharp(content).resize(150, 150, { fit: "inside" }).png().toBuffer();
    const twoX = await sharp(content).resize(300, 300, { fit: "inside" }).png().toBuffer();
    composites.push({ input: oneX, left: left + 44, top: top + 34 });
    composites.push({ input: twoX, left: left + 286, top: top + 16 });
    composites.push({
      input: Buffer.from(`<svg width="${tileWidth}" height="${tileHeight}" xmlns="http://www.w3.org/2000/svg"><text x="45" y="${tileHeight - 34}" fill="#00d8ff" font-family="Consolas" font-size="14">1× preview</text><text x="286" y="${tileHeight - 34}" fill="#00d8ff" font-family="Consolas" font-size="14">2× preview</text><text x="${tileWidth - 190}" y="24" fill="#ffb000" font-family="Consolas" font-size="12">edge alpha max ${edgeAlphaMax}</text></svg>`),
      left,
      top
    });
    metrics.push({ filename: asset.filename, width: raw.info.width, height: raw.info.height, visiblePixels, edgeAlphaMax });
  }

  const output = resolve(outputRoot, "weather-boss-bitmap-alpha-2x-qa.png");
  await sharp({ create: { width, height, channels: 4, background: "#05080a" } })
    .composite(composites)
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toFile(output);
  return { output, width, height, metrics };
}

await mkdir(outputRoot, { recursive: true });
const rendered = [];
for (const target of targets) rendered.push(await renderTarget(target));
const bitmapScaleQa = await renderBitmapScaleQa();
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  manifest: "public/assets/weather-boss/manifest.json",
  assetCount: assets.length,
  textPolicy: manifest.textPolicy,
  compression: "lossless PNG compression level 9; no lossy color quantization",
  targets: rendered.map((target) => ({ ...target, output: target.output.replaceAll("\\", "/").replace(`${root.replaceAll("\\", "/")}/`, "") })),
  bitmapScaleQa: {
    ...bitmapScaleQa,
    output: bitmapScaleQa.output.replaceAll("\\", "/").replace(`${root.replaceAll("\\", "/")}/`, "")
  }
};
await writeFile(resolve(outputRoot, "weather-boss-assets-visual-qa.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report));
