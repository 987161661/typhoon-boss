export interface ProjectedWindPoint {
  x: number;
  y: number;
}

export interface WindFlowPolicyInput {
  zoom: number;
  viewportWidth: number;
  viewportHeight: number;
  adaptiveQuality: number;
  livePerformanceMode: boolean;
}

export interface WindFlowPolicy {
  zoomSignal: number;
  headSpacingPx: number;
  targetTrailPx: number;
  targetParticleCount: number;
  poolCapacity: number;
  segmentBudget: number;
  historyPointLimit: number;
  minimumSampleDistancePx: number;
}

export interface TrimmedWindTrail {
  points: ProjectedWindPoint[];
  lengthPx: number;
}

const MIN_ZOOM = 3.25;
const MAX_ZOOM = 7.25;

export function computeWindFlowPolicy({
  zoom,
  viewportWidth,
  viewportHeight,
  adaptiveQuality,
  livePerformanceMode
}: WindFlowPolicyInput): WindFlowPolicy {
  const zoomSignal = smoothStep(MIN_ZOOM, MAX_ZOOM, zoom);
  const headSpacingPx = lerp(30, 52, zoomSignal);
  const targetTrailPx = lerp(110, 58, zoomSignal);
  const viewportArea = Math.max(1, viewportWidth) * Math.max(1, viewportHeight);
  const minimumParticles = livePerformanceMode ? 520 : 620;
  const maximumParticles = livePerformanceMode ? 1_320 : 1_600;
  const quality = clamp(adaptiveQuality, 0.35, 1);
  const visualTarget = viewportArea / (headSpacingPx * headSpacingPx);
  const targetParticleCount = clamp(
    Math.round(visualTarget * quality),
    minimumParticles,
    maximumParticles
  );
  const baseSegmentBudget = livePerformanceMode ? 8_000 : 10_000;

  return {
    zoomSignal,
    headSpacingPx,
    targetTrailPx,
    targetParticleCount,
    poolCapacity: Math.ceil(targetParticleCount * 1.25),
    segmentBudget: Math.max(2_400, Math.round(baseSegmentBudget * quality)),
    historyPointLimit: 160,
    minimumSampleDistancePx: 1.25
  };
}

export function trimWindTrailToPixelLength(
  trail: readonly ProjectedWindPoint[],
  head: ProjectedWindPoint | null | undefined,
  maximumLengthPx: number
): TrimmedWindTrail {
  const maximumLength = Math.max(0, maximumLengthPx);
  const endpoint = head ?? trail.at(-1);
  if (!endpoint) return { points: [], lengthPx: 0 };

  const points: ProjectedWindPoint[] = [{ x: endpoint.x, y: endpoint.y }];
  let lengthPx = 0;
  let previous = endpoint;

  for (let index = trail.length - 1; index >= 0; index -= 1) {
    const point = trail[index];
    const segmentLength = Math.hypot(previous.x - point.x, previous.y - point.y);
    if (segmentLength <= 0.0001) continue;
    const remaining = maximumLength - lengthPx;
    if (remaining <= 0) break;
    if (segmentLength > remaining) {
      const ratio = remaining / segmentLength;
      points.push({
        x: previous.x + (point.x - previous.x) * ratio,
        y: previous.y + (point.y - previous.y) * ratio
      });
      lengthPx = maximumLength;
      break;
    }
    points.push({ x: point.x, y: point.y });
    lengthPx += segmentLength;
    previous = point;
  }

  points.reverse();
  return { points, lengthPx };
}

export function smoothStep(edge0: number, edge1: number, value: number) {
  if (edge1 <= edge0) return value >= edge1 ? 1 : 0;
  const progress = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return progress * progress * (3 - 2 * progress);
}

export function windJourneyBudgetKm(targetTrailKm: number, phase: number) {
  const safeTrailKm = Math.max(0, targetTrailKm);
  return Math.max(30, safeTrailKm * lerp(2.2, 4, clamp(phase, 0, 1)));
}

function lerp(start: number, end: number, progress: number) {
  return start + (end - start) * progress;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}
