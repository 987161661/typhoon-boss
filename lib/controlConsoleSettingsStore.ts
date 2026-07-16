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
    // Keep this persisted contract narrow: stale settings must not look like
    // live knobs after an upgrade. Linglan owns its own TTS routes and this
    // console only keeps settings that are consumed by this application.
    return {
      ...merged,
      routes: { documentAgent: merged.routes.documentAgent },
      dataSources: { typhoonTrackBaseUrl: merged.dataSources.typhoonTrackBaseUrl },
      reliability: {
        requestTimeoutSeconds: merged.reliability.requestTimeoutSeconds,
        retainLastGoodDataHours: merged.reliability.retainLastGoodDataHours
      }
    };
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
