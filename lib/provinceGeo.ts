import chinaProvinces from "@/public/data/china-provinces-full.json";
import type { FeatureCollection, Geometry, Polygon } from "geojson";

export interface ProvinceFeatureProperties {
  adcode?: number;
  name: string;
  center?: [number, number];
  centroid?: [number, number];
  [key: string]: unknown;
}

export interface ProvinceReferencePoint {
  name: string;
  shortName: string;
  center: [number, number];
}

const COASTAL_PROVINCES = new Set([
  "辽宁",
  "河北",
  "天津",
  "山东",
  "江苏",
  "上海",
  "浙江",
  "福建",
  "台湾",
  "广东",
  "香港",
  "澳门",
  "广西",
  "海南"
]);

export const provinceGeoJson = chinaProvinces as unknown as FeatureCollection<Geometry, ProvinceFeatureProperties>;

export function normalizeProvinceName(name: string) {
  return name
    .replace(/特别行政区|壮族自治区|回族自治区|维吾尔自治区|自治区|省|市/g, "")
    .trim();
}

export function getProvinceReferencePoints({ coastalOnly = false }: { coastalOnly?: boolean } = {}): ProvinceReferencePoint[] {
  return provinceGeoJson.features
    .map((feature) => {
      const center = readCenter(feature.properties);
      if (!center) return null;
      const shortName = normalizeProvinceName(feature.properties.name);
      if (coastalOnly && !COASTAL_PROVINCES.has(shortName)) return null;
      return {
        name: feature.properties.name,
        shortName,
        center
      };
    })
    .filter((item): item is ProvinceReferencePoint => Boolean(item));
}

export function findProvinceReferencePoint(name: string): ProvinceReferencePoint | null {
  const normalized = normalizeProvinceName(name);
  return getProvinceReferencePoints().find((item) => item.shortName === normalized || item.name === name) ?? null;
}

export function findProvinceAtCoordinate(
  coordinate: { lon: number; lat: number },
  { coastalOnly = false }: { coastalOnly?: boolean } = {}
): ProvinceReferencePoint | null {
  for (const feature of provinceGeoJson.features) {
    const shortName = normalizeProvinceName(feature.properties.name);
    if (coastalOnly && !COASTAL_PROVINCES.has(shortName)) continue;
    if (!geometryContainsPoint(feature.geometry, [coordinate.lon, coordinate.lat])) continue;
    const center = readCenter(feature.properties) ?? [coordinate.lon, coordinate.lat];
    return { name: feature.properties.name, shortName, center };
  }
  return null;
}

export function provinceContainsCoordinate(name: string, coordinate: { lon: number; lat: number }) {
  const normalized = normalizeProvinceName(name);
  const feature = provinceGeoJson.features.find((item) => {
    const shortName = normalizeProvinceName(item.properties.name);
    return shortName === normalized || item.properties.name === name;
  });
  return feature ? geometryContainsPoint(feature.geometry, [coordinate.lon, coordinate.lat]) : false;
}

export function getProvinceSampleCoordinates(name: string, maxPoints = 7): Array<{ lon: number; lat: number }> {
  const normalized = normalizeProvinceName(name);
  const feature = provinceGeoJson.features.find((item) => {
    const shortName = normalizeProvinceName(item.properties.name);
    return shortName === normalized || item.properties.name === name;
  });
  if (!feature) return [];

  const coordinates = geometryCoordinates(feature.geometry);
  if (coordinates.length === 0) return [];
  const west = Math.min(...coordinates.map(([lon]) => lon));
  const east = Math.max(...coordinates.map(([lon]) => lon));
  const south = Math.min(...coordinates.map(([, lat]) => lat));
  const north = Math.max(...coordinates.map(([, lat]) => lat));
  const candidates: Array<{ lon: number; lat: number }> = [];

  for (let row = 0; row < 5; row += 1) {
    for (let column = 0; column < 5; column += 1) {
      const point = {
        lon: west + ((east - west) * (column + 0.5)) / 5,
        lat: south + ((north - south) * (row + 0.5)) / 5
      };
      if (geometryContainsPoint(feature.geometry, [point.lon, point.lat])) candidates.push(point);
    }
  }

  const center = readCenter(feature.properties);
  if (center && geometryContainsPoint(feature.geometry, center)) {
    candidates.unshift({ lon: center[0], lat: center[1] });
  }
  if (candidates.length <= maxPoints) return candidates;
  return Array.from({ length: maxPoints }, (_, index) => candidates[Math.round(index * (candidates.length - 1) / (maxPoints - 1))]);
}

function geometryCoordinates(geometry: Geometry): [number, number][] {
  const positions = geometry.type === "Polygon"
    ? geometry.coordinates.flat()
    : geometry.type === "MultiPolygon"
      ? geometry.coordinates.flat(2)
      : [];
  return positions
    .map((position) => [Number(position[0]), Number(position[1])] as [number, number])
    .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));
}

function geometryContainsPoint(geometry: Geometry, point: [number, number]) {
  if (geometry.type === "Polygon") return polygonContainsPoint(geometry, point);
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.some((coordinates) =>
      polygonContainsPoint({ type: "Polygon", coordinates }, point)
    );
  }
  return false;
}

function polygonContainsPoint(polygon: Polygon, point: [number, number]) {
  const [outer, ...holes] = polygon.coordinates;
  return Boolean(outer && ringContainsPoint(outer, point) && !holes.some((ring) => ringContainsPoint(ring, point)));
}

function ringContainsPoint(ring: Polygon["coordinates"][number], [x, y]: [number, number]) {
  let inside = false;
  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current, current += 1) {
    const [currentX, currentY] = ring[current];
    const [previousX, previousY] = ring[previous];
    const crosses = currentY > y !== previousY > y;
    if (!crosses) continue;
    const intersectionX = ((previousX - currentX) * (y - currentY)) / (previousY - currentY) + currentX;
    if (x < intersectionX) inside = !inside;
  }
  return inside;
}

function readCenter(properties: ProvinceFeatureProperties): [number, number] | null {
  const center = properties.center ?? properties.centroid;
  if (!Array.isArray(center) || center.length !== 2) return null;
  const lon = Number(center[0]);
  const lat = Number(center[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return [lon, lat];
}

export function makeCircle(lon: number, lat: number, radiusKm: number, points = 128) {
  const coordinates: [number, number][] = [];
  const latRadius = radiusKm / 111;
  const lonRadius = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= points; i += 1) {
    const angle = (i / points) * Math.PI * 2;
    coordinates.push([lon + Math.cos(angle) * lonRadius, lat + Math.sin(angle) * latRadius]);
  }
  return {
    type: "Feature" as const,
    properties: {},
    geometry: {
      type: "Polygon" as const,
      coordinates: [coordinates]
    }
  };
}
