import { refreshChinaWeatherVisuals } from "../lib/chinaWeatherVisualFeed";

async function main() {
  const snapshot = await refreshChinaWeatherVisuals();
  console.log(`China Weather visuals: radar ${snapshot.radar.frames.length}, satellite ${snapshot.satellite.frames.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
