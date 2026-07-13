import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { makeQuadrantWindPolygon } from "@/lib/meteorology";
import { getCurrentStorms } from "@/lib/realTyphoonData";
import type {
  ImpactAreaPayload,
  RadarMosaicLayerPayload,
  SatelliteLayerPayload,
  Storm,
  GfsScalarLayerId,
  GfsScalarLayerPayload,
  GfsScalarPoint,
  GfsWaveLayerPayload,
  GfsWavePoint,
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
const MET_NORWAY_SOURCE = "MET Norway Locationforecast API";
const MET_NORWAY_ATTRIBUTION = "MET Norway Locationforecast 2.0 global forecast";
const NCEP_GFS_SOURCE = "NOAA/NCEP NOMADS Grib Filter";
const NCEP_GFS_ATTRIBUTION = "NOAA NCEP GFS 0.25 degree analysis";
const NCEP_GFS_FILTER_URL = "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl";
const NCEP_GFS_WAVE_FILTER_URL = "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfswave.pl";
const NCEP_GFS_NATIVE_RESOLUTION_DEGREES = 0.25;
const NCEP_GFS_MAX_DISPLAY_POINTS = 18_000;
const NCEP_GFS_WAVE_MAX_DISPLAY_POINTS = 6_000;
const WGRIB2_PATH = process.env.WGRIB2_PATH ?? join(process.cwd(), ".runtime", "tools", "wgrib2", "wgrib2.exe");
const SATELLITE_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const SATELLITE_IMAGE_CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const WIND_FIELD_CACHE_TTL_MS = 15 * 60 * 1000;
const NATIONAL_WIND_FIELD_CACHE_TTL_MS = 30 * 60 * 1000;
const DEGRADED_WIND_FIELD_RETRY_MS = 2 * 60 * 1000;
const PERSISTED_WIND_FIELD_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const OPEN_METEO_RATE_LIMIT_COOLDOWN_MS = 10 * 60 * 1000;
const OPEN_METEO_REQUEST_SPACING_MS = 900;
const WIND_FIELD_CACHE_DIR = join(process.cwd(), ".runtime", "wind-field");
const SATELLITE_IMAGE_CACHE_DIR = join(process.cwd(), ".runtime", "satellite-images");
// NOAA imagery occasionally takes several seconds to start transferring even
// when the product is healthy. Keep this outside the core radar request path,
// but allow enough time for the background image proxy to complete.
const SATELLITE_FETCH_TIMEOUT_MS = 20_000;
const SATELLITE_CIRCUIT_COOLDOWN_MS = 5 * 60 * 1000;
const CWA_RADAR_SOURCE = "Taiwan CWA radar composite";
const CWA_RADAR_ATTRIBUTION = "台湾中央气象署雷达整合回波透明图层";
const CWA_RADAR_PRODUCT = "O-A0058-005";
const CWA_RADAR_REMOTE_URL = `https://cwaopendata.s3.ap-northeast-1.amazonaws.com/Observation/${CWA_RADAR_PRODUCT}.png`;
const CWA_RADAR_BOUNDS = { west: 115, south: 17.75, east: 126.5, north: 29.25 };
const CWA_RADAR_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const CWA_RADAR_METADATA_TTL_MS = 5 * 60 * 1000;
const IMPACT_SOURCE = "浙江省水利厅台风路径公开接口风圈半径";
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0"
};
const execFileAsync = promisify(execFile);
interface CachedSatelliteImage {
  expiresAt: number;
  bytes: Uint8Array;
  contentType: string;
  status: "fresh" | "stale";
  fetchedAt: string;
}

const satelliteImageCache = new Map<string, CachedSatelliteImage>();
const satelliteImageInFlight = new Map<string, Promise<CachedSatelliteImage>>();
const satelliteSourceFailures = new Map<string, { count: number; blockedUntil: number }>();
const windFieldCache = new Map<string, { expiresAt: number; payload: WindFieldPayload }>();
const windFieldInFlight = new Map<string, Promise<WindFieldPayload>>();
const windFieldLastSuccess = new Map<string, WindFieldPayload>();
const gfsScalarCache = new Map<string, { expiresAt: number; payload: GfsScalarLayerPayload }>();
const gfsScalarInFlight = new Map<string, Promise<GfsScalarLayerPayload>>();
const gfsScalarLastSuccess = new Map<string, GfsScalarLayerPayload>();
const gfsWaveCache = new Map<string, { expiresAt: number; payload: GfsWaveLayerPayload }>();
const gfsWaveInFlight = new Map<string, Promise<GfsWaveLayerPayload>>();
const gfsWaveLastSuccess = new Map<string, GfsWaveLayerPayload>();
let cwaRadarLayerCache: { expiresAt: number; payload: RadarMosaicLayerPayload } | null = null;
let cwaRadarLayerInFlight: Promise<RadarMosaicLayerPayload> | null = null;
let cwaRadarLastSuccess: RadarMosaicLayerPayload | null = null;
let openMeteoBlockedUntil = 0;
let openMeteoLastRequestAt = 0;
let openMeteoRequestChain: Promise<unknown> = Promise.resolve();
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

