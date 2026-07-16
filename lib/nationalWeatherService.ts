import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { readChinaWeatherProducts } from "@/lib/chinaWeatherProductFeed";
import { readChinaWeatherVisuals } from "@/lib/chinaWeatherVisualFeed";
import { readChinaWeatherWarnings } from "@/lib/chinaWeatherWarningFeed";
import { getAdministrativeHierarchy } from "@/lib/administrativeHierarchyService";
import { buildNationalSituationSnapshot, retainLastValidSources } from "@/lib/nationalWeather";
import type { NationalSituationSnapshot } from "@/lib/nationalWeatherTypes";
import { getTrackSnapshot } from "@/lib/realTyphoonData";

const NATIONAL_SNAPSHOT_PATH = resolve(process.cwd(), ".runtime/national-situation.json");
const MEMORY_CACHE_MS = 15_000;

let memoryCache: { snapshot: NationalSituationSnapshot; expiresAt: number } | null = null;
let snapshotInFlight: Promise<NationalSituationSnapshot> | null = null;

export async function getNationalSituationSnapshot(): Promise<NationalSituationSnapshot> {
  const cached = memoryCache;
  if (cached && cached.expiresAt > Date.now()) return cached.snapshot;
  if (snapshotInFlight) return snapshotInFlight;

  snapshotInFlight = loadNationalSituationSnapshot().then((snapshot) => {
    memoryCache = { snapshot, expiresAt: Date.now() + MEMORY_CACHE_MS };
    return snapshot;
  }).finally(() => {
    snapshotInFlight = null;
  });
  return snapshotInFlight;
}

async function loadNationalSituationSnapshot(): Promise<NationalSituationSnapshot> {
  const [warnings, visuals, products, track, administrative, previous] = await Promise.all([
    readChinaWeatherWarnings(),
    readChinaWeatherVisuals(),
    readChinaWeatherProducts(),
    getTrackSnapshot(),
    getAdministrativeHierarchy(),
    readPersistedNationalSituation()
  ]);
  const now = new Date();
  const current = buildNationalSituationSnapshot({
    warnings,
    visuals,
    products,
    track,
    administrativeHierarchy: administrative.hierarchy,
    administrativeHierarchyError: administrative.error
  }, now);
  const merged = previous ? retainLastValidSources(current, previous, now) : current;
  const snapshot = previous && sameSnapshotContent(previous, merged) ? previous : merged;
  if (snapshot !== previous) await writeJsonAtomic(NATIONAL_SNAPSHOT_PATH, snapshot);
  return snapshot;
}

function sameSnapshotContent(a: NationalSituationSnapshot, b: NationalSituationSnapshot) {
  return JSON.stringify({ ...a, generatedAt: null }) === JSON.stringify({ ...b, generatedAt: null });
}

async function readPersistedNationalSituation() {
  try {
    const value = JSON.parse(await readFile(NATIONAL_SNAPSHOT_PATH, "utf8")) as NationalSituationSnapshot;
    return value.schemaVersion === 1 && Array.isArray(value.sourceHealth) && Array.isArray(value.events) ? value : null;
  } catch {
    return null;
  }
}

async function writeJsonAtomic(filePath: string, value: unknown) {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}
