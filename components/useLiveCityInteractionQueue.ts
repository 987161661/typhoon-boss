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

export function useLiveCityInteractionQueue() {
  const [active, setActive] = useState<CityInteractionRequest | null>(null);
  const [queueVersion, setQueueVersion] = useState(0);
  const pendingRef = useRef<CityInteractionRequest[]>([]);
  const seenEventAtRef = useRef(new Map<string, number>());
  const cityAcceptedAtRef = useRef(new Map<string, number>());

  const advance = useCallback(() => {
    setActive((current) => current ?? pendingRef.current.shift() ?? null);
  }, []);

  useEffect(() => {
    if (!active) advance();
  }, [active, advance, queueVersion]);

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
    // source. A fresh @city command must visibly replay the card immediately,
    // including after a previous request for the same city.
    if (isRadarOperator) {
      pendingRef.current = [];
      cityAcceptedAtRef.current.set(cityKey, now);
      setActive(request);
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
