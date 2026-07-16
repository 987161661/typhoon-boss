"use client";

import type { CSSProperties } from "react";
import {
  resolveAspectLockedFrameBox,
  type BroadcastFrameAspectLock
} from "@/lib/broadcastFrameGeometry";

export function BroadcastFrameSkin({
  image,
  tone,
  className,
  aspectLock
}: {
  image: string;
  tone: "battle" | "official";
  className: string;
  aspectLock?: BroadcastFrameAspectLock;
}) {
  const frameBox = aspectLock ? resolveAspectLockedFrameBox(aspectLock) : null;
  const style = {
    "--broadcast-frame-image": `url(\"${image}\")`,
    ...(frameBox ? {
      "--frame-source-height": `${frameBox.height}px`
    } : {})
  } as CSSProperties;

  return (
    <div
      className={className}
      data-frame-tone={tone}
      data-frame-render-mode={aspectLock ? "source-aspect" : "nine-slice"}
      data-source-aspect={aspectLock ? `${aspectLock.sourceWidth}/${aspectLock.sourceHeight}` : undefined}
      data-frame-scale={frameBox?.scale.toFixed(4)}
      style={style}
      aria-hidden="true"
    />
  );
}
