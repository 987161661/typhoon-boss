import { promises as fs } from "node:fs";
import path from "node:path";
import type { Storm } from "@/lib/types";
import type {
  BossEvidenceLevel,
  BossStructureSignals,
  BossStructureSummary,
  CoreStructureState
} from "./types";

const JTWC_LABEL = "JTWC 热带气旋结构分析";
const LEDGER_VERSION = 1;
const CACHE_TTL_MS = 8 * 60 * 1000;
const FAILURE_CACHE_TTL_MS = 45 * 1000;
const MAX_TRANSITIONS_PER_STORM = 80;
const STRUCTURE_CACHE_VERSION = "lifecycle-v1";
const RUNTIME_DIR = process.env.BOSS_RUNTIME_DIR
  ? path.resolve(process.env.BOSS_RUNTIME_DIR)
  : path.join(process.cwd(), ".runtime");
const LEDGER_PATH = path.join(RUNTIME_DIR, "storm-structure-ledger.json");

const ACTIVE_REPLACEMENT_STATES = new Set<CoreStructureState>([
  "secondary-ring-forming",
  "replacement-active",
  "replacement-stalled"
]);

const STRUCTURE_LABELS: Record<CoreStructureState, string> = {
  unknown: "内核结构待确认",
  "stable-eye": "稳定眼墙",
  "secondary-ring-forming": "第二眼墙生成",
  "replacement-active": "眼壁置换进行中",
  "replacement-stalled": "眼壁蜕变受阻",
  "replacement-completed": "外环继位完成",
  "replacement-collapsed": "置换结构崩解",
  "overland-dissipation": "登陆后内核衰减"
};

interface StructureTransition {
  id: string;
  state: CoreStructureState;
  bulletinId: string | null;
  observedAt: string;
  monitoredCycle: number | null;
}

interface StormLedgerEntry {
  lastState: CoreStructureState;
  monitoredCycle: number;
  lastSummary: BossStructureSummary;
  transitions: StructureTransition[];
}

interface StructureLedger {
  version: number;
  storms: Record<string, StormLedgerEntry>;
}

interface CachedStructure {
  expiresAt: number;
  value: BossStructureSummary;
}

const structureCache = new Map<string, CachedStructure>();
const structureInFlight = new Map<string, Promise<BossStructureSummary>>();
let ledgerReadPromise: Promise<StructureLedger> | null = null;
let ledgerWriteQueue: Promise<void> = Promise.resolve();

export async function getStormStructureIntelligence(storm: Storm): Promise<BossStructureSummary> {
  const source = jtwcSourceForStorm(storm);
  const cacheKey = `${STRUCTURE_CACHE_VERSION}:${storm.id}:${source.url}`;
  const cached = structureCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const inFlight = structureInFlight.get(cacheKey);
  if (inFlight) return inFlight;

  // This request intentionally outlives the rendering budget. A slow source
  // must refresh the local ledger in the background instead of being aborted
  // on every live-page render and never becoming the next valid snapshot.
  const request = loadStormStructure(storm, source)
    .then((value) => {
      const ttl = value.source === "unavailable" ? FAILURE_CACHE_TTL_MS : value.stale ? 2 * 60 * 1000 : CACHE_TTL_MS;
      structureCache.set(cacheKey, { expiresAt: Date.now() + ttl, value });
      structureInFlight.delete(cacheKey);
      return value;
    })
    .catch((error) => {
      structureInFlight.delete(cacheKey);
      throw error;
    });
  structureInFlight.set(cacheKey, request);
  return request;
}

async function loadStormStructure(storm: Storm, source: ReturnType<typeof jtwcSourceForStorm>) {
  try {
    const bulletin = await fetchJtwcBulletin(source);
    const observation = parseJtwcStructureBulletin(bulletin.text, storm, bulletin.url);
    return persistObservation(storm.id, observation);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "JTWC structure request failed.";
    const previousEntry = (await readLedger()).storms[storm.id];
    const previous = previousEntry?.lastSummary;
    if (previous) {
      return {
        ...previous,
        historyCount: previousEntry.transitions.length,
        stale: true,
        warnings: [...previous.warnings, reason]
      };
    }
    return unknownStructure(storm, reason, source.url);
  }
}

/**
 * Returns the most recent locally retained JTWC structure record immediately.
 * The live request is deliberately allowed to refresh it separately, so a slow
 * or blocked upstream does not erase an already observed eyewall timeline.
 */
export async function getPersistedStormStructure(stormId: string): Promise<BossStructureSummary | null> {
  const entry = (await readLedger()).storms[stormId];
  if (!entry) return null;
  return {
    ...entry.lastSummary,
    historyCount: entry.transitions.length,
    stale: true,
    warnings: [...entry.lastSummary.warnings, "实时 JTWC 结构源正在刷新；当前展示本地已记录通报。"]
  };
}

