#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MIB = 1024 * 1024;

const CSV_COLUMNS = [
  "sample_index",
  "sampled_at",
  "elapsed_seconds",
  "sample_elapsed_ms",
  "listener_pid",
  "process_name",
  "process_started_at",
  "process_command_line",
  "working_set_bytes",
  "private_bytes",
  "handle_count",
  "thread_count",
  "process_error",
  "national_requested",
  "national_observed_at",
  "national_status",
  "national_latency_ms",
  "national_etag",
  "national_conditional_request",
  "national_conditional_status",
  "national_conditional_304",
  "national_schema_version",
  "national_event_count",
  "national_warning_count",
  "national_storm_count",
  "national_source_health_count",
  "national_radar_frame_count",
  "national_satellite_frame_count",
  "national_product_count",
  "national_city_rank_count",
  "national_error",
  "radar_requested",
  "radar_observed_at",
  "radar_status",
  "radar_latency_ms",
  "radar_etag",
  "radar_conditional_request",
  "radar_conditional_status",
  "radar_conditional_304",
  "radar_active_storm_id",
  "radar_storm_count",
  "radar_boss_count",
  "radar_warning_count",
  "radar_wind_vector_count",
  "radar_error",
  "request_in_flight_peak",
  "schedule_overrun_ms"
];

