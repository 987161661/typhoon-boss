"use client";

import { useEffect, useState } from "react";

export function usePollingEnvironmentLayer<T>({
  url,
  intervalMs,
  enabled = true
}: {
  url: string;
  intervalMs: number;
  enabled?: boolean;
}) {
  const [payload, setPayload] = useState<T | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let controller: AbortController | null = null;

    const refresh = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch(url, { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const next = await response.json() as T;
        if (!disposed) setPayload(next);
      } catch (error) {
        if (!disposed && !(error instanceof DOMException && error.name === "AbortError")) return;
      }
    };

    void refresh();
    const timer = window.setInterval(() => void refresh(), intervalMs);
    return () => {
      disposed = true;
      controller?.abort();
      window.clearInterval(timer);
    };
  }, [enabled, intervalMs, url]);

  return payload;
}
