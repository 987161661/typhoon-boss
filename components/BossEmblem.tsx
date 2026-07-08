"use client";

import type { StormStage } from "@/lib/types";

const stageClass: Record<StormStage, string> = {
  热带低压: "emblem-storm",
  热带风暴: "emblem-storm",
  强热带风暴: "emblem-typhoon",
  台风: "emblem-typhoon",
  强台风: "emblem-severe",
  超强台风: "emblem-super"
};

export function BossEmblem({ stage, label }: { stage: StormStage; label?: string }) {
  return (
    <div className={`boss-emblem ${stageClass[stage]}`} aria-label={label ?? stage}>
      <div className="emblem-ring ring-a" />
      <div className="emblem-ring ring-b" />
      <div className="emblem-core" />
      <div className="emblem-slash slash-a" />
      <div className="emblem-slash slash-b" />
    </div>
  );
}
