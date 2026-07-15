export interface LayoutPoint {
  x: number;
  y: number;
}

export interface LayoutSize {
  width: number;
  height: number;
}

export interface LayoutRect extends LayoutPoint, LayoutSize {}

export interface SafeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface CityPanelLayoutInput {
  viewport: LayoutSize;
  anchor: LayoutPoint | null;
  battleSize: LayoutSize;
  infoSize: LayoutSize;
  safeInsets?: Partial<SafeInsets>;
  reservedRects?: LayoutRect[];
}

export interface CityPanelLayout {
  mode: "split" | "stacked";
  density: "full" | "compact";
  battleRect: LayoutRect;
  infoRect: LayoutRect;
  connectorsVisible: boolean;
}

const DEFAULT_INSET = 18;
const CORE_CLEARANCE = 38;
const STACK_GAP = 14;
const SPLIT_MIN_VIEWPORT_WIDTH = 980;
const FULL_DESKTOP_MIN_WIDTH = 1180;
const FULL_DESKTOP_MIN_HEIGHT = 680;
const FULL_DESKTOP_MIN_SAFE_HEIGHT = 600;
const PANEL_WIDTH_POLICY = {
  battle: { minimum: 540, preferred: 680, maximum: 760 },
  info: { minimum: 450, preferred: 550, maximum: 620 }
} as const;
const PANEL_HEIGHT_POLICY = {
  full: { minimum: 650, preferred: 680 },
  compact: { minimum: 520, preferred: 580 }
} as const;

export function resolveCityPanelLayout(input: CityPanelLayoutInput): CityPanelLayout {
  const viewport = normalizeSize(input.viewport, { width: 1280, height: 720 });
  const insets = normalizeInsets(input.safeInsets);
  const safe = safeRect(viewport, insets);
  const splitDensity: CityPanelLayout["density"] = isReadableDesktopSplit(viewport, safe) ? "full" : "compact";
  const anchor = validPoint(input.anchor) ? input.anchor : null;
  const battleSize = preferredPanelSize(input.battleSize, "battle", safe, splitDensity);
  const infoSize = preferredPanelSize(input.infoSize, "info", safe, splitDensity);
  const reservedRects = (input.reservedRects ?? []).filter(validRect);

  if (anchor && viewport.width >= SPLIT_MIN_VIEWPORT_WIDTH && pointInside(anchor, safe)) {
    const leftSpace = anchor.x - CORE_CLEARANCE - safe.x;
    const rightSpace = safe.x + safe.width - anchor.x - CORE_CLEARANCE;
    if (leftSpace >= 320 && rightSpace >= 320) {
      const splitBattleSize = { ...battleSize, width: Math.min(battleSize.width, leftSpace) };
      const splitInfoSize = { ...infoSize, width: Math.min(infoSize.width, rightSpace) };
      const splitTop = splitDensity === "compact" ? safe.y : null;
      const battleRect = clampRect({
        x: anchor.x - CORE_CLEARANCE - splitBattleSize.width,
        y: splitTop ?? anchor.y - splitBattleSize.height / 2,
        ...splitBattleSize
      }, safe);
      const infoRect = clampRect({
        x: anchor.x + CORE_CLEARANCE,
        y: splitTop ?? anchor.y - splitInfoSize.height / 2,
        ...splitInfoSize
      }, safe);
      const core = coreRect(anchor);
      const hasCollision = intersects(battleRect, infoRect)
        || intersects(battleRect, core)
        || intersects(infoRect, core)
        || reservedRects.some((rect) => intersects(rect, battleRect) || intersects(rect, infoRect));
      if (!hasCollision) {
        return { mode: "split", density: splitDensity, battleRect, infoRect, connectorsVisible: true };
      }
    }
  }

  const stacked = resolveStacked(safe, anchor, battleSize, infoSize, reservedRects);
  const stackedDensity: CityPanelLayout["density"] = safe.height >= battleSize.height + infoSize.height + STACK_GAP
    ? splitDensity
    : "compact";
  return { mode: "stacked", density: stackedDensity, ...stacked, connectorsVisible: false };
}

function isReadableDesktopSplit(viewport: LayoutSize, safe: LayoutRect) {
  return viewport.width >= FULL_DESKTOP_MIN_WIDTH
    && viewport.height >= FULL_DESKTOP_MIN_HEIGHT
    && safe.height >= FULL_DESKTOP_MIN_SAFE_HEIGHT;
}

function resolveStacked(
  safe: LayoutRect,
  anchor: LayoutPoint | null,
  battleSize: LayoutSize,
  infoSize: LayoutSize,
  reservedRects: LayoutRect[]
): Pick<CityPanelLayout, "battleRect" | "infoRect"> {
  const core = anchor && pointInside(anchor, safe) ? coreRect(anchor) : null;
  const maxPanelWidth = Math.min(safe.width, Math.max(battleSize.width, infoSize.width));
  const sideCandidates = core ? [
    { x: safe.x, width: Math.max(0, core.x - safe.x) },
    { x: core.x + core.width, width: Math.max(0, safe.x + safe.width - core.x - core.width) }
  ].sort((a, b) => b.width - a.width) : [];

  const candidates: Array<{ x: number; y: number; width: number }> = [];
  for (const side of sideCandidates) {
    if (side.width >= 280) {
      const width = Math.min(maxPanelWidth, side.width);
      candidates.push({ x: side.x + (side.width - width) / 2, y: safe.y, width });
    }
  }
  candidates.push(
    { x: safe.x + (safe.width - maxPanelWidth) / 2, y: safe.y, width: maxPanelWidth },
    { x: safe.x, y: safe.y, width: maxPanelWidth },
    { x: safe.x + safe.width - maxPanelWidth, y: safe.y, width: maxPanelWidth }
  );

  for (const candidate of candidates) {
    const rects = makeStack(candidate, safe, battleSize, infoSize);
    if ((!core || (!intersects(rects.battleRect, core) && !intersects(rects.infoRect, core)))
      && !reservedRects.some((rect) => intersects(rect, rects.battleRect) || intersects(rect, rects.infoRect))) {
      return rects;
    }
  }

  // A fully occupied safe area has no perfect placement. Keep the cards valid,
  // ordered and mutually exclusive; the caller can still render a useful compact pair.
  return makeStack(candidates[0], safe, battleSize, infoSize);
}

