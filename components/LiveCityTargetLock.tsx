"use client";

import type { CSSProperties } from "react";
import type { CityAttention, CityAttentionAnchor } from "@/lib/liveCityInteraction";

export function LiveCityTargetLock({
  attention,
  anchor
}: {
  attention: CityAttention | null;
  anchor: CityAttentionAnchor | null;
}) {
  if (!attention || !anchor) return null;
  return (
    <div
      className="city-target-lock"
      data-phase={attention.phase}
      style={{ "--city-lock-x": `${anchor.x}px`, "--city-lock-y": `${anchor.y}px` } as CSSProperties}
      aria-label={`${attention.city} 城市目标锁定`}
    >
      <i className="city-target-lock-sweep" />
      <i className="city-target-lock-orbit is-inner" />
      <i className="city-target-lock-orbit is-outer" />
      <span className="city-target-lock-bracket is-nw" /><span className="city-target-lock-bracket is-ne" />
      <span className="city-target-lock-bracket is-sw" /><span className="city-target-lock-bracket is-se" />
      <div className="city-target-lock-core"><b>{attention.city}</b><small>TARGET LOCK</small></div>
    </div>
  );
}
