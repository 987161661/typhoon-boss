import type { VisualLayerFrameSummary, VisualLayerSummary } from "@/lib/nationalWeatherTypes";

export interface RadarPlaybackState {
  index: number;
  playing: boolean;
  frameIds: string[];
}

export type RadarPlaybackAction =
  | { type: "sync"; frameIds: string[] }
  | { type: "previous" }
  | { type: "next" }
  | { type: "toggle" }
  | { type: "pause" }
  | { type: "tick" };

export function radarPlaybackFrames(radar: VisualLayerSummary | null): VisualLayerFrameSummary[] {
  return [...(radar?.frames ?? [])].sort((left, right) => {
    const leftTime = left.observedAt ? Date.parse(left.observedAt) : 0;
    const rightTime = right.observedAt ? Date.parse(right.observedAt) : 0;
    return leftTime - rightTime || left.id.localeCompare(right.id);
  });
}

export function createRadarPlaybackState(frameIds: readonly string[]): RadarPlaybackState {
  return { index: Math.max(0, frameIds.length - 1), playing: false, frameIds: [...frameIds] };
}

export function reduceRadarPlaybackState(state: RadarPlaybackState, action: RadarPlaybackAction): RadarPlaybackState {
  const count = action.type === "sync" ? action.frameIds.length : state.frameIds.length;
  switch (action.type) {
    case "sync": {
      const selectedId = state.frameIds[state.index];
      const preservedIndex = selectedId ? action.frameIds.indexOf(selectedId) : -1;
      return {
        frameIds: action.frameIds,
        index: preservedIndex >= 0 ? preservedIndex : Math.max(0, count - 1),
        playing: count > 1 && state.playing
      };
    }
    case "previous":
      return count > 0 ? { ...state, index: (state.index - 1 + count) % count } : state;
    case "next":
    case "tick":
      return count > 0 ? { ...state, index: (state.index + 1) % count } : state;
    case "toggle":
      return count > 1 ? { ...state, playing: !state.playing } : state;
    case "pause":
      return state.playing ? { ...state, playing: false } : state;
  }
}

export function shouldRunRadarPlaybackTimer(enabled: boolean, state: RadarPlaybackState) {
  return enabled && state.playing && state.frameIds.length > 1;
}
