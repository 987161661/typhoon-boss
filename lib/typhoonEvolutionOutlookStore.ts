import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  TyphoonEvolutionOutlook,
  TyphoonEvolutionOutlookPayload
} from "./liveTyphoonOutlook";
import { assessTropicalDisturbanceOutlook } from "./agent/tropicalDisturbanceOutlook.mjs";

const STATE_PATH = path.join(process.cwd(), ".runtime", "typhoon-evolution-agent.json");

function isOutlook(value: unknown): value is TyphoonEvolutionOutlook {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TyphoonEvolutionOutlook>;
  return candidate.schemaVersion === 1
    && typeof candidate.generatedAt === "string"
    && Array.isArray(candidate.nearTermDisturbances)
    && Array.isArray(candidate.extendedRangeAreas);
}

export async function readTyphoonEvolutionOutlook(): Promise<TyphoonEvolutionOutlookPayload> {
  try {
    const raw = await fs.readFile(STATE_PATH, "utf8");
    const state = JSON.parse(raw) as { updatedAt?: unknown; lastDisturbanceOutlook?: unknown };
    if (!isOutlook(state.lastDisturbanceOutlook)) {
      return { status: "unavailable", updatedAt: null, outlook: null };
    }
    const evidence = assessTropicalDisturbanceOutlook(state.lastDisturbanceOutlook);
    const outlook: TyphoonEvolutionOutlook = {
      ...state.lastDisturbanceOutlook,
      evidenceStatus: evidence.status,
      coverage: evidence.coverage
    };
    return {
      status: evidence.status,
      updatedAt: typeof state.updatedAt === "string" ? state.updatedAt : state.lastDisturbanceOutlook.generatedAt,
      outlook
    };
  } catch {
    return { status: "unavailable", updatedAt: null, outlook: null };
  }
}
