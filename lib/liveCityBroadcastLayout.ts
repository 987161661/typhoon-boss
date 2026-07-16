import type { LayoutPoint, LayoutRect, LayoutSize } from "@/lib/cityPanelLayout";

export interface LiveCityBroadcastLayout {
  battleRect: LayoutRect;
  infoRect: LayoutRect;
  corridorRect: LayoutRect;
  target: LayoutPoint;
}

/**
 * The live report is a broadcast composition rather than an anchored desktop
 * popover.  Both towers grow beyond their former 720p dimensions while the
 * remaining width becomes a real map corridor.  The map camera consumes the
 * same target point, so the city lock can never drift underneath a tower.
 */
export function resolveLiveCityBroadcastLayout(viewport: LayoutSize): LiveCityBroadcastLayout {
  const width = finitePositive(viewport.width, 1280);
  const height = finitePositive(viewport.height, 720);
  const minimumCorridor = width >= 1280 ? Math.max(80, width * 0.0625) : Math.max(96, width * 0.14);
  const desiredBattleWidth = clamp(width * 0.625, width >= 1280 ? 800 : width * 0.58, 1_100);
  const desiredInfoWidth = clamp(width * 0.3125, width >= 1280 ? 400 : width * 0.34, 620);
  const desiredTowerWidth = desiredBattleWidth + desiredInfoWidth;
  const availableTowerWidth = Math.max(2, width - minimumCorridor);
  const scale = desiredTowerWidth > availableTowerWidth ? availableTowerWidth / desiredTowerWidth : 1;
  const battleWidth = Math.round(desiredBattleWidth * scale);
  const infoWidth = Math.round(desiredInfoWidth * scale);
  const corridorWidth = Math.max(1, width - battleWidth - infoWidth);
  const panelHeight = Math.max(1, Math.min(920, height - 24));
  const panelY = Math.max(0, Math.round((height - panelHeight) / 2));

  const battleHeight = Math.min(panelHeight, Math.round(battleWidth * 941 / 1_672));
  const battleRect = { x: 0, y: panelY, width: battleWidth, height: battleHeight };
  const infoRect = { x: width - infoWidth, y: panelY, width: infoWidth, height: panelHeight };
  const corridorRect = { x: battleWidth, y: 0, width: corridorWidth, height };
  return {
    battleRect,
    infoRect,
    corridorRect,
    target: {
      x: corridorRect.x + corridorRect.width / 2,
      y: height / 2
    }
  };
}

export function liveCityBroadcastMapOffset(
  viewport: LayoutSize,
  mapSurface: LayoutRect = { x: 0, y: 0, width: viewport.width, height: viewport.height }
): [number, number] {
  const layout = resolveLiveCityBroadcastLayout(viewport);
  return [
    layout.target.x - (mapSurface.x + mapSurface.width / 2),
    layout.target.y - (mapSurface.y + mapSurface.height / 2)
  ];
}

function finitePositive(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
