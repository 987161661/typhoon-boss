"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  toCityInteractionRequest,
  type CityInteractionRequest,
  type HostLiveComment
} from "@/lib/liveCityInteraction";

const CITY_COOLDOWN_MS = 90_000;
const EVENT_DEDUPLICATION_MS = 10 * 60_000;
const MAX_PENDING_INTERACTIONS = 5;
const MIN_ACTIVE_MS = 10_000;

export function useLiveCityInteractionQueue() {
  const [active, setActive] = useState<CityInteractionRequest | null>(null);
  const [queueVersion, setQueueVersion] = useState(0);
  const pendingRef = useRef<CityInteractionRequest[]>([]);
  const activeStartedAtRef = useRef(0);
  const preemptionTimerRef = useRef<number | null>(null);
  const seenEventAtRef = useRef(new Map<string, number>());
  const cityAcceptedAtRef = useRef(new Map<string, number>());

  const advance = useCallback(() => {
    setActive((current) => {
      if (current) return current;
      const next = pendingRef.current.shift() ?? null;
      if (next) activeStartedAtRef.current = Date.now();
      return next;
    });
  }, []);

  const schedulePreemption = useCallback(() => {
    if (preemptionTimerRef.current !== null) return;
    const wait = Math.max(0, MIN_ACTIVE_MS - (Date.now() - activeStartedAtRef.current));
    preemptionTimerRef.current = window.setTimeout(() => {
      preemptionTimerRef.current = null;
      setActive(null);
    }, wait);
  }, []);

  useEffect(() => {
    if (!active) advance();
  }, [active, advance, queueVersion]);

  useEffect(() => () => {
    if (preemptionTimerRef.current !== null) window.clearTimeout(preemptionTimerRef.current);
  }, []);

  const submitComment = useCallback((comment: HostLiveComment) => {
    const request = toCityInteractionRequest(comment);
    if (!request) return false;
    const isRadarOperator = comment.platform === "radar-chat";
    const now = Date.now();
    const seenAt = seenEventAtRef.current.get(request.id);
    if (seenAt && now - seenAt < EVENT_DEDUPLICATION_MS) return false;
    seenEventAtRef.current.set(request.id, now);
    for (const [id, recordedAt] of seenEventAtRef.current) {
      if (now - recordedAt > EVENT_DEDUPLICATION_MS) seenEventAtRef.current.delete(id);
    }

    const cityKey = request.cityQuery.normalize("NFKC").toLocaleLowerCase("zh-CN");
    const acceptedAt = cityAcceptedAtRef.current.get(cityKey);
    if (!isRadarOperator && acceptedAt && now - acceptedAt < CITY_COOLDOWN_MS) return false;

    // The local radar console is an operator control, not an audience spam
    // source. It goes to the front of the waiting line, but it still respects
    // the active card's minimum on-screen time.
    if (isRadarOperator) {
      cityAcceptedAtRef.current.set(cityKey, now);
      if (!active) {
        activeStartedAtRef.current = now;
        setActive(request);
        return true;
      }
      pendingRef.current = [request, ...pendingRef.current.filter((item) => item.cityQuery !== request.cityQuery)].slice(0, MAX_PENDING_INTERACTIONS);
      schedulePreemption();
      setQueueVersion((version) => version + 1);
      return true;
    }

    if (active?.cityQuery === request.cityQuery || pendingRef.current.some((item) => item.cityQuery === request.cityQuery)) return false;

    if (!active) {
      cityAcceptedAtRef.current.set(cityKey, now);
      activeStartedAtRef.current = now;
      setActive(request);
      return true;
    }

    if (pendingRef.current.length >= MAX_PENDING_INTERACTIONS) return false;
    cityAcceptedAtRef.current.set(cityKey, now);
    for (const [city, recordedAt] of cityAcceptedAtRef.current) {
      if (now - recordedAt > CITY_COOLDOWN_MS) cityAcceptedAtRef.current.delete(city);
    }
    pendingRef.current.push(request);
    if (active) schedulePreemption();
    setQueueVersion((version) => version + 1);
    return true;
  }, [active, schedulePreemption]);

  const completeActive = useCallback((id: string) => {
    setActive((current) => {
      if (current?.id !== id) return current;
      if (preemptionTimerRef.current !== null) {
        window.clearTimeout(preemptionTimerRef.current);
        preemptionTimerRef.current = null;
      }
      return null;
    });
  }, []);

  return {
    active,
    pendingCount: pendingRef.current.length,
    submitComment,
    completeActive
  };
}
