import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { writeFileAtomic } from "@/lib/atomicFile";
import {
  createAdministrativeHierarchy,
  parseAdministrativeHierarchyCsv,
  type AdministrativeHierarchy,
  type AdministrativeHierarchyRow
} from "@/lib/administrativeMapping";

export const ADMINISTRATIVE_HIERARCHY_SOURCE = "https://raw.githubusercontent.com/qwd/LocationList/master/China-City-List-latest.csv";
export const ADMINISTRATIVE_HIERARCHY_REFRESH_MINUTES = 30 * 24 * 60;

const SNAPSHOT_PATH = resolve(process.cwd(), ".runtime/administrative-hierarchy.json");
const REFRESH_MS = ADMINISTRATIVE_HIERARCHY_REFRESH_MINUTES * 60_000;
const FAILED_REFRESH_RETRY_MS = 6 * 60 * 60 * 1_000;

interface PersistedAdministrativeHierarchy {
  schemaVersion: 1;
  source: string;
  fetchedAt: string;
  rows: AdministrativeHierarchyRow[];
}

export interface AdministrativeHierarchyState {
  hierarchy: AdministrativeHierarchy | null;
  error: string | null;
}

let cachedState: AdministrativeHierarchyState | null = null;
let inFlight: Promise<AdministrativeHierarchyState> | null = null;
let nextRefreshAttemptAt = 0;

export async function getAdministrativeHierarchy(): Promise<AdministrativeHierarchyState> {
  const now = Date.now();
  if (cachedState && now < nextRefreshAttemptAt) return cachedState;
  if (inFlight) return inFlight;
  inFlight = loadAdministrativeHierarchy(now).finally(() => { inFlight = null; });
  cachedState = remember(await inFlight, now);
  return cachedState;
}

export async function refreshAdministrativeHierarchy(): Promise<AdministrativeHierarchyState> {
  if (inFlight) return inFlight;
  const previous = await readPersistedSnapshot();
  inFlight = refreshFromOfficialList(previous).finally(() => { inFlight = null; });
  cachedState = remember(await inFlight, Date.now());
  return cachedState;
}

async function loadAdministrativeHierarchy(now: number): Promise<AdministrativeHierarchyState> {
  const previous = await readPersistedSnapshot();
  if (previous && now - Date.parse(previous.fetchedAt) <= REFRESH_MS) {
    return { hierarchy: hierarchyFromSnapshot(previous), error: null };
  }
  return refreshFromOfficialList(previous);
}

async function refreshFromOfficialList(previous: PersistedAdministrativeHierarchy | null): Promise<AdministrativeHierarchyState> {
  try {
    const response = await fetch(ADMINISTRATIVE_HIERARCHY_SOURCE, {
      cache: "no-store",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TyphoonBossRadar/1.0)" },
      signal: AbortSignal.timeout(30_000)
    });
    if (!response.ok) throw new Error(`行政层级列表 HTTP ${response.status}`);
    const rows = parseAdministrativeHierarchyCsv(await response.text());
    if (rows.length < 1_000) throw new Error(`行政层级列表记录异常：仅 ${rows.length} 行`);
    const requiredIds = ["101010100", "101020100", "101030100", "101040100", "101270803", "101320101", "101330101", "101340101"];
    const locationIds = new Set(rows.map((row) => row.locationId));
    const missing = requiredIds.filter((locationId) => !locationIds.has(locationId));
    if (missing.length) throw new Error(`行政层级列表缺少关键记录：${missing.join(", ")}`);
    const snapshot: PersistedAdministrativeHierarchy = {
      schemaVersion: 1,
      source: ADMINISTRATIVE_HIERARCHY_SOURCE,
      fetchedAt: new Date().toISOString(),
      rows
    };
    await writeJsonAtomic(SNAPSHOT_PATH, snapshot);
    return { hierarchy: hierarchyFromSnapshot(snapshot), error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!previous) return { hierarchy: null, error: message };
    return {
      hierarchy: createAdministrativeHierarchy(previous.rows, {
        source: previous.source,
        fetchedAt: previous.fetchedAt,
        error: `层级刷新失败，保留最近有效快照：${message}`
      }),
      error: message
    };
  }
}

function hierarchyFromSnapshot(snapshot: PersistedAdministrativeHierarchy) {
  return createAdministrativeHierarchy(snapshot.rows, {
    source: snapshot.source,
    fetchedAt: snapshot.fetchedAt
  });
}

async function readPersistedSnapshot(): Promise<PersistedAdministrativeHierarchy | null> {
  try {
    const value = JSON.parse(await readFile(SNAPSHOT_PATH, "utf8")) as Partial<PersistedAdministrativeHierarchy>;
    if (value.schemaVersion !== 1 || !value.source || !value.fetchedAt || !Array.isArray(value.rows)) return null;
    if (!Number.isFinite(Date.parse(value.fetchedAt))) return null;
    return value as PersistedAdministrativeHierarchy;
  } catch {
    return null;
  }
}

async function writeJsonAtomic(filePath: string, value: unknown) {
  await writeFileAtomic(filePath, `${JSON.stringify(value)}\n`);
}

function remember(state: AdministrativeHierarchyState, now: number) {
  nextRefreshAttemptAt = state.error
    ? now + FAILED_REFRESH_RETRY_MS
    : state.hierarchy
      ? Date.parse(state.hierarchy.fetchedAt) + REFRESH_MS
      : now + FAILED_REFRESH_RETRY_MS;
  return state;
}
