"use client";

import { useEffect, useRef, useState } from "react";
import type { SatelliteLayerPayload, Storm } from "@/lib/types";

export function StormSatellitePortrait({
  storm,
  satelliteLayer
}: {
  storm: Storm;
  satelliteLayer?: SatelliteLayerPayload | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [frameState, setFrameState] = useState<"loading" | "ready" | "unavailable">("loading");
  const imageUrl = satelliteLayer?.status === "available" ? satelliteLayer.imageUrl : null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageUrl || !satelliteLayer) {
      setFrameState("unavailable");
      return;
    }

    let cancelled = false;
    const image = new Image();
    image.decoding = "async";

    image.onload = () => {
      if (cancelled || !canvas) return;
      const context = canvas.getContext("2d");
      if (!context) return;

      const crop = cropAroundStorm(image, storm, satelliteLayer);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.filter = "contrast(1.12) saturate(1.08)";
      context.drawImage(image, crop.x, crop.y, crop.size, crop.size, 0, 0, canvas.width, canvas.height);
      context.filter = "none";

      const tint = context.createLinearGradient(0, 0, canvas.width, canvas.height);
      tint.addColorStop(0, "rgba(4, 30, 44, 0.38)");
      tint.addColorStop(0.55, "rgba(0, 0, 0, 0.02)");
      tint.addColorStop(1, "rgba(116, 12, 20, 0.24)");
      context.fillStyle = tint;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "rgba(153, 230, 255, 0.13)";
      for (let y = 3; y < canvas.height; y += 7) context.fillRect(0, y, canvas.width, 1);

      setFrameState("ready");
    };
    image.onerror = () => {
      if (!cancelled) setFrameState("unavailable");
    };
    setFrameState("loading");
    image.src = imageUrl;

    return () => {
      cancelled = true;
    };
  }, [imageUrl, satelliteLayer, storm]);

  const sourceLabel = satelliteLayer?.updatedAt ? new Date(satelliteLayer.updatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : null;
  const frameLabel = satelliteLayer?.isStale
    ? `卫星帧 ${sourceLabel ?? "时次未知"}（较旧）`
    : `卫星帧 ${sourceLabel ?? "时次未知"}`;

  return (
    <div
      className={`storm-satellite-portrait is-${frameState}`}
      aria-label={frameState === "ready" ? `${storm.nameZh} 卫星云图 ${sourceLabel ?? "时次未知"}` : `${storm.nameZh} 卫星云图暂不可用`}
    >
      <canvas ref={canvasRef} width="256" height="256" aria-hidden="true" />
      <span className="storm-satellite-portrait-grid" aria-hidden="true" />
      <span className="storm-satellite-portrait-crosshair" aria-hidden="true" />
      <span className="storm-satellite-portrait-tag">{frameState === "ready" ? frameLabel : frameState === "loading" ? "卫星帧同步中" : "卫星帧不可用"}</span>
    </div>
  );
}

function cropAroundStorm(image: HTMLImageElement, storm: Storm, satelliteLayer: SatelliteLayerPayload) {
  const { west, east, south, north } = satelliteLayer.bounds;
  const normalizedX = clamp((storm.position.lon - west) / (east - west), 0, 1);
  const normalizedY = clamp(
    (mercatorLatitude(north) - mercatorLatitude(storm.position.lat)) / (mercatorLatitude(north) - mercatorLatitude(south)),
    0,
    1
  );
  const size = Math.max(96, Math.min(image.naturalWidth * 0.24, image.naturalHeight * 0.48));

  return {
    x: clamp(normalizedX * image.naturalWidth - size / 2, 0, image.naturalWidth - size),
    y: clamp(normalizedY * image.naturalHeight - size / 2, 0, image.naturalHeight - size),
    size
  };
}

function mercatorLatitude(latitude: number) {
  const safeLatitude = clamp(latitude, -85, 85) * (Math.PI / 180);
  return Math.log(Math.tan(Math.PI / 4 + safeLatitude / 2));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
