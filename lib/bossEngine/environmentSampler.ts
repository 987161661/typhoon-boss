import type { Storm } from "@/lib/types";

export type EnvironmentSampleRole = "center" | "r7-edge" | "forecast-corridor";

export interface EnvironmentSample {
  time: string;
  lon: number;
  lat: number;
  role: EnvironmentSampleRole;
  windSpeed10mMps: number | null;
  windGust10mMps: number | null;
  windDirection10mDeg: number | null;
  precipitationMm: number | null;
  relativeHumidityPct: number | null;
  cloudCoverPct: number | null;
  pressureMslHpa: number | null;
  totalColumnWaterVapourKgM2: number | null;
  capeJkg: number | null;
}

export interface EnvironmentFeatures {
  status: "available" | "unavailable";
  source: "Open-Meteo Forecast API";
  attribution: "Open-Meteo weather forecast model blend";
  updatedAt: string;
  sampleCount: number;
  maxTcwvKgM2: number | null;
  meanTcwvKgM2: number | null;
  maxPrecipMm: number | null;
  meanHumidityPct: number | null;
  meanCloudCoverPct: number | null;
  maxCapeJkg: number | null;
  maxWindGustMps: number | null;
  isMoistureLoaded: boolean;
  isRainThreat: boolean;
  isConvective: boolean;
  samples: EnvironmentSample[];
  warnings: string[];
}

interface SamplePoint {
  lon: number;
  lat: number;
  role: EnvironmentSampleRole;
}

interface OpenMeteoLocation {
  latitude: number;
  longitude: number;
  hourly?: {
    time?: string[];
    wind_speed_10m?: Array<number | null>;
    wind_direction_10m?: Array<number | null>;
    wind_gusts_10m?: Array<number | null>;
    precipitation?: Array<number | null>;
    relative_humidity_2m?: Array<number | null>;
    cloud_cover?: Array<number | null>;
    pressure_msl?: Array<number | null>;
    total_column_integrated_water_vapour?: Array<number | null>;
    cape?: Array<number | null>;
  };
}

const OPEN_METEO_SOURCE = "Open-Meteo Forecast API";
const OPEN_METEO_ATTRIBUTION = "Open-Meteo weather forecast model blend";
const OPEN_METEO_VARIABLES = [
  "wind_speed_10m",
  "wind_direction_10m",
  "wind_gusts_10m",
  "precipitation",
  "relative_humidity_2m",
  "cloud_cover",
  "pressure_msl",
  "total_column_integrated_water_vapour",
  "cape"
].join(",");

export async function sampleBossEnvironment(storm: Storm, signal?: AbortSignal): Promise<EnvironmentFeatures> {
  const points = buildSamplePoints(storm);

  try {
    const samples: EnvironmentSample[] = [];
    for (const pointChunk of chunk(points, 8)) {
      const locations = await fetchOpenMeteoLocations(pointChunk, signal);
      samples.push(
        ...locations
          .map((location, index) => convertSample(location, pointChunk[index]))
          .filter((sample): sample is EnvironmentSample => Boolean(sample))
      );
    }

    if (samples.length === 0) {
      return unavailableEnvironment("Open-Meteo did not return usable environment samples.");
    }

    const features = summarizeSamples(samples);
    return {
      ...features,
      status: "available",
      source: OPEN_METEO_SOURCE,
      attribution: OPEN_METEO_ATTRIBUTION,
      updatedAt: samples[0]?.time ?? new Date().toISOString(),
      sampleCount: samples.length,
      samples,
      warnings: samples.length < points.length ? [`环境采样点可用 ${samples.length}/${points.length} 个。`] : []
    };
  } catch (error) {
    return unavailableEnvironment(error instanceof Error ? error.message : "Open-Meteo environment request failed.");
  }
}

function buildSamplePoints(storm: Storm): SamplePoint[] {
  const points: SamplePoint[] = [{ lon: storm.position.lon, lat: storm.position.lat, role: "center" }];
  const radiusKm = clamp(storm.windRadiiKm.r7 || 220, 160, 520);
  const latOffset = radiusKm / 111;
  const lonOffset = radiusKm / Math.max(35, 111 * Math.cos(degToRad(storm.position.lat)));

  points.push(
    { lon: storm.position.lon + lonOffset, lat: storm.position.lat, role: "r7-edge" },
    { lon: storm.position.lon - lonOffset, lat: storm.position.lat, role: "r7-edge" },
    { lon: storm.position.lon, lat: storm.position.lat + latOffset, role: "r7-edge" },
    { lon: storm.position.lon, lat: storm.position.lat - latOffset, role: "r7-edge" }
  );

  for (const forecast of storm.forecast.slice(0, 4)) {
    points.push({ lon: forecast.lon, lat: forecast.lat, role: "forecast-corridor" });
  }

  return dedupePoints(points).slice(0, 9);
}

async function fetchOpenMeteoLocations(points: SamplePoint[], signal?: AbortSignal) {
  const query = new URLSearchParams({
    latitude: points.map((point) => point.lat.toFixed(2)).join(","),
    longitude: points.map((point) => point.lon.toFixed(2)).join(","),
    hourly: OPEN_METEO_VARIABLES,
    forecast_hours: "1",
    timezone: "UTC",
    wind_speed_unit: "ms",
    cell_selection: "sea"
  });
  const response = await fetchOpenMeteoWithRetry(query, signal);
  if (!response.ok) throw new Error(`Open-Meteo environment request failed: ${response.status}`);
  const raw = (await response.json()) as OpenMeteoLocation | OpenMeteoLocation[];
  return Array.isArray(raw) ? raw : [raw];
}