interface MetNorwayResponse {
  properties?: {
    meta?: { updated_at?: string };
    timeseries?: Array<{
      time?: string;
      data?: {
        instant?: {
          details?: {
            wind_speed?: number;
            wind_from_direction?: number;
          };
        };
      };
    }>;
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
  let image: CachedSatelliteImage;
  try {
    // Version the cache key when changing the image geometry: older cached
    // payloads were vertically cropped but still advertised full-frame bounds.
    image = await getCachedSatelliteImage(`regional-georef-v2:${frame}`, "regional", remoteUrl, prepareRegionalCloudOverlay);
  } catch (error) {
    return satelliteUnavailableResponse("regional", error);
  }
  return new Response(Buffer.from(image.bytes), {
    status: 200,
    headers: {
      "Content-Type": image.contentType,
      "Cache-Control": "public, max-age=1800, stale-while-revalidate=3600, immutable",
      "X-Remote-Source": remoteUrl,
      "X-Data-Status": image.status,
      "X-Data-Fetched-At": image.fetchedAt
    }
  });
}

export async function fetchGlobalSatelliteImage(frame: string): Promise<Response> {
  if (!/^GLOBCOMPLIR_v3r0_blend_s\d{15}_e\d{15}_c\d{15}$/.test(frame)) {
    return new Response("Invalid global satellite image request", { status: 400 });
  }

  const remoteUrl = `${NOAA_GMGSI_BASE_URL}/${NOAA_GMGSI_PRODUCT}/${frame}.gif`;
  let image: CachedSatelliteImage;
  try {
    image = await getCachedSatelliteImage(`global:${frame}`, "global", remoteUrl, prepareGlobalCloudOverlay);
  } catch (error) {
    return satelliteUnavailableResponse("global", error);
  }
  return new Response(Buffer.from(image.bytes), {
    status: 200,
    headers: {
      "Content-Type": image.contentType,
      "Cache-Control": "public, max-age=1800, stale-while-revalidate=3600, immutable",
      "X-Remote-Source": remoteUrl,
      "X-Data-Status": image.status,
      "X-Data-Fetched-At": image.fetchedAt
    }
  });
}

export async function getCwaRadarLayer(): Promise<RadarMosaicLayerPayload> {
  if (cwaRadarLayerCache && cwaRadarLayerCache.expiresAt > Date.now()) return cwaRadarLayerCache.payload;
  if (cwaRadarLayerInFlight) return cwaRadarLayerInFlight;

  cwaRadarLayerInFlight = loadCwaRadarLayer()
    .then((payload) => {
      cwaRadarLayerCache = { expiresAt: Date.now() + CWA_RADAR_METADATA_TTL_MS, payload };
      if (payload.status === "available" && !payload.isStale) cwaRadarLastSuccess = payload;
      return payload;
    })
    .finally(() => {
      cwaRadarLayerInFlight = null;
    });
  return cwaRadarLayerInFlight;
}

async function loadCwaRadarLayer(): Promise<RadarMosaicLayerPayload> {
  try {
    const response = await fetch(CWA_RADAR_REMOTE_URL, {
      method: "HEAD",
      cache: "no-store",
      signal: AbortSignal.timeout(5_000)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength <= 0 || contentLength > 8 * 1024 * 1024) throw new Error("invalid radar image size");
    const updatedAt = parseHttpDate(response.headers.get("last-modified")) ?? new Date().toISOString();
    const isStale = Date.now() - new Date(updatedAt).getTime() > 40 * 60 * 1000;
    return {
      source: CWA_RADAR_SOURCE,
      updatedAt,
      status: "available",
      attribution: CWA_RADAR_ATTRIBUTION,
      imageUrl: `/api/environment/cwa-radar-image?v=${encodeURIComponent(updatedAt)}`,
      product: CWA_RADAR_PRODUCT,
      isStale,
      refreshIntervalMinutes: CWA_RADAR_REFRESH_INTERVAL_MS / 60_000,
      bounds: CWA_RADAR_BOUNDS,
      reason: isStale ? "实况雷达图已超过 40 分钟未更新。" : undefined
    };
  } catch (error) {
    if (cwaRadarLastSuccess) {
      return {
        ...cwaRadarLastSuccess,
        isStale: true,
        reason: `上游暂不可用，保留最后有效图：${errorMessage(error)}`
      };
    }
    return {
      source: CWA_RADAR_SOURCE,
      updatedAt: new Date().toISOString(),
      status: "unavailable",
      attribution: CWA_RADAR_ATTRIBUTION,
      imageUrl: null,
      product: CWA_RADAR_PRODUCT,
      isStale: false,
      refreshIntervalMinutes: CWA_RADAR_REFRESH_INTERVAL_MS / 60_000,
      bounds: CWA_RADAR_BOUNDS,
      reason: `实况雷达图暂不可用：${errorMessage(error)}`
    };
  }
}

export async function fetchCwaRadarImage(): Promise<Response> {
  const layer = await getCwaRadarLayer();
  const version = layer.status === "available" ? layer.updatedAt : "last-good";
  try {
    const image = await getCachedSatelliteImage(
      `cwa-radar:${version}`,
      "cwa-radar",
      CWA_RADAR_REMOTE_URL,
      validatePngImage,
      true
    );
    return new Response(Buffer.from(image.bytes), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=300, stale-while-revalidate=1800",
        "X-Remote-Source": CWA_RADAR_REMOTE_URL,
        "X-Data-Status": image.status,
        "X-Data-Fetched-At": image.fetchedAt
      }
    });
  } catch (error) {
    return satelliteUnavailableResponse("cwa-radar", error);
  }
}

async function getCachedSatelliteImage(
  key: string,
  sourceKey: "regional" | "global" | "cwa-radar",
  remoteUrl: string,
  transform: (bytes: Uint8Array) => Promise<Uint8Array>,
  allowBinaryImage = false
): Promise<CachedSatelliteImage> {
  const cached = satelliteImageCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }
  const inFlight = satelliteImageInFlight.get(key);
  if (inFlight) return inFlight;

  const request = loadSatelliteImage(sourceKey, remoteUrl, transform, allowBinaryImage).finally(() => satelliteImageInFlight.delete(key));
  satelliteImageInFlight.set(key, request);
  const entry = await request;
  if (satelliteImageCache.size > 12) satelliteImageCache.clear();
  satelliteImageCache.set(key, entry);
  return entry;
}

async function loadSatelliteImage(
  sourceKey: "regional" | "global" | "cwa-radar",
  remoteUrl: string,
  transform: (bytes: Uint8Array) => Promise<Uint8Array>,
  allowBinaryImage = false
): Promise<CachedSatelliteImage> {
  const failure = satelliteSourceFailures.get(sourceKey);
  if (!failure || failure.blockedUntil <= Date.now()) {
    try {
      const source = await fetchRemoteBytes(remoteUrl, allowBinaryImage);
      const bytes = await transform(source);
      const fetchedAt = new Date().toISOString();
      await persistLastGoodSatelliteImage(sourceKey, bytes, fetchedAt);
      satelliteSourceFailures.delete(sourceKey);
      return { expiresAt: Date.now() + SATELLITE_IMAGE_CACHE_TTL_MS, bytes, contentType: "image/png", status: "fresh", fetchedAt };
    } catch (error) {
      const count = (failure?.count ?? 0) + 1;
      satelliteSourceFailures.set(sourceKey, {
        count,
        blockedUntil: count >= 2 ? Date.now() + SATELLITE_CIRCUIT_COOLDOWN_MS : 0
      });
      console.warn(`[satellite-image] ${sourceKey} source unavailable; using last good image when present: ${errorMessage(error)}`);
    }
  }

  const persisted = await readLastGoodSatelliteImage(sourceKey);
  if (persisted) return persisted;
  throw new Error(`${sourceKey} satellite image unavailable and no last-good image has been stored.`);
}

