import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { makeCircle } from "@/lib/provinceGeo";
import { getCurrentStorms } from "@/lib/realTyphoonData";
import type {
  ImpactAreaPayload,
  SatelliteLayerPayload,
  Storm,
  WindFieldPayload,
  WindFieldPoint
} from "@/lib/types";

const JMA_BASE_URL = "https://www.data.jma.go.jp/mscweb/data/himawari";
const JMA_REGION = {
  id: "teasia",
  label: "Himawari Tropical Southeast Asia RGB",
  product: "rgb",
  bounds: {
    west: 90,
    south: -10,
    east: 150,
    north: 35
  }
};
const NOAA_HIMAWARI_IMAGE_URL = "https://www.ospo.noaa.gov/jma/teasia/rgb.jpg";
const JMA_ATTRIBUTION = "NOAA OSPO / JMA Himawari Tropical Southeast Asia RGB";
const OPEN_METEO_SOURCE = "Open-Meteo Forecast API";
const OPEN_METEO_ATTRIBUTION = "Open-Meteo weather forecast model blend";
const IMPACT_SOURCE = "浙江省水利厅台风路径公开接口风圈半径";
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0"
};
const execFileAsync = promisify(execFile);

interface OpenMeteoLocation {
  latitude: number;
  longitude: number;
  generationtime_ms?: number;
  hourly?: {
    time?: string[];
    wind_speed_10m?: number[];
    wind_direction_10m?: number[];
  };
}

export function noStoreHeaders() {
  return NO_STORE_HEADERS;
}

export async function getSatelliteLayer(): Promise<SatelliteLayerPayload> {
  const slot = latestJmaSlot();
  const imageUrl = `/api/environment/satellite-image?region=${JMA_REGION.id}&product=${JMA_REGION.product}&time=${slot.key}`;

  return {
    source: "NOAA OSPO Himawari Real-Time Image",
    updatedAt: slot.iso,
    status: "available",
    attribution: JMA_ATTRIBUTION,
    imageUrl,
    remoteImageUrl: NOAA_HIMAWARI_IMAGE_URL,
    product: JMA_REGION.label,
    isStale: Date.now() - new Date(slot.iso).getTime() > 60 * 60 * 1000,
    bounds: JMA_REGION.bounds
  };
}

export async function fetchJmaImage(region: string, product: string, time: string): Promise<Response> {
  if (region !== JMA_REGION.id || !/^[a-z0-9]{3,4}$/.test(product) || !/^\d{4}$/.test(time)) {
    return new Response("Invalid Himawari image request", { status: 400 });
  }

  if (region === "teasia" && product === "rgb") {
    const image = await fetchNoaaImageWithPowershell();
    return new Response(image, {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "no-store, max-age=0",
        "X-Remote-Source": NOAA_HIMAWARI_IMAGE_URL
      }
    });
  }

  const remoteUrl = jmaRemoteImageUrl(time, product, region);
  const response = await fetch(remoteUrl, {
    headers: {
      Accept: "image/jpeg,image/*"
    },
    cache: "no-store"
  });

  if (!response.ok || !response.body) {
    return new Response("Himawari image unavailable", { status: 502 });
  }

  return new Response(response.body, {
    status: 200,
    headers: {
      "Content-Type": response.headers.get("Content-Type") ?? "image/jpeg",
      "Cache-Control": "no-store, max-age=0",
      "X-Remote-Source": remoteUrl
    }
  });
}

async function fetchNoaaImageWithPowershell() {
  const script = [
    "$ProgressPreference='SilentlyContinue'",
    `$bytes=(Invoke-WebRequest -UseBasicParsing '${NOAA_HIMAWARI_IMAGE_URL}').Content`,
    "[Console]::Out.Write([Convert]::ToBase64String($bytes))"
  ].join("; ");
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script], {
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true
      });
      return Uint8Array.from(Buffer.from(stdout.trim(), "base64"));
    } catch (error) {
      lastError = error;
      await delay(400 + attempt * 700);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("NOAA Himawari image request failed.");
}

export async function getImpactArea(stormId?: string | null): Promise<ImpactAreaPayload> {
  try {
    const storms = await getCurrentStorms();
    const storm = storms.find((item) => item.id === stormId) ?? storms[0] ?? null;
    if (!storm) {
      return emptyImpact("当前没有活跃台风，影响区为空。");
    }

    const features = [
      impactFeature(storm, "r7", storm.windRadiiKm.r7),
      impactFeature(storm, "r10", storm.windRadiiKm.r10),
      impactFeature(storm, "r12", storm.windRadiiKm.r12)
    ].filter((feature): feature is GeoJSON.Feature => Boolean(feature));

    return {
      source: IMPACT_SOURCE,
      updatedAt: storm.updatedAt || new Date().toISOString(),
      status: features.length > 0 ? "available" : "unavailable",
      attribution: "浙江省水利厅公开台风路径资料",
      reason: features.length > 0 ? undefined : "当前台风资料没有可用的 7/10/12 级风圈半径。",
      stormId: storm.id,
      stormName: storm.nameZh,
      featureCount: features.length,
      areas: {
        type: "FeatureCollection",
        features
      }
    };
  } catch (error) {
    return emptyImpact(error instanceof Error ? error.message : "影响区数据暂时不可用。");
  }
}

