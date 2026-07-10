import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import { makeCircle } from "@/lib/provinceGeo";
import { getCurrentStorms } from "@/lib/realTyphoonData";
import type {
  ImpactAreaPayload,
  SatelliteLayerPayload,
  Storm,
  WindFieldPayload,
  WindFieldPoint
} from "@/lib/types";

const JMA_REGION = {
  id: "teasia",
  label: "Himawari Tropical Southeast Asia RGB",
  product: "rgb",
  bounds: {
    west: 69.8,
    south: 0,
    east: 150.4,
    north: 40.1
  }
};
const NOAA_HIMAWARI_BASE_URL = "https://www.ospo.noaa.gov/jma/teasia";
const NOAA_HIMAWARI_FRAME_LIST_URL = `${NOAA_HIMAWARI_BASE_URL}/txtfiles/rgb_names.txt`;
const NOAA_GMGSI_BASE_URL = "https://www.ospo.noaa.gov/Visualization01/cData/Atmosphere/Imagery/GMGSI";
const NOAA_GMGSI_PRODUCT = "GMGSI_LW_GIF_C";
const GLOBAL_SATELLITE_BOUNDS = {
  west: -180,
  south: -60,
  east: 180,
  north: 60
};
const JMA_ATTRIBUTION = "NOAA OSPO GMGSI 全球长波红外云图 + JMA/Himawari 东亚 RGB · 30 分钟同步检查";
const OPEN_METEO_SOURCE = "Open-Meteo Forecast API";
const OPEN_METEO_ATTRIBUTION = "Open-Meteo weather forecast model blend";
const SATELLITE_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const SATELLITE_IMAGE_CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const WIND_FIELD_CACHE_TTL_MS = 4 * 60 * 1000;
const IMPACT_SOURCE = "浙江省水利厅台风路径公开接口风圈半径";
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0"
};
const execFileAsync = promisify(execFile);
const satelliteImageCache = new Map<string, { expiresAt: number; bytes: Uint8Array; contentType: string }>();
const windFieldCache = new Map<string, { expiresAt: number; payload: WindFieldPayload }>();
const windFieldInFlight = new Map<string, Promise<WindFieldPayload>>();
let satelliteFrameCache: { slotKey: string; promise: Promise<SynchronizedSatelliteFrames> } | null = null;

interface SatelliteFrame {
  id: string;
  capturedAt: string;
  remoteUrl: string;
}

interface SynchronizedSatelliteFrames {
  regional: SatelliteFrame;
  global: SatelliteFrame;
  synchronizedAt: string;
  skewMinutes: number;
  refreshSlot: string;
}

export interface WindFieldBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

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

export async function getSatelliteLayer(referenceUpdatedAt?: string | null): Promise<SatelliteLayerPayload> {
  const frames = await getSynchronizedSatelliteFrames();
  const imageUrl = `/api/environment/satellite-image?region=${JMA_REGION.id}&product=${JMA_REGION.product}&frame=${encodeURIComponent(frames.regional.id)}`;
  const globalImageUrl = `/api/environment/global-satellite-image?frame=${encodeURIComponent(frames.global.id)}`;
  const oldestFrameAt = Math.min(new Date(frames.regional.capturedAt).getTime(), new Date(frames.global.capturedAt).getTime());
  const referenceAt = parseReferenceTime(referenceUpdatedAt);
  const synchronizedAt = new Date(frames.synchronizedAt).getTime();

  return {
    source: "NOAA OSPO synchronized geostationary satellite imagery",
    updatedAt: frames.regional.capturedAt,
    status: "available",
    attribution: JMA_ATTRIBUTION,
    imageUrl,
    remoteImageUrl: frames.regional.remoteUrl,
    product: JMA_REGION.label,
    globalTileUrl: null,
    globalImageUrl,
    globalProduct: "NOAA OSPO GMGSI Global Longwave Infrared Cloud Mosaic",
    globalUpdatedAt: frames.global.capturedAt,
    globalBounds: GLOBAL_SATELLITE_BOUNDS,
    synchronizedAt: frames.synchronizedAt,
    synchronizationSkewMinutes: frames.skewMinutes,
    referenceUpdatedAt: referenceAt ? new Date(referenceAt).toISOString() : undefined,
    referenceSkewMinutes: referenceAt ? Math.round(Math.abs(referenceAt - synchronizedAt) / 60_000) : undefined,
    refreshIntervalMinutes: SATELLITE_REFRESH_INTERVAL_MS / 60_000,
    isStale: Date.now() - oldestFrameAt > 4 * 60 * 60 * 1000,
    bounds: JMA_REGION.bounds
  };
}

