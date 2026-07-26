"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from "react";

export type FloatingWindowBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type FloatingWindowInteraction = {
  kind: "move" | "resize";
  pointerId: number;
  startX: number;
  startY: number;
  bounds: FloatingWindowBounds;
};

export function usePersistentFloatingWindow({
  storageKey,
  minWidth,
  minHeight,
  viewportPadding = 8
}: {
  storageKey: string;
  minWidth: number;
  minHeight: number;
  viewportPadding?: number;
}) {
  const windowRef = useRef<HTMLElement | null>(null);
  const [bounds, setBounds] = useState<FloatingWindowBounds | null>(null);
  const [interaction, setInteraction] = useState<FloatingWindowInteraction | null>(null);

  const constrain = (value: FloatingWindowBounds): FloatingWindowBounds => {
    const maxWidth = Math.max(0, window.innerWidth - viewportPadding * 2);
    const maxHeight = Math.max(0, window.innerHeight - viewportPadding * 2);
    const effectiveMinWidth = Math.min(minWidth, maxWidth);
    const effectiveMinHeight = Math.min(minHeight, maxHeight);
    const width = Math.min(maxWidth, Math.max(effectiveMinWidth, Math.round(value.width)));
    const height = Math.min(maxHeight, Math.max(effectiveMinHeight, Math.round(value.height)));
    return {
      width,
      height,
      left: Math.min(window.innerWidth - width - viewportPadding, Math.max(viewportPadding, Math.round(value.left))),
      top: Math.min(window.innerHeight - height - viewportPadding, Math.max(viewportPadding, Math.round(value.top)))
    };
  };

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (!stored) return;
      const value = JSON.parse(stored) as Partial<FloatingWindowBounds>;
      if (
        Number.isFinite(value.left) &&
        Number.isFinite(value.top) &&
        Number.isFinite(value.width) &&
        Number.isFinite(value.height)
      ) {
        setBounds(constrain(value as FloatingWindowBounds));
      }
    } catch {
      // A malformed local preference must never block the live composition.
    }
    // The geometry contract is fixed for one window instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    if (!bounds) return;
    window.localStorage.setItem(storageKey, JSON.stringify(bounds));
  }, [bounds, storageKey]);

  useEffect(() => {
    if (!interaction) return;
    const update = (event: PointerEvent) => {
      if (event.pointerId !== interaction.pointerId) return;
      const deltaX = event.clientX - interaction.startX;
      const deltaY = event.clientY - interaction.startY;
      setBounds(constrain(
        interaction.kind === "move"
          ? {
              ...interaction.bounds,
              left: interaction.bounds.left + deltaX,
              top: interaction.bounds.top + deltaY
            }
          : {
              ...interaction.bounds,
              width: interaction.bounds.width + deltaX,
              height: interaction.bounds.height + deltaY
            }
      ));
    };
    const stop = (event: PointerEvent) => {
      if (event.pointerId === interaction.pointerId) setInteraction(null);
    };
    window.addEventListener("pointermove", update);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointermove", update);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    // constrain only closes over immutable hook options.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interaction, minHeight, minWidth, viewportPadding]);

  const beginInteraction = (
    kind: FloatingWindowInteraction["kind"],
    event: ReactPointerEvent<HTMLElement>
  ) => {
    if (event.button !== 0) return;
    const rect = windowRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    const currentBounds = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    };
    setBounds(currentBounds);
    setInteraction({
      kind,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      bounds: currentBounds
    });
  };

  const positionedStyle: CSSProperties | undefined = bounds
    ? {
        left: `${bounds.left}px`,
        top: `${bounds.top}px`,
        width: `${bounds.width}px`,
        height: `${bounds.height}px`,
        right: "auto",
        bottom: "auto"
      }
    : undefined;

  return {
    windowRef,
    positioned: Boolean(bounds),
    interacting: Boolean(interaction),
    positionedStyle,
    beginInteraction
  };
}
