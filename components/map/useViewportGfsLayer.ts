"use client";

import { useEffect, useState } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { WindFieldBounds } from "@/lib/environmentData";
import type { GfsScalarLayerId, GfsScalarLayerPayload } from "@/lib/types";

export function useViewportGfsLayer({
  map,
  layer,
  boundsForMap
}: {
  map: MapLibreMap | null;
  layer: GfsScalarLayerId | null;
  boundsForMap: (map: MapLibreMap) => WindFieldBounds;
}) {
  return useViewportGridLayer<GfsScalarLayerPayload>({
    map,
    endpoint: "/api/environment/gfs-layer",
    enabled: Boolean(layer),
    queryKey: layer ? `layer=${encodeURIComponent(layer)}` : "",
    boundsForMap
  });
}

export function useViewportGridLayer<T extends { status: string; points: unknown[] }>({
  map,
  endpoint,
  enabled,
  queryKey = "",
  boundsForMap
}: {
  map: MapLibreMap | null;
  endpoint: string;
  enabled: boolean;
  queryKey?: string;
  boundsForMap: (map: MapLibreMap) => WindFieldBounds;
}) {
  const [payload, setPayload] = useState<T | null>(null);

  useEffect(() => {
    if (!map || !enabled) { setPayload(null); return; }
    let disposed = false;
    let timer = 0;
    let controller: AbortController | null = null;

    const load = async () => {
      controller?.abort();
      controller = new AbortController();
      const bounds = boundsForMap(map);
      const query = new URLSearchParams(queryKey);
      Object.entries(bounds).forEach(([key, value]) => query.set(key, value.toFixed(2)));
      try {
        const response = await fetch(`${endpoint}?${query}`, { cache: "no-store", signal: controller.signal });
        const next = response.ok ? await response.json() as T : null;
        if (!disposed && next?.status === "available" && next.points.length > 0) setPayload(next);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) return;
      }
    };
    const schedule = () => { window.clearTimeout(timer); timer = window.setTimeout(() => void load(), 220); };
    schedule();
    map.on("moveend", schedule);
    return () => { disposed = true; window.clearTimeout(timer); controller?.abort(); map.off("moveend", schedule); };
  }, [boundsForMap, enabled, endpoint, map, queryKey]);

  return payload;
}