export async function fetchJmaImage(region: string, product: string, frame: string): Promise<Response> {
  if (region !== JMA_REGION.id || product !== JMA_REGION.product || !/^\d{7}_\d{4}rgb$/.test(frame)) {
    return new Response("Invalid Himawari image request", { status: 400 });
  }

  const remoteUrl = `${NOAA_HIMAWARI_BASE_URL}/img/${frame}.jpg`;
  const image = await getCachedSatelliteImage(`regional:${frame}`, remoteUrl, prepareRegionalCloudOverlay);
  return new Response(Buffer.from(image.bytes), {
    status: 200,
    headers: {
      "Content-Type": image.contentType,
      "Cache-Control": "public, max-age=1800, stale-while-revalidate=3600, immutable",
      "X-Remote-Source": remoteUrl
    }
  });
}

export async function fetchGlobalSatelliteImage(frame: string): Promise<Response> {
  if (!/^GLOBCOMPLIR_v3r0_blend_s\d{15}_e\d{15}_c\d{15}$/.test(frame)) {
    return new Response("Invalid global satellite image request", { status: 400 });
  }

  const remoteUrl = `${NOAA_GMGSI_BASE_URL}/${NOAA_GMGSI_PRODUCT}/${frame}.gif`;
  const image = await getCachedSatelliteImage(`global:${frame}`, remoteUrl, prepareGlobalCloudOverlay);
  return new Response(Buffer.from(image.bytes), {
    status: 200,
    headers: {
      "Content-Type": image.contentType,
      "Cache-Control": "public, max-age=1800, stale-while-revalidate=3600, immutable",
      "X-Remote-Source": remoteUrl
    }
  });
}

async function getCachedSatelliteImage(
  key: string,
  remoteUrl: string,
  transform: (bytes: Uint8Array) => Promise<Uint8Array>
) {
  const cached = satelliteImageCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }
  const source = await fetchRemoteBytesWithPowershell(remoteUrl);
  const bytes = await transform(source);
  if (satelliteImageCache.size > 12) satelliteImageCache.clear();
  const entry = {
    expiresAt: Date.now() + SATELLITE_IMAGE_CACHE_TTL_MS,
    bytes,
    contentType: "image/png"
  };
  satelliteImageCache.set(key, entry);
  return entry;
}

