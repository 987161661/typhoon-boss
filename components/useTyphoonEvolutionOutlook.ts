"use client";

import { useEffect, useMemo, useState } from "react";
import {
  buildLiveTyphoonOutlookView,
  buildTyphoonOutlookMarkerModels,
  type TyphoonEvolutionOutlookPayload
} from "@/lib/liveTyphoonOutlook";

const EMPTY_PAYLOAD: TyphoonEvolutionOutlookPayload = {
  status: "unavailable",
  updatedAt: null,
  outlook: null
};

export function useTyphoonEvolutionOutlook(enabled: boolean) {
  const [payload, setPayload] = useState<TyphoonEvolutionOutlookPayload>(EMPTY_PAYLOAD);

  useEffect(() => {
    if (!enabled) {
      setPayload(EMPTY_PAYLOAD);
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      try {
        const response = await fetch("/api/typhoon-evolution-outlook", { cache: "no-store" });
        if (!response.ok) return;
        const next = await response.json() as TyphoonEvolutionOutlookPayload;
        if (!cancelled) setPayload(next);
      } catch {
        // Keep the last successful report during a transient local API failure.
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enabled]);

  return useMemo(() => ({
    payload,
    view: buildLiveTyphoonOutlookView(payload),
    markers: buildTyphoonOutlookMarkerModels(payload)
  }), [payload]);
}
