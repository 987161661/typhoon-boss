import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { refreshNationalCityComparison } from "../lib/cityBriefingData";

async function main() {
  await loadEnvFile(resolve(process.cwd(), ".env.local"));
  const result = await refreshNationalCityComparison();
  process.stdout.write(`National city snapshot ready: ${result.fulfilled}/${result.rosterCount} at ${result.fetchedAt}\n`);
}

async function loadEnvFile(filePath: string) {
  try {
    for (const line of (await readFile(filePath, "utf8")).split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (match && !(match[1] in process.env)) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

void main();
