import { refreshChinaWeatherWarnings } from "../lib/chinaWeatherWarningFeed";

async function main() {
  const snapshot = await refreshChinaWeatherWarnings();
  process.stdout.write(`China Weather warning feed ready: ${snapshot.total} alerts at ${snapshot.fetchedAt}\n`);
}

void main();
