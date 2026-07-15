import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const PRODUCT_API = "https://productsapi.weather.com.cn/products/getOldPicData?type=";
const IMAGE_BASE = "https://pi.weather.com.cn/i/product/pic/l/";
const SNAPSHOT_PATH = resolve(process.cwd(), ".runtime/china-weather-products.json");
const REFRESH_INTERVAL_MS = 30 * 60 * 1_000;

export type ChinaWeatherProductKind = "observed" | "forecast" | "risk" | "analysis" | "marine";

export interface ChinaWeatherProductDefinition {
  id: string;
  kind: ChinaWeatherProductKind;
  label: string;
  target: "environment" | "battle" | "agent" | "environment-and-agent";
}

// National products only. Regional duplicates and lifestyle/news products are
// deliberately excluded; each entry is a distinct operational product.
export const CHINA_WEATHER_PRODUCTS: ChinaWeatherProductDefinition[] = [
  { id: "TY_OBS_PRE_1H", kind: "observed", label: "hourly precipitation", target: "environment-and-agent" },
  { id: "TY_OBS_PRE_6H_CN", kind: "observed", label: "6h precipitation", target: "battle" },
  { id: "TY_OBS_PRE_24H_CN", kind: "observed", label: "24h precipitation", target: "battle" },
  { id: "TY_OBS_TEM_1H", kind: "observed", label: "hourly temperature", target: "environment" },
  { id: "TY_OBS_WIN_1H", kind: "observed", label: "hourly wind", target: "environment" },
  { id: "TY_OBS_GUST_1H_CN", kind: "observed", label: "hourly gust", target: "battle" },
  { id: "TY_OBS_RHU_1H", kind: "observed", label: "hourly relative humidity", target: "environment" },
  { id: "TY_OBS_VIS_1H", kind: "observed", label: "hourly visibility", target: "battle" },
  { id: "JC_LD_BJ", kind: "observed", label: "severe convection monitoring", target: "environment-and-agent" },
  { id: "JC_NQ_TRSFL10", kind: "observed", label: "10cm soil moisture", target: "agent" },
  { id: "TY_FST_ER_24H", kind: "forecast", label: "national precipitation forecast", target: "environment-and-agent" },
  { id: "TY_FST_ETM_24H", kind: "forecast", label: "maximum temperature forecast", target: "environment" },
  { id: "TY_FST_ETN_24H", kind: "forecast", label: "minimum temperature forecast", target: "environment" },
  { id: "YB_QDLWD_XML", kind: "risk", label: "severe convection forecast", target: "battle" },
  { id: "YB_SHZH_24", kind: "risk", label: "flash flood meteorological risk", target: "battle" },
  { id: "YB_DZZH_24", kind: "risk", label: "geological hazard meteorological risk", target: "battle" },
  { id: "YB_ZLZH_24", kind: "risk", label: "waterlogging risk", target: "battle" },
  { id: "YB_JT_24", kind: "risk", label: "transport weather risk", target: "battle" },
  { id: "TY_FST_DUST_24H", kind: "risk", label: "dust forecast", target: "battle" },
  { id: "TY_FST_KW_24H", kind: "risk", label: "air pollution condition forecast", target: "battle" },
  { id: "JC_HY_RDQXJC", kind: "marine", label: "tropical cyclone monitoring bulletin", target: "environment-and-agent" },
  { id: "JC_HY_HPM_SK", kind: "analysis", label: "sea-level pressure analysis", target: "environment" },
  { id: "TY_OBS_EGH_H000", kind: "analysis", label: "surface analysis", target: "environment-and-agent" },
  { id: "TY_OBS_EGH_H850", kind: "analysis", label: "850hPa analysis", target: "environment-and-agent" },
  { id: "TY_OBS_EGH_H700", kind: "analysis", label: "700hPa analysis", target: "environment-and-agent" },
  { id: "TY_OBS_EGH_H500", kind: "analysis", label: "500hPa analysis", target: "environment-and-agent" }
];

export interface ChinaWeatherProductFrame {
  filename: string;
  imageUrl: string;
  productTime: string | null;
  ingestedAt: string | null;
}

export interface ChinaWeatherProductSnapshot {
  fetchedAt: string;
  source: string;
  refreshIntervalMinutes: number;
  products: Array<ChinaWeatherProductDefinition & { frames: ChinaWeatherProductFrame[]; status: "available" | "unavailable"; error?: string }>;
}

export async function refreshChinaWeatherProducts(force = false) {
  const existing = await readChinaWeatherProducts();
  if (!force && existing && Date.now() - Date.parse(existing.fetchedAt) < REFRESH_INTERVAL_MS) return existing;
  const products = await mapWithConcurrency(CHINA_WEATHER_PRODUCTS, 5, async (definition) => {
    try {
      const response = await fetch(`${PRODUCT_API}${encodeURIComponent(definition.id)}`, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; TyphoonBossRadar/1.0)", Referer: "https://products.weather.com.cn/" },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = JSON.parse(await response.text()) as { status?: string; result?: { list?: Array<{ fname?: string; ptime?: string; itime?: string }> } };
      const frames = (payload.result?.list ?? []).flatMap((frame) => {
        const filename = frame.fname?.trim();
        return filename ? [{ filename, imageUrl: `${IMAGE_BASE}${filename}`, productTime: frame.ptime?.trim() || null, ingestedAt: frame.itime?.trim() || null }] : [];
      });
      return { ...definition, frames: frames.slice(0, 8), status: "available" as const };
    } catch (error) {
      return { ...definition, frames: [], status: "unavailable" as const, error: error instanceof Error ? error.message : String(error) };
    }
  });
  const snapshot: ChinaWeatherProductSnapshot = { fetchedAt: new Date().toISOString(), source: "China Weather professional product directory", refreshIntervalMinutes: REFRESH_INTERVAL_MS / 60_000, products };
  await writeJsonAtomic(SNAPSHOT_PATH, snapshot);
  return snapshot;
}

export async function readChinaWeatherProducts() {
  try {
    const snapshot = JSON.parse(await readFile(SNAPSHOT_PATH, "utf8")) as ChinaWeatherProductSnapshot;
    return snapshot.fetchedAt && Array.isArray(snapshot.products) ? snapshot : null;
  } catch { return null; }
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index]);
    }
  }));
  return results;
}

async function writeJsonAtomic(filePath: string, value: unknown) {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}
