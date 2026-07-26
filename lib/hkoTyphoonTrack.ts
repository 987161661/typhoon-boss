import type { ForecastScenario, StormStage, TrackPoint } from "@/lib/types";
import { toBeijingIso } from "@/lib/meteorology";

export const HKO_TRACK_URL = "https://www.hko.gov.hk/textonly/v2/tc/tcpc.htm";
export const HKO_TRACK_SOURCE = "香港天文台热带气旋位置";

export interface HkoTyphoonTrack {
  nameZh: string;
  issuedAt: string;
  current: TrackPoint & { stage: StormStage };
  history: Array<TrackPoint & { stage: StormStage }>;
  forecast: TrackPoint[];
}

export async function fetchHkoTyphoonTrack(timeoutMs: number): Promise<HkoTyphoonTrack> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(HKO_TRACK_URL, {
        headers: { Accept: "text/html", "User-Agent": "TyphoonBossRadar/1.0" },
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (!response.ok) throw new Error(`HKO track request failed: ${response.status}`);
      return parseHkoTyphoonTrack(await response.text());
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("HKO track request failed");
}

export function parseHkoTyphoonTrack(html: string): HkoTyphoonTrack {
  const headings = [...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)]
    .map((match) => compactText(match[1]));
  const cycloneHeading = headings.find((heading) => HKO_STAGE_PREFIXES.some((prefix) => heading.startsWith(prefix)));
  if (!cycloneHeading) throw new Error("HKO track page has no active cyclone heading");

  const stagePrefix = HKO_STAGE_PREFIXES.find((prefix) => cycloneHeading.startsWith(prefix));
  const nameZh = cycloneHeading.slice(stagePrefix?.length ?? 0);
  if (!nameZh) throw new Error("HKO track page has no cyclone name");

  const issuedMatch = compactText(html).match(/於(\d{4})年(\d{2})月(\d{2})日(\d{2})時(\d{2})分發出/);
  const issuedAt = issuedMatch ? hktIso(...issuedMatch.slice(1, 6) as [string, string, string, string, string]) : null;
  if (!issuedAt) throw new Error("HKO track page has no valid issue time");

  const blocks = [...html.matchAll(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi)].map((match) => match[1]);
  if (blocks.length < 3) throw new Error("HKO track page is missing position tables");

  const forecast = parsePositionRows(blocks[0]).map(stripStage);
  const currentRows = parsePositionRows(blocks[1]);
  const history = parsePositionRows(blocks[2]);
  const current = currentRows[0];
  if (!current) throw new Error("HKO track page has no current position");

  return {
    nameZh,
    issuedAt,
    current,
    history: [...history, current].sort((a, b) => Date.parse(a.time) - Date.parse(b.time)),
    forecast: forecast.sort((a, b) => Date.parse(a.time) - Date.parse(b.time))
  };
}

export function normalizeHkoName(value: string) {
  const traditionalToSimplified: Record<string, string> = {
    紅: "红", 樺: "桦", 鳳: "凤", 鵑: "鹃", 蘭: "兰", 馬: "马",
    鸚: "鹦", 鵡: "鹉", 風: "风", 蓮: "莲", 雲: "云", 電: "电",
    絲: "丝", 黃: "黄", 薔: "蔷", 鯨: "鲸", 獅: "狮", 龍: "龙", 煙: "烟"
  };
  return value.replace(/\s+/g, "").split("")
    .map((character) => traditionalToSimplified[character] ?? character)
    .join("").toLowerCase();
}

export function mergeHkoForecastScenarios(
  existing: ForecastScenario[],
  report: HkoTyphoonTrack
): ForecastScenario[] {
  if (report.forecast.length === 0) return existing;
  return [{
    id: `HKO-${report.current.time}`,
    agency: "香港天文台",
    agencyCode: "HKO",
    points: report.forecast,
    isPrimary: true
  }, ...existing
    .filter((scenario) => scenario.agencyCode !== "HKO")
    .map((scenario) => ({ ...scenario, isPrimary: false }))];
}

function parsePositionRows(block: string): Array<TrackPoint & { stage: StormStage }> {
  return decodeHtml(block).split(/\r?\n/).map((line) => line.replace(/\s+/g, "")).map((line) => {
    const match = line.match(
      /^(\d{4})年(\d{2})月(\d{2})日(\d{2})時(\d+(?:\.\d+)?)N(\d+(?:\.\d+)?)E(.+?)每小時(\d+)公里$/
    );
    if (!match) return null;
    const time = hktIso(match[1], match[2], match[3], match[4], "00");
    const stage = normalizeHkoStage(match[7]);
    if (!time || !stage) return null;
    return {
      time,
      lat: Number(match[5]),
      lon: Number(match[6]),
      wind: Math.round((Number(match[8]) / 3.6) * 10) / 10,
      pressure: 0,
      stage
    };
  }).filter((point): point is TrackPoint & { stage: StormStage } => point !== null);
}

function stripStage(point: TrackPoint & { stage: StormStage }): TrackPoint {
  return { time: point.time, lat: point.lat, lon: point.lon, wind: point.wind, pressure: point.pressure };
}

function normalizeHkoStage(value: string): StormStage | null {
  if (value.includes("超強颱風")) return "超强台风";
  if (value.includes("強颱風")) return "强台风";
  if (value.includes("颱風")) return "台风";
  if (value.includes("強烈熱帶風暴")) return "强热带风暴";
  if (value.includes("熱帶風暴")) return "热带风暴";
  if (value.includes("熱帶低氣壓")) return "热带低压";
  return null;
}

function hktIso(year: string, month: string, day: string, hour: string, minute: string) {
  return toBeijingIso(`${year}-${month}-${day} ${hour}:${minute}:00`);
}

function compactText(value: string) {
  return decodeHtml(value).replace(/<[^>]+>/g, "").replace(/\s+/g, "");
}

function decodeHtml(value: string) {
  return value.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
}

const HKO_STAGE_PREFIXES = ["超強颱風", "強颱風", "颱風", "強烈熱帶風暴", "熱帶風暴", "熱帶低氣壓"];
