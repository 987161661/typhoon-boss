import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { readChinaWeatherProducts } from "@/lib/chinaWeatherProductFeed";
import { readChinaWeatherVisuals } from "@/lib/chinaWeatherVisualFeed";
import { readChinaWeatherWarnings } from "@/lib/chinaWeatherWarningFeed";
import { getAdministrativeHierarchy } from "@/lib/administrativeHierarchyService";
import { buildNationalSituationSnapshot, retainLastValidSources } from "@/lib/nationalWeather";
import type { CityRankSnapshotSummary, NationalSituationSnapshot } from "@/lib/nationalWeatherTypes";
import { getTrackSnapshot } from "@/lib/realTyphoonData";
import { createStaleWhileRefreshCache } from "@/lib/staleWhileRefreshCache";
import {
  NATIONAL_SITUATION_SNAPSHOT_PATH,
  readPersistedNationalSituationSnapshot
} from "@/lib/nationalSituationSnapshotStore";

const NATIONAL_CITY_SNAPSHOT_PATH = resolve(process.cwd(), ".runtime/qweather-national-city-snapshot.json");
const MEMORY_CACHE_MS = 15_000;
const CITY_RANK_FRESH_MS = 26 * 60 * 60 * 1_000;
const CITY_RANK_DELAYED_MS = 3 * 24 * 60 * 60 * 1_000;

const nationalSnapshotCache = createStaleWhileRefreshCache({
  loader: loadNationalSituationSnapshot,
  readPersisted: readPersistedNationalSituationSnapshot,
  ttlMs: MEMORY_CACHE_MS
});

export async function getNationalSituationSnapshot(): Promise<NationalSituationSnapshot> {
  return nationalSnapshotCache.get();
}

async function loadNationalSituationSnapshot(): Promise<NationalSituationSnapshot> {
  const now = new Date();
  const [warnings, visuals, products, track, administrative, cityRankSnapshot, previous] = await Promise.all([
    readChinaWeatherWarnings(),
    readChinaWeatherVisuals(),
    readChinaWeatherProducts(),
    getTrackSnapshot(),
    getAdministrativeHierarchy(),
    readNationalCityRankSummary(now),
    readPersistedNationalSituationSnapshot()
  ]);
  const current = buildNationalSituationSnapshot({
    warnings,
    visuals,
    products,
    track,
    administrativeHierarchy: administrative.hierarchy,
    administrativeHierarchyError: administrative.error,
    cityRankSnapshot
  }, now);
  const merged = previous ? retainLastValidSources(current, previous, now) : current;
  const snapshot = previous && sameSnapshotContent(previous, merged) ? previous : merged;
  if (snapshot !== previous) await writeJsonAtomic(NATIONAL_SITUATION_SNAPSHOT_PATH, snapshot);
  return snapshot;
}

async function readNationalCityRankSummary(now: Date): Promise<CityRankSnapshotSummary | null> {
  try {
    const value = JSON.parse(await readFile(NATIONAL_CITY_SNAPSHOT_PATH, "utf8")) as {
      fetchedAt?: string;
      values?: unknown[];
    };
    const generatedAt = value.fetchedAt;
    if (!generatedAt || !Array.isArray(value.values) || value.values.length < 200) return null;
    const generatedTime = Date.parse(generatedAt);
    if (!Number.isFinite(generatedTime)) return null;
    const age = Math.max(0, now.getTime() - generatedTime);
    return {
      generatedAt,
      sourceIds: ["qweather"],
      cityCount: value.values.length,
      status: age <= CITY_RANK_FRESH_MS ? "fresh" : age <= CITY_RANK_DELAYED_MS ? "delayed" : "expired"
    };
  } catch {
    return null;
  }
}

function sameSnapshotContent(a: NationalSituationSnapshot, b: NationalSituationSnapshot) {
  return JSON.stringify({ ...a, generatedAt: null }) === JSON.stringify({ ...b, generatedAt: null });
}

async function writeJsonAtomic(filePath: string, value: unknown) {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}
