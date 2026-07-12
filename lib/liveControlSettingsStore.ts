import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_LIVE_CONTROL_SETTINGS,
  normalizeLiveControlSettings,
  type LiveControlSettings
} from "./liveControlSettings";

const SETTINGS_PATH = path.join(process.cwd(), ".runtime", "live-control-settings.json");

export async function readLiveControlSettings(): Promise<LiveControlSettings> {
  try {
    const raw = await readFile(SETTINGS_PATH, "utf8");
    return normalizeLiveControlSettings(JSON.parse(raw) as Partial<LiveControlSettings>);
  } catch {
    return DEFAULT_LIVE_CONTROL_SETTINGS;
  }
}

export async function updateLiveControlSettings(
  patch: Partial<LiveControlSettings>
): Promise<LiveControlSettings> {
  const current = await readLiveControlSettings();
  const next = normalizeLiveControlSettings(
    { ...current, ...patch, updatedAt: new Date().toISOString() },
    current
  );
  await mkdir(path.dirname(SETTINGS_PATH), { recursive: true });
  const temporaryPath = `${SETTINGS_PATH}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await rename(temporaryPath, SETTINGS_PATH);
  return next;
}
