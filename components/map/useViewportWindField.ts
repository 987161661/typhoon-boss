"use client";

import { useEffect, useState } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { WindFieldBounds } from "@/lib/environmentData";
import type { WindFieldPayload } from "@/lib/types";

export function useViewportWindField({
  map,
  enabled,
  stormId,
  boundsForMap
}: {
  map: MapLibreMap | null;
  enabled: boolean;
  stormId?: string | null;
  boundsForMap: (map: MapLibreMap) => WindFieldBounds;
}) {
  const [field, setField] = useState<WindFieldPayload | null>(null);

  useEffect(() => {
    if (!map || !enabled) { setField(null); return; }
    setField(null);
    let disposed = false;
    let timer = 0;
    let controller: AbortController | null = null;

    const load = async () => {
      controller?.abort();
      controller = new AbortController();
      const bounds = boundsForMap(map);
      const query = new URLSearchParams(Object.fromEntries(Object.entries(bounds).map(([key, value]) => [key, value.toFixed(2)])));
      if (stormId) query.set("stormId", stormId);
      try {
        const response = await fetch(`/api/environment/wind-field?${query}`, { cache: "no-store", signal: controller.signal });
        const payload = response.ok ? await response.json() as WindFieldPayload : null;
        if (!disposed && payload?.status === "available" && payload.points.length > 0) setField(payload);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) return;
      }
    };
    const schedule = () => { window.clearTimeout(timer); timer = window.setTimeout(() => void load(), 180); };
    schedule();
    map.on("moveend", schedule);
    return () => { disposed = true; window.clearTimeout(timer); controller?.abort(); map.off("moveend", schedule); };
  }, [map, enabled, stormId, boundsForMap]);

  return field;
}
