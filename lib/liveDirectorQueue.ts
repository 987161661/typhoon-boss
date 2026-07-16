import type { WeatherEventLevel } from "@/lib/nationalWeatherTypes";

export type DirectorLensIntent =
  | { kind: "national" }
  | { kind: "typhoon"; stormId: string };

export interface DirectorCityRequest {
  id: string;
  cityKey: string;
  lensIntent: DirectorLensIntent;
}

export interface DirectorIdleContext {
  highestOfficialWarningLevel: WeatherEventLevel | null;
  focusedStormId: string | null;
}

export interface LiveDirectorQueueState {
  active: { request: DirectorCityRequest; startedAt: number; releaseRequested?: boolean } | null;
  pending: DirectorCityRequest[];
  idleContext: DirectorIdleContext;
}

export type LiveDirectorQueueAction =
  | { type: "request"; request: DirectorCityRequest; now: number; position?: "front" | "back" }
  | { type: "complete"; id: string; now: number }
  | { type: "tick"; now: number }
  | { type: "idle-context"; context: DirectorIdleContext; now: number };

export const CITY_SCENE_MIN_MS = 10_000;
export const CITY_SCENE_MAX_IDLE_MS = 30_000;

export function createLiveDirectorQueueState(
  idleContext: DirectorIdleContext = { highestOfficialWarningLevel: null, focusedStormId: null }
): LiveDirectorQueueState {
  return { active: null, pending: [], idleContext };
}

/** Pure transition function; callers inject monotonic `now` values. */
export function transitionLiveDirectorQueue(
  current: LiveDirectorQueueState,
  action: LiveDirectorQueueAction
): LiveDirectorQueueState {
  // A request is inserted before reconciliation so a front-priority operator
  // request can win the already-eligible switch without bypassing 10 seconds.
  let state = action.type === "request" ? current : reconcile(current, action.now);

  if (action.type === "idle-context") {
    return { ...state, idleContext: action.context };
  }
  if (action.type === "tick") return state;

  if (action.type === "complete") {
    if (state.active?.request.id !== action.id) return state;
    const elapsed = Math.max(0, action.now - state.active.startedAt);
    if (elapsed >= CITY_SCENE_MIN_MS) return releaseActive(state, action.now);
    return { ...state, active: { ...state.active, releaseRequested: true } };
  }

  if (hasRequest(state, action.request.id)) return state;
  if (!state.active) {
    return { ...state, active: { request: action.request, startedAt: action.now } };
  }

  state = {
    ...state,
    pending: action.position === "front"
      ? [action.request, ...state.pending]
      : [...state.pending, action.request]
  };
  return reconcile(state, action.now);
}

export function selectDirectorLens(state: LiveDirectorQueueState): DirectorLensIntent {
  if (state.active) return state.active.request.lensIntent;
  return resolveIdleDirectorLens(state.idleContext);
}

export function resolveIdleDirectorLens(context: DirectorIdleContext): DirectorLensIntent {
  if (context.highestOfficialWarningLevel === "red" || context.highestOfficialWarningLevel === "orange") {
    return { kind: "national" };
  }
  if (context.focusedStormId) return { kind: "typhoon", stormId: context.focusedStormId };
  return { kind: "national" };
}

/** Removes completed request payloads while retaining active and queued ids. */
export function retainQueuedRequestPayloads<T>(
  payloads: Map<string, T>,
  state: LiveDirectorQueueState
) {
  const retained = new Set([
    ...(state.active ? [state.active.request.id] : []),
    ...state.pending.map((request) => request.id)
  ]);
  for (const id of payloads.keys()) {
    if (!retained.has(id)) payloads.delete(id);
  }
  return payloads;
}

function reconcile(state: LiveDirectorQueueState, now: number): LiveDirectorQueueState {
  if (!state.active) return state;
  const elapsed = Math.max(0, now - state.active.startedAt);
  if (state.active.releaseRequested && elapsed >= CITY_SCENE_MIN_MS) {
    return releaseActive(state, now);
  }
  if (state.pending.length && elapsed >= CITY_SCENE_MIN_MS) {
    const [request, ...pending] = state.pending;
    return { ...state, active: { request: request!, startedAt: now }, pending };
  }
  if (!state.pending.length && elapsed >= CITY_SCENE_MAX_IDLE_MS) {
    return { ...state, active: null };
  }
  return state;
}

function releaseActive(state: LiveDirectorQueueState, now: number): LiveDirectorQueueState {
  const [request, ...pending] = state.pending;
  return request
    ? { ...state, active: { request, startedAt: now }, pending }
    : { ...state, active: null };
}

function hasRequest(state: LiveDirectorQueueState, id: string) {
  return state.active?.request.id === id || state.pending.some((request) => request.id === id);
}