function makeStack(
  candidate: { x: number; y: number; width: number },
  safe: LayoutRect,
  battleSize: LayoutSize,
  infoSize: LayoutSize
): Pick<CityPanelLayout, "battleRect" | "infoRect"> {
  const availableHeight = Math.max(2, safe.height - STACK_GAP);
  const requestedHeight = Math.max(2, battleSize.height + infoSize.height);
  const battleShare = battleSize.height / requestedHeight;
  const battleHeight = Math.min(battleSize.height, Math.max(1, availableHeight * battleShare));
  const infoHeight = Math.min(infoSize.height, Math.max(1, availableHeight - battleHeight));
  const groupHeight = battleHeight + STACK_GAP + infoHeight;
  const y = clamp(candidate.y + (safe.height - groupHeight) / 2, safe.y, safe.y + safe.height - groupHeight);
  const battleWidth = Math.min(candidate.width, battleSize.width);
  const infoWidth = Math.min(candidate.width, infoSize.width);
  const battleRect = {
    x: clamp(candidate.x + (candidate.width - battleWidth) / 2, safe.x, safe.x + safe.width - battleWidth),
    y,
    width: battleWidth,
    height: battleHeight
  };
  const infoRect = {
    x: clamp(candidate.x + (candidate.width - infoWidth) / 2, safe.x, safe.x + safe.width - infoWidth),
    y: y + battleHeight + STACK_GAP,
    width: infoWidth,
    height: infoHeight
  };
  return { battleRect, infoRect };
}

function preferredPanelSize(
  size: LayoutSize,
  kind: "battle" | "info",
  safe: LayoutRect,
  density: CityPanelLayout["density"]
): LayoutSize {
  const fallback = kind === "battle" ? { width: 680, height: 680 } : { width: 550, height: 680 };
  const normalized = normalizeSize(size, fallback);
  const widthPolicy = PANEL_WIDTH_POLICY[kind];
  const heightPolicy = PANEL_HEIGHT_POLICY[density];
  return {
    // ResizeObserver reports the last inline layout size. Treat it as content
    // demand, not as a reason to keep a previously squeezed card forever.
    width: Math.min(
      safe.width,
      clamp(Math.max(normalized.width, widthPolicy.preferred), widthPolicy.minimum, widthPolicy.maximum)
    ),
    height: Math.min(
      safe.height,
      Math.max(heightPolicy.minimum, Math.max(normalized.height, heightPolicy.preferred))
    )
  };
}

function safeRect(viewport: LayoutSize, insets: SafeInsets): LayoutRect {
  return {
    x: Math.min(insets.left, viewport.width),
    y: Math.min(insets.top, viewport.height),
    width: Math.max(1, viewport.width - insets.left - insets.right),
    height: Math.max(1, viewport.height - insets.top - insets.bottom)
  };
}

function normalizeInsets(insets: Partial<SafeInsets> | undefined): SafeInsets {
  return {
    top: finiteNonNegative(insets?.top, DEFAULT_INSET),
    right: finiteNonNegative(insets?.right, DEFAULT_INSET),
    bottom: finiteNonNegative(insets?.bottom, DEFAULT_INSET),
    left: finiteNonNegative(insets?.left, DEFAULT_INSET)
  };
}

function normalizeSize(size: LayoutSize, fallback: LayoutSize): LayoutSize {
  return {
    width: finitePositive(size?.width, fallback.width),
    height: finitePositive(size?.height, fallback.height)
  };
}

function coreRect(anchor: LayoutPoint): LayoutRect {
  return { x: anchor.x - CORE_CLEARANCE, y: anchor.y - CORE_CLEARANCE, width: CORE_CLEARANCE * 2, height: CORE_CLEARANCE * 2 };
}

function clampRect(rect: LayoutRect, bounds: LayoutRect): LayoutRect {
  return {
    ...rect,
    x: clamp(rect.x, bounds.x, bounds.x + bounds.width - rect.width),
    y: clamp(rect.y, bounds.y, bounds.y + bounds.height - rect.height)
  };
}

function pointInside(point: LayoutPoint, rect: LayoutRect) {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

function intersects(a: LayoutRect, b: LayoutRect) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function validPoint(point: LayoutPoint | null): point is LayoutPoint {
  return Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y));
}

function validRect(rect: LayoutRect) {
  return validPoint(rect) && Number.isFinite(rect.width) && Number.isFinite(rect.height) && rect.width > 0 && rect.height > 0;
}

function finitePositive(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function finiteNonNegative(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(minimum, value), Math.max(minimum, maximum));
}
