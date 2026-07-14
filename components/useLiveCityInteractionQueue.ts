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

  useEffect(() => {
    if (!active) advance();
  }, [active, advance, queueVersion]);

  // A fresh request may preempt an idle report, but never before its audience
  // has had ten seconds to read it. The report itself owns the 30s no-queue
  // timeout; this hook only cuts it short when a request is actually waiting.
  useEffect(() => {
    if (!active || !pendingRef.current.length) return;
    const remaining = Math.max(0, MIN_ACTIVE_MS - (Date.now() - activeStartedAtRef.current));
    const timer = window.setTimeout(() => setActive(null), remaining);
    return () => window.clearTimeout(timer);
  }, [active, queueVersion]);

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
      pendingRef.current = [request, ...pendingRef.current.filter((item) => item.cityQuery !== request.cityQuery)].slice(0, MAX_PENDING_INTERACTIONS);
      setQueueVersion((version) => version + 1);
      return true;
    }

    if (active?.cityQuery === request.cityQuery || pendingRef.current.some((item) => item.cityQuery === request.cityQuery)) return false;

    if (pendingRef.current.length >= MAX_PENDING_INTERACTIONS) return false;
    cityAcceptedAtRef.current.set(cityKey, now);
    for (const [city, recordedAt] of cityAcceptedAtRef.current) {
      if (now - recordedAt > CITY_COOLDOWN_MS) cityAcceptedAtRef.current.delete(city);
    }
    pendingRef.current.push(request);
    setQueueVersion((version) => version + 1);
    return true;
  }, [active]);

  const completeActive = useCallback((id: string) => {
    setActive((current) => current?.id === id ? null : current);
  }, []);

  return {
    active,
    pendingCount: pendingRef.current.length,
    submitComment,
    completeActive
  };
}
