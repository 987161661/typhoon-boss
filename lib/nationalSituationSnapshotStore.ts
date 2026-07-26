import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { NationalSituationSnapshot } from "@/lib/nationalWeatherTypes";

export const NATIONAL_SITUATION_SNAPSHOT_PATH = resolve(
  process.cwd(),
  ".runtime/national-situation.json"
);

export async function readPersistedNationalSituationSnapshot(): Promise<NationalSituationSnapshot | null> {
  try {
    const value = JSON.parse(
      await readFile(NATIONAL_SITUATION_SNAPSHOT_PATH, "utf8")
    ) as NationalSituationSnapshot;
    return value.schemaVersion === 1
      && Array.isArray(value.sourceHealth)
      && Array.isArray(value.events)
      ? value
      : null;
  } catch {
    return null;
  }
}