async function fetchJtwcBulletin(source: ReturnType<typeof jtwcSourceForStorm>) {
  // The official reasoning message is the preferred source for an active
  // eyewall cycle. NRL's ATCF mirror is fetched in parallel because it
  // retains the official warning, final-warning and dissipation lifecycle
  // statements when the JTWC product endpoint blocks this runtime.
  const [reasoning, warning] = await Promise.allSettled([
    fetchTextBulletin(source.url, "PROGNOSTIC REASONING"),
    fetchTextBulletin(source.warningUrl, "WARNING NR")
  ]);
  if (reasoning.status === "fulfilled") return { text: reasoning.value, url: source.url };
  if (warning.status === "fulfilled") return { text: warning.value, url: source.warningUrl };
  const reasons = [reasoning, warning]
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));
  throw new Error(reasons.join("; ") || "JTWC structure bulletin unavailable.");
}

async function fetchTextBulletin(url: string, expectedText: string) {
  const controller = new AbortController();
  const timeoutMs = url.includes("nrlmry.navy.mil") ? 8_000 : 2_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { Accept: "text/plain", "User-Agent": "TyphoonBossRadar/1.0" },
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`JTWC text bulletin HTTP ${response.status}.`);
    const text = await response.text();
    if (!text.toUpperCase().includes(expectedText)) {
      throw new Error(`JTWC response did not contain ${expectedText}.`);
    }
    return text;
  } catch (error) {
    throw new Error(describeFetchError(error, "JTWC text bulletin unavailable."));
  } finally {
    clearTimeout(timeout);
  }
}

function describeFetchError(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  const cause = error.cause as { code?: string; message?: string } | undefined;
  const causeText = cause?.code ?? cause?.message;
  return causeText ? `${error.message} (${causeText})` : error.message;
}

export function parseJtwcStructureBulletin(text: string, storm: Storm, sourceUrl: string): BossStructureSummary {
  const normalized = text.replace(/\s+/g, " ").toUpperCase();
  const expectedName = storm.nameEn.trim().toUpperCase();
  if (expectedName && !normalized.includes(`(${expectedName})`) && !normalized.includes(` ${expectedName} `)) {
    throw new Error(`JTWC bulletin identity did not match ${expectedName}.`);
  }
  const warningNumber = /WARNING NR\s+(\d+)/.exec(normalized)?.[1] ?? null;
  const bulletinId = warningNumber ? `JTWC-W${Number(warningNumber)}` : "JTWC-CURRENT";
  const observedAt = parseJtwcObservedAt(text) ?? new Date().toISOString();
  const lifecycleState = classifyLifecycleState(normalized);
  const mentionsReplacement = /EYEWALL REPLACEMENT|CONCENTRIC EYEWALL|\bERC\b/.test(normalized);
  const state = lifecycleState ?? (mentionsReplacement ? classifyReplacementState(normalized) : classifyNonReplacementState(normalized));
  const signals = lifecycleState ? emptyStructureSignals() : extractStructureSignals(normalized);
  const confidence = state === "unknown" ? 0.28 : state === "stable-eye" ? 0.72 : 0.94;
  const evidenceLevel: BossEvidenceLevel = state === "unknown" ? "visualHint" : "confirmed";

  return {
    state,
    stateLabel: STRUCTURE_LABELS[state],
    cycleOrdinal: null,
    monitoredCycle: null,
    cycleLabel: "轮次待确认",
    confidence,
    evidenceLevel,
    source: "jtwc",
    sourceLabel: sourceUrl.includes("nrlmry.navy.mil") ? "JTWC 警报（NRL ATCF 镜像）" : JTWC_LABEL,
    sourceUrl,
    bulletinId,
    observedAt,
    detail: buildStructureDetail(state, signals, bulletinId),
    signals,
    stale: false,
    warnings:
      state === "unknown"
        ? [`${bulletinId} 未包含可归一化的眼墙结构结论。`]
        : ["结构状态来自JTWC业务分析，不等同中国气象部门预警等级。"]
  };
}

function classifyLifecycleState(text: string): CoreStructureState | null {
  const terminalOverland = /FINAL WARNING|DISSIPATED AS A SIGNIFICANT TROPICAL CYCLONE OVER LAND|DISSIPATING AS A SIGNIFICANT TROPICAL CYCLONE OVER LAND/;
  return terminalOverland.test(text) ? "overland-dissipation" : null;
}

