import type { Storm } from "@/lib/types";

export type HimawariProduct = "dnc" | "b13" | "b08" | "tre" | "hrp";
export type HimawariArea = "se2" | "r2w" | "r5w";

export interface SatelliteProductState {
  source: "jma-himawari";
  area: HimawariArea;
  product: HimawariProduct;
  time: string | null;
  imageUrl: string | null;
  status: "available" | "unavailable";
  label: string;
  use: string;
  reason?: string;
}

export interface SatelliteProductsSummary {
  source: "jma-himawari";
  status: "available" | "degraded" | "unavailable";
  updatedAt: string;
  area: HimawariArea;
  fallbackAreas: HimawariArea[];
  availableProducts: HimawariProduct[];
  products: SatelliteProductState[];
  warnings: string[];
}

const JMA_BASE_URL = "https://www.data.jma.go.jp/mscweb/data/himawari/img";
const PRODUCTS: Array<{ id: HimawariProduct; label: string; use: string }> = [
  { id: "dnc", label: "Day/Night Composite", use: "卫星底图与云系外观" },
  { id: "b13", label: "Band 13 Infrared", use: "云顶冷却与核心结构视觉提示" },
  { id: "b08", label: "Band 08 Water Vapour", use: "中高层水汽视觉提示" },
  { id: "tre", label: "True Color Reproduction", use: "白天可见光增强参考" },
  { id: "hrp", label: "Heavy Rainfall Potential", use: "暴雨潜势视觉提示" }
];

export async function getHimawariProductsForStorm(storm: Storm, signal?: AbortSignal): Promise<SatelliteProductsSummary> {
  const area = chooseArea(storm);
  const fallbackAreas = (["se2", "r2w", "r5w"] as HimawariArea[]).filter((item) => item !== area);
  const products = await Promise.all(PRODUCTS.map((product) => probeProduct([area, ...fallbackAreas], product.id, signal)));
  const availableProducts = products.filter((product) => product.status === "available").map((product) => product.product);
  const latestProduct = products.find((product) => product.time);
  const fallbackCount = products.filter((product) => product.status === "available" && product.area !== area).length;

  return {
    source: "jma-himawari",
    status: availableProducts.length === PRODUCTS.length ? "available" : availableProducts.length > 0 ? "degraded" : "unavailable",
    updatedAt: latestProduct?.time ? slotToIso(latestProduct.time) : new Date().toISOString(),
    area,
    fallbackAreas,
    availableProducts,
    products,
    warnings:
      availableProducts.length === PRODUCTS.length
        ? fallbackCount > 0
          ? [`Himawari 主区域 ${area} 有 ${fallbackCount} 个产品使用备用区域。`]
          : []
        : [`Himawari ${area} 可用产品 ${availableProducts.length}/${PRODUCTS.length}，缺失产品不会触发对应视觉提示。`]
  };
}

async function probeProduct(areas: HimawariArea[], product: HimawariProduct, signal?: AbortSignal): Promise<SatelliteProductState> {
  const meta = PRODUCTS.find((item) => item.id === product);
  let lastReason = "no current Himawari slot matched.";

  for (const area of areas) {
    for (const slot of recentSlots()) {
      const imageUrl = jmaProductUrl(area, product, slot);
      try {
        const response = await fetchWithTimeout(imageUrl, "HEAD", signal);
        const fallbackResponse = response.ok ? response : await fetchWithTimeout(imageUrl, "GET", signal);
        if (fallbackResponse.ok && String(fallbackResponse.headers.get("content-type") ?? "").includes("image")) {
          return {
            source: "jma-himawari",
            area,
            product,
            time: slot,
            imageUrl,
            status: "available",
            label: meta?.label ?? product,
            use: meta?.use ?? "卫星产品视觉提示"
          };
        }
        lastReason = `HTTP ${fallbackResponse.status}`;
      } catch (error) {
        lastReason = error instanceof Error ? error.message : "request failed";
      }
    }
  }

  return {
    source: "jma-himawari",
    area: areas[0],
    product,
    time: null,
    imageUrl: null,
    status: "unavailable",
    label: meta?.label ?? product,
    use: meta?.use ?? "卫星产品视觉提示",
    reason: lastReason
  };
}

async function fetchWithTimeout(url: string, method: "HEAD" | "GET", outerSignal?: AbortSignal) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6500);
  try {
    return await fetch(url, {
      method,
      headers: {
        Accept: "image/jpeg,image/*",
        ...(method === "GET" ? { Range: "bytes=0-0" } : {}),
        "User-Agent": "TyphoonBossRadar/1.0"
      },
      cache: "no-store",
      signal: outerSignal ? AbortSignal.any([controller.signal, outerSignal]) : controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

function chooseArea(storm: Storm): HimawariArea {
  const { lon, lat } = storm.position;
  if (lon >= 118 && lon <= 150 && lat >= 0 && lat <= 35) return "se2";
  if (lon >= 105 && lon < 130) return "r2w";
  return "r5w";
}

function recentSlots() {
  const base = new Date(Date.now() - 20 * 60 * 1000);
  const slots: string[] = [];
  for (let index = 0; index < 6; index += 1) {
    const date = new Date(base.getTime() - index * 10 * 60 * 1000);
    date.setUTCMinutes(Math.floor(date.getUTCMinutes() / 10) * 10, 0, 0);
    const hh = String(date.getUTCHours()).padStart(2, "0");
    const mm = String(date.getUTCMinutes()).padStart(2, "0");
    slots.push(`${hh}${mm}`);
  }
  return [...new Set(slots)];
}

function jmaProductUrl(area: HimawariArea, product: HimawariProduct, slot: string) {
  return `${JMA_BASE_URL}/${area}/${area}_${product}_${slot}.jpg`;
}

function slotToIso(slot: string) {
  const date = new Date();
  date.setUTCHours(Number(slot.slice(0, 2)), Number(slot.slice(2, 4)), 0, 0);
  if (date.getTime() - Date.now() > 30 * 60 * 1000) date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString();
}
