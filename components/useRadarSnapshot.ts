"use client";

import { useEffect, useRef, useState } from "react";
import type { RadarSnapshot } from "@/lib/radarSnapshot";

export const SNAPSHOT_POLL_MS = 10 * 1000;

interface RadarSnapshotState {
  snapshot: RadarSnapshot | null;
  error: string | null;
  fetchDurationMs: number | null;
  loaded: boolean;
  lastSyncedAt: number | null;
  refreshSequence: number;
  pollIntervalMs: number;
}

export function useRadarSnapshot(stormId?: string | null): RadarSnapshotState {
  const [state, setState] = useState<RadarSnapshotState>({
    snapshot: null,
    error: null,
    fetchDurationMs: null,
    loaded: false,
    lastSyncedAt: null,
    refreshSequence: 0,
    pollIntervalMs: SNAPSHOT_POLL_MS
  });
  const requestIdRef = useRef(0);
  const etagRef = useRef<string | null>(null);

  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();

    async function loadSnapshot() {
      const requestId = ++requestIdRef.current;
      const start = performance.now();
      const params = new URLSearchParams({ t: String(Date.now()) });
      if (stormId) params.set("stormId", stormId);

      try {
        const response = await fetch(`/api/radar/snapshot?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
          headers: etagRef.current ? { "If-None-Match": etagRef.current } : undefined
        });
        if (response.status === 304) {
          if (!disposed && requestId === requestIdRef.current) {
            setState((current) => ({ ...current, error: null, fetchDurationMs: Math.round(performance.now() - start), lastSyncedAt: Date.now() }));
          }
          return;
        }
        const payload = (await response.json()) as RadarSnapshot;
        if (!response.ok) {
          throw new Error(payload.warnings?.[0] ?? "Radar snapshot temporarily unavailable.");
        }
        if (disposed || requestId !== requestIdRef.current) return;
        etagRef.current = response.headers.get("etag");
        setState((current) => ({
          snapshot: payload,
          error: null,
          fetchDurationMs: Math.round(performance.now() - start),
          loaded: true,
          lastSyncedAt: Date.now(),
          refreshSequence: current.refreshSequence + 1,
          pollIntervalMs: SNAPSHOT_POLL_MS
        }));
      } catch (error) {
        if (disposed || controller.signal.aborted || requestId !== requestIdRef.current) return;
        setState((current) => ({
          ...current,
          error: error instanceof Error ? error.message : "Radar snapshot temporarily unavailable.",
          fetchDurationMs: Math.round(performance.now() - start),
          loaded: true
        }));
      }
    }

    void loadSnapshot();
    const timer = window.setInterval(loadSnapshot, SNAPSHOT_POLL_MS);

    return () => {
      disposed = true;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [stormId]);

  return state;
}