function classifyReplacementState(text: string): CoreStructureState {
  if (/ERC[^.]{0,120}(FAILED|COLLAPSED|DISSIPATED)|OUTER EYEWALL[^.]{0,100}(COLLAPSED|DISSIPATED)/.test(text)) {
    return "replacement-collapsed";
  }
  if (/STALLED|INCOMPLETE EYEWALL REPLACEMENT|ERC PROCESS REMAINS STALLED|STRUGGLING[^.]{0,160}ERC/.test(text)) {
    return "replacement-stalled";
  }
  if (!/INCOMPLETE|NOT COMPLETE/.test(text) && /EYEWALL REPLACEMENT[^.]{0,120}(COMPLETE|COMPLETED)|COMPLETED[^.]{0,80}ERC/.test(text)) {
    return "replacement-completed";
  }
  if (/UNDERGOING|ONGOING|IN PROGRESS|PROGRESS OF THE EYEWALL REPLACEMENT|CONCENTRIC MAX WIND RINGS/.test(text)) {
    return "replacement-active";
  }
  if (/SECONDARY EYEWALL|OUTER EYEWALL[^.]{0,100}(FORMING|DEVELOPING|ORGANIZING)/.test(text)) {
    return "secondary-ring-forming";
  }
  return "replacement-active";
}

function classifyNonReplacementState(text: string): CoreStructureState {
  if (/WELL-DEFINED EYE|SYMMETRIC EYE|CLOSED EYEWALL/.test(text)) return "stable-eye";
  return "unknown";
}

function extractStructureSignals(text: string): BossStructureSignals {
  const innerEyewall: BossStructureSignals["innerEyewall"] = /INNER EYEWALL[^.]{0,100}(COLLAPS|DISSIPAT)/.test(text)
    ? "collapsed"
    : /PARTIAL INNER EYEWALL|EYEWALL FRAGMENT|HOLLOWED OUT INNER CORE/.test(text)
      ? "partial"
      : /INNER EYEWALL[^.]{0,100}(INTACT|CLOSED|COMPLETE)/.test(text)
        ? "intact"
        : "unknown";
  const outerEyewall: BossStructureSignals["outerEyewall"] = /CAN BARELY BE SAID TO EXIST|OUTER[^.]{0,100}FRAGMENT/.test(text)
    ? "fragmented"
    : /OUTER EYEWALL[^.]{0,100}(CLOSED|COMPLETE)|CLOSED[^.]{0,80}OUTER EYEWALL/.test(text)
      ? "closed"
      : /SECONDARY EYEWALL|OUTER EYEWALL|OUTER CONCENTRIC CONVECTIVE RING/.test(text)
        ? "forming"
        : "unknown";
  const radii = [...text.matchAll(/(\d{1,3})\s*NM(?:\s+RADIUS|\s+RADII)?/g)]
    .map((match) => Number(match[1]))
    .filter((value) => value >= 5 && value <= 200);

  return {
    innerEyewall,
    outerEyewall,
    innerRadiusNm: radii.length >= 2 ? Math.min(...radii) : null,
    outerRadiusNm: radii.length >= 2 ? Math.max(...radii) : radii[0] ?? null
  };
}

function emptyStructureSignals(): BossStructureSignals {
  return { innerEyewall: "unknown", outerEyewall: "unknown", innerRadiusNm: null, outerRadiusNm: null };
}

function buildStructureDetail(state: CoreStructureState, signals: BossStructureSignals, bulletinId: string) {
  const radiusText =
    signals.innerRadiusNm && signals.outerRadiusNm
      ? `内外风环约 ${signals.innerRadiusNm}/${signals.outerRadiusNm} 海里。`
      : signals.outerRadiusNm
        ? `外围结构半径约 ${signals.outerRadiusNm} 海里。`
        : "";
  const details: Record<CoreStructureState, string> = {
    unknown: `${bulletinId} 尚无可确认的内核结构结论。`,
    "stable-eye": `${bulletinId} 显示眼墙结构较完整。`,
    "secondary-ring-forming": `${bulletinId} 显示外围对流环正在组织，可能进入眼壁置换。`,
    "replacement-active": `${bulletinId} 确认眼壁置换正在进行。`,
    "replacement-stalled": `${bulletinId} 确认眼壁置换受阻，外环尚未完成接管。`,
    "replacement-completed": `${bulletinId} 确认外眼壁已完成接管。`,
    "replacement-collapsed": `${bulletinId} 显示外围置换结构已经瓦解。`,
    "overland-dissipation": `${bulletinId} 确认系统已登陆并在陆地上衰减，眼墙置换判读结束。`
  };
  return `${details[state]}${radiusText}`;
}

