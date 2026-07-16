import type { WindRadiiQuadrants } from "@/lib/types";

export const BEIJING_TIME_OFFSET = "+08:00";

export function parseBeijingTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed)
    ? trimmed
    : `${trimmed.replace(" ", "T")}${BEIJING_TIME_OFFSET}`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toBeijingIso(value: string | null | undefined): string | null {
  const parsed = parseBeijingTime(value);
  return parsed === null ? null : new Date(parsed).toISOString();
}

export function windForceFromSpeed(speed: number): string {
  const thresholds = [0.3, 1.6, 3.4, 5.5, 8, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7, 37, 41.5, 46.2, 51, 56.1, 61.3];
  const level = thresholds.findIndex((threshold) => speed < threshold);
  return level === -1 ? "17+" : String(level);
}

export function distanceBetweenKm(a: { lon: number; lat: number }, b: { lon: number; lat: number }) {
  const earthRadiusKm = 6_371;
  const lat1 = degreesToRadians(a.lat);
  const lat2 = degreesToRadians(b.lat);
  const deltaLat = lat2 - lat1;
  const deltaLon = degreesToRadians(b.lon - a.lon);
  const h = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

export function distanceToPathKm(point: { lon: number; lat: number }, path: Array<{ lon: number; lat: number }>) {
  if (path.length === 0) return null;
  if (path.length === 1) return distanceBetweenKm(point, path[0]);
  let closest = Number.POSITIVE_INFINITY;
  for (let index = 1; index < path.length; index += 1) {
    closest = Math.min(closest, distanceToSegmentKm(point, path[index - 1], path[index]));
  }
  return Number.isFinite(closest) ? closest : null;
}

export function parseWindRadii(value?: string | null): WindRadiiQuadrants {
  const values = String(value ?? "")
    .split("|")
    .map(Number)
    .map((item) => Number.isFinite(item) && item > 0 ? item : 0);
  return { ne: values[0] ?? 0, se: values[1] ?? 0, sw: values[2] ?? 0, nw: values[3] ?? 0 };
}

export function maxWindRadius(quadrants: WindRadiiQuadrants) {
  return Math.max(quadrants.ne, quadrants.se, quadrants.sw, quadrants.nw);
}

export function makeQuadrantWindPolygon(
  center: { lon: number; lat: number },
  quadrants: WindRadiiQuadrants,
  points = 160
) {
  if (maxWindRadius(quadrants) <= 0) return null;
  const coordinates: [number, number][] = [];
  for (let index = 0; index <= points; index += 1) {
    const bearing = (index / points) * 360;
    const radiusKm = radiusForBearing(quadrants, bearing);
    coordinates.push(destinationPoint(center, bearing, radiusKm));
  }
  return {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "Polygon" as const, coordinates: [coordinates] }
  };
}

function radiusForBearing(quadrants: WindRadiiQuadrants, bearing: number) {
  if (bearing < 90) return quadrants.ne;
  if (bearing < 180) return quadrants.se;
  if (bearing < 270) return quadrants.sw;
  return quadrants.nw;
}

function destinationPoint(center: { lon: number; lat: number }, bearing: number, distanceKm: number): [number, number] {
  if (distanceKm <= 0) return [center.lon, center.lat];
  const angularDistance = distanceKm / 6_371;
  const theta = degreesToRadians(bearing);
  const lat1 = degreesToRadians(center.lat);
  const lon1 = degreesToRadians(center.lon);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angularDistance) + Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(theta));
  const lon2 = lon1 + Math.atan2(Math.sin(theta) * Math.sin(angularDistance) * Math.cos(lat1), Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2));
  return [radiansToDegrees(lon2), radiansToDegrees(lat2)];
}

function distanceToSegmentKm(point: { lon: number; lat: number }, start: { lon: number; lat: number }, end: { lon: number; lat: number }) {
  const referenceLat = degreesToRadians((start.lat + end.lat + point.lat) / 3);
  const scaleX = 111.32 * Math.max(0.1, Math.cos(referenceLat));
  const scaleY = 110.57;
  const ax = start.lon * scaleX;
  const ay = start.lat * scaleY;
  const bx = end.lon * scaleX;
  const by = end.lat * scaleY;
  const px = point.lon * scaleX;
  const py = point.lat * scaleY;
  const lengthSquared = (bx - ax) ** 2 + (by - ay) ** 2;
  const projection = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / lengthSquared));
  return Math.hypot(px - (ax + projection * (bx - ax)), py - (ay + projection * (by - ay)));
}

function degreesToRadians(value: number) { return value * Math.PI / 180; }
function radiansToDegrees(value: number) { return value * 180 / Math.PI; }