async function fetchRemoteBytesWithPowershell(remoteUrl: string) {
  const script = [
    "$ProgressPreference='SilentlyContinue'",
    `$bytes=(Invoke-WebRequest -UseBasicParsing '${remoteUrl}').Content`,
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

export async function getWindField(stormId?: string | null, requestedBounds?: WindFieldBounds | null): Promise<WindFieldPayload> {
  const bounds = requestedBounds ? normalizeWindFieldBounds(requestedBounds) : null;
  const cacheKey = bounds ? `viewport:${windBoundsCacheKey(bounds)}` : stormId ?? "default";
  const cached = windFieldCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.payload;
  }
  const inFlight = windFieldInFlight.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const request = loadWindField(stormId, bounds).then(
    (payload) => {
      windFieldCache.set(cacheKey, {
        expiresAt: Date.now() + (payload.status === "available" ? WIND_FIELD_CACHE_TTL_MS : 20 * 1000),
        payload
      });
      windFieldInFlight.delete(cacheKey);
      return payload;
    },
    (error) => {
      windFieldInFlight.delete(cacheKey);
      throw error;
    }
  );
  windFieldInFlight.set(cacheKey, request);
  return request;
}

async function loadWindField(stormId?: string | null, viewportBounds?: WindFieldBounds | null): Promise<WindFieldPayload> {
  const storms = await getCurrentStorms().catch(() => []);
  const storm = storms.find((item) => item.id === stormId) ?? storms[0] ?? null;
  if (!storm && !viewportBounds) {
    return {
      source: OPEN_METEO_SOURCE,
      updatedAt: new Date().toISOString(),
      status: "unavailable",
      attribution: OPEN_METEO_ATTRIBUTION,
      reason: "当前没有活动台风，未生成环境风场采样网格。",
      model: "Open-Meteo best match, 10m wind",
      unit: "m/s",
      points: []
    };
  }
  const sampleBounds = viewportBounds ?? buildStormWindBounds(storm as Storm);
  const samplePoints = buildWindSampleGrid(sampleBounds);

  try {
    const batches = await Promise.all(chunk(samplePoints, 54).map(async (points) => {
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
      return Array.isArray(raw) ? raw : [raw];
    }));
    const locations = batches.flat();
    const points = locations.map(convertWindPoint).filter((point): point is WindFieldPoint => Boolean(point));
    if (points.length < 42) throw new Error(`Open-Meteo returned only ${points.length} usable wind samples.`);

    return {
      source: OPEN_METEO_SOURCE,
      updatedAt: locations[0]?.hourly?.time?.[0] ?? new Date().toISOString(),
      status: "available",
      attribution: OPEN_METEO_ATTRIBUTION,
      model: "Open-Meteo best match, 10m wind",
      unit: "m/s",
      points,
      sampling: viewportBounds ? "viewport" : "storm",
      coverage: sampleBounds
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
      points: [],
      sampling: viewportBounds ? "viewport" : "storm",
      coverage: sampleBounds
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

async function getSynchronizedSatelliteFrames() {
  const refreshSlot = satelliteRefreshSlot();
  if (satelliteFrameCache?.slotKey === refreshSlot.key) {
    return satelliteFrameCache.promise;
  }

  const promise = loadSynchronizedSatelliteFrames(refreshSlot.iso).catch((error) => {
    if (satelliteFrameCache?.slotKey === refreshSlot.key) satelliteFrameCache = null;
    throw error;
  });
  satelliteFrameCache = {
    slotKey: refreshSlot.key,
    promise
  };
  return promise;
}

async function loadSynchronizedSatelliteFrames(refreshSlot: string): Promise<SynchronizedSatelliteFrames> {
  const [regionalFrames, globalFrames] = await Promise.all([loadRegionalSatelliteFrames(), loadGlobalSatelliteFrames()]);
  if (regionalFrames.length === 0 || globalFrames.length === 0) {
    throw new Error("NOAA satellite frame manifests did not contain a usable synchronized pair.");
  }

  const pair = chooseSynchronizedFramePair(regionalFrames, globalFrames);
  const regionalAt = new Date(pair.regional.capturedAt).getTime();
  const globalAt = new Date(pair.global.capturedAt).getTime();
  return {
    regional: pair.regional,
    global: pair.global,
    synchronizedAt: new Date(Math.round((regionalAt + globalAt) / 2)).toISOString(),
    skewMinutes: Math.round(Math.abs(regionalAt - globalAt) / 60_000),
    refreshSlot
  };
}

async function loadRegionalSatelliteFrames() {
  const text = await fetchRemoteTextWithPowershell(NOAA_HIMAWARI_FRAME_LIST_URL);
  const frames: SatelliteFrame[] = [];
  const expression = /img\/(\d{7}_\d{4}rgb)\.jpg/g;
  for (const match of text.matchAll(expression)) {
    const id = match[1];
    const capturedAt = regionalFrameTime(id);
    if (!capturedAt) continue;
    frames.push({
      id,
      capturedAt,
      remoteUrl: `${NOAA_HIMAWARI_BASE_URL}/img/${id}.jpg`
    });
  }
  return uniqueFrames(frames);
}

async function loadGlobalSatelliteFrames() {
  const frames: SatelliteFrame[] = [];
  const now = new Date();
  for (let dayOffset = 0; dayOffset < 3; dayOffset += 1) {
    const day = new Date(now.getTime() - dayOffset * 24 * 60 * 60 * 1000);
    const dateKey = day.toISOString().slice(0, 10).replaceAll("-", "");
    const manifestUrl = `${NOAA_GMGSI_BASE_URL}/assets/${dateKey}_GMGSI_filelist.js`;
    let text: string;
    try {
      text = await fetchRemoteTextWithPowershell(manifestUrl);
    } catch {
      continue;
    }
    const block = text.match(/var\s+GMGSI_LW_GIF_C\s*=\s*\[\s*\{([\s\S]*?)\}\s*\];/);
    if (!block) continue;
    for (const match of block[1].matchAll(/"\d{2}"\s*:\s*"([^"]+)"/g)) {
      const id = match[1];
      const capturedAt = globalFrameTime(id);
      if (!capturedAt) continue;
      frames.push({
        id,
        capturedAt,
        remoteUrl: `${NOAA_GMGSI_BASE_URL}/${NOAA_GMGSI_PRODUCT}/${id}.gif`
      });
    }
  }
  return uniqueFrames(frames);
}

function chooseSynchronizedFramePair(regionalFrames: SatelliteFrame[], globalFrames: SatelliteFrame[]) {
  const now = Date.now() + 5 * 60 * 1000;
  const regional = regionalFrames.filter((frame) => new Date(frame.capturedAt).getTime() <= now);
  const global = globalFrames.filter((frame) => new Date(frame.capturedAt).getTime() <= now);
  let best: { regional: SatelliteFrame; global: SatelliteFrame; freshness: number; skew: number } | null = null;

  for (const regionalFrame of regional) {
    const regionalAt = new Date(regionalFrame.capturedAt).getTime();
    for (const globalFrame of global) {
      const globalAt = new Date(globalFrame.capturedAt).getTime();
      const skew = Math.abs(regionalAt - globalAt);
      if (skew > SATELLITE_REFRESH_INTERVAL_MS) continue;
      const freshness = Math.min(regionalAt, globalAt);
      if (!best || freshness > best.freshness || (freshness === best.freshness && skew < best.skew)) {
        best = { regional: regionalFrame, global: globalFrame, freshness, skew };
      }
    }
  }

  if (best) return best;
  return {
    regional: [...regionalFrames].sort(compareFrameNewestFirst)[0],
    global: [...globalFrames].sort(compareFrameNewestFirst)[0]
  };
}

function uniqueFrames(frames: SatelliteFrame[]) {
  return [...new Map(frames.map((frame) => [frame.id, frame])).values()].sort(compareFrameNewestFirst);
}

function compareFrameNewestFirst(left: SatelliteFrame, right: SatelliteFrame) {
  return new Date(right.capturedAt).getTime() - new Date(left.capturedAt).getTime();
}

function regionalFrameTime(id: string) {
  const match = id.match(/^(\d{4})(\d{3})_(\d{2})(\d{2})rgb$/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), 0, Number(match[2]), Number(match[3]), Number(match[4])));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function globalFrameTime(id: string) {
  const match = id.match(/_s(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})\d{3}_/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5])));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function satelliteRefreshSlot() {
  const slot = Math.floor(Date.now() / SATELLITE_REFRESH_INTERVAL_MS) * SATELLITE_REFRESH_INTERVAL_MS;
  return {
    key: String(slot),
    iso: new Date(slot).toISOString()
  };
}

