import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { EcmwfStormTrack, EcmwfTrackPayload } from "@/lib/types";

const execFileAsync = promisify(execFile);
const CACHE_TTL_MS = 30 * 60 * 1000;
const RETRY_TTL_MS = 3 * 60 * 1000;
const RUNTIME_DIR = join(process.cwd(), ".runtime", "ecmwf");
const PYTHON_PACKAGES = join(process.cwd(), ".runtime", "python-packages");
const DECODER = join(process.cwd(), "scripts", "decode_ecmwf_tc.py");
let cache: { expiresAt: number; payload: EcmwfTrackPayload } | null = null;
let inFlight: Promise<EcmwfTrackPayload> | null = null;
let bootstrap: Promise<void> | null = null;
let lastSuccess: EcmwfTrackPayload | null = null;

export async function getEcmwfTracks(): Promise<EcmwfTrackPayload> {
  if (cache && cache.expiresAt > Date.now()) return cache.payload;
  if (inFlight) return inFlight;
  inFlight = loadEcmwfTracks().then((payload) => {
    if (payload.status === "available") lastSuccess = payload;
    else if (lastSuccess) payload = { ...lastSuccess, isStale: true, reason: payload.reason ?? "ECMWF refresh failed; using last valid tracks." };
    cache = { expiresAt: Date.now() + (payload.status === "available" ? CACHE_TTL_MS : RETRY_TTL_MS), payload };
    return payload;
  }).finally(() => { inFlight = null; });
  return inFlight;
}

async function loadEcmwfTracks(): Promise<EcmwfTrackPayload> {
  const warnings: string[] = [];
  for (const cycle of cycleCandidates()) {
    try {
      await ensureDecoder();
      const step = cycle.hour === "00" || cycle.hour === "12" ? 360 : 144;
      const root = `https://data.ecmwf.int/forecasts/${cycle.date}/${cycle.hour}z/ifs/0p25`;
      const [deterministic, ensemble] = await Promise.all([
        fetchAndDecode(`${root}/oper/${cycle.date}${cycle.hour}0000-${step}h-oper-tf.bufr`, "oper"),
        fetchAndDecode(`${root}/enfo/${cycle.date}${cycle.hour}0000-${step}h-enfo-tf.bufr`, "enfo")
      ]);
      return {
        source: "ECMWF Open Data IFS TC tracks",
        updatedAt: `${cycle.date.slice(0, 4)}-${cycle.date.slice(4, 6)}-${cycle.date.slice(6, 8)}T${cycle.hour}:00:00Z`,
        status: "available",
        attribution: "ECMWF open-data IFS control and ensemble tropical cyclone trajectories",
        cycle: `${cycle.date} ${cycle.hour}Z`,
        deterministic: northwestPacific(deterministic),
        ensemble: northwestPacific(ensemble)
      };
    } catch (error) {
      warnings.push(`${cycle.date}${cycle.hour}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return {
    source: "ECMWF Open Data IFS TC tracks",
    updatedAt: new Date().toISOString(),
    status: "unavailable",
    attribution: "ECMWF open-data IFS control and ensemble tropical cyclone trajectories",
    cycle: "unavailable",
    deterministic: [],
    ensemble: [],
    reason: warnings.join(" | ")
  };
}

async function ensureDecoder() {
  if (bootstrap) return bootstrap;
  bootstrap = (async () => {
    try {
      await readFile(join(PYTHON_PACKAGES, "eccodes", "__init__.py"));
      return;
    } catch {
      await mkdir(PYTHON_PACKAGES, { recursive: true });
      await execFileAsync(process.env.PYTHON_PATH ?? "python", ["-m", "pip", "install", "--disable-pip-version-check", "--target", PYTHON_PACKAGES, "eccodes==2.47.0"], { windowsHide: true, timeout: 180_000, maxBuffer: 4 * 1024 * 1024 });
    }
  })();
  return bootstrap;
}

async function fetchAndDecode(url: string, label: string): Promise<EcmwfStormTrack[]> {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(25_000) });
  if (!response.ok) throw new Error(`${label} HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 8 || String.fromCharCode(...bytes.slice(0, 4)) !== "BUFR") throw new Error(`${label} response was not BUFR`);
  await mkdir(RUNTIME_DIR, { recursive: true });
  const path = join(RUNTIME_DIR, `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}.bufr`);
  try {
    await writeFile(path, bytes);
    const env = { ...process.env, PYTHONPATH: [PYTHON_PACKAGES, process.env.PYTHONPATH].filter(Boolean).join(";") };
    const { stdout } = await execFileAsync(process.env.PYTHON_PATH ?? "python", [DECODER, path], { env, windowsHide: true, timeout: 60_000, maxBuffer: 32 * 1024 * 1024 });
    const parsed = JSON.parse(stdout) as { storms?: EcmwfStormTrack[] };
    return parsed.storms ?? [];
  } finally {
    await rm(path, { force: true }).catch(() => undefined);
  }
}

function northwestPacific(storms: EcmwfStormTrack[]) {
  return storms.filter((storm) => storm.members.some((member) => member.points.some((point) => point.lon >= 100 && point.lon <= 180 && point.lat >= 0 && point.lat <= 50)));
}

function cycleCandidates(now = new Date()) {
  const delayed = new Date(now.getTime() - 10 * 60 * 60 * 1000);
  delayed.setUTCMinutes(0, 0, 0);
  delayed.setUTCHours(Math.floor(delayed.getUTCHours() / 6) * 6);
  return Array.from({ length: 6 }, (_, index) => {
    const value = new Date(delayed.getTime() - index * 6 * 60 * 60 * 1000);
    return { date: value.toISOString().slice(0, 10).replaceAll("-", ""), hour: String(value.getUTCHours()).padStart(2, "0") };
  });
}
