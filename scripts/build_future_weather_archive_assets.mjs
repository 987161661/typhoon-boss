import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";

const sourcePath = process.argv[2];
if (!sourcePath) {
  throw new Error("Usage: node scripts/build_future_weather_archive_assets.mjs <master-image-or-3x3-atlas>");
}

const targetDir = path.resolve("public/assets/future-weather-archive");
await mkdir(targetDir, { recursive: true });

const metadata = await sharp(sourcePath).metadata();
if (!metadata.width || !metadata.height) throw new Error("Atlas dimensions are unavailable");

const tiles = [
  "bureau-seal-v1.webp",
  "cabinet-grain-v1.webp",
  "plaque-surface-v1.webp",
  "specimen-frame-v1.webp",
  "control-deck-v1.webp",
  "caption-paper-v1.webp",
  "case-tab-v1.webp",
  "evidence-ticket-v1.webp",
  "evidence-thread-v1.webp"
];

const portraitSpecimen = metadata.height > metadata.width * 1.5;
const extracts = portraitSpecimen
  ? specimenExtracts(metadata.width, metadata.height)
  : atlasExtracts(metadata.width, metadata.height);

for (const [index, fileName] of tiles.entries()) {
  const recipe = extracts[index];
  let pipeline = sharp(sourcePath)
    .extract(recipe.region)
    .resize({ width: 480, height: 480, fit: "fill" });
  if (recipe.modulate) pipeline = pipeline.modulate(recipe.modulate);
  await pipeline.webp({ quality: 84, effort: 6 }).toFile(path.join(targetDir, fileName));
}

await derive("specimen-frame-v1.webp", "specimen-overlay-v1.webp", { opacity: 0.72, saturation: 0.72 });
await derive("specimen-frame-v1.webp", "calibration-marks-v1.webp", { opacity: 0.52, saturation: 0.34 });
await derive("evidence-ticket-v1.webp", "gate-plate-v1.webp", { opacity: 0.88, saturation: 0.58 });

async function derive(sourceName, targetName, { opacity, saturation }) {
  await sharp(path.join(targetDir, sourceName))
    .modulate({ saturation })
    .ensureAlpha(opacity)
    .webp({ quality: 82, effort: 6 })
    .toFile(path.join(targetDir, targetName));
}

console.log(JSON.stringify({
  source: path.resolve(sourcePath),
  dimensions: `${metadata.width}x${metadata.height}`,
  extractionMode: portraitSpecimen ? "specimen-derivatives" : "3x3-atlas",
  outputs: [...tiles, "specimen-overlay-v1.webp", "calibration-marks-v1.webp", "gate-plate-v1.webp"]
}, null, 2));

function atlasExtracts(width, height) {
  const columns = 3;
  const rows = 3;
  const cellWidth = Math.floor(width / columns);
  const cellHeight = Math.floor(height / rows);
  const inset = Math.max(4, Math.floor(Math.min(cellWidth, cellHeight) * 0.025));
  return tiles.map((_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      region: {
        left: column * cellWidth + inset,
        top: row * cellHeight + inset,
        width: cellWidth - inset * 2,
        height: cellHeight - inset * 2
      }
    };
  });
}

function specimenExtracts(width, height) {
  const region = (left, top, cropWidth, cropHeight) => ({
    left: Math.floor(width * left),
    top: Math.floor(height * top),
    width: Math.max(8, Math.floor(width * cropWidth)),
    height: Math.max(8, Math.floor(height * cropHeight))
  });
  return [
    { region: region(0.20, 0.19, 0.60, 0.30), modulate: { saturation: 0.72, brightness: 0.92 } },
    { region: region(0.00, 0.68, 1.00, 0.30), modulate: { saturation: 0.32, brightness: 0.56 } },
    { region: region(0.00, 0.00, 1.00, 0.20), modulate: { saturation: 0.52, brightness: 0.70 } },
    { region: region(0.00, 0.06, 1.00, 0.48), modulate: { saturation: 0.64, brightness: 0.72 } },
    { region: region(0.00, 0.75, 1.00, 0.16), modulate: { saturation: 0.30, brightness: 0.52 } },
    { region: region(0.08, 0.12, 0.84, 0.28), modulate: { saturation: 0.18, brightness: 0.88 } },
    { region: region(0.00, 0.50, 1.00, 0.18), modulate: { saturation: 0.42, brightness: 0.66 } },
    { region: region(0.00, 0.60, 1.00, 0.18), modulate: { saturation: 0.30, brightness: 0.62 } },
    { region: region(0.86, 0.03, 0.14, 0.80), modulate: { saturation: 0.76, brightness: 0.72 } }
  ];
}
