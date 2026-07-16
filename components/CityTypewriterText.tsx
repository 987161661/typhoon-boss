"use client";

import { useEffect, useRef, useState } from "react";
import { revealDelayFor, splitRevealText } from "@/lib/cityBattleShowModel";

export function CityTypewriterText({
  text,
  active,
  speed,
  reducedMotion,
  role,
  className,
  startDelayMs = 220,
  onCharacter,
  onComplete
}: {
  text: string;
  active: boolean;
  speed: number;
  reducedMotion: boolean;
  role: string;
  className?: string;
  startDelayMs?: number;
  onCharacter?: (character: string) => void;
  onComplete?: () => void;
}) {
  const [visible, setVisible] = useState(reducedMotion ? text : "");
  const characterRef = useRef(onCharacter);
  const completeRef = useRef(onComplete);
  characterRef.current = onCharacter;
  completeRef.current = onComplete;

  useEffect(() => {
    if (reducedMotion) {
      setVisible(text);
      completeRef.current?.();
      return;
    }
    if (!active) {
      setVisible("");
      return;
    }
    const units = splitRevealText(text);
    if (units.length === 0) {
      setVisible("");
      completeRef.current?.();
      return;
    }
    let position = 0;
    let timer: number | null = null;
    setVisible("");
    const typeNext = () => {
      position += 1;
      const character = units[position - 1] ?? "";
      setVisible(units.slice(0, position).join(""));
      characterRef.current?.(character);
      if (position < units.length) {
        timer = window.setTimeout(typeNext, revealDelayFor(character, speed));
      } else {
        completeRef.current?.();
      }
    };
    timer = window.setTimeout(typeNext, Math.max(0, startDelayMs));
    return () => {
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [active, reducedMotion, speed, startDelayMs, text]);

  return <p className={className} data-role={role}>{visible}<i aria-hidden="true" /></p>;
}
