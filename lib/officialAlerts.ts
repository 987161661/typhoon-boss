import type { OfficialAlertPayload, OfficialWeatherAlert } from "@/lib/types";

const CWA_URL = "https://cwaopendata.s3.ap-northeast-1.amazonaws.com/Warning/W-C0033-002.json";
const HKO_URL = "https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=warnsum&lang=sc";
let cache: { expiresAt: number; payload: OfficialAlertPayload } | null = null;
let inFlight: Promise<OfficialAlertPayload> | null = null;
let lastSuccess: OfficialAlertPayload | null = null;

export async function getOfficialAlerts(): Promise<OfficialAlertPayload> {
  if (cache && cache.expiresAt > Date.now()) return cache.payload;
  if (inFlight) return inFlight;
  inFlight = load().then((payload) => {
    if (payload.status === "available" && (payload.alerts.length > 0 || payload.tide)) lastSuccess = payload;
    else if (lastSuccess) payload = { ...lastSuccess, reason: payload.reason ?? "官方警特报刷新失败，保留最后有效资料。" };
    cache = { expiresAt: Date.now() + 5 * 60 * 1000, payload };
    return payload;
  }).finally(() => { inFlight = null; });
  return inFlight;
}

async function load(): Promise<OfficialAlertPayload> {
  const [cwa, hko, tide] = await Promise.allSettled([fetchCwa(), fetchHko(), fetchHkoTide()]);
  const alerts = [cwa.status === "fulfilled" ? cwa.value : [], hko.status === "fulfilled" ? hko.value : []].flat();
  const warnings = [cwa, hko, tide].filter((item) => item.status === "rejected").map((item) => item.status === "rejected" ? String(item.reason) : "");
  return {
    source: "CWA + Hong Kong Observatory official warning feeds",
    updatedAt: new Date().toISOString(),
    status: alerts.length > 0 || warnings.length < 3 ? "available" : "unavailable",
    attribution: "台湾中央气象署与香港天文台官方警特报",
    reason: warnings.length ? warnings.join(" | ") : undefined,
    alerts,
    tide: tide.status === "fulfilled" ? tide.value : undefined
  };
}

async function fetchCwa(): Promise<OfficialWeatherAlert[]> {
  const response = await fetch(CWA_URL, { cache: "no-store", signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`CWA warnings HTTP ${response.status}`);
  const raw = await response.json() as { cwaopendata?: { dataset?: unknown } };
  const datasets = Array.isArray(raw.cwaopendata?.dataset) ? raw.cwaopendata.dataset : raw.cwaopendata?.dataset ? [raw.cwaopendata.dataset] : [];
  return datasets.flatMap((entry, index) => {
    const item = entry as { datasetInfo?: { datasetDescription?: string; issueTime?: string; update?: string; validTime?: { endTime?: string } }; contents?: { content?: { contentText?: string } } };
    const info = item.datasetInfo;
    if (!info?.datasetDescription) return [];
    if (info.validTime?.endTime && Date.parse(info.validTime.endTime) < Date.now()) return [];
    return [{ id: `cwa-${info.update ?? info.issueTime ?? index}-${info.datasetDescription}`, source: "CWA" as const, title: info.datasetDescription, description: item.contents?.content?.contentText, issuedAt: info.issueTime ?? info.update ?? new Date().toISOString(), expiresAt: info.validTime?.endTime }];
  });
}

async function fetchHko(): Promise<OfficialWeatherAlert[]> {
  const response = await fetch(HKO_URL, { cache: "no-store", signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`HKO warnings HTTP ${response.status}`);
  const raw = await response.json() as Record<string, { name?: string; code?: string; issueTime?: string; updateTime?: string }>;
  return Object.values(raw).flatMap((item) => item.name ? [{ id: `hko-${item.code ?? item.name}`, source: "HKO" as const, title: item.name, issuedAt: item.issueTime ?? item.updateTime ?? new Date().toISOString(), code: item.code }] : []);
}

async function fetchHkoTide() {
  const hongKong = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const year = hongKong.getUTCFullYear();
  const month = hongKong.getUTCMonth() + 1;
  const day = hongKong.getUTCDate();
  const query = new URLSearchParams({ dataType: "HHOT", lang: "sc", rformat: "json", station: "WAG", year: String(year), month: String(month), day: String(day) });
  const response = await fetch(`https://data.weather.gov.hk/weatherAPI/opendata/opendata.php?${query}`, { cache: "no-store", signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`HKO tide HTTP ${response.status}`);
  const raw = await response.json() as { data?: string[][] };
  const row = raw.data?.[0] ?? [];
  return {
    station: "Waglan Island / 横澜岛",
    date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    unit: "m" as const,
    hourly: row.slice(2, 26).map((value, index) => ({ hour: index + 1, heightM: Number(value) })).filter((point) => Number.isFinite(point.heightM)),
    note: "天文潮预报，不包含风暴增水。"
  };
}