function parseInteger(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}; received ${value}`);
  }
  return parsed;
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    if (token === "--self-test") {
      values.set("self-test", "true");
      continue;
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      throw new Error(`Missing value for ${token}`);
    }
    values.set(token.slice(2), next);
    index += 1;
  }

  const baseUrl = values.get("base-url") ?? "http://127.0.0.1:3038";
  const portFromUrl = (() => {
    const parsed = new URL(baseUrl);
    if (parsed.port) return Number(parsed.port);
    return parsed.protocol === "https:" ? 443 : 80;
  })();
  const outputDirectory = resolve(values.get("output-directory") ?? "evidence");
  const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const outputPrefix = resolve(values.get("output-prefix") ?? `${outputDirectory}/soak-stability-${timestamp}`);

  return {
    selfTest: values.has("self-test"),
    baseUrl: baseUrl.replace(/\/$/, ""),
    port: parseInteger(values.get("port") ?? portFromUrl, "port", { min: 1, max: 65535 }),
    durationSeconds: parseInteger(values.get("duration-seconds") ?? 7200, "duration-seconds", { min: 1 }),
    sampleIntervalSeconds: parseInteger(values.get("sample-interval-seconds") ?? 10, "sample-interval-seconds", { min: 1 }),
    nationalIntervalSeconds: parseInteger(values.get("national-interval-seconds") ?? 300, "national-interval-seconds", { min: 1 }),
    radarIntervalSeconds: parseInteger(values.get("radar-interval-seconds") ?? 10, "radar-interval-seconds", { min: 1 }),
    requestTimeoutMs: parseInteger(values.get("request-timeout-ms") ?? 8000, "request-timeout-ms", { min: 100 }),
    outputPrefix
  };
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const text = typeof value === "boolean" ? (value ? "true" : "false") : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(samples) {
  const lines = [CSV_COLUMNS.join(",")];
  for (const sample of samples) {
    lines.push(CSV_COLUMNS.map((column) => csvCell(sample[column])).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

function linearSlope(values, intervalSeconds) {
  if (values.length < 2) return 0;
  const stepMinutes = intervalSeconds / 60;
  const xMean = ((values.length - 1) * stepMinutes) / 2;
  const yMean = values.reduce((sum, value) => sum + value, 0) / values.length;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < values.length; index += 1) {
    const x = index * stepMinutes - xMean;
    numerator += x * (values[index] - yMean);
    denominator += x * x;
  }
  return denominator === 0 ? 0 : numerator / denominator;
}

function percentile(values, quantile) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1));
  return sorted[index];
}

function metricSummary(values, intervalSeconds, kind) {
  if (values.length === 0) {
    return { first: null, last: null, peak: null, delta: null, slopePerMinute: null, nonDecreasingRatio: null, continuousAbnormalGrowth: false };
  }
  const comparisons = [];
  for (let index = 1; index < values.length; index += 1) {
    comparisons.push(values[index] >= values[index - 1]);
  }
  const nonDecreasingRatio = comparisons.length === 0 ? 0 : comparisons.filter(Boolean).length / comparisons.length;
  const first = values[0];
  const last = values.at(-1);
  const delta = last - first;
  const slopePerMinute = linearSlope(values, intervalSeconds);
  const thresholds = {
    bytes: { minimumSamples: 12, delta: 128 * MIB, relative: 0.25, slope: 1 * MIB, ratio: 0.7 },
    handles: { minimumSamples: 12, delta: 150, relative: 0.5, slope: 2, ratio: 0.7 },
    threads: { minimumSamples: 12, delta: 20, relative: 0.5, slope: 0.2, ratio: 0.7 }
  }[kind];
  const continuousAbnormalGrowth = values.length >= thresholds.minimumSamples
    && delta >= Math.max(thresholds.delta, first * thresholds.relative)
    && slopePerMinute >= thresholds.slope
    && nonDecreasingRatio >= thresholds.ratio;
  return {
    first,
    last,
    peak: Math.max(...values),
    delta,
    slopePerMinute: Math.round(slopePerMinute * 100) / 100,
    nonDecreasingRatio: Math.round(nonDecreasingRatio * 1000) / 1000,
    continuousAbnormalGrowth
  };
}

function endpointSummary(observations, configuredIntervalSeconds) {
  const requested = observations.filter((observation) => observation.requested);
  const latencies = requested.map((observation) => observation.latencyMs).filter(Number.isFinite);
  const requestTimes = requested.map((observation) => Date.parse(observation.observedAt)).filter(Number.isFinite);
  const gaps = [];
  for (let index = 1; index < requestTimes.length; index += 1) {
    gaps.push((requestTimes[index] - requestTimes[index - 1]) / 1000);
  }
  const cadenceViolations = gaps.filter((gap) => gap < configuredIntervalSeconds * 0.9).length;
  const lateCadenceViolations = gaps.filter((gap) => gap > configuredIntervalSeconds * 1.25).length;
  return {
    requestCount: requested.length,
    httpRequestCount: requested.reduce((sum, observation) => sum + (observation.requestAttemptCount ?? 1), 0),
    status200Count: requested.filter((observation) => observation.status === 200).length,
    status304Count: requested.filter((observation) => observation.status === 304).length,
    conditional304Count: requested.filter((observation) => observation.conditional304).length,
    errorCount: requested.filter((observation) => observation.error).length,
    schemaErrorCount: requested.filter((observation) => observation.schemaError).length,
    etags: [...new Set(requested.map((observation) => observation.etag).filter(Boolean))],
    latencyMs: {
      average: latencies.length === 0 ? null : Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length),
      peak: latencies.length === 0 ? null : Math.max(...latencies),
      p95: percentile(latencies, 0.95)
    },
    cadence: {
      configuredIntervalSeconds,
      minimumObservedGapSeconds: gaps.length === 0 ? null : Math.min(...gaps),
      maximumObservedGapSeconds: gaps.length === 0 ? null : Math.max(...gaps),
      earlyRequestViolations: cadenceViolations,
      lateRequestViolations: lateCadenceViolations
    },
    maximumConsecutiveErrors: maximumConsecutive(requested, (observation) => Boolean(observation.error))
  };
}

function maximumConsecutive(values, predicate) {
  let maximum = 0;
  let current = 0;
  for (const value of values) {
    current = predicate(value) ? current + 1 : 0;
    maximum = Math.max(maximum, current);
  }
  return maximum;
}

async function inspectListenerProcess(port) {
  const script = [
    "$ErrorActionPreference='Stop'",
    `$listener = Get-NetTCPConnection -State Listen -LocalPort ${port} | Sort-Object OwningProcess | Select-Object -First 1`,
    "if ($null -eq $listener) { throw 'No TCP listener found' }",
    "$process = Get-Process -Id $listener.OwningProcess -ErrorAction Stop",
    "$cim = Get-CimInstance Win32_Process -Filter (\"ProcessId = {0}\" -f $process.Id)",
    "[pscustomobject]@{ pid=$process.Id; name=$process.ProcessName; workingSetBytes=[int64]$process.WorkingSet64; privateBytes=[int64]$process.PrivateMemorySize64; handles=$process.HandleCount; threads=$process.Threads.Count; startedAt=$process.StartTime.ToUniversalTime().ToString('o'); commandLine=$cim.CommandLine } | ConvertTo-Json -Compress"
  ].join("; ");
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true,
      timeout: 8000,
      maxBuffer: 1024 * 1024
    });
    return { ...JSON.parse(stdout.trim()), error: null };
  } catch (error) {
    return {
      pid: null,
      name: null,
      workingSetBytes: null,
      privateBytes: null,
      handles: null,
      threads: null,
      startedAt: null,
      commandLine: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function countArray(value) {
  return Array.isArray(value) ? value.length : null;
}

function summarizeNationalPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("national payload is not an object");
  }
  const summary = {
    schemaVersion: payload.schemaVersion ?? null,
    eventCount: countArray(payload.events),
    warningCount: typeof payload.warnings?.total === "number" ? payload.warnings.total : null,
    stormCount: countArray(payload.storms),
    sourceHealthCount: countArray(payload.sourceHealth),
    radarFrameCount: countArray(payload.radar?.frames),
    satelliteFrameCount: countArray(payload.satellite?.frames),
    productCount: countArray(payload.products),
    cityRankCount: typeof payload.cityRankSnapshot?.cityCount === "number" ? payload.cityRankSnapshot.cityCount : null
  };
  if (summary.schemaVersion !== 1 || summary.eventCount === null || summary.warningCount === null || summary.stormCount === null || summary.sourceHealthCount === null) {
    throw new Error(`national schema mismatch: ${JSON.stringify(summary)}`);
  }
  return summary;
}

function summarizeRadarPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("radar payload is not an object");
  }
  const summary = {
    activeStormId: typeof payload.activeStormId === "string" ? payload.activeStormId : null,
    stormCount: countArray(payload.storms),
    bossCount: countArray(payload.bosses),
    warningCount: countArray(payload.warnings),
    windVectorCount: countArray(payload.environment?.windField?.vectors)
  };
  if (summary.stormCount === null || summary.bossCount === null || summary.warningCount === null || !("activeStormId" in payload)) {
    throw new Error(`radar schema mismatch: ${JSON.stringify(summary)}`);
  }
  return summary;
}

function makeEmptyEndpointState(kind) {
  return {
    kind,
    observedAt: null,
    status: null,
    latencyMs: null,
    etag: null,
    conditionalRequest: false,
    conditionalStatus: null,
    conditional304: false,
    error: null,
    schemaError: null,
    summary: kind === "national"
      ? { schemaVersion: null, eventCount: null, warningCount: null, stormCount: null, sourceHealthCount: null, radarFrameCount: null, satelliteFrameCount: null, productCount: null, cityRankCount: null }
      : { activeStormId: null, stormCount: null, bossCount: null, warningCount: null, windVectorCount: null }
  };
}

async function fetchEndpoint(url, previous, timeoutMs, inFlightTracker) {
  const observedAt = new Date().toISOString();
  const conditionalRequest = Boolean(previous.etag);
  const headers = conditionalRequest ? { "If-None-Match": previous.etag } : {};
  const startedAt = performance.now();
  let response;
  let requestAttemptCount = 1;
  inFlightTracker.current += 1;
  inFlightTracker.peak = Math.max(inFlightTracker.peak, inFlightTracker.current);
  try {
    try {
      response = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    } finally {
      inFlightTracker.current -= 1;
    }
    const latencyMs = Math.round(performance.now() - startedAt);
    const etag = response.headers.get("etag") ?? previous.etag;
    let summary = previous.summary;
    let schemaError = null;
    let error = null;
    if (response.status === 200) {
      try {
        const payload = await response.json();
        summary = previous.kind === "national" ? summarizeNationalPayload(payload) : summarizeRadarPayload(payload);
      } catch (caught) {
        schemaError = caught instanceof Error ? caught.message : String(caught);
        error = schemaError;
      }
    } else if (response.status !== 304) {
      const body = await response.text().catch(() => "");
      error = `HTTP ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}`;
    }

    const current = {
      kind: previous.kind,
      observedAt,
      status: response.status,
      latencyMs,
      etag,
      conditionalRequest,
      conditionalStatus: conditionalRequest ? response.status : null,
      conditional304: conditionalRequest && response.status === 304,
      error,
      schemaError,
      summary,
      requestAttemptCount
    };

    // Prove conditional semantics immediately after a new 200 representation.
    // This extra call only happens when the representation changes, not at every sample.
    if (response.status === 200 && etag && !error) {
      requestAttemptCount += 1;
      current.requestAttemptCount = requestAttemptCount;
      const probeStartedAt = performance.now();
      inFlightTracker.current += 1;
      inFlightTracker.peak = Math.max(inFlightTracker.peak, inFlightTracker.current);
      try {
        const probe = await fetch(url, { headers: { "If-None-Match": etag }, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
        current.conditionalStatus = probe.status;
        current.conditional304 = probe.status === 304;
        if (probe.status !== 304) {
          current.error = `conditional ETag probe returned HTTP ${probe.status}`;
        }
        current.latencyMs += Math.round(performance.now() - probeStartedAt);
      } finally {
        inFlightTracker.current -= 1;
      }
    }
    return current;
  } catch (error) {
    return {
      ...previous,
      observedAt,
      status: null,
      latencyMs: Math.round(performance.now() - startedAt),
      conditionalRequest,
      conditionalStatus: null,
      conditional304: false,
      error: error instanceof Error ? error.message : String(error),
      schemaError: null,
      requestAttemptCount
    };
  }
}

function flattenSample({ index, sampledAt, elapsedSeconds, sampleElapsedMs, process, national, nationalRequested, radar, radarRequested, inFlightPeak, scheduleOverrunMs }) {
  return {
    sample_index: index,
    sampled_at: sampledAt,
    elapsed_seconds: elapsedSeconds,
    sample_elapsed_ms: sampleElapsedMs,
    listener_pid: process.pid,
    process_name: process.name,
    process_started_at: process.startedAt,
    process_command_line: process.commandLine,
    working_set_bytes: process.workingSetBytes,
    private_bytes: process.privateBytes,
    handle_count: process.handles,
    thread_count: process.threads,
    process_error: process.error,
    national_requested: nationalRequested,
    national_observed_at: national.observedAt,
    national_status: national.status,
    national_latency_ms: national.latencyMs,
    national_etag: national.etag,
    national_conditional_request: national.conditionalRequest,
    national_conditional_status: national.conditionalStatus,
    national_conditional_304: national.conditional304,
    national_schema_version: national.summary.schemaVersion,
    national_event_count: national.summary.eventCount,
    national_warning_count: national.summary.warningCount,
    national_storm_count: national.summary.stormCount,
    national_source_health_count: national.summary.sourceHealthCount,
    national_radar_frame_count: national.summary.radarFrameCount,
    national_satellite_frame_count: national.summary.satelliteFrameCount,
    national_product_count: national.summary.productCount,
    national_city_rank_count: national.summary.cityRankCount,
    national_error: national.error,
    radar_requested: radarRequested,
    radar_observed_at: radar.observedAt,
    radar_status: radar.status,
    radar_latency_ms: radar.latencyMs,
    radar_etag: radar.etag,
    radar_conditional_request: radar.conditionalRequest,
    radar_conditional_status: radar.conditionalStatus,
    radar_conditional_304: radar.conditional304,
    radar_active_storm_id: radar.summary.activeStormId,
    radar_storm_count: radar.summary.stormCount,
    radar_boss_count: radar.summary.bossCount,
    radar_warning_count: radar.summary.warningCount,
    radar_wind_vector_count: radar.summary.windVectorCount,
    radar_error: radar.error,
    request_in_flight_peak: inFlightPeak,
    schedule_overrun_ms: scheduleOverrunMs
  };
}

function buildSummary(samples, endpointObservations, config, startedAt, finishedAt, interrupted) {
  const validProcessSamples = samples.filter((sample) => Number.isInteger(sample.listener_pid));
  const processMetrics = (column) => validProcessSamples.map((sample) => sample[column]).filter(Number.isFinite);
  const distinctPids = [...new Set(validProcessSamples.map((sample) => sample.listener_pid))];
  const missingConsecutive = maximumConsecutive(samples, (sample) => !Number.isInteger(sample.listener_pid));
  const process = {
    distinctListenerPids: distinctPids,
    pidChangeCount: Math.max(0, distinctPids.length - 1),
    missingSampleCount: samples.length - validProcessSamples.length,
    maximumConsecutiveMissingSamples: missingConsecutive,
    workingSetBytes: metricSummary(processMetrics("working_set_bytes"), config.sampleIntervalSeconds, "bytes"),
    privateBytes: metricSummary(processMetrics("private_bytes"), config.sampleIntervalSeconds, "bytes"),
    handles: metricSummary(processMetrics("handle_count"), config.sampleIntervalSeconds, "handles"),
    threads: metricSummary(processMetrics("thread_count"), config.sampleIntervalSeconds, "threads")
  };
  const national = endpointSummary(endpointObservations.national, config.nationalIntervalSeconds);
  const radar = endpointSummary(endpointObservations.radar, config.radarIntervalSeconds);
  const scheduleOverrunCount = samples.filter((sample) => sample.schedule_overrun_ms > 0).length;
  const hardFailures = [];
  const actualDurationSeconds = Math.round((Date.parse(finishedAt) - Date.parse(startedAt)) / 1000);
  if (samples.length === 0) hardFailures.push("no samples were recorded");
  if (process.missingSampleCount === samples.length) hardFailures.push(`no process listening on port ${config.port} was observed`);
  if (process.maximumConsecutiveMissingSamples >= 3) hardFailures.push(`listener process was missing for ${process.maximumConsecutiveMissingSamples} consecutive samples`);
  if (process.pidChangeCount > 0) hardFailures.push(`listener process changed PID ${process.pidChangeCount} time(s)`);
  if (national.requestCount === 0 || national.status200Count + national.status304Count === 0) hardFailures.push("national situation endpoint never returned 200/304");
  if (radar.requestCount === 0 || radar.status200Count + radar.status304Count === 0) hardFailures.push("legacy radar endpoint never returned 200/304");
  if (national.conditional304Count === 0) hardFailures.push("national situation ETag was not proven by a 304 response");
  if (radar.conditional304Count === 0) hardFailures.push("legacy radar ETag was not proven by a 304 response");
  if (national.schemaErrorCount > 0) hardFailures.push(`national situation schema failed ${national.schemaErrorCount} time(s)`);
  if (radar.schemaErrorCount > 0) hardFailures.push(`legacy radar schema failed ${radar.schemaErrorCount} time(s)`);
  if (national.cadence.earlyRequestViolations > 0) hardFailures.push("national situation requests violated the configured minimum cadence");
  if (radar.cadence.earlyRequestViolations > 0) hardFailures.push("legacy radar requests violated the configured minimum cadence");
  if (national.cadence.lateRequestViolations > 0) hardFailures.push("national situation requests missed the configured cadence");
  if (radar.cadence.lateRequestViolations > 0) hardFailures.push("legacy radar requests missed the configured cadence");
  if (national.maximumConsecutiveErrors >= 3) hardFailures.push(`national situation endpoint failed ${national.maximumConsecutiveErrors} consecutive scheduled requests`);
  if (radar.maximumConsecutiveErrors >= 3) hardFailures.push(`legacy radar endpoint failed ${radar.maximumConsecutiveErrors} consecutive scheduled requests`);
  if (actualDurationSeconds < config.durationSeconds * 0.95) hardFailures.push(`soak ended early after ${actualDurationSeconds}s of ${config.durationSeconds}s`);
  for (const [label, result] of Object.entries({
    workingSetBytes: process.workingSetBytes,
    privateBytes: process.privateBytes,
    handles: process.handles,
    threads: process.threads
  })) {
    if (result.continuousAbnormalGrowth) hardFailures.push(`${label} shows continuous abnormal growth`);
  }
  return {
    startedAt,
    finishedAt,
    interrupted,
    plannedDurationSeconds: config.durationSeconds,
    actualDurationSeconds,
    sampleCount: samples.length,
    sampleSchedule: {
      intervalSeconds: config.sampleIntervalSeconds,
      overrunCount: scheduleOverrunCount,
      peakOverrunMs: samples.length === 0 ? 0 : Math.max(...samples.map((sample) => sample.schedule_overrun_ms))
    },
    process,
    endpoints: { national, radar },
    hardFailures,
    passed: hardFailures.length === 0
  };
}

async function writeEvidence(outputPrefix, report, samples) {
  await mkdir(dirname(outputPrefix), { recursive: true });
  const csvPath = `${outputPrefix}.csv`;
  const jsonPath = `${outputPrefix}.json`;
  await Promise.all([
    writeFile(csvPath, toCsv(samples), "utf8"),
    writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  ]);
  return { csvPath, jsonPath };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runSelfTest() {
  assert(csvCell('a,"b"') === '"a,""b"""', "CSV quoting failed");
  const stable = metricSummary([100, 110, 95, 105, 100, 102, 98, 103, 101, 99, 104, 100], 10, "bytes");
  assert(!stable.continuousAbnormalGrowth, "stable metric was incorrectly flagged");
  const growth = metricSummary(Array.from({ length: 20 }, (_, index) => 100 * MIB + index * 16 * MIB), 10, "bytes");
  assert(growth.continuousAbnormalGrowth, "continuous byte growth was not flagged");
  const national = summarizeNationalPayload({ schemaVersion: 1, events: [], warnings: { total: 0 }, storms: [], sourceHealth: [], radar: { frames: [] }, satellite: { frames: [] }, products: [], cityRankSnapshot: null });
  assert(national.schemaVersion === 1 && national.eventCount === 0, "national schema summary failed");
  const radar = summarizeRadarPayload({ activeStormId: null, storms: [], bosses: [], warnings: [], environment: { windField: { vectors: [] } } });
  assert(radar.stormCount === 0 && radar.activeStormId === null, "radar schema summary failed");
  const cadence = endpointSummary([
    { requested: true, observedAt: "2026-01-01T00:00:00.000Z", latencyMs: 10, status: 200, conditional304: true, error: null, schemaError: null, etag: '"x"' },
    { requested: true, observedAt: "2026-01-01T00:00:10.000Z", latencyMs: 12, status: 304, conditional304: true, error: null, schemaError: null, etag: '"x"' }
  ], 10);
  assert(cadence.cadence.earlyRequestViolations === 0 && cadence.status304Count === 1, "endpoint cadence summary failed");
  assert(cadence.cadence.lateRequestViolations === 0, "on-time endpoint cadence was marked late");
  return { passed: true, checks: ["csv", "growth-detector", "national-schema", "radar-schema", "cadence"] };
}

async function run(config) {
  const startedAt = new Date().toISOString();
  const monotonicStartedAt = performance.now();
  const stopAt = monotonicStartedAt + config.durationSeconds * 1000;
  let interrupted = false;
  process.once("SIGINT", () => { interrupted = true; });
  process.once("SIGTERM", () => { interrupted = true; });

  const samples = [];
  const endpointObservations = { national: [], radar: [] };
  let national = makeEmptyEndpointState("national");
  let radar = makeEmptyEndpointState("radar");
  let nextNationalAt = monotonicStartedAt;
  let nextRadarAt = monotonicStartedAt;
  let nextSampleAt = monotonicStartedAt;
  const inFlightTracker = { current: 0, peak: 0 };

  console.log(JSON.stringify({ event: "soak-start", startedAt, config }));
  while (!interrupted && performance.now() < stopAt) {
    while (!interrupted && performance.now() < nextSampleAt) {
      await sleep(Math.min(nextSampleAt - performance.now(), 1000));
    }
    if (interrupted || performance.now() >= stopAt) break;
    const sampleStartedAt = performance.now();
    const sampledAt = new Date().toISOString();
    const processObservation = await inspectListenerProcess(config.port);
    let nationalRequested = false;
    let radarRequested = false;

    if (sampleStartedAt >= nextNationalAt - 50) {
      nationalRequested = true;
      national = await fetchEndpoint(`${config.baseUrl}/api/national-situation`, national, config.requestTimeoutMs, inFlightTracker);
      endpointObservations.national.push({ ...national, requested: true });
      do {
        nextNationalAt += config.nationalIntervalSeconds * 1000;
      } while (nextNationalAt <= sampleStartedAt);
    }
    if (sampleStartedAt >= nextRadarAt - 50) {
      radarRequested = true;
      radar = await fetchEndpoint(`${config.baseUrl}/api/radar/snapshot`, radar, config.requestTimeoutMs, inFlightTracker);
      endpointObservations.radar.push({ ...radar, requested: true });
      do {
        nextRadarAt += config.radarIntervalSeconds * 1000;
      } while (nextRadarAt <= sampleStartedAt);
    }

    const sampleFinishedAt = performance.now();
    const scheduleOverrunMs = Math.max(0, Math.round(sampleFinishedAt - nextSampleAt - config.sampleIntervalSeconds * 1000));
    const sample = flattenSample({
      index: samples.length,
      sampledAt,
      elapsedSeconds: Math.round((sampleStartedAt - monotonicStartedAt) / 100) / 10,
      sampleElapsedMs: Math.round(sampleFinishedAt - sampleStartedAt),
      process: processObservation,
      national,
      nationalRequested,
      radar,
      radarRequested,
      inFlightPeak: inFlightTracker.peak,
      scheduleOverrunMs
    });
    samples.push(sample);
    console.log(JSON.stringify({ event: "sample", index: sample.sample_index, pid: sample.listener_pid, workingSetBytes: sample.working_set_bytes, nationalStatus: sample.national_status, radarStatus: sample.radar_status, errors: [sample.process_error, sample.national_error, sample.radar_error].filter(Boolean) }));
    nextSampleAt += config.sampleIntervalSeconds * 1000;
    if (nextSampleAt <= sampleFinishedAt) nextSampleAt = sampleFinishedAt;
  }

  const finishedAt = new Date().toISOString();
  const summary = buildSummary(samples, endpointObservations, config, startedAt, finishedAt, interrupted);
  const report = {
    schemaVersion: 1,
    kind: "typhoon-boss-radar-soak-stability",
    config,
    summary,
    samples
  };
  const paths = await writeEvidence(config.outputPrefix, report, samples);
  console.log(JSON.stringify({ event: "soak-finish", ...paths, summary }));
  return summary.passed ? 0 : 1;
}

async function main() {
  try {
    const config = parseArgs(process.argv.slice(2));
    if (config.selfTest) {
      console.log(JSON.stringify(runSelfTest()));
      return 0;
    }
    return await run(config);
  } catch (error) {
    console.error(error instanceof Error ? error.stack : String(error));
    return 2;
  }
}

process.exitCode = await main();
