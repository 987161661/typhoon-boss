import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";

const assignments = process.argv.slice(2);
if (assignments.length === 0) {
  throw new Error("Usage: node scripts/optimize_weather_performance_assets.mjs <target-name=source-image> [...]");
}

const targetDir = path.resolve("public/assets/future-weather-archive/performances");
await mkdir(targetDir, { recursive: true });

for (const assignment of assignments) {
  const separator = assignment.indexOf("=");
  if (separator <= 0 || separator === assignment.length - 1) {
    throw new Error(`Invalid assignment: ${assignment}`);
  }

  const targetName = assignment.slice(0, separator);
  const sourcePath = assignment.slice(separator + 1);
  if (!/^[a-z0-9-]+\.webp$/u.test(targetName)) {
    throw new Error(`Invalid target name: ${targetName}`);
  }

  await sharp(sourcePath)
    .resize(960, 640, { fit: "cover", position: "centre", withoutEnlargement: true })
    .webp({ quality: 78, effort: 5, smartSubsample: true })
    .toFile(path.join(targetDir, targetName));
}

console.log(`Optimized ${assignments.length} performance scenes into ${targetDir}`);
