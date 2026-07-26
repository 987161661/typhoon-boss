import type { WindFieldPayload, WindFieldPoint } from "@/lib/types";

export function normalizeWindDirection(direction: number) {
  return ((direction % 360) + 360) % 360;
}

export interface WindVectorSample {
  u: number;
  v: number;
}

/** Move a coherent model frame without changing its U/V values or grid shape. */
export function translateWindVectorPoints(
  points: WindFieldPoint[],
  translation: { lon: number; lat: number } | null
) {
  if (!translation || (translation.lon === 0 && translation.lat === 0)) return points;
  return points.map((point) => ({
    ...point,
    lon: point.lon + translation.lon,
    lat: point.lat + translation.lat
  }));
}

interface WindVectorIndex {
  points: WindFieldPoint[];
  longitudes: number[];
  latitudes: number[];
  grid: Map<string, WindFieldPoint>;
  width: number;
  height: number;
  west: number;
  east: number;
  south: number;
  north: number;
  longitudeStep: number;
  latitudeStep: number;
  u: Float32Array;
  v: Float32Array;
  regular: boolean;
}

export interface CompositeWindVectorIndex {
  ambient: WindVectorIndex;
  detail: WindVectorIndex | null;
}

/** Only blend grids that describe the same model analysis and selected storm. */
export function windFieldsShareFrame(
  ambient: WindFieldPayload | null,
  detail: WindFieldPayload | null
) {
  return Boolean(
    ambient?.status === "available" &&
    detail?.status === "available" &&
    ambient.source === detail.source &&
    ambient.model === detail.model &&
    ambient.updatedAt === detail.updatedAt &&
    ambient.cycle === detail.cycle &&
    (ambient.stormId ?? null) === (detail.stormId ?? null)
  );
}

export function createCompositeWindVectorIndex(
  ambientPoints: WindFieldPoint[],
  detailPoints: WindFieldPoint[] = []
): CompositeWindVectorIndex {
  return {
    ambient: createWindVectorIndex(ambientPoints),
    detail: detailPoints.length > 0 ? createWindVectorIndex(detailPoints) : null
  };
}

export function sampleCompositeWindVector(
  index: CompositeWindVectorIndex,
  lon: number,
  lat: number,
  sample: WindVectorSample
) {
  const detail = index.detail;
  if (detail && containsIndexPoint(detail, lon, lat) && sampleWindVector(detail, lon, lat, sample)) {
    const detailU = sample.u;
    const detailV = sample.v;
    const blendWidth = Math.max(detail.longitudeStep, detail.latitudeStep);
    const edgeDistance = Math.min(lon - detail.west, detail.east - lon, lat - detail.south, detail.north - lat);
    const detailWeight = smoothStep(0, blendWidth, edgeDistance);
    if (detailWeight >= 0.999 || !sampleWindVector(index.ambient, lon, lat, sample)) return true;
    sample.u = sample.u * (1 - detailWeight) + detailU * detailWeight;
    sample.v = sample.v * (1 - detailWeight) + detailV * detailWeight;
    return true;
  }
  return sampleWindVector(index.ambient, lon, lat, sample);
}

/** Replace coarse points inside the detail footprint so wind barbs do not draw twice. */
export function mergeWindVectorPoints(ambientPoints: WindFieldPoint[], detailPoints: WindFieldPoint[]) {
  if (detailPoints.length === 0) return ambientPoints;
  const detail = createWindVectorIndex(detailPoints);
  return [
    ...ambientPoints.filter((point) => !containsIndexPoint(detail, point.lon, point.lat)),
    ...detailPoints
  ];
}

function createWindVectorIndex(points: WindFieldPoint[]): WindVectorIndex {
  const longitudes = [...new Set(points.map((point) => point.lon))].sort((left, right) => left - right);
  const latitudes = [...new Set(points.map((point) => point.lat))].sort((left, right) => left - right);
  const grid = new Map(points.map((point) => [windGridKey(point.lon, point.lat), point]));
  const width = longitudes.length;
  const height = latitudes.length;
  const west = longitudes[0] ?? 0;
  const east = longitudes.at(-1) ?? 0;
  const south = latitudes[0] ?? 0;
  const north = latitudes.at(-1) ?? 0;
  const longitudeStep = width > 1 ? (east - west) / (width - 1) : 0;
  const latitudeStep = height > 1 ? (north - south) / (height - 1) : 0;
  const regular = width > 1 && height > 1 && longitudeStep > 0 && latitudeStep > 0 && width * height <= points.length * 1.08;
  const u = new Float32Array(width * height);
  const v = new Float32Array(width * height);
  u.fill(Number.NaN);
  v.fill(Number.NaN);
  if (regular) {
    points.forEach((point) => {
      const x = Math.round((point.lon - west) / longitudeStep);
      const y = Math.round((point.lat - south) / latitudeStep);
      if (x < 0 || x >= width || y < 0 || y >= height) return;
      const offset = y * width + x;
      u[offset] = point.u;
      v[offset] = point.v;
    });
  }
  return { points, longitudes, latitudes, grid, width, height, west, east, south, north, longitudeStep, latitudeStep, u, v, regular };
}

