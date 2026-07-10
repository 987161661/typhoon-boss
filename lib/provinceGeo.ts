import chinaProvinces from "@/public/data/china-provinces-full.json";
import type { FeatureCollection, Geometry } from "geojson";

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
