import { refreshChinaWeatherProducts } from "../lib/chinaWeatherProductFeed";

async function main() {
  const snapshot = await refreshChinaWeatherProducts();
  const available = snapshot.products.filter((product) => product.status === "available").length;
  process.stdout.write(`China Weather products ready: ${available}/${snapshot.products.length} at ${snapshot.fetchedAt}\n`);
}

void main();