function parseReferenceTime(value?: string | null) {
  if (!value) return null;
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  const normalized = hasTimezone ? value : `${value.trim().replace(" ", "T")}+08:00`;
  const time = Date.parse(normalized);
  return Number.isNaN(time) ? null : time;
}

async function fetchRemoteTextWithPowershell(remoteUrl: string) {
  const script = [
    "$ProgressPreference='SilentlyContinue'",
    "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)",
    `$text=(Invoke-WebRequest -UseBasicParsing '${remoteUrl}').Content`,
    "[Console]::Out.Write([string]$text)"
  ].join("; ");
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script], {
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true
      });
      if (stdout.trim()) return stdout;
    } catch (error) {
      lastError = error;
    }
    await delay(600 + attempt * 900);
  }
  throw lastError instanceof Error ? lastError : new Error(`Remote text request failed for ${remoteUrl}`);
}

async function prepareRegionalCloudOverlay(bytes: Uint8Array) {
  const metadata = await sharp(Buffer.from(bytes)).metadata();
  const width = metadata.width ?? 1120;
  const height = metadata.height ?? 640;
  const cropHeight = Math.max(1, Math.min(height, Math.round(height * 0.944)));
  return renderCloudMask(bytes, { left: 0, top: 0, width, height: cropHeight }, 88, 205);
}

