"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CITY_SCENE_MAX_IDLE_MS,
  CITY_SCENE_MIN_MS,
  createLiveDirectorQueueState,
  retainQueuedRequestPayloads,
  selectDirectorLens,
  transitionLiveDirectorQueue,
  type DirectorIdleContext,
  type LiveDirectorQueueAction,
  type LiveDirectorQueueState
} from "@/lib/liveDirectorQueue";
import {
  toCityInteractionRequest,
  type CityInteractionRequest,
  type HostLiveComment
} from "@/lib/liveCityInteraction";

const CITY_COOLDOWN_MS = 90_000;
const EVENT_DEDUPLICATION_MS = 10 * 60_000;
const MAX_PENDING_INTERACTIONS = 5;

const DEFAULT_IDLE_CONTEXT: DirectorIdleContext = {
  highestOfficialWarningLevel: null,
  focusedStormId: null
};

export function useLiveCityInteractionQueue(idleContext: DirectorIdleContext = DEFAULT_IDLE_CONTEXT) {
  const highestOfficialWarningLevel = idleContext.highestOfficialWarningLevel;
  const focusedStormId = idleContext.focusedStormId;
  const [machine, setMachine] = useState<LiveDirectorQueueState>(() => createLiveDirectorQueueState(idleContext));
  const machineRef = useRef(machine);
  const seenEventAtRef = useRef(new Map<string, number>());
  const cityAcceptedAtRef = useRef(new Map<string, number>());
  const interactionRequestsRef = useRef(new Map<string, CityInteractionRequest>());

  const apply = useCallback((action: LiveDirectorQueueAction) => {
    const next = transitionLiveDirectorQueue(machineRef.current, action);
    machineRef.current = next;
    setMachine(next);
    return next;
  }, []);

  useEffect(() => {
    apply({
      type: "idle-context",
      context: { highestOfficialWarningLevel, focusedStormId },
      now: Date.now()
    });
  }, [apply, focusedStormId, highestOfficialWarningLevel]);

  useEffect(() => {
    const active = machine.active;
    if (!active) return;
    const releaseAt = active.startedAt + (
      active.releaseRequested || machine.pending.length
        ? CITY_SCENE_MIN_MS
        : CITY_SCENE_MAX_IDLE_MS
    );
    const timer = window.setTimeout(() => {
      apply({ type: "tick", now: Date.now() });
    }, Math.max(0, releaseAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [apply, machine.active, machine.pending.length]);

  useEffect(() => {
    retainQueuedRequestPayloads(interactionRequestsRef.current, machine);
  }, [machine]);

  const submitComment = useCallback((comment: HostLiveComment) => {
    const request = toCityInteractionRequest(comment);
    if (!request) return false;
    const isRadarOperator = comment.platform === "radar-chat";
    const now = Date.now();
    const seenAt = seenEventAtRef.current.get(request.id);
    if (seenAt && now - seenAt < EVENT_DEDUPLICATION_MS) return false;
    seenEventAtRef.current.set(request.id, now);
    pruneOlderThan(seenEventAtRef.current, now, EVENT_DEDUPLICATION_MS);

    const cityKey = normalizeCityKey(request.cityQuery);
    const acceptedAt = cityAcceptedAtRef.current.get(cityKey);
    if (!isRadarOperator && acceptedAt && now - acceptedAt < CITY_COOLDOWN_MS) return false;

    const current = machineRef.current;
    if (
      current.active?.request.cityKey === cityKey
      || current.pending.some((item) => item.cityKey === cityKey)
      || current.pending.length >= MAX_PENDING_INTERACTIONS
    ) return false;

    cityAcceptedAtRef.current.set(cityKey, now);
    pruneOlderThan(cityAcceptedAtRef.current, now, CITY_COOLDOWN_MS);
    interactionRequestsRef.current.set(request.id, request);
    apply({
      type: "request",
      request: { id: request.id, cityKey, lensIntent: { kind: "national" } },
      position: isRadarOperator ? "front" : "back",
      now
    });
    return true;
  }, [apply]);

  const completeActive = useCallback((id: string) => {
    apply({ type: "complete", id, now: Date.now() });
  }, [apply]);

  return {
    active: machine.active ? interactionRequestsRef.current.get(machine.active.request.id) ?? null : null,
    pendingCount: machine.pending.length,
    lensIntent: selectDirectorLens(machine),
    submitComment,
    completeActive
  };
}

function normalizeCityKey(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN");
}

function pruneOlderThan(map: Map<string, number>, now: number, ttl: number) {
  for (const [key, recordedAt] of map) {
    if (now - recordedAt > ttl) map.delete(key);
  }
}
