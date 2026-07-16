"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

export const WARNING_CAROUSEL_INTERVAL_MS = 2_500;

export type CarouselItem = { id: string };

export function useWarningCarousel<T extends CarouselItem>(items: readonly T[], intervalMs = WARNING_CAROUSEL_INTERVAL_MS) {
  const signature = useMemo(() => items.map((item) => item.id).join("|"), [items]);
  const [currentId, setCurrentId] = useState<string | null>(() => items[0]?.id ?? null);
  const [manualPaused, setManualPaused] = useState(false);
  const [interactionPaused, setInteractionPaused] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    setCurrentId((current) => current && items.some((item) => item.id === current) ? current : items[0]?.id ?? null);
  }, [items, signature]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      setReducedMotion(media.matches);
      setPageVisible(document.visibilityState === "visible");
    };
    sync();
    media.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      media.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  const currentIndex = Math.max(0, items.findIndex((item) => item.id === currentId));
  const current = items[currentIndex] ?? null;
  const paused = manualPaused || interactionPaused || !pageVisible || reducedMotion;
  const move = useCallback((delta: number) => {
    if (items.length < 2) return;
    setCurrentId((id) => {
      const from = Math.max(0, items.findIndex((item) => item.id === id));
      return items[(from + delta + items.length) % items.length]?.id ?? null;
    });
  }, [items]);

  useEffect(() => {
    if (paused || items.length < 2) return;
    const timer = window.setInterval(() => move(1), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs, items.length, move, paused, signature]);

  return {
    current,
    currentIndex,
    paused,
    move,
    togglePaused: () => setManualPaused((value) => !value),
    setInteractionPaused
  };
}
