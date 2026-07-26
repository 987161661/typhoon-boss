import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { writeFileAtomic } from "@/lib/atomicFile";
import { assertWeatherProviderResponse } from "./weatherProviderBoundary";

const SOURCE_URL = "https://product.weather.com.cn/alarm/grepalarm_cn.php";
const SNAPSHOT_PATH = resolve(process.cwd(), ".runtime/china-weather-national-warnings.json");

const gradeByCode: Record<string, { label: string; severity: number }> = {
  "01": { label: "blue", severity: 1 },
  "02": { label: "yellow", severity: 2 },
  "03": { label: "orange", severity: 3 },
  "04": { label: "red", severity: 4 }
};

export interface ChinaWeatherWarning {
  id: string;
  issuer: string;
  locationId: string;
  issuedAt: string | null;
  typeCode: string;
  gradeCode: string;
  grade: string;
  severity: number;
  longitude: number | null;
  latitude: number | null;
  title: string;
  detailUrl: string;
}

export interface ChinaWeatherWarningSnapshot {
  fetchedAt: string;
  source: string;
  total: number;
  warnings: ChinaWeatherWarning[];
}

export async function refreshChinaWeatherWarnings() {
  const response = await fetch(SOURCE_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; TyphoonBossRadar/1.0)",
      Referer: "https://e.weather.com.cn/alarmMap/index.html"
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000)
  });
  assertWeatherProviderResponse(response, "China Weather warning feed");
  const payload = parseChinaWeatherAlarmScript(await response.text());
  const warnings = payload.data.flatMap((row) => normalizeWarning(row));
  warnings.sort((a, b) => b.severity - a.severity || (Date.parse(b.issuedAt ?? "") || 0) - (Date.parse(a.issuedAt ?? "") || 0));
  const snapshot: ChinaWeatherWarningSnapshot = {
    fetchedAt: new Date().toISOString(),
    source: SOURCE_URL,
    total: warnings.length,
    warnings
  };
  await writeJsonAtomic(SNAPSHOT_PATH, snapshot);
  return snapshot;
}

export async function readChinaWeatherWarnings() {
  try {
    const snapshot = JSON.parse(await readFile(SNAPSHOT_PATH, "utf8")) as ChinaWeatherWarningSnapshot;
    if (!snapshot.fetchedAt || !Array.isArray(snapshot.warnings)) return null;
    return snapshot;
  } catch {
    return null;
  }
}

export function parseChinaWeatherAlarmScript(script: string): { count?: string | number; data: unknown[][] } {
  const match = script.match(/var\s+alarminfo\s*=\s*(\{[\s\S]*\})\s*;?\s*$/);
  if (!match) throw new Error("China Weather warning feed format changed");
  const payload = JSON.parse(match[1]) as { count?: string | number; data?: unknown };
  if (!Array.isArray(payload.data)) throw new Error("China Weather warning feed has no data array");
  return { count: payload.count, data: payload.data.filter((row): row is unknown[] => Array.isArray(row)) };
}

function normalizeWarning(row: unknown[]): ChinaWeatherWarning[] {
  const issuer = text(row[0]);
  const link = text(row[1]);
  const match = link.match(/^(\d+)-(\d{14})-(\d{4})\.html$/);
  if (!issuer || !match) return [];
  const [, locationId, issuedCompact, typeGrade] = match;
  const typeCode = typeGrade.slice(0, 2);
  const gradeCode = typeGrade.slice(2, 4);
  const grade = gradeByCode[gradeCode] ?? { label: "unknown", severity: 0 };
  return [{
    id: link,
    issuer,
    locationId,
    issuedAt: isoFromCompactTime(issuedCompact),
    typeCode,
    gradeCode,
    grade: grade.label,
    severity: grade.severity,
    longitude: numberOrNull(row[2]),
    latitude: numberOrNull(row[3]),
    title: text(row[6]) || `${issuer} warning ${typeGrade}`,
    detailUrl: `https://e.weather.com.cn/alarmMap/detail.html?file=${encodeURIComponent(link)}`
  }];
}

function isoFromCompactTime(value: string) {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}+08:00` : null;
}

function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function numberOrNull(value: unknown) { const number = Number(value); return Number.isFinite(number) ? number : null; }

async function writeJsonAtomic(filePath: string, value: unknown) {
  await writeFileAtomic(filePath, `${JSON.stringify(value)}\n`);
}
