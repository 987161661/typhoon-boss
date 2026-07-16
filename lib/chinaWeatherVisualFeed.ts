import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { assertWeatherProviderResponse, describeWeatherProviderFailure } from "./weatherProviderBoundary";

const SNAPSHOT_PATH = resolve(process.cwd(), ".runtime/china-weather-visuals.json");
const RADAR_INDEX = "https://d1.weather.com.cn/radar/JC_RADAR_CHN_JB_V3.html";
const SATELLITE_INDEX = "https://d1.weather.com.cn/satellite2015/JC_YT_DL_WXZXCSYT_4B.html";
const IMAGE_BASE = "https://pi.weather.com.cn/i/product/pic/l/";

export interface ChinaWeatherVisualFrame {
  observedAt: string | null;
  filename: string;
  imageUrl: string | null;
}

export interface ChinaWeatherVisualSnapshot {
  fetchedAt: string;
  source: string;
  radar: { status: "available" | "unavailable"; frames: ChinaWeatherVisualFrame[]; error?: string };
  satellite: { status: "available" | "unavailable"; frames: ChinaWeatherVisualFrame[]; sourceEndpoint: string; error?: string };
}

export async function refreshChinaWeatherVisuals() {
  const [radar, satellite] = await Promise.all([fetchRadar(), fetchSatellite()]);
  const snapshot: ChinaWeatherVisualSnapshot = {
    fetchedAt: new Date().toISOString(),
    source: "China Weather radar and satellite index feeds",
    radar,
    satellite
  };
  await writeJsonAtomic(SNAPSHOT_PATH, snapshot);
  return snapshot;
}

export async function readChinaWeatherVisuals() {
  try {
    const snapshot = JSON.parse(await readFile(SNAPSHOT_PATH, "utf8")) as ChinaWeatherVisualSnapshot;
    return snapshot.fetchedAt && snapshot.radar && snapshot.satellite ? snapshot : null;
  } catch { return null; }
}

async function fetchRadar() {
  try {
    const payload = await fetchJsonp(RADAR_INDEX, "readerinfo") as { radars?: Array<{ fn1?: string; dt?: string }> };
    const frames = (payload.radars ?? []).flatMap((item) => {
      const filename = item.fn1?.trim();
      return filename ? [{ filename, observedAt: item.dt?.trim() || null, imageUrl: `${IMAGE_BASE}${filename}` }] : [];
    });
    return { status: "available" as const, frames: frames.slice(-12).reverse() };
  } catch (error) {
    return { status: "unavailable" as const, frames: [], error: describeWeatherProviderFailure("China Weather radar index", error).message };
  }
}

async function fetchSatellite() {
  try {
    const payload = await fetchJsonp(SATELLITE_INDEX, "readSatellite") as { radars?: Array<{ fn?: string; ft?: string; dt?: string }> };
    // The official index exposes a frame identity and time, but no stable public
    // image URL contract. Keep it as an evidence index until that contract is verified.
    const frames = (payload.radars ?? []).flatMap((item) => {
      const filename = [item.fn?.trim(), item.ft?.trim()].filter(Boolean).join("_");
      return filename ? [{ filename, observedAt: item.dt?.trim() || null, imageUrl: null }] : [];
    });
    return { status: "available" as const, frames: frames.slice(-12).reverse(), sourceEndpoint: SATELLITE_INDEX };
  } catch (error) {
    return { status: "unavailable" as const, frames: [], sourceEndpoint: SATELLITE_INDEX, error: describeWeatherProviderFailure("China Weather satellite index", error).message };
  }
}

async function fetchJsonp(url: string, callback: string) {
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", Referer: "https://products.weather.com.cn/" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000)
  });
  assertWeatherProviderResponse(response, `China Weather ${callback} index`);
  const text = (await response.text()).trim();
  return parseChinaWeatherJsonp(text, callback);
}

export function parseChinaWeatherJsonp(text: string, callback: string) {
  const prefix = `${callback}(`;
  if (!text.startsWith(prefix) || !text.endsWith(")")) throw new Error("Unexpected JSONP payload");
  // The official feed is JSONP-like rather than strict JSON: frame objects use
  // single-quoted keys/strings. It contains no executable expressions, so
  // normalize that wire quirk instead of evaluating the remote response.
  return JSON.parse(text.slice(prefix.length, -1).replaceAll("'", "\""));
}

async function writeJsonAtomic(filePath: string, value: unknown) {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}