async function prepareGlobalCloudOverlay(bytes: Uint8Array) {
  const metadata = await sharp(Buffer.from(bytes)).metadata();
  const width = metadata.width ?? 835;
  const height = metadata.height ?? 488;
  const top = Math.max(0, Math.round(height * 0.154));
  const bottom = Math.min(height, Math.round(height * 0.868));
  return renderCloudMask(bytes, { left: 0, top, width, height: Math.max(1, bottom - top) }, 76, 175);
}

async function renderCloudMask(
  bytes: Uint8Array,
  extract: { left: number; top: number; width: number; height: number },
  luminanceFloor: number,
  maxAlpha: number
) {
  const decoded = await sharp(Buffer.from(bytes), { animated: false })
    .extract(extract)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const output = Buffer.alloc(decoded.info.width * decoded.info.height * 4);

  for (let sourceIndex = 0, targetIndex = 0; sourceIndex < decoded.data.length; sourceIndex += 3, targetIndex += 4) {
    const red = decoded.data[sourceIndex];
    const green = decoded.data[sourceIndex + 1];
    const blue = decoded.data[sourceIndex + 2];
    const maximum = Math.max(red, green, blue);
    const minimum = Math.min(red, green, blue);
    const overlayInk = maximum > 95 && maximum - minimum > 54;
    const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    const signal = clamp((luminance - luminanceFloor) / Math.max(1, 255 - luminanceFloor), 0, 1);
    const alpha = overlayInk ? 0 : Math.round(Math.pow(signal, 1.24) * maxAlpha);
    const shade = Math.round(188 + signal * 67);
    output[targetIndex] = shade;
    output[targetIndex + 1] = Math.min(255, shade + 5);
    output[targetIndex + 2] = 255;
    output[targetIndex + 3] = alpha;
  }

  return sharp(output, {
    raw: {
      width: decoded.info.width,
      height: decoded.info.height,
      channels: 4
    }
  })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
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

function buildStormWindBounds(storm: Storm): WindFieldBounds {
  const center = storm.position;
  return {
    west: clamp(center.lon - 9, -180, 180),
    east: clamp(center.lon + 9, -180, 180),
    south: clamp(center.lat - 7, -80, 80),
    north: clamp(center.lat + 7, -80, 80)
  };
}

function buildWindSampleGrid(bounds: WindFieldBounds) {
  const { west, east, south, north } = bounds;
  const columns = 9;
  const rows = 6;
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

function normalizeWindFieldBounds(bounds: WindFieldBounds): WindFieldBounds {
  const west = clamp(Math.min(bounds.west, bounds.east), -180, 180);
  const east = clamp(Math.max(bounds.west, bounds.east), -180, 180);
  const south = clamp(Math.min(bounds.south, bounds.north), -80, 80);
  const north = clamp(Math.max(bounds.south, bounds.north), -80, 80);
  return {
    west: quantize(west, 0.5),
    east: quantize(Math.max(west + 1, east), 0.5),
    south: quantize(south, 0.5),
    north: quantize(Math.max(south + 1, north), 0.5)
  };
}

function windBoundsCacheKey(bounds: WindFieldBounds) {
  return [bounds.west, bounds.south, bounds.east, bounds.north].map((value) => value.toFixed(1)).join(":");
}

function quantize(value: number, step: number) {
  return Math.round(value / step) * step;
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
