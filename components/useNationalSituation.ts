"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { NationalSituationSnapshot } from "@/lib/nationalWeatherTypes";
import { acceptanceScenarioFromLocation, withAcceptanceScenario } from "@/lib/acceptanceScenario";

export const NATIONAL_SITUATION_POLL_INTERVAL_MS = 5 * 60 * 1000;

export interface NationalSituationState {
  snapshot: NationalSituationSnapshot | null;
  error: string | null;
  loaded: boolean;
  refreshing: boolean;
  refresh: () => void;
}

export function nationalSituationRequestHeaders(etag: string | null): HeadersInit {
  return etag ? { "If-None-Match": etag } : {};
}

export function useNationalSituation({
  enabled = true,
  intervalMs = NATIONAL_SITUATION_POLL_INTERVAL_MS
}: {
  enabled?: boolean;
  intervalMs?: number;
} = {}): NationalSituationState {
  const [snapshot, setSnapshot] = useState<NationalSituationSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshSequence, setRefreshSequence] = useState(0);
  const etagRef = useRef<string | null>(null);
  const acceptanceScenario = acceptanceScenarioFromLocation();

  const refresh = useCallback(() => setRefreshSequence((current) => current + 1), []);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let controller: AbortController | null = null;

    const load = async () => {
      controller?.abort();
      const requestController = new AbortController();
      controller = requestController;
      if (!disposed) setRefreshing(true);
      try {
        const response = await fetch(withAcceptanceScenario("/api/national-situation", acceptanceScenario), {
          cache: "no-store",
          headers: nationalSituationRequestHeaders(etagRef.current),
          signal: requestController.signal
        });
        if (response.status === 304) {
          if (!disposed) {
            setError(null);
            setLoaded(true);
          }
          return;
        }
        if (!response.ok) {
          const failure = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(failure?.error ?? "全国态势快照暂时不可用");
        }
        const next = await response.json() as NationalSituationSnapshot;
        if (!disposed) {
          etagRef.current = response.headers.get("etag");
          setSnapshot(next);
          setError(null);
          setLoaded(true);
        }
      } catch (loadError) {
        if (!disposed && !(loadError instanceof DOMException && loadError.name === "AbortError")) {
          setError(loadError instanceof Error ? loadError.message : "全国态势快照暂时不可用");
          setLoaded(true);
        }
      } finally {
        if (!disposed && controller === requestController) setRefreshing(false);
      }
    };

    void load();
    const timer = window.setInterval(() => void load(), intervalMs);
    return () => {
      disposed = true;
      controller?.abort();
      window.clearInterval(timer);
    };
  }, [acceptanceScenario, enabled, intervalMs, refreshSequence]);

  return { snapshot, error, loaded, refreshing, refresh };
}