async function fetchRemoteBytes(remoteUrl: string, allowBinaryImage = false) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(remoteUrl, { signal: AbortSignal.timeout(SATELLITE_FETCH_TIMEOUT_MS), cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.startsWith("image/") && !(allowBinaryImage && contentType === "binary/octet-stream")) {
        throw new Error(`unexpected content type ${contentType || "unknown"}`);
      }
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt === 0) await delay(500);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Satellite image request failed.");
}

async function persistLastGoodSatelliteImage(sourceKey: string, bytes: Uint8Array, fetchedAt: string) {
  await mkdir(SATELLITE_IMAGE_CACHE_DIR, { recursive: true });
  const imagePath = join(SATELLITE_IMAGE_CACHE_DIR, `${sourceKey}.png`);
  const metadataPath = join(SATELLITE_IMAGE_CACHE_DIR, `${sourceKey}.json`);
  await writeFile(`${imagePath}.tmp`, bytes);
  await rename(`${imagePath}.tmp`, imagePath);
  await writeFile(`${metadataPath}.tmp`, JSON.stringify({ fetchedAt }), "utf8");
  await rename(`${metadataPath}.tmp`, metadataPath);
}

async function readLastGoodSatelliteImage(sourceKey: string): Promise<CachedSatelliteImage | null> {
  try {
    const imagePath = join(SATELLITE_IMAGE_CACHE_DIR, `${sourceKey}.png`);
    const metadataPath = join(SATELLITE_IMAGE_CACHE_DIR, `${sourceKey}.json`);
    const [bytes, metadataText] = await Promise.all([readFile(imagePath), readFile(metadataPath, "utf8")]);
    const metadata = JSON.parse(metadataText) as { fetchedAt?: string };
    return {
      expiresAt: Date.now() + 5 * 60 * 1000,
      bytes,
      contentType: "image/png",
      status: "stale",
      fetchedAt: metadata.fetchedAt ?? new Date(0).toISOString()
    };
  } catch {
    return null;
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function satelliteUnavailableResponse(sourceKey: string, error: unknown) {
  console.warn(`[satellite-image] ${sourceKey} unavailable: ${errorMessage(error)}`);
  return new Response("Satellite image temporarily unavailable", {
    status: 503,
    headers: {
      "Cache-Control": "public, max-age=30",
      "Retry-After": "60",
      "X-Data-Status": "unavailable"
    }
  });
}

async function validatePngImage(bytes: Uint8Array) {
  const metadata = await sharp(bytes).metadata();
  if (metadata.format !== "png" || !metadata.width || !metadata.height) throw new Error("invalid radar PNG");
  return bytes;
}

function parseHttpDate(value: string | null) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export async function getImpactArea(stormId?: string | null): Promise<ImpactAreaPayload> {
  try {
    const storms = await getCurrentStorms();
    const storm = storms.find((item) => item.id === stormId) ?? storms[0] ?? null;
    if (!storm) {
      return emptyImpact("当前没有活跃台风，影响区为空。");
    }

    const features = [
      impactFeature(storm, "r7"),
      impactFeature(storm, "r10"),
      impactFeature(storm, "r12")
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

  const request = (async () => {
    const persisted = shouldPersistWindField(bounds) ? await readPersistedWindField(cacheKey) : null;
    const lastSuccess = windFieldLastSuccess.get(cacheKey) ?? persisted;
    if (persisted && !windFieldLastSuccess.has(cacheKey)) {
      windFieldLastSuccess.set(cacheKey, persisted);
    }

    const payload = await loadWindField(stormId, bounds);
    if (payload.status === "available" && payload.points.length > 0) {
      const freshPayload = {
        ...payload,
        isStale: false,
        lastSuccessfulAt: payload.updatedAt
      } satisfies WindFieldPayload;
      windFieldLastSuccess.set(cacheKey, freshPayload);
      windFieldCache.set(cacheKey, {
        expiresAt: Date.now() + windFieldCacheTtl(bounds),
        payload: freshPayload
      });
      if (shouldPersistWindField(bounds)) {
        void persistWindField(cacheKey, freshPayload);
      }
      return freshPayload;
    }

    const resilientPayload = lastSuccess
      ? staleWindField(lastSuccess, payload.reason ?? "风场上游暂时不可用。")
      : payload;
    windFieldCache.set(cacheKey, {
      expiresAt: Date.now() + DEGRADED_WIND_FIELD_RETRY_MS,
      payload: resilientPayload
    });
    return resilientPayload;
  })().then(
    (payload) => {
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

  let ncepReason = "";
  try {
    return await loadNcepGfsWindField(sampleBounds, Boolean(viewportBounds), storm?.position ?? null);
  } catch (error) {
    ncepReason = error instanceof Error ? error.message : "NCEP GFS GRIB2 decoding failed.";
  }

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
        wind_speed_unit: "ms",
        models: "gfs_global"
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
      reason: ncepReason ? `Direct NCEP feed unavailable: ${ncepReason}` : undefined,
      model: "NCEP GFS global via Open-Meteo, 10m wind",
      unit: "m/s",
      points,
      sampling: viewportBounds ? "viewport" : "storm",
      coverage: sampleBounds
    };
  } catch (error) {
    const openMeteoReason = error instanceof Error ? error.message : "风场接口暂时不可用。";
    // A throttled primary GFS mirror must not make an otherwise valid local
    // viewport blank. The fallback is labeled separately in its payload.
    if (samplePoints.length > 0) {
      try {
        return await loadMetNorwayWindField(samplePoints, sampleBounds);
      } catch (fallbackError) {
        const fallbackReason = fallbackError instanceof Error ? fallbackError.message : "MET Norway fallback failed.";
        return unavailableWindField(viewportBounds ?? null, sampleBounds, `${openMeteoReason}；${fallbackReason}`);
      }
    }
    return unavailableWindField(viewportBounds ?? null, sampleBounds, openMeteoReason);
  }
}

const GFS_SCALAR_LAYERS: Record<GfsScalarLayerId, {
  label: string;
  variable: string;
  level: string;
  unit: GfsScalarLayerPayload["unit"];
  convert: (value: number) => number;
}> = {
  pressure: { label: "海平面气压", variable: "PRMSL", level: "mean_sea_level", unit: "hPa", convert: (value) => value / 100 },
  precipitation: { label: "模型降水率", variable: "PRATE", level: "surface", unit: "mm/h", convert: (value) => value * 3_600 },
  gust: { label: "地面阵风", variable: "GUST", level: "surface", unit: "m/s", convert: (value) => value },
  reflectivity: { label: "模型合成反射率", variable: "REFC", level: "entire_atmosphere", unit: "dBZ", convert: (value) => value },
  "precipitable-water": { label: "整层可降水量", variable: "PWAT", level: "entire_atmosphere_(considered_as_a_single_layer)", unit: "mm", convert: (value) => value }
};

export function isGfsScalarLayerId(value: string | null): value is GfsScalarLayerId {
  return Boolean(value && value in GFS_SCALAR_LAYERS);
}

export async function getGfsScalarLayer(layer: GfsScalarLayerId, requestedBounds: WindFieldBounds): Promise<GfsScalarLayerPayload> {
  const bounds = snapNcepBounds(normalizeWindFieldBounds(requestedBounds));
  const cacheKey = `${layer}:${windBoundsCacheKey(bounds)}`;
  const cached = gfsScalarCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.payload;
  const inFlight = gfsScalarInFlight.get(cacheKey);
  if (inFlight) return inFlight;

  const request = loadNcepGfsScalarLayer(layer, bounds).then(
    (payload) => {
      gfsScalarLastSuccess.set(cacheKey, payload);
      gfsScalarCache.set(cacheKey, { expiresAt: Date.now() + WIND_FIELD_CACHE_TTL_MS, payload });
      gfsScalarInFlight.delete(cacheKey);
      return payload;
    },
    (error) => {
      gfsScalarInFlight.delete(cacheKey);
      const last = gfsScalarLastSuccess.get(cacheKey);
      if (last) {
        const stale = {
          ...last,
          status: "available" as const,
          isStale: true,
          reason: `NCEP GFS refresh failed; using last valid layer: ${errorMessage(error)}`
        };
        gfsScalarCache.set(cacheKey, { expiresAt: Date.now() + DEGRADED_WIND_FIELD_RETRY_MS, payload: stale });
        return stale;
      }
      throw error;
    }
  );
  gfsScalarInFlight.set(cacheKey, request);
  return request;
}

async function loadNcepGfsScalarLayer(layer: GfsScalarLayerId, bounds: WindFieldBounds): Promise<GfsScalarLayerPayload> {
  const config = GFS_SCALAR_LAYERS[layer];
  const errors: string[] = [];
  for (const cycle of ncepCycleCandidates()) {
    const query = new URLSearchParams({
      file: `gfs.t${cycle.hour}z.pgrb2.0p25.f000`,
      [`lev_${config.level}`]: "on",
      [`var_${config.variable}`]: "on",
      subregion: "",
      leftlon: String(bounds.west),
      rightlon: String(bounds.east),
      toplat: String(bounds.north),
      bottomlat: String(bounds.south),
      dir: `/gfs.${cycle.date}/${cycle.hour}/atmos`
    });
    try {
      const response = await fetch(`${NCEP_GFS_FILTER_URL}?${query.toString()}`, {
        cache: "no-store",
        headers: {
          Accept: "application/octet-stream",
          "User-Agent": process.env.WEATHER_API_USER_AGENT ?? "TyphoonBossRadar/1.0 local-deployment"
        },
        signal: AbortSignal.timeout(35_000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length < 16 || String.fromCharCode(...bytes.slice(0, 4)) !== "GRIB") throw new Error("response was not GRIB2");
      const decoded = await decodeNcepGfsScalar(bytes, cycle, bounds, config.variable, config.convert);
      return {
        source: NCEP_GFS_SOURCE,
        updatedAt: decoded.updatedAt,
        status: "available",
        attribution: NCEP_GFS_ATTRIBUTION,
        layer,
        label: config.label,
        model: `NCEP GFS 0.25 degree analysis, ${config.variable}`,
        unit: config.unit,
        points: decoded.points,
        nativeResolutionDegrees: NCEP_GFS_NATIVE_RESOLUTION_DEGREES,
        displayResolutionDegrees: decoded.displayResolutionDegrees,
        cycle: `${cycle.date} ${cycle.hour}Z`,
        lastSuccessfulAt: decoded.updatedAt,
        sampling: "viewport",
        coverage: bounds
      };
    } catch (error) {
      errors.push(`${cycle.date}${cycle.hour}: ${errorMessage(error)}`);
    }
  }
  throw new Error(`NCEP GFS ${layer} unavailable (${errors.join(" | ")})`);
}

export async function getGfsWaveLayer(requestedBounds: WindFieldBounds): Promise<GfsWaveLayerPayload> {
  const bounds = snapNcepBounds(normalizeWindFieldBounds(requestedBounds));
  const cacheKey = windBoundsCacheKey(bounds);
  const cached = gfsWaveCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.payload;
  const inFlight = gfsWaveInFlight.get(cacheKey);
  if (inFlight) return inFlight;
  const request = loadNcepGfsWaveLayer(bounds).then(
    (payload) => {
      gfsWaveLastSuccess.set(cacheKey, payload);
      gfsWaveCache.set(cacheKey, { expiresAt: Date.now() + WIND_FIELD_CACHE_TTL_MS, payload });
      gfsWaveInFlight.delete(cacheKey);
      return payload;
    },
    (error) => {
      gfsWaveInFlight.delete(cacheKey);
      const last = gfsWaveLastSuccess.get(cacheKey);
      if (!last) throw error;
      const stale = { ...last, isStale: true, reason: `GFS Wave refresh failed; using last valid layer: ${errorMessage(error)}` };
      gfsWaveCache.set(cacheKey, { expiresAt: Date.now() + DEGRADED_WIND_FIELD_RETRY_MS, payload: stale });
      return stale;
    }
  );
  gfsWaveInFlight.set(cacheKey, request);
  return request;
}

async function loadNcepGfsWaveLayer(bounds: WindFieldBounds): Promise<GfsWaveLayerPayload> {
  const errors: string[] = [];
  for (const cycle of ncepCycleCandidates()) {
    const query = new URLSearchParams({
      file: `gfswave.t${cycle.hour}z.global.0p25.f000.grib2`,
      lev_surface: "on",
      var_HTSGW: "on",
      var_DIRPW: "on",
      var_PERPW: "on",
      subregion: "",
      leftlon: String(bounds.west),
      rightlon: String(bounds.east),
      toplat: String(bounds.north),
      bottomlat: String(bounds.south),
      dir: `/gfs.${cycle.date}/${cycle.hour}/wave/gridded`
    });
    try {
      const response = await fetch(`${NCEP_GFS_WAVE_FILTER_URL}?${query}`, {
        cache: "no-store",
        headers: { Accept: "application/octet-stream", "User-Agent": process.env.WEATHER_API_USER_AGENT ?? "TyphoonBossRadar/1.0 local-deployment" },
        signal: AbortSignal.timeout(35_000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length < 16 || String.fromCharCode(...bytes.slice(0, 4)) !== "GRIB") throw new Error("response was not GRIB2");
      const decoded = await decodeNcepGfsWave(bytes, cycle, bounds);
      return {
        source: NCEP_GFS_SOURCE,
        updatedAt: decoded.updatedAt,
        status: "available",
        attribution: "NOAA NCEP GFS Wave 0.25 degree analysis",
        model: "NCEP GFS Wave 0.25 degree analysis, HTSGW/DIRPW/PERPW",
        unit: "m",
        points: decoded.points,
        nativeResolutionDegrees: NCEP_GFS_NATIVE_RESOLUTION_DEGREES,
        displayResolutionDegrees: decoded.displayResolutionDegrees,
        cycle: `${cycle.date} ${cycle.hour}Z`,
        sampling: "viewport",
        coverage: bounds
      };
    } catch (error) {
      errors.push(`${cycle.date}${cycle.hour}: ${errorMessage(error)}`);
    }
  }
  throw new Error(`NCEP GFS Wave unavailable (${errors.join(" | ")})`);
}

async function loadNcepGfsWindField(
  sampleBounds: WindFieldBounds,
  viewportSampling: boolean,
  analysisReference: Storm["position"] | null
): Promise<WindFieldPayload> {
  const bounds = snapNcepBounds(sampleBounds);
  const errors: string[] = [];

  for (const cycle of ncepCycleCandidates()) {
    const query = new URLSearchParams({
      file: `gfs.t${cycle.hour}z.pgrb2.0p25.f000`,
      lev_10_m_above_ground: "on",
      var_UGRD: "on",
      var_VGRD: "on",
      subregion: "",
      leftlon: String(bounds.west),
      rightlon: String(bounds.east),
      toplat: String(bounds.north),
      bottomlat: String(bounds.south),
      dir: `/gfs.${cycle.date}/${cycle.hour}/atmos`
    });
    try {
      const response = await fetch(`${NCEP_GFS_FILTER_URL}?${query.toString()}`, {
        cache: "no-store",
        headers: {
          Accept: "application/octet-stream",
          "User-Agent": process.env.WEATHER_API_USER_AGENT ?? "TyphoonBossRadar/1.0 local-deployment"
        },
        signal: AbortSignal.timeout(35_000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length < 16 || String.fromCharCode(...bytes.slice(0, 4)) !== "GRIB") {
        throw new Error("response was not GRIB2");
      }
      const decoded = await decodeNcepGfsWind(bytes, cycle, bounds);
      return {
        source: NCEP_GFS_SOURCE,
        updatedAt: decoded.updatedAt,
        status: "available",
        attribution: NCEP_GFS_ATTRIBUTION,
        model: "NCEP GFS 0.25 degree analysis, 10m U/V wind",
        unit: "m/s",
        points: decoded.points,
        nativeResolutionDegrees: NCEP_GFS_NATIVE_RESOLUTION_DEGREES,
        displayResolutionDegrees: decoded.displayResolutionDegrees,
        cycle: `${cycle.date} ${cycle.hour}Z`,
        sampling: viewportSampling ? "viewport" : "storm",
        coverage: bounds,
        analysisCenter: findCyclonicVorticityCenter(decoded.points, analysisReference)
      };
    } catch (error) {
      errors.push(`${cycle.date}${cycle.hour}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }
  throw new Error(`NCEP GFS unavailable (${errors.join(" | ")})`);
}

async function decodeNcepGfsWind(
  bytes: Uint8Array,
  cycle: { date: string; hour: string },
  bounds: WindFieldBounds
) {
  await mkdir(WIND_FIELD_CACHE_DIR, { recursive: true });
  const token = createHash("sha1")
    .update(`${cycle.date}${cycle.hour}:${bounds.west}:${bounds.south}:${bounds.east}:${bounds.north}:${Date.now()}`)
    .digest("hex")
    .slice(0, 16);
  const gribPath = join(WIND_FIELD_CACHE_DIR, `ncep-${token}.grib2`);
  const csvPath = join(WIND_FIELD_CACHE_DIR, `ncep-${token}.csv`);
  try {
    await writeFile(gribPath, bytes);
    await execFileAsync(WGRIB2_PATH, [gribPath, "-csv", csvPath], {
      cwd: join(process.cwd(), ".runtime", "tools", "wgrib2"),
      windowsHide: true,
      timeout: 45_000,
      maxBuffer: 2 * 1024 * 1024
    });
    return parseNcepWindCsv(await readFile(csvPath, "utf8"));
  } finally {
    await Promise.all([
      rm(gribPath, { force: true }).catch(() => undefined),
      rm(csvPath, { force: true }).catch(() => undefined)
    ]);
  }
}

async function decodeNcepGfsScalar(
  bytes: Uint8Array,
  cycle: { date: string; hour: string },
  bounds: WindFieldBounds,
  variable: string,
  convert: (value: number) => number
) {
  await mkdir(WIND_FIELD_CACHE_DIR, { recursive: true });
  const token = createHash("sha1")
    .update(`scalar:${variable}:${cycle.date}${cycle.hour}:${bounds.west}:${bounds.south}:${bounds.east}:${bounds.north}:${Date.now()}`)
    .digest("hex")
    .slice(0, 16);
  const gribPath = join(WIND_FIELD_CACHE_DIR, `ncep-${token}.grib2`);
  const csvPath = join(WIND_FIELD_CACHE_DIR, `ncep-${token}.csv`);
  try {
    await writeFile(gribPath, bytes);
    await execFileAsync(WGRIB2_PATH, [gribPath, "-csv", csvPath], {
      cwd: join(process.cwd(), ".runtime", "tools", "wgrib2"),
      windowsHide: true,
      timeout: 45_000,
      maxBuffer: 4 * 1024 * 1024
    });
    return parseNcepScalarCsv(await readFile(csvPath, "utf8"), variable, convert);
  } finally {
    await Promise.all([
      rm(gribPath, { force: true }).catch(() => undefined),
      rm(csvPath, { force: true }).catch(() => undefined)
    ]);
  }
}

async function decodeNcepGfsWave(
  bytes: Uint8Array,
  cycle: { date: string; hour: string },
  bounds: WindFieldBounds
) {
  await mkdir(WIND_FIELD_CACHE_DIR, { recursive: true });
  const token = createHash("sha1")
    .update(`wave:${cycle.date}${cycle.hour}:${bounds.west}:${bounds.south}:${bounds.east}:${bounds.north}:${Date.now()}`)
    .digest("hex")
    .slice(0, 16);
  const gribPath = join(WIND_FIELD_CACHE_DIR, `ncep-${token}.grib2`);
  const csvPath = join(WIND_FIELD_CACHE_DIR, `ncep-${token}.csv`);
  try {
    await writeFile(gribPath, bytes);
    await execFileAsync(WGRIB2_PATH, [gribPath, "-csv", csvPath], {
      cwd: join(process.cwd(), ".runtime", "tools", "wgrib2"),
      windowsHide: true,
      timeout: 45_000,
      maxBuffer: 6 * 1024 * 1024
    });
    return parseNcepWaveCsv(await readFile(csvPath, "utf8"));
  } finally {
    await Promise.all([rm(gribPath, { force: true }).catch(() => undefined), rm(csvPath, { force: true }).catch(() => undefined)]);
  }
}

function parseNcepWaveCsv(csv: string) {
  const grid = new Map<string, GfsWavePoint>();
  let updatedAt = "";
  for (const line of csv.split(/\r?\n/)) {
    if (!line) continue;
    const fields = line.split(",");
    if (fields.length < 7) continue;
    const validTime = fields[1].replaceAll('"', "");
    const variable = fields[2].replaceAll('"', "");
    if (variable !== "HTSGW" && variable !== "DIRPW" && variable !== "PERPW") continue;
    const lon = Number(fields[4]);
    const lat = Number(fields[5]);
    const value = Number(fields[6]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(value)) continue;
    if (!updatedAt && validTime) updatedAt = `${validTime.replace(" ", "T")}Z`;
    const key = windSampleKey(lon, lat);
    const point = grid.get(key) ?? { lon, lat, heightM: Number.NaN, directionDeg: Number.NaN };
    if (variable === "HTSGW") point.heightM = value;
    if (variable === "DIRPW") point.directionDeg = value;
    if (variable === "PERPW") point.periodS = value;
    grid.set(key, point);
  }
  const complete = [...grid.values()].filter((point) => Number.isFinite(point.heightM) && Number.isFinite(point.directionDeg));
  if (complete.length < 80) throw new Error(`wgrib2 decoded only ${complete.length} complete wave cells`);
  const stride = Math.max(1, Math.ceil(complete.length / NCEP_GFS_WAVE_MAX_DISPLAY_POINTS));
  return {
    updatedAt: updatedAt || new Date().toISOString(),
    displayResolutionDegrees: NCEP_GFS_NATIVE_RESOLUTION_DEGREES * stride,
    points: complete.filter((_, index) => index % stride === 0)
  };
}

function parseNcepScalarCsv(csv: string, variable: string, convert: (value: number) => number) {
  const rawPoints: GfsScalarPoint[] = [];
  let updatedAt = "";
  for (const line of csv.split(/\r?\n/)) {
    if (!line) continue;
    const fields = line.split(",");
    if (fields.length < 7) continue;
    const validTime = fields[1].replaceAll('"', "");
    const rowVariable = fields[2].replaceAll('"', "");
    if (rowVariable !== variable) continue;
    const lon = Number(fields[4]);
    const lat = Number(fields[5]);
    const rawValue = Number(fields[6]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(rawValue)) continue;
    if (!updatedAt && validTime) updatedAt = `${validTime.replace(" ", "T")}Z`;
    rawPoints.push({ lon, lat, value: convert(rawValue) });
  }
  if (rawPoints.length < 100) throw new Error(`wgrib2 decoded only ${rawPoints.length} ${variable} cells`);
  const stride = Math.max(1, Math.ceil(Math.sqrt(rawPoints.length / NCEP_GFS_MAX_DISPLAY_POINTS)));
  const points = rawPoints.filter((_, index) => index % stride === 0);
  return {
    updatedAt: updatedAt || new Date().toISOString(),
    displayResolutionDegrees: NCEP_GFS_NATIVE_RESOLUTION_DEGREES * stride,
    points
  };
}

function parseNcepWindCsv(csv: string) {
  const grid = new Map<string, { lon: number; lat: number; u?: number; v?: number }>();
  let updatedAt = "";
  for (const line of csv.split(/\r?\n/)) {
    if (!line) continue;
    const fields = line.split(",");
    if (fields.length < 7) continue;
    const validTime = fields[1].replaceAll('"', "");
    const variable = fields[2].replaceAll('"', "");
    const lon = Number(fields[4]);
    const lat = Number(fields[5]);
    const value = Number(fields[6]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(value)) continue;
    if (variable !== "UGRD" && variable !== "VGRD") continue;
    if (!updatedAt && validTime) updatedAt = `${validTime.replace(" ", "T")}Z`;
    const key = windSampleKey(lon, lat);
    const point = grid.get(key) ?? { lon, lat };
    if (variable === "UGRD") point.u = value;
    if (variable === "VGRD") point.v = value;
    grid.set(key, point);
  }

  const complete = [...grid.values()].filter(
    (point): point is { lon: number; lat: number; u: number; v: number } => Number.isFinite(point.u) && Number.isFinite(point.v)
  );
  if (complete.length < 100) throw new Error(`wgrib2 decoded only ${complete.length} complete U/V cells`);
  const longitudes = [...new Set(complete.map((point) => point.lon))].sort((left, right) => left - right);
  const latitudes = [...new Set(complete.map((point) => point.lat))].sort((left, right) => left - right);
  const stride = Math.max(1, Math.ceil(Math.sqrt(complete.length / NCEP_GFS_MAX_DISPLAY_POINTS)));
  const indexed = new Map(complete.map((point) => [windSampleKey(point.lon, point.lat), point]));
  const points: WindFieldPoint[] = [];
  for (let latIndex = 0; latIndex < latitudes.length; latIndex += stride) {
    for (let lonIndex = 0; lonIndex < longitudes.length; lonIndex += stride) {
      const point = indexed.get(windSampleKey(longitudes[lonIndex], latitudes[latIndex]));
      if (!point) continue;
      const speed = Math.hypot(point.u, point.v);
      points.push({ ...point, speed, direction: (Math.atan2(-point.u, -point.v) * 180) / Math.PI });
    }
  }
  if (points.length < 100) throw new Error(`NCEP display grid retained only ${points.length} cells`);
  return {
    updatedAt: updatedAt || new Date().toISOString(),
    displayResolutionDegrees: NCEP_GFS_NATIVE_RESOLUTION_DEGREES * stride,
    points
  };
}

function findCyclonicVorticityCenter(
  points: WindFieldPoint[],
  reference: Storm["position"] | null
): WindFieldPayload["analysisCenter"] {
  if (!reference || points.length < 9) return undefined;
  const longitudes = [...new Set(points.map((point) => point.lon))].sort((left, right) => left - right);
  const latitudes = [...new Set(points.map((point) => point.lat))].sort((left, right) => left - right);
  if (longitudes.length < 3 || latitudes.length < 3) return undefined;
  const lonStep = longitudes[1] - longitudes[0];
  const latStep = latitudes[1] - latitudes[0];
  if (!Number.isFinite(lonStep) || !Number.isFinite(latStep) || lonStep <= 0 || latStep <= 0) return undefined;

  const index = new Map(points.map((point) => [windSampleKey(point.lon, point.lat), point]));
  let strongest: { lon: number; lat: number; vorticity: number } | null = null;
  for (const point of points) {
    // The field can cover East Asia. Restrict the diagnostic to this storm's
    // synoptic neighbourhood, otherwise another weather system could win.
    if (Math.abs(point.lon - reference.lon) > 5 || Math.abs(point.lat - reference.lat) > 5) continue;
    const west = index.get(windSampleKey(point.lon - lonStep, point.lat));
    const east = index.get(windSampleKey(point.lon + lonStep, point.lat));
    const south = index.get(windSampleKey(point.lon, point.lat - latStep));
    const north = index.get(windSampleKey(point.lon, point.lat + latStep));
    if (!west || !east || !south || !north) continue;
    const dx = 2 * lonStep * 111_320 * Math.max(0.1, Math.cos((point.lat * Math.PI) / 180));
    const dy = 2 * latStep * 111_320;
    const vorticity = (east.v - west.v) / dx - (north.u - south.u) / dy;
    if (!strongest || vorticity > strongest.vorticity) {
      strongest = { lon: point.lon, lat: point.lat, vorticity };
    }
  }
  if (!strongest || strongest.vorticity <= 0) return undefined;
  return { lon: strongest.lon, lat: strongest.lat, method: "peak-cyclonic-vorticity" };
}

function ncepCycleCandidates(now = new Date()) {
  const delayed = new Date(now.getTime() - 4.5 * 60 * 60 * 1000);
  delayed.setUTCMinutes(0, 0, 0);
  delayed.setUTCHours(Math.floor(delayed.getUTCHours() / 6) * 6);
  return Array.from({ length: 4 }, (_, index) => {
    const cycle = new Date(delayed.getTime() - index * 6 * 60 * 60 * 1000);
    return {
      date: `${cycle.getUTCFullYear()}${String(cycle.getUTCMonth() + 1).padStart(2, "0")}${String(cycle.getUTCDate()).padStart(2, "0")}`,
      hour: String(cycle.getUTCHours()).padStart(2, "0")
    };
  });
}

function snapNcepBounds(bounds: WindFieldBounds): WindFieldBounds {
  return {
    west: clamp(Math.floor(bounds.west / 0.25) * 0.25, 0, 359.75),
    east: clamp(Math.ceil(bounds.east / 0.25) * 0.25, 0.25, 359.75),
    south: clamp(Math.floor(bounds.south / 0.25) * 0.25, -90, 89.75),
    north: clamp(Math.ceil(bounds.north / 0.25) * 0.25, -89.75, 90)
  };
}

function windSampleKey(lon: number, lat: number) {
  return `${lon.toFixed(2)}:${lat.toFixed(2)}`;
}

function unavailableWindField(
  viewportBounds: WindFieldBounds | null,
  sampleBounds: WindFieldBounds,
  reason: string
): WindFieldPayload {
    return {
      source: OPEN_METEO_SOURCE,
      updatedAt: new Date().toISOString(),
      status: "unavailable",
      attribution: OPEN_METEO_ATTRIBUTION,
      reason,
      model: "NCEP GFS global via Open-Meteo, 10m wind",
      unit: "m/s",
      points: [],
      sampling: viewportBounds ? "viewport" : "storm",
      coverage: sampleBounds
    };
}

async function loadMetNorwayWindField(
  samplePoints: Array<{ lon: number; lat: number }>,
  sampleBounds: WindFieldBounds
): Promise<WindFieldPayload> {
  const results = await mapWithConcurrency(samplePoints, 4, async (point) => {
    const query = new URLSearchParams({
      lat: point.lat.toFixed(3),
      lon: point.lon.toFixed(3)
    });
    const response = await fetch(`https://api.met.no/weatherapi/locationforecast/2.0/compact?${query.toString()}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": process.env.WEATHER_API_USER_AGENT ?? "TyphoonBossRadar/1.0 local-deployment"
      },
      cache: "no-store"
    });
    if (!response.ok) throw new Error(`MET Norway wind request failed: ${response.status}`);
    const raw = (await response.json()) as MetNorwayResponse;
    const timeseries = raw.properties?.timeseries?.[0];
    const details = timeseries?.data?.instant?.details;
    const speed = details?.wind_speed;
    const direction = details?.wind_from_direction;
    if (!Number.isFinite(speed) || !Number.isFinite(direction)) {
      throw new Error("MET Norway returned an incomplete wind sample.");
    }
    const radians = ((direction as number) * Math.PI) / 180;
    return {
      point: {
        lon: point.lon,
        lat: point.lat,
        u: -(speed as number) * Math.sin(radians),
        v: -(speed as number) * Math.cos(radians),
        speed: speed as number,
        direction: direction as number
      } satisfies WindFieldPoint,
      updatedAt: timeseries?.time ?? raw.properties?.meta?.updated_at ?? new Date().toISOString()
    };
  });
  const samples = results.filter((result): result is { point: WindFieldPoint; updatedAt: string } => Boolean(result));
  if (samples.length < 42) {
    throw new Error(`MET Norway returned only ${samples.length} usable nationwide wind samples.`);
  }
  return {
    source: MET_NORWAY_SOURCE,
    updatedAt: samples[0].updatedAt,
    status: "available",
    attribution: MET_NORWAY_ATTRIBUTION,
    reason: "Open-Meteo 受限时自动切换至独立全球预报源。",
    model: "MET Norway global location forecast, 10m wind",
    unit: "m/s",
    points: samples.map((sample) => sample.point),
    sampling: "viewport",
    coverage: sampleBounds
  };
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
  return queueOpenMeteoRequest(() => fetch(`https://api.open-meteo.com${path}`, init));
}

async function fetchOpenMeteoWithRetry(query: URLSearchParams) {
  if (openMeteoBlockedUntil > Date.now()) {
    throw new Error(`Open-Meteo rate-limit cooldown active until ${new Date(openMeteoBlockedUntil).toISOString()}.`);
  }
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchOpenMeteo(query);
      if (response.status === 429) {
        openMeteoBlockedUntil = Date.now() + retryAfterMs(response.headers.get("Retry-After"));
        return response;
      }
      if (response.ok || attempt === 1 || response.status < 500) return response;
    } catch (error) {
      lastError = error;
    }
    await delay(500 + attempt * 900);
  }
  throw lastError instanceof Error ? lastError : new Error("Open-Meteo wind request failed.");
}

function queueOpenMeteoRequest<T>(task: () => Promise<T>): Promise<T> {
  const run = openMeteoRequestChain.then(async () => {
    const waitMs = Math.max(0, OPEN_METEO_REQUEST_SPACING_MS - (Date.now() - openMeteoLastRequestAt));
    if (waitMs > 0) await delay(waitMs);
    openMeteoLastRequestAt = Date.now();
    return task();
  });
  openMeteoRequestChain = run.then(() => undefined, () => undefined);
  return run;
}

function retryAfterMs(value: string | null) {
  if (!value) return OPEN_METEO_RATE_LIMIT_COOLDOWN_MS;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(60_000, Math.min(seconds * 1000, 30 * 60 * 1000));
  const timestamp = Date.parse(value);
  if (Number.isFinite(timestamp)) return Math.max(60_000, Math.min(timestamp - Date.now(), 30 * 60 * 1000));
  return OPEN_METEO_RATE_LIMIT_COOLDOWN_MS;
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, task: (item: T) => Promise<R>): Promise<Array<R | null>> {
  const results: Array<R | null> = new Array(items.length).fill(null);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = await task(items[index]);
      } catch {
        results[index] = null;
      }
    }
  });
  await Promise.all(workers);
  return results;
}

function windFieldCacheTtl(bounds: WindFieldBounds | null) {
  return isNationwideWindBounds(bounds) ? NATIONAL_WIND_FIELD_CACHE_TTL_MS : WIND_FIELD_CACHE_TTL_MS;
}

function isNationwideWindBounds(bounds: WindFieldBounds | null | undefined) {
  return Boolean(bounds && bounds.east - bounds.west >= 50 && bounds.north - bounds.south >= 30);
}

function shouldPersistWindField(bounds: WindFieldBounds | null) {
  return bounds === null || isNationwideWindBounds(bounds);
}

function staleWindField(payload: WindFieldPayload, reason: string): WindFieldPayload {
  return {
    ...payload,
    status: "available",
    isStale: true,
    lastSuccessfulAt: payload.lastSuccessfulAt ?? payload.updatedAt,
    reason: `最新风场刷新失败，继续使用最后有效数据：${reason}`
  };
}

function persistedWindFieldPath(cacheKey: string) {
  const digest = createHash("sha1").update(cacheKey).digest("hex");
  return join(WIND_FIELD_CACHE_DIR, `${digest}.json`);
}

async function readPersistedWindField(cacheKey: string): Promise<WindFieldPayload | null> {
  try {
    const raw = JSON.parse(await readFile(persistedWindFieldPath(cacheKey), "utf8")) as {
      version?: number;
      savedAt?: string;
      payload?: WindFieldPayload;
    };
    const savedAt = Date.parse(raw.savedAt ?? "");
    if (raw.version !== 1 || !raw.payload || raw.payload.status !== "available" || raw.payload.points.length < 42) return null;
    if (!Number.isFinite(savedAt) || Date.now() - savedAt > PERSISTED_WIND_FIELD_MAX_AGE_MS) return null;
    return raw.payload;
  } catch {
    return null;
  }
}

async function persistWindField(cacheKey: string, payload: WindFieldPayload) {
  try {
    await mkdir(WIND_FIELD_CACHE_DIR, { recursive: true });
    const target = persistedWindFieldPath(cacheKey);
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, JSON.stringify({ version: 1, savedAt: new Date().toISOString(), payload }), "utf8");
    await rename(temporary, target);
  } catch (error) {
    console.warn("[wind-field] failed to persist last successful field", error);
  }
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
  // These products have different publication delays and retention windows.
  // Forcing an equal timestamp made the regional layer follow a stale global
  // frame until NOAA had already removed that regional image. Prefer the newest
  // independently available frame and expose the actual skew to the UI.
  return {
    regional: regional[0] ?? [...regionalFrames].sort(compareFrameNewestFirst)[0],
    global: global[0] ?? [...globalFrames].sort(compareFrameNewestFirst)[0]
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
  // Preserve every source row. Cropping the southern edge while retaining the
  // original geographic bounds stretched the cloud field and displaced it
  // relative to the track and wind layers.
  return renderCloudMask(bytes, { left: 0, top: 0, width, height }, 88, 205);
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

function impactFeature(storm: Storm, level: "r7" | "r10" | "r12") {
  const radius = storm.windRadiiKm.quadrants[level];
  const feature = makeQuadrantWindPolygon(storm.position, radius, 160) as GeoJSON.Feature | null;
  if (!feature) return null;
  feature.properties = {
    stormId: storm.id,
    stormName: storm.nameZh,
    radiusLevel: level,
    radiusKm: radius.max,
    quadrants: { ne: radius.ne, se: radius.se, sw: radius.sw, nw: radius.nw },
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
