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
        // Environment routes deliberately return a structured unavailable
        // payload on 503.  Dropping every non-2xx body left controls stuck on
        // “正在获取” forever even after the provider had already answered.
        const next = await response.json().catch(() => null) as T | null;
        if (!disposed && next) setPayload(next);
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
