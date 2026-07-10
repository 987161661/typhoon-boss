import type { Storm } from "@/lib/types";

export type AhiBand = "B03" | "B08" | "B13";

export interface AhiBandState {
  band: AhiBand;
  label: string;
  use: string;
  resolution: "R05" | "R10" | "R20";
  status: "available" | "unavailable";
  segmentCount: number;
  sampleKey: string | null;
  sampleUrl: string | null;
}

export interface AhiEvidenceSummary {
  source: "noaa-himawari-ahi";
  status: "available" | "degraded" | "unavailable";
  sensor: "Himawari-9 AHI";
  dataset: "AHI-L1b-FLDK";
  bucket: "noaa-himawari9";
  slot: string | null;
  updatedAt: string;
  availableBands: AhiBand[];
  bands: AhiBandState[];
  attribution: string;
  warnings: string[];
}

interface S3Object {
  key: string;
  size: number;
}

const S3_BUCKET = "noaa-himawari9";
const S3_BASE_URL = `https://${S3_BUCKET}.s3.amazonaws.com`;
const DATASET = "AHI-L1b-FLDK";
const ATTRIBUTION = "NOAA Open Data / JMA Himawari-9 AHI";
const CACHE_TTL_MS = 5 * 60 * 1000;
const slotCache = new Map<string, { expiresAt: number; objects: S3Object[] }>();

const BANDS: Array<{ band: AhiBand; label: string; use: string; resolution: AhiBandState["resolution"] }> = [
  {
    band: "B13",
    label: "Band 13 Longwave Infrared",
    use: "cloud-top cooling and compact convective-core evidence",
    resolution: "R20"
  },
  {
    band: "B08",
    label: "Band 08 Upper-Level Water Vapor",
    use: "mid/upper-level moisture and outflow evidence",
    resolution: "R20"
  },
  {
    band: "B03",
    label: "Band 03 Visible",
    use: "daytime cloud texture and eyewall organization evidence",
    resolution: "R05"
  }
];

export async function getAhiEvidenceForStorm(storm: Storm): Promise<AhiEvidenceSummary> {
  void storm;
  let lastReason = "no recent Himawari-9 AHI slot matched.";

  for (const slot of recentAhiSlots()) {
    try {
      const objects = await listSlotObjects(slot);
      if (objects.length === 0) {
        lastReason = `${slot.path} had no published objects.`;
        continue;
      }

      const bands = BANDS.map((band) => buildBandState(slot.path, objects, band));
      const availableBands = bands.filter((band) => band.status === "available").map((band) => band.band);
      return {
        source: "noaa-himawari-ahi",
        status: availableBands.length === BANDS.length ? "available" : availableBands.length > 0 ? "degraded" : "unavailable",
        sensor: "Himawari-9 AHI",
        dataset: DATASET,
        bucket: S3_BUCKET,
        slot: slot.path,
        updatedAt: slot.iso,
        availableBands,
        bands,
        attribution: ATTRIBUTION,
        warnings: buildWarnings(availableBands, bands)
      };
    } catch (error) {
      lastReason = error instanceof Error ? error.message : "AHI object listing failed.";
    }
  }

  return emptyAhiEvidence(lastReason);
}

function buildBandState(
  slotPath: string,
  objects: S3Object[],
  band: (typeof BANDS)[number]
): AhiBandState {
  const matches = objects.filter((object) => object.key.includes(`_${band.band}_FLDK_${band.resolution}_`));
  const sampleKey = matches[0]?.key ?? null;
  return {
    band: band.band,
    label: band.label,
    use: band.use,
    resolution: band.resolution,
    status: matches.length > 0 ? "available" : "unavailable",
    segmentCount: matches.length,
    sampleKey,
    sampleUrl: sampleKey ? `${S3_BASE_URL}/${sampleKey}` : null
  };
}

function buildWarnings(availableBands: AhiBand[], bands: AhiBandState[]) {
  const warnings = [
    "AHI raw data is used only as a satellite evidence layer; it does not replace official track, wind radius, pressure, or warning products.",
    "This adapter probes S3 metadata only. Raw DAT.bz2 files still require server-side decompression, calibration, geolocation, and rendering before visual use."
  ];
  if (availableBands.length < bands.length) {
    warnings.push(`Available AHI evidence bands: ${availableBands.length}/${bands.length}. Missing bands are ignored for visual hints.`);
  }
  return warnings;
}

async function listSlotObjects(slot: AhiSlot): Promise<S3Object[]> {
  const cached = slotCache.get(slot.path);
  if (cached && cached.expiresAt > Date.now()) return cached.objects;

  const url = new URL(S3_BASE_URL);
  url.searchParams.set("list-type", "2");
  url.searchParams.set("max-keys", "1000");
  url.searchParams.set("prefix", `${DATASET}/${slot.path}/`);

  const response = await fetch(url, {
    headers: {
      Accept: "application/xml,text/xml",
      "User-Agent": "TyphoonBossRadar/1.0"
    },
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`NOAA Himawari AHI listing failed: HTTP ${response.status}`);

  const objects = parseS3Objects(await response.text());
  if (slotCache.size > 24) slotCache.clear();
  slotCache.set(slot.path, { expiresAt: Date.now() + CACHE_TTL_MS, objects });
  return objects;
}

function parseS3Objects(xml: string): S3Object[] {
  const objects: S3Object[] = [];
  const contentPattern = /<Contents>([\s\S]*?)<\/Contents>/g;
  let contentMatch: RegExpExecArray | null;
  while ((contentMatch = contentPattern.exec(xml))) {
    const key = decodeXml(textBetween(contentMatch[1], "Key"));
    const size = Number(textBetween(contentMatch[1], "Size"));
    if (key && Number.isFinite(size)) objects.push({ key, size });
  }
  return objects;
}

function textBetween(input: string, tag: string) {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`).exec(input);
  return match?.[1] ?? "";
}

function decodeXml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

interface AhiSlot {
  path: string;
  iso: string;
}

function recentAhiSlots(): AhiSlot[] {
  const base = new Date(Date.now() - 25 * 60 * 1000);
  const slots: AhiSlot[] = [];
  for (let index = 0; index < 10; index += 1) {
    const date = new Date(base.getTime() - index * 10 * 60 * 1000);
    date.setUTCMinutes(Math.floor(date.getUTCMinutes() / 10) * 10, 0, 0);
    const yyyy = String(date.getUTCFullYear());
    const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(date.getUTCDate()).padStart(2, "0");
    const hh = String(date.getUTCHours()).padStart(2, "0");
    const minute = String(date.getUTCMinutes()).padStart(2, "0");
    slots.push({
      path: `${yyyy}/${mm}/${dd}/${hh}${minute}`,
      iso: date.toISOString()
    });
  }
  return slots;
}

function emptyAhiEvidence(reason: string): AhiEvidenceSummary {
  return {
    source: "noaa-himawari-ahi",
    status: "unavailable",
    sensor: "Himawari-9 AHI",
    dataset: DATASET,
    bucket: S3_BUCKET,
    slot: null,
    updatedAt: new Date().toISOString(),
    availableBands: [],
    bands: BANDS.map((band) => ({
      band: band.band,
      label: band.label,
      use: band.use,
      resolution: band.resolution,
      status: "unavailable",
      segmentCount: 0,
      sampleKey: null,
      sampleUrl: null
    })),
    attribution: ATTRIBUTION,
    warnings: [reason]
  };
}
