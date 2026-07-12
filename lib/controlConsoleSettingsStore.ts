import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultControlConsoleSettings, type ControlConsoleSettings } from "./controlConsoleSettings";

const SETTINGS_PATH = path.join(process.cwd(), ".runtime", "control-console.json");

function merge<T>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return base;
  const output: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    output[key] = value && typeof value === "object" && !Array.isArray(value) ? merge(output[key] ?? {}, value) : value;
  }
  return output as T;
}

export async function readControlConsoleSettings(): Promise<ControlConsoleSettings> {
  const defaults = defaultControlConsoleSettings();
  try {
    const merged = merge(defaults, JSON.parse(await readFile(SETTINGS_PATH, "utf8")));
    // Drop the old unused digital-human/TTS route presets on read. The
    // external Linglan runtime owns those integrations; this console only
    // routes the document agent that this project actually calls.
    return { ...merged, routes: { documentAgent: merged.routes.documentAgent } };
  } catch { return defaults; }
}

export async function updateControlConsoleSettings(patch: Partial<ControlConsoleSettings>) {
  const current = await readControlConsoleSettings();
  const next = merge(current, { ...patch, updatedAt: new Date().toISOString() });
  await mkdir(path.dirname(SETTINGS_PATH), { recursive: true });
  const temporaryPath = `${SETTINGS_PATH}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await rename(temporaryPath, SETTINGS_PATH);
  return next;
}