export async function getWindField(stormId?: string | null): Promise<WindFieldPayload> {
  const storms = await getCurrentStorms().catch(() => []);
  const storm = storms.find((item) => item.id === stormId) ?? storms[0] ?? null;
  const samplePoints = buildWindSampleGrid(storm);

  try {
    const locations: OpenMeteoLocation[] = [];
    for (const points of chunk(samplePoints, 8)) {
      const latitude = points.map((point) => point.lat.toFixed(2)).join(",");
      const longitude = points.map((point) => point.lon.toFixed(2)).join(",");
      const query = new URLSearchParams({
        latitude,
        longitude,
        hourly: "wind_speed_10m,wind_direction_10m",
        forecast_hours: "1",
        timezone: "UTC",
        wind_speed_unit: "ms"
      });
      const response = await fetchOpenMeteoWithRetry(query);
      if (!response.ok) throw new Error(`Open-Meteo wind request failed: ${response.status}`);
      const raw = (await response.json()) as OpenMeteoLocation | OpenMeteoLocation[];
      locations.push(...(Array.isArray(raw) ? raw : [raw]));
    }
    const points = locations.map(convertWindPoint).filter((point): point is WindFieldPoint => Boolean(point));
    if (points.length < 80) throw new Error(`Open-Meteo returned only ${points.length} usable wind samples.`);

    return {
      source: OPEN_METEO_SOURCE,
      updatedAt: locations[0]?.hourly?.time?.[0] ?? new Date().toISOString(),
      status: "available",
      attribution: OPEN_METEO_ATTRIBUTION,
      model: "Open-Meteo best match, 10m wind",
      unit: "m/s",
      points
    };
  } catch (error) {
    return {
      source: OPEN_METEO_SOURCE,
      updatedAt: new Date().toISOString(),
      status: "unavailable",
      attribution: OPEN_METEO_ATTRIBUTION,
      reason: error instanceof Error ? error.message : "风场接口暂时不可用。",
      model: "Open-Meteo best match, 10m wind",
      unit: "m/s",
      points: []
    };
  }
}

async function fetchOpenMeteo(query: URLSearchParams) {
  const path = `/v1/forecast?${query.toString()}`;
  const init: RequestInit = {
    headers: {
      Accept: "application/json",
      "User-Agent": "TyphoonBossRadar/1.0"
    },
    cache: "no-store"
  };

  try {
    return await fetch(`http://api.open-meteo.com${path}`, init);
  } catch {
    return fetch(`https://api.open-meteo.com${path}`, init);
  }
}

async function fetchOpenMeteoWithRetry(query: URLSearchParams) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetchOpenMeteo(query);
      if (response.ok || attempt === 2) return response;
    } catch (error) {
      lastError = error;
    }
    await delay(220 + attempt * 360);
  }
  throw lastError instanceof Error ? lastError : new Error("Open-Meteo wind request failed.");
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

function latestJmaSlot() {
  const date = new Date(Date.now() - 20 * 60 * 1000);
  date.setUTCMinutes(Math.floor(date.getUTCMinutes() / 10) * 10, 0, 0);
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  return {
    key: `${hh}${mm}`,
    iso: date.toISOString()
  };
}

function jmaRemoteImageUrl(time: string, product: string, region: string) {
  return `${JMA_BASE_URL}/img/${region}/${region}_${product}_${time}.jpg`;
}

function impactFeature(storm: Storm, level: "r7" | "r10" | "r12", radiusKm: number) {
  if (!Number.isFinite(radiusKm) || radiusKm <= 0) return null;
  const feature = makeCircle(storm.position.lon, storm.position.lat, radiusKm, 160) as GeoJSON.Feature;
  feature.properties = {
    stormId: storm.id,
    stormName: storm.nameZh,
    radiusLevel: level,
    radiusKm,
    updatedAt: storm.updatedAt
  };
  return feature;
}

function emptyImpact(reason: string): ImpactAreaPayload {
  return {
    source: IMPACT_SOURCE,
    updatedAt: new Date().toISOString(),
    status: "unavailable",
    attribution: "浙江省水利厅公开台风路径资料",
    reason,
    stormId: null,
    stormName: null,
    featureCount: 0,
    areas: {
      type: "FeatureCollection",
      features: []
    }
  };
}

function buildWindSampleGrid(storm: Storm | null) {
  const center = storm?.position ?? { lon: 122.5, lat: 22.5 };
  const west = clamp(center.lon - 9, 105, 132);
  const east = clamp(center.lon + 9, 113, 140);
  const south = clamp(center.lat - 7, 0, 23);
  const north = clamp(center.lat + 7, 7, 30);
  const columns = 11;
  const rows = 8;
  const points: Array<{ lon: number; lat: number }> = [];

  for (let row = 0; row < rows; row += 1) {
    const lat = north - ((north - south) * row) / (rows - 1);
    for (let column = 0; column < columns; column += 1) {
      const lon = west + ((east - west) * column) / (columns - 1);
      points.push({ lon, lat });
    }
  }

  return points;
}

function convertWindPoint(location: OpenMeteoLocation): WindFieldPoint | null {
  const speed = location.hourly?.wind_speed_10m?.[0];
  const direction = location.hourly?.wind_direction_10m?.[0];
  if (!Number.isFinite(location.longitude) || !Number.isFinite(location.latitude)) return null;
  if (!Number.isFinite(speed) || !Number.isFinite(direction)) return null;

  const radians = ((direction as number) * Math.PI) / 180;
  const windSpeed = speed as number;
  return {
    lon: location.longitude,
    lat: location.latitude,
    u: -windSpeed * Math.sin(radians),
    v: -windSpeed * Math.cos(radians),
    speed: windSpeed,
    direction: direction as number
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