function convertSample(location: OpenMeteoLocation, point?: SamplePoint): EnvironmentSample | null {
  if (!point || !Number.isFinite(location.longitude) || !Number.isFinite(location.latitude)) return null;
  const hourly = location.hourly;
  if (!hourly?.time?.[0]) return null;

  return {
    time: hourly.time[0],
    lon: location.longitude,
    lat: location.latitude,
    role: point.role,
    windSpeed10mMps: finiteOrNull(hourly.wind_speed_10m?.[0]),
    windGust10mMps: finiteOrNull(hourly.wind_gusts_10m?.[0]),
    windDirection10mDeg: finiteOrNull(hourly.wind_direction_10m?.[0]),
    precipitationMm: finiteOrNull(hourly.precipitation?.[0]),
    relativeHumidityPct: finiteOrNull(hourly.relative_humidity_2m?.[0]),
    cloudCoverPct: finiteOrNull(hourly.cloud_cover?.[0]),
    pressureMslHpa: finiteOrNull(hourly.pressure_msl?.[0]),
    totalColumnWaterVapourKgM2: finiteOrNull(hourly.total_column_integrated_water_vapour?.[0]),
    capeJkg: finiteOrNull(hourly.cape?.[0])
  };
}

function summarizeSamples(samples: EnvironmentSample[]) {
  const maxTcwvKgM2 = maxValue(samples.map((sample) => sample.totalColumnWaterVapourKgM2));
  const meanTcwvKgM2 = meanValue(samples.map((sample) => sample.totalColumnWaterVapourKgM2));
  const maxPrecipMm = maxValue(samples.map((sample) => sample.precipitationMm));
  const meanHumidityPct = meanValue(samples.map((sample) => sample.relativeHumidityPct));
  const meanCloudCoverPct = meanValue(samples.map((sample) => sample.cloudCoverPct));
  const maxCapeJkg = maxValue(samples.map((sample) => sample.capeJkg));
  const maxWindGustMps = maxValue(samples.map((sample) => sample.windGust10mMps));

  return {
    maxTcwvKgM2,
    meanTcwvKgM2,
    maxPrecipMm,
    meanHumidityPct,
    meanCloudCoverPct,
    maxCapeJkg,
    maxWindGustMps,
    isMoistureLoaded: (maxTcwvKgM2 ?? 0) >= 60 || ((meanTcwvKgM2 ?? 0) >= 52 && (meanHumidityPct ?? 0) >= 82),
    isRainThreat: (maxPrecipMm ?? 0) >= 3 || ((meanHumidityPct ?? 0) >= 88 && (meanCloudCoverPct ?? 0) >= 70),
    isConvective: (maxCapeJkg ?? 0) >= 1200 && (meanHumidityPct ?? 0) >= 70
  };
}

function unavailableEnvironment(reason: string): EnvironmentFeatures {
  return {
    status: "unavailable",
    source: OPEN_METEO_SOURCE,
    attribution: OPEN_METEO_ATTRIBUTION,
    updatedAt: new Date().toISOString(),
    sampleCount: 0,
    maxTcwvKgM2: null,
    meanTcwvKgM2: null,
    maxPrecipMm: null,
    meanHumidityPct: null,
    meanCloudCoverPct: null,
    maxCapeJkg: null,
    maxWindGustMps: null,
    isMoistureLoaded: false,
    isRainThreat: false,
    isConvective: false,
    samples: [],
    warnings: [reason]
  };
}

async function fetchOpenMeteo(query: URLSearchParams, signal?: AbortSignal) {
  const path = `/v1/forecast?${query.toString()}`;
  const init: RequestInit = {
    headers: {
      Accept: "application/json",
      "User-Agent": "TyphoonBossRadar/1.0"
    },
    cache: "no-store",
    signal
  };

  try {
    return await fetch(`http://api.open-meteo.com${path}`, init);
  } catch {
    return fetch(`https://api.open-meteo.com${path}`, init);
  }
}

async function fetchOpenMeteoWithRetry(query: URLSearchParams, signal?: AbortSignal) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetchOpenMeteo(query, signal);
      if (response.ok || attempt === 2) return response;
    } catch (error) {
      lastError = error;
    }
    await delay(250 + attempt * 450);
  }
  throw lastError instanceof Error ? lastError : new Error("Open-Meteo environment request failed.");
}

function dedupePoints(points: SamplePoint[]) {
  const seen = new Set<string>();
  return points
    .map((point) => ({
      ...point,
      lon: clamp(Number(point.lon.toFixed(2)), -180, 180),
      lat: clamp(Number(point.lat.toFixed(2)), -89, 89)
    }))
    .filter((point) => {
      const key = `${point.lon},${point.lat}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function finiteOrNull(value: number | null | undefined) {
  return Number.isFinite(value) ? (value as number) : null;
}

function maxValue(values: Array<number | null>) {
  const finite = values.filter((value): value is number => Number.isFinite(value));
  return finite.length ? Math.max(...finite) : null;
}

function meanValue(values: Array<number | null>) {
  const finite = values.filter((value): value is number => Number.isFinite(value));
  if (!finite.length) return null;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function degToRad(deg: number) {
  return (deg * Math.PI) / 180;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}