async function persistObservation(stormId: string, observation: BossStructureSummary) {
  const operation = ledgerWriteQueue.then(async () => {
    const ledger = await readLedger();
    const previous = ledger.storms[stormId];
    const previousActive = previous ? ACTIVE_REPLACEMENT_STATES.has(previous.lastState) : false;
    const nextActive = ACTIVE_REPLACEMENT_STATES.has(observation.state);
    let monitoredCycle = previous?.monitoredCycle ?? 0;

    if (nextActive && !previousActive) monitoredCycle += 1;
    if (nextActive && monitoredCycle === 0) monitoredCycle = 1;
    if (!nextActive && observation.state !== "replacement-completed") {
      monitoredCycle = previous?.monitoredCycle ?? monitoredCycle;
    }

    const cycleLabel = observation.state === "overland-dissipation"
      ? "登陆后衰减 · 眼墙判读结束"
      :
      observation.cycleOrdinal !== null
        ? `第 ${observation.cycleOrdinal} 轮`
        : monitoredCycle > 0
          ? `监测期第 ${monitoredCycle} 轮 · 历史待回溯`
          : "轮次待确认";
    const summary: BossStructureSummary = {
      ...observation,
      monitoredCycle: monitoredCycle || null,
      cycleLabel
    };
    const transitionId = `${stormId}:${observation.bulletinId ?? "no-bulletin"}:${observation.state}`;
    const transitions = previous?.transitions ?? [];
    if (!transitions.some((transition) => transition.id === transitionId)) {
      transitions.push({
        id: transitionId,
        state: observation.state,
        bulletinId: observation.bulletinId,
        observedAt: observation.observedAt,
        monitoredCycle: summary.monitoredCycle
      });
    }
    summary.historyCount = transitions.length;

    ledger.storms[stormId] = {
      lastState: observation.state,
      monitoredCycle,
      lastSummary: summary,
      transitions: transitions.slice(-MAX_TRANSITIONS_PER_STORM)
    };
    await writeLedger(ledger);
    return summary;
  });
  ledgerWriteQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

async function readLedger(): Promise<StructureLedger> {
  if (ledgerReadPromise) return ledgerReadPromise;
  ledgerReadPromise = (async () => {
    try {
      const payload = JSON.parse(await fs.readFile(LEDGER_PATH, "utf8")) as StructureLedger;
      if (payload.version === LEDGER_VERSION && payload.storms) return payload;
    } catch {
      // First run or a discarded local runtime ledger.
    }
    return { version: LEDGER_VERSION, storms: {} };
  })();
  return ledgerReadPromise;
}

async function writeLedger(ledger: StructureLedger) {
  await fs.mkdir(RUNTIME_DIR, { recursive: true });
  const temporaryPath = `${LEDGER_PATH}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, LEDGER_PATH);
}

function unknownStructure(storm: Storm, reason: string, sourceUrl: string): BossStructureSummary {
  return {
    state: "unknown",
    stateLabel: STRUCTURE_LABELS.unknown,
    cycleOrdinal: null,
    monitoredCycle: null,
    cycleLabel: "轮次待确认",
    confidence: 0,
    evidenceLevel: "visualHint",
    source: "unavailable",
    sourceLabel: JTWC_LABEL,
    sourceUrl,
    bulletinId: null,
    observedAt: storm.updatedAt || new Date().toISOString(),
    detail: "结构情报链路暂不可用，保留强度与风圈事实。",
    signals: {
      innerEyewall: "unknown",
      outerEyewall: "unknown",
      innerRadiusNm: null,
      outerRadiusNm: null
    },
    stale: true,
    warnings: [reason]
  };
}

function jtwcSourceForStorm(storm: Storm) {
  const digits = String(storm.code || storm.id).replace(/\D/g, "");
  const fullYear = digits.slice(0, 4) || String(new Date().getUTCFullYear());
  const year = fullYear.slice(-2);
  const stormNumber = (digits.slice(-2) || "00").padStart(2, "0");
  const basinId = `wp${stormNumber}${year}`;
  return {
    basinId,
    url: `https://www.metoc.navy.mil/jtwc/products/${basinId}prog.txt`,
    warningUrl: `https://science.nrlmry.navy.mil/atcf/docs/current_storms/wp${stormNumber}${fullYear}.wrn`
  };
}

function parseJtwcObservedAt(text: string) {
  const stamp = /(?:WDPN|WTPN)\d+\s+PGTW\s+(\d{2})(\d{2})(\d{2})/.exec(text);
  if (!stamp) return null;
  const now = new Date();
  let date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), Number(stamp[1]), Number(stamp[2]), Number(stamp[3])));
  if (date.getTime() - now.getTime() > 3 * 24 * 60 * 60 * 1000) {
    date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, Number(stamp[1]), Number(stamp[2]), Number(stamp[3])));
  }
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function structureStateLabel(state: CoreStructureState) {
  return STRUCTURE_LABELS[state];
}
