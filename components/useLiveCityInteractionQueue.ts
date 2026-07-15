"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
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
  viewerIdentityKey,
  type CityInteractionRequest,
  type HostLiveComment,
  type HostLiveEvent,
  type HostViewerRelationEvent
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
  const viewerCityAccessRef = useRef(new Map<string, CityInteractionRequest["followEvidence"]>());
  const followedViewersRef = useRef(new Map<string, number>());
  const interactionRequestsRef = useRef(new Map<string, CityInteractionRequest>());
  const [, publishPayloadChange] = useReducer((value: number) => value + 1, 0);

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
    const parsedRequest = toCityInteractionRequest(comment);
    if (!parsedRequest) return false;
    const viewerKey = viewerIdentityKey(parsedRequest.platform, parsedRequest.viewerId);
    const followedAt = viewerKey ? followedViewersRef.current.get(viewerKey) : undefined;
    const request = followedAt && parsedRequest.followEvidence !== "observed"
      ? { ...parsedRequest, followEvidence: "observed" as const, followObservedAt: followedAt }
      : parsedRequest;
    const isRadarOperator = comment.platform === "radar-chat";
    const now = Date.now();
    const seenAt = seenEventAtRef.current.get(request.id);
    if (seenAt && now - seenAt < EVENT_DEDUPLICATION_MS) return false;
    seenEventAtRef.current.set(request.id, now);
    pruneOlderThan(seenEventAtRef.current, now, EVENT_DEDUPLICATION_MS);

    const cityKey = normalizeCityKey(request.cityQuery);
    const acceptedAt = cityAcceptedAtRef.current.get(cityKey);
    const viewerCityKey = viewerKey ? `${viewerKey}|${cityKey}` : null;
    const previousAccess = viewerCityKey ? viewerCityAccessRef.current.get(viewerCityKey) : undefined;
    const upgradedAfterLockedQuery = request.followEvidence === "observed" && previousAccess === "unknown";
    if (!isRadarOperator && !upgradedAfterLockedQuery && acceptedAt && now - acceptedAt < CITY_COOLDOWN_MS) return false;

    const current = machineRef.current;
    if (
      current.active?.request.cityKey === cityKey
      || current.pending.some((item) => item.cityKey === cityKey)
      || current.pending.length >= MAX_PENDING_INTERACTIONS
    ) return false;

    cityAcceptedAtRef.current.set(cityKey, now);
    if (viewerCityKey) viewerCityAccessRef.current.set(viewerCityKey, request.followEvidence);
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

  const submitRelation = useCallback((event: HostViewerRelationEvent) => {
    const viewerKey = viewerIdentityKey(event.platform, event.viewerId);
    if (!viewerKey) return false;
    followedViewersRef.current.set(viewerKey, event.observedAt);
    let changed = false;
    for (const [id, request] of interactionRequestsRef.current) {
      if (viewerIdentityKey(request.platform, request.viewerId) !== viewerKey) continue;
      if (request.followEvidence === "observed" && request.followObservedAt === event.observedAt) continue;
      interactionRequestsRef.current.set(id, {
        ...request,
        followEvidence: "observed",
        followObservedAt: event.observedAt
      });
      changed = true;
    }
    if (changed) publishPayloadChange();
    return true;
  }, []);

  const submitEvent = useCallback((event: HostLiveEvent) => {
    return event.type === "aituber:viewer-relation"
      ? submitRelation(event)
      : submitComment(event);
  }, [submitComment, submitRelation]);

  const completeActive = useCallback((id: string) => {
    apply({ type: "complete", id, now: Date.now() });
  }, [apply]);

  return {
    active: machine.active ? interactionRequestsRef.current.get(machine.active.request.id) ?? null : null,
    pendingCount: machine.pending.length,
    lensIntent: selectDirectorLens(machine),
    submitComment,
    submitEvent,
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
