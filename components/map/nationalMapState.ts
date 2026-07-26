import type { Storm } from "@/lib/types";

export const NATIONAL_CAMERA = {
  center: [104, 35] as [number, number],
  zoom: 3.25
} as const;

export type NationalMapState =
  | { mode: "national"; selectedStormId: null }
  | { mode: "typhoon"; selectedStormId: string };

export type NationalMapAction =
  | { type: "select-storm"; stormId: string }
  | { type: "return-national" }
  | { type: "reconcile-storms"; stormIds: readonly string[] };

export function createNationalMapState(requestedStormId?: string | null): NationalMapState {
  return requestedStormId
    ? { mode: "typhoon", selectedStormId: requestedStormId }
    : { mode: "national", selectedStormId: null };
}

export function reduceNationalMapState(state: NationalMapState, action: NationalMapAction): NationalMapState {
  switch (action.type) {
    case "select-storm":
      return action.stormId ? { mode: "typhoon", selectedStormId: action.stormId } : state;
    case "return-national":
      return { mode: "national", selectedStormId: null };
    case "reconcile-storms":
      if (state.mode === "national") return state;
      return action.stormIds.includes(state.selectedStormId)
        ? state
        : { mode: "national", selectedStormId: null };
  }
}

export function selectedStormForMap(state: NationalMapState, storms: readonly Storm[]): Storm | null {
  if (state.mode !== "typhoon") return null;
  return storms.find((storm) => storm.id === state.selectedStormId) ?? null;
}

/** Keeps status panels synchronized without changing the national map camera. */
export function overviewStormForMap(state: NationalMapState, storms: readonly Storm[]): Storm | null {
  return selectedStormForMap(state, storms) ?? storms[0] ?? null;
}

export function activeStormIndexForMap(state: NationalMapState, storms: readonly Storm[]) {
  if (state.mode !== "typhoon") return 0;
  const index = storms.findIndex((storm) => storm.id === state.selectedStormId);
  return index >= 0 ? index : 0;
}
