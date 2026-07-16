export interface BroadcastFrameAspectLock {
  sourceWidth: number;
  sourceHeight: number;
  renderedWidth: number;
}

/**
 * Returns a source-proportional box. It is used for distinctive full-frame
 * artwork that must never be squeezed into the height of its content tower.
 */
export function resolveAspectLockedFrameBox({
  sourceWidth,
  sourceHeight,
  renderedWidth,
}: BroadcastFrameAspectLock) {
  const safeSourceWidth = finitePositive(sourceWidth, 1);
  const safeSourceHeight = finitePositive(sourceHeight, 1);
  const safeRenderedWidth = finitePositive(renderedWidth, safeSourceWidth);
  const scale = safeRenderedWidth / safeSourceWidth;
  return {
    width: round(safeRenderedWidth),
    height: round(safeSourceHeight * scale),
    scale
  };
}

function finitePositive(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function round(value: number) {
  return Math.round(value * 1_000) / 1_000;
}