function sampleWindVector(index: WindVectorIndex, lon: number, lat: number, sample: WindVectorSample) {
  if (!index.regular) {
    const vector = bilinearWindVector(index, lon, lat);
    if (!vector) return false;
    sample.u = vector.u;
    sample.v = vector.v;
    return true;
  }
  const gridX = (lon - index.west) / index.longitudeStep;
  const gridY = (lat - index.south) / index.latitudeStep;
  if (gridX < 0 || gridY < 0 || gridX > index.width - 1 || gridY > index.height - 1) return false;
  const x0 = Math.min(index.width - 2, Math.floor(gridX));
  const y0 = Math.min(index.height - 2, Math.floor(gridY));
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const tx = Math.max(0, Math.min(1, gridX - x0));
  const ty = Math.max(0, Math.min(1, gridY - y0));
  const southwest = y0 * index.width + x0;
  const southeast = y0 * index.width + x1;
  const northwest = y1 * index.width + x0;
  const northeast = y1 * index.width + x1;
  const uSouthwest = index.u[southwest];
  const uSoutheast = index.u[southeast];
  const uNorthwest = index.u[northwest];
  const uNortheast = index.u[northeast];
  const vSouthwest = index.v[southwest];
  const vSoutheast = index.v[southeast];
  const vNorthwest = index.v[northwest];
  const vNortheast = index.v[northeast];
  if (
    !Number.isFinite(uSouthwest) || !Number.isFinite(uSoutheast) || !Number.isFinite(uNorthwest) || !Number.isFinite(uNortheast) ||
    !Number.isFinite(vSouthwest) || !Number.isFinite(vSoutheast) || !Number.isFinite(vNorthwest) || !Number.isFinite(vNortheast)
  ) return false;
  sample.u =
    uSouthwest * (1 - tx) * (1 - ty) +
    uSoutheast * tx * (1 - ty) +
    uNorthwest * (1 - tx) * ty +
    uNortheast * tx * ty;
  sample.v =
    vSouthwest * (1 - tx) * (1 - ty) +
    vSoutheast * tx * (1 - ty) +
    vNorthwest * (1 - tx) * ty +
    vNortheast * tx * ty;
  return true;
}

function bilinearWindVector(index: WindVectorIndex, lon: number, lat: number): WindFieldPoint | null {
  const x = gridBracket(index.longitudes, lon);
  const y = gridBracket(index.latitudes, lat);
  if (!x || !y) return null;
  const southwest = index.grid.get(windGridKey(x.lower, y.lower));
  const southeast = index.grid.get(windGridKey(x.upper, y.lower));
  const northwest = index.grid.get(windGridKey(x.lower, y.upper));
  const northeast = index.grid.get(windGridKey(x.upper, y.upper));
  if (!southwest || !southeast || !northwest || !northeast) return null;
  const tx = x.upper === x.lower ? 0 : (lon - x.lower) / (x.upper - x.lower);
  const ty = y.upper === y.lower ? 0 : (lat - y.lower) / (y.upper - y.lower);
  const blend = (field: "u" | "v") =>
    southwest[field] * (1 - tx) * (1 - ty) +
    southeast[field] * tx * (1 - ty) +
    northwest[field] * (1 - tx) * ty +
    northeast[field] * tx * ty;
  const u = blend("u");
  const v = blend("v");
  return {
    lon,
    lat,
    u,
    v,
    speed: Math.hypot(u, v),
    direction: normalizeWindDirection((Math.atan2(-u, -v) * 180) / Math.PI)
  };
}

function containsIndexPoint(index: WindVectorIndex, lon: number, lat: number) {
  return lon >= index.west && lon <= index.east && lat >= index.south && lat <= index.north;
}

function smoothStep(edge0: number, edge1: number, value: number) {
  if (edge1 <= edge0) return value >= edge1 ? 1 : 0;
  const progress = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return progress * progress * (3 - 2 * progress);
}

function gridBracket(values: number[], value: number) {
  if (values.length < 2 || value < values[0] || value > values[values.length - 1]) return null;
  let lowerIndex = 0;
  let upperIndex = values.length - 1;
  while (upperIndex - lowerIndex > 1) {
    const middle = Math.floor((lowerIndex + upperIndex) / 2);
    if (value <= values[middle]) upperIndex = middle;
    else lowerIndex = middle;
  }
  return { lower: values[lowerIndex], upper: values[upperIndex] };
}

function windGridKey(lon: number, lat: number) {
  return `${lon.toFixed(4)}:${lat.toFixed(4)}`;
}
