import { inflateRawSync } from "node:zlib";
import type { RegionalObservationPayload, RegionalObservationPoint } from "@/lib/types";

const STATIONS = "https://cwaopendata.s3.ap-northeast-1.amazonaws.com/Observation/O-A0003-001.json";
const BUOYS = "https://cwaopendata.s3.ap-northeast-1.amazonaws.com/Observation/O-B0076-001.json";
const LIGHTNING = "https://cwaopendata.s3.ap-northeast-1.amazonaws.com/Observation/O-A0039-001.kmz";
let cache: { expiresAt: number; payload: RegionalObservationPayload } | null = null;
let inFlight: Promise<RegionalObservationPayload> | null = null;
let lastSuccess: RegionalObservationPayload | null = null;

export async function getRegionalObservations(): Promise<RegionalObservationPayload> {
  if (cache && cache.expiresAt > Date.now()) return cache.payload;
  if (inFlight) return inFlight;
  inFlight = load().then((payload) => {
    if (payload.status === "available" && payload.points.length) lastSuccess = payload;
    else if (lastSuccess) payload = { ...lastSuccess, reason: payload.reason ?? "区域观测刷新失败，保留最后有效资料。" };
    cache = { expiresAt: Date.now() + 5 * 60 * 1000, payload };
    return payload;
  }).finally(() => { inFlight = null; });
  return inFlight;
}

async function load(): Promise<RegionalObservationPayload> {
  const [stations, buoys, lightning] = await Promise.allSettled([fetchJson(STATIONS), fetchJson(BUOYS), fetchBytes(LIGHTNING)]);
  const points: RegionalObservationPoint[] = [];
  if (stations.status === "fulfilled") points.push(...parseStations(stations.value));
  if (buoys.status === "fulfilled") points.push(...parseBuoys(buoys.value));
  if (lightning.status === "fulfilled") points.push(...parseLightning(lightning.value));
  const failures = [stations, buoys, lightning].filter((item) => item.status === "rejected").map((item) => item.status === "rejected" ? String(item.reason) : "");
  return { source: "Taiwan CWA regional observations", updatedAt: new Date().toISOString(), status: points.length ? "available" : "unavailable", attribution: "台湾中央气象署测站、海象站与闪电定位公开资料", reason: failures.length ? failures.join(" | ") : undefined, points };
}

async function fetchJson(url: string) {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<Record<string, unknown>>;
}

async function fetchBytes(url: string) {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

function parseStations(raw: Record<string, unknown>) {
  const root = raw as any;
  const stations = root.cwaopendata?.dataset?.Station;
  if (!Array.isArray(stations)) return [];
  return stations.flatMap((item: any) => {
    const coordinates = Array.isArray(item.GeoInfo?.Coordinates) ? item.GeoInfo.Coordinates : [];
    const coordinate = coordinates.find((entry: any) => entry.CoordinateName === "WGS84") ?? coordinates[0];
    const lon = number(coordinate?.StationLongitude); const lat = number(coordinate?.StationLatitude);
    if (lon === null || lat === null) return [];
    const weather = item.WeatherElement ?? {};
    return [{ id: `station-${item.StationId}`, kind: "station" as const, name: item.StationName ?? item.StationId, lon, lat, observedAt: item.ObsTime?.DateTime, windSpeed: number(weather.WindSpeed) ?? undefined, gustSpeed: number(weather.GustInfo?.PeakGustSpeed) ?? undefined, pressureHpa: number(weather.AirPressure) ?? undefined, rainMm: number(weather.Now?.Precipitation) ?? undefined, temperatureC: number(weather.AirTemperature) ?? undefined }];
  });
}

function parseBuoys(raw: Record<string, unknown>) {
  const root = raw as any;
  const locations = root.cwaopendata?.Resources?.Resource?.Data?.SeaSurfaceObs?.Location;
  const entries = Array.isArray(locations) ? locations : locations ? [locations] : [];
  return entries.flatMap((entry: any) => {
    const station = entry.Station ?? {};
    const attribute = String(station.StationAttributeEN ?? "");
    if (!/Buoy|Wave Station/i.test(attribute) || entry.StationObsStatus?.StationStatus !== "1") return [];
    const lon = number(station.StationLongitude); const lat = number(station.StationLatitude);
    return lon === null || lat === null ? [] : [{ id: `buoy-${station.StationID}`, kind: "buoy" as const, name: station.StationName ?? station.StationNameEN ?? station.StationID, lon, lat }];
  });
}

function parseLightning(bytes: Uint8Array) {
  if (bytes.length < 30 || readU32(bytes, 0) !== 0x04034b50) return [];
  const method = readU16(bytes, 8); const compressedSize = readU32(bytes, 18); const nameLength = readU16(bytes, 26); const extraLength = readU16(bytes, 28);
  const start = 30 + nameLength + extraLength;
  const compressed = bytes.slice(start, start + compressedSize);
  const text = new TextDecoder().decode(method === 8 ? inflateRawSync(compressed) : compressed);
  const points: RegionalObservationPoint[] = [];
  const pattern = /<Placemark>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<coordinates>\s*([\d.-]+),([\d.-]+)/g;
  for (const match of text.matchAll(pattern)) points.push({ id: `lightning-${points.length}-${match[2]}-${match[3]}`, kind: "lightning", name: match[1].replace(/<[^>]+>/g, ""), lon: Number(match[2]), lat: Number(match[3]) });
  return points;
}

function number(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) && parsed > -900 ? parsed : null; }
function readU16(bytes: Uint8Array, offset: number) { return bytes[offset] | (bytes[offset + 1] << 8); }
function readU32(bytes: Uint8Array, offset: number) { return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0; }
