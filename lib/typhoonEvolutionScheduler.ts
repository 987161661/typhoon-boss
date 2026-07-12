import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { readLiveControlSettings } from "./liveControlSettingsStore";

const execFileAsync = promisify(execFile);
const RUN_TIMEOUT_MS = 8 * 60 * 1000;

type SchedulerState = {
  started: boolean;
  running: boolean;
  enabled: boolean;
  intervalMinutes: number;
  timer: NodeJS.Timeout | null;
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastCompletedAt: number | null;
  lastError: string | null;
};

declare global {
  var typhoonEvolutionSchedulerState: SchedulerState | undefined;
}

function schedulerState() {
  const state = globalThis.typhoonEvolutionSchedulerState ?? {
    started: false,
    running: false,
    enabled: false,
    intervalMinutes: 30,
    timer: null,
    nextRunAt: null,
    lastRunAt: null,
    lastCompletedAt: null,
    lastError: null
  };
  globalThis.typhoonEvolutionSchedulerState = state;
  return state;
}

export function startTyphoonEvolutionScheduler() {
  const state = schedulerState();
  if (state.started) return;
  state.started = true;
  void initializeScheduler(state);
}

async function initializeScheduler(state: SchedulerState) {
  await refreshTyphoonEvolutionScheduler(false);
  if (!state.enabled) return;
  await runAgent(state, "startup");
}

export async function refreshTyphoonEvolutionScheduler(runWhenEnabled = true) {
  const state = schedulerState();
  const settings = await readLiveControlSettings();
  const environmentAllowsAgent = process.env.TYPHOON_EVOLUTION_AGENT_ENABLED !== "false";
  const wasEnabled = state.enabled;

  if (state.timer) clearTimeout(state.timer);
  state.timer = null;
  state.nextRunAt = null;
  state.enabled = environmentAllowsAgent && settings.evolutionAgentEnabled;
  state.intervalMinutes = settings.evolutionAgentIntervalMinutes;

  if (!state.enabled) {
    console.info("[typhoon-evolution-agent] scheduler disabled by live settings or environment.");
    return;
  }

  scheduleNextRun(state);
  if (runWhenEnabled && state.started && !wasEnabled) void runAgent(state, "enabled");
}

function scheduleNextRun(state: SchedulerState) {
  const intervalMs = state.intervalMinutes * 60 * 1000;
  const nextAt = Math.floor(Date.now() / intervalMs + 1) * intervalMs;
  const delay = Math.max(1_000, nextAt - Date.now());
  state.nextRunAt = nextAt;
  state.timer = setTimeout(async () => {
    state.timer = null;
    state.nextRunAt = null;
    await runAgent(state, "scheduled");
    if (state.enabled) scheduleNextRun(state);
  }, delay);
  state.timer.unref?.();
  console.info(
    `[typhoon-evolution-agent] scheduler active; ${state.intervalMinutes} minute interval, next run ${new Date(nextAt).toISOString()}.`
  );
}

async function runAgent(
  state: SchedulerState,
  trigger: "startup" | "enabled" | "scheduled"
) {
  if (!state.enabled) return;
  if (state.running) {
    console.warn("[typhoon-evolution-agent] previous run is still active; the overlapping trigger was skipped.");
    return;
  }

  state.running = true;
  state.lastRunAt = Date.now();
  state.lastError = null;
  try {
    const scriptPath = path.join(process.cwd(), "scripts", "run_typhoon_evolution_agent.mjs");
    const { stdout, stderr } = await execFileAsync(process.execPath, [scriptPath], {
      cwd: process.cwd(),
      windowsHide: true,
      timeout: RUN_TIMEOUT_MS,
      env: process.env
    });
    state.lastCompletedAt = Date.now();
    console.info(`[typhoon-evolution-agent] ${trigger} run completed. ${stdout.trim()}`.trim());
    if (stderr.trim()) console.warn(`[typhoon-evolution-agent] ${stderr.trim()}`);
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : String(error);
    console.error(`[typhoon-evolution-agent] ${trigger} run failed.`, error);
  } finally {
    state.running = false;
  }
}

export function getTyphoonEvolutionSchedulerStatus() {
  const state = schedulerState();
  return {
    started: state.started,
    running: state.running,
    enabled: state.enabled,
    intervalMinutes: state.intervalMinutes,
    nextRunAt: state.nextRunAt ? new Date(state.nextRunAt).toISOString() : null,
    lastRunAt: state.lastRunAt ? new Date(state.lastRunAt).toISOString() : null,
    lastCompletedAt: state.lastCompletedAt ? new Date(state.lastCompletedAt).toISOString() : null,
    lastError: state.lastError
  };
}
