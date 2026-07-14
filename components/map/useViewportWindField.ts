"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { WindFieldBounds } from "@/lib/environmentData";
import type { WindFieldPayload } from "@/lib/types";

export function useViewportWindField({
  map,
  enabled,
  stormId,
  boundsForMap,
  requiredBoundsForMap
}: {
  map: MapLibreMap | null;
  enabled: boolean;
  stormId?: string | null;
  boundsForMap: (map: MapLibreMap) => WindFieldBounds;
  requiredBoundsForMap?: (map: MapLibreMap) => WindFieldBounds;
}) {
  const [field, setField] = useState<WindFieldPayload | null>(null);
  const fieldRef = useRef<WindFieldPayload | null>(null);

  useEffect(() => {
    if (!map || !enabled) { fieldRef.current = null; setField(null); return; }
    fieldRef.current = null;
    setField(null);
    let disposed = false;
    let timer = 0;
    let controller: AbortController | null = null;
    let requestedCoverage: WindFieldBounds | null = null;

    const load = async () => {
      const requiredBounds = requiredBoundsForMap?.(map);
      if (requiredBounds && windCoverageContains(fieldRef.current?.coverage, requiredBounds)) return;
      if (requiredBounds && windCoverageContains(requestedCoverage, requiredBounds)) return;

      const bounds = boundsForMap(map);
      controller?.abort();
      const requestController = new AbortController();
      controller = requestController;
      requestedCoverage = bounds;
      const query = new URLSearchParams(Object.fromEntries(Object.entries(bounds).map(([key, value]) => [key, value.toFixed(2)])));
      if (stormId) query.set("stormId", stormId);
      try {
        const response = await fetch(`/api/environment/wind-field?${query}`, { cache: "no-store", signal: requestController.signal });
        const payload = response.ok ? await response.json() as WindFieldPayload : null;
        if (!disposed && payload?.status === "available" && payload.points.length > 0) {
          fieldRef.current = payload;
          setField(payload);
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) return;
      } finally {
        if (controller === requestController) {
          controller = null;
          requestedCoverage = null;
        }
      }
    };
    const schedule = (delayMs = 180) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void load(), delayMs);
    };
    const prefetchNearCoverageEdge = () => {
      const requiredBounds = requiredBoundsForMap?.(map);
      if (!requiredBounds || windCoverageContains(fieldRef.current?.coverage, requiredBounds)) return;
      schedule(90);
    };
    const scheduleAfterMove = () => schedule();
    schedule();
    map.on("move", prefetchNearCoverageEdge);
    map.on("moveend", scheduleAfterMove);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      controller?.abort();
      map.off("move", prefetchNearCoverageEdge);
      map.off("moveend", scheduleAfterMove);
    };
  }, [map, enabled, stormId, boundsForMap, requiredBoundsForMap]);

  return field;
}

export function windCoverageContains(
  coverage: WindFieldBounds | null | undefined,
  required: WindFieldBounds
) {
  if (!coverage) return false;
  const epsilon = 0.001;
  return coverage.west <= required.west + epsilon &&
    coverage.east >= required.east - epsilon &&
    coverage.south <= required.south + epsilon &&
    coverage.north >= required.north - epsilon;
}
