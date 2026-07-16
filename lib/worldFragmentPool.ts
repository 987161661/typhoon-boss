import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildWorldFragmentBriefs,
  normalizeGeneratedWorldFragment,
  parseWorldFragmentResponse,
  runWorldFragmentBatches,
  type GeneratedWorldFragment,
  type WorldFragmentBrief
} from "./worldFragmentGeneration";
import { buildWorldFragmentSystemPrompt, loadWorldLoreFramework } from "./worldLoreFramework";
import type { WorldLoreFramework } from "./worldLoreFramework";

const TARGET_SIZE = 50;
const REFILL_AT = 10;
const REFILL_SIZE = 40;
const DEFAULT_POOL_STATE_FILE = path.join(process.cwd(), ".runtime", "world-fragment-pool.json");
const DEFAULT_CLAIM_STATE_FILE = path.join(process.cwd(), ".runtime", "world-fragment-claims.json");

export type WorldFragmentPoolStatus = {
  fragment: string | null;
  available: number;
  refill: "idle" | "running" | "unavailable" | "sealed";
};

export type WorldFragmentRuntimeStatus = {
  canon: "ready" | "sealed";
  available: number;
  targetSize: number;
  refillAt: number;
  refill: "idle" | "running" | "sealed";
};

type PoolFragmentEntry = {
  id: string;
  text: string;
  seed: string;
  createdAt: string;
  semanticKey?: string;
  motifs?: string[];
  speaker?: string;
  thesis?: string;
  rhetoric?: string;
  lengthTier?: string;
  revealLevel?: number;
};

type PoolState = {
  version: 1;
  generation: number;
  available: PoolFragmentEntry[];
  consumed: Array<PoolFragmentEntry & { consumedAt: string }>;
};

export type WorldFragmentAccessSource = "observed" | "whitelist" | "unknown";

export interface ClaimWorldFragmentInput {
  requestId: string;
  cityKey: string;
  platform: string;
  viewerId: string;
  accessSource: WorldFragmentAccessSource;
}

export interface ClaimWorldFragmentResult {
  status: "revealed" | "syncing" | "sealed";
  fragment?: string;
  archiveCode: string;
}

type ClaimRecord = {
  requestId: string;
  cityKey: string;
  platform: string;
  viewerId: string;
  accessSource: Exclude<WorldFragmentAccessSource, "unknown">;
  status: "revealed" | "syncing";
  fragment: string | null;
  archiveCode: string;
  updatedAt: string;
};

type ClaimState = {
  version: 1;
  claims: Record<string, ClaimRecord>;
};

let refillTask: Promise<void> | null = null;
let poolQueue: Promise<void> = Promise.resolve();
let claimQueue: Promise<void> = Promise.resolve();

export async function warmWorldFragmentPool() {
  const framework = await loadWorldLoreFramework();
  if (framework.status !== "canon") return;
  const state = await loadState();
  if (state.available.length < TARGET_SIZE) void scheduleRefill(state.available.length ? REFILL_SIZE : TARGET_SIZE);
}

export async function getWorldFragmentRuntimeStatus(): Promise<WorldFragmentRuntimeStatus> {
  const framework = await loadWorldLoreFramework();
  if (framework.status !== "canon") {
    return { canon: "sealed", available: 0, targetSize: TARGET_SIZE, refillAt: REFILL_AT, refill: "sealed" };
  }
  const state = await loadState();
  return {
    canon: "ready",
    available: state.available.length,
    targetSize: TARGET_SIZE,
    refillAt: REFILL_AT,
    refill: refillTask ? "running" : "idle"
  };
}

export async function consumeWorldFragment(selectionKey?: string): Promise<WorldFragmentPoolStatus> {
  return withPoolLock(() => consumeWorldFragmentUnlocked(selectionKey));
}

export async function claimWorldFragment(input: ClaimWorldFragmentInput): Promise<ClaimWorldFragmentResult> {
  const normalized = normalizeClaimInput(input);
  const archiveCode = buildArchiveCode(normalized.requestId, normalized.cityKey);
  if (normalized.accessSource === "unknown") return { status: "sealed", archiveCode };
  const accessSource: Exclude<WorldFragmentAccessSource, "unknown"> = normalized.accessSource;

  return withClaimLock(async () => {
    const state = await loadClaimState();
    const key = claimKey(normalized.requestId);
    const existing = state.claims[key];
    if (existing && !sameClaimIdentity(existing, normalized)) {
      return { status: "sealed", archiveCode };
    }
    if (existing?.status === "revealed" && existing.fragment) {
      return { status: "revealed", fragment: existing.fragment, archiveCode: existing.archiveCode };
    }

    const consumed = await consumeWorldFragment(`${normalized.requestId}|${normalized.cityKey}|${normalized.platform}|${normalized.viewerId}`);
    const status = consumed.fragment ? "revealed" : "syncing";
    const record: ClaimRecord = {
      requestId: normalized.requestId,
      cityKey: normalized.cityKey,
      platform: normalized.platform,
      viewerId: normalized.viewerId,
      accessSource,
      status,
      fragment: consumed.fragment,
      archiveCode: existing?.archiveCode ?? archiveCode,
      updatedAt: new Date().toISOString()
    };
    state.claims[key] = record;
    await saveClaimState(state);
    return consumed.fragment
      ? { status: "revealed", fragment: consumed.fragment, archiveCode: record.archiveCode }
      : { status: "syncing", archiveCode: record.archiveCode };
  });
}

async function consumeWorldFragmentUnlocked(selectionKey?: string): Promise<WorldFragmentPoolStatus> {
  const framework = await loadWorldLoreFramework();
  if (framework.status !== "canon") return { fragment: null, available: 0, refill: "sealed" };
  const state = await loadState();
  const entryIndex = selectionKey && state.available.length
    ? selectionIndex(selectionKey, state.available.length)
    : 0;
  const entry = state.available.splice(entryIndex, 1)[0] ?? null;
  if (entry) {
    state.consumed.push({ ...entry, consumedAt: new Date().toISOString() });
    await saveState(state);
  }
  if (state.available.length <= REFILL_AT) void scheduleRefill(REFILL_SIZE);
  return {
    fragment: entry?.text ?? null,
    available: state.available.length,
    refill: refillTask ? "running" : process.env.MINIMAX_API_KEY?.trim() ? "idle" : "unavailable"
  };
}

async function scheduleRefill(count: number) {
  if (refillTask) return refillTask;
  refillTask = refill(count)
    .catch((error) => console.warn("[world-fragments] refill failed", error))
    .finally(() => { refillTask = null; });
  return refillTask;
}

async function refill(requested: number) {
  const apiKey = process.env.MINIMAX_API_KEY?.trim();
  if (!apiKey) return;
  const framework = await loadWorldLoreFramework();
  if (framework.status !== "canon") return;
  const snapshot = await loadState();
  const capacity = Math.max(0, TARGET_SIZE - snapshot.available.length);
  const count = Math.min(requested, capacity);
  if (!count) return;
  const seed = `${Date.now().toString(36)}-${crypto.randomUUID()}`;
  const accepted: GeneratedWorldFragment[] = [];
  const preferredLongLimit = Math.ceil(count * 0.2);
  const fallbackLongLimit = Math.ceil(count * 0.26);
  const knownTexts = [...snapshot.available, ...snapshot.consumed].map((entry) => entry.text);
  let briefOffset = 0;
  let stagnantRounds = 0;

  // First pass fills the requested capacity with ten-item calls. If provider
  // formatting or local quality gates reject candidates, later narrow passes
  // regenerate only the shortage. Two consecutive no-progress rounds stop the
  // refill so a degraded provider cannot create an infinite paid retry loop.
  for (let attempt = 0; attempt < 4 && accepted.length < count && stagnantRounds < 2; attempt += 1) {
    const beforeAttempt = accepted.length;
    const shortage = count - accepted.length;
    const briefs = buildWorldFragmentBriefs({ count: shortage, seed: `${seed}:${attempt}`, framework, offset: briefOffset });
    briefOffset += briefs.length;
    const avoid = [...knownTexts, ...accepted.map((item) => item.text)].slice(-160);
    const outcome = await runWorldFragmentBatches({
      briefs,
      batchSize: 10,
      maxConcurrency: worldFragmentMaxConcurrency(),
      generate: (batch, batchIndex) => generateFragments(
        apiKey,
        batch,
        `${seed}:${attempt}:${batchIndex}`,
        framework,
        avoid
      )
    });
    if (outcome.failures.length) {
      console.warn("[world-fragments] partial generation failure", outcome.failures);
    }
    for (const candidate of outcome.items) {
      if (accepted.length >= count) break;
      const prior = [...knownTexts, ...accepted.map((item) => item.text)];
      if (prior.some((text) => tooSimilar(text, candidate.text))) continue;
      const semanticKeyUses = [...snapshot.available, ...snapshot.consumed]
        .filter((item) => item.semanticKey === candidate.semanticKey).length
        + accepted.filter((item) => item.semanticKey === candidate.semanticKey).length;
      if (semanticKeyUses >= 2) continue;
      const longLimit = attempt < 2 ? preferredLongLimit : fallbackLongLimit;
      if (candidate.lengthTier === "long" && accepted.filter((item) => item.lengthTier === "long").length >= longLimit) continue;
      accepted.push(candidate);
    }
    stagnantRounds = accepted.length === beforeAttempt ? stagnantRounds + 1 : 0;
  }

  await withPoolLock(async () => {
    // Re-read after the provider round-trip. Claims may have consumed entries
    // while MiniMax was generating; merging into the current state prevents a
    // stale refill snapshot from resurrecting consumed fragments.
    const state = await loadState();
    const known = [...state.available, ...state.consumed].map((entry) => entry.text);
    const currentCapacity = Math.max(0, TARGET_SIZE - state.available.length);
    const publishable = accepted
      .filter((candidate) => !known.some((prior) => tooSimilar(prior, candidate.text)))
      .slice(0, currentCapacity);
    if (!publishable.length) return;
    const now = new Date().toISOString();
    state.generation += 1;
    state.available.push(...publishable.map((candidate, index) => ({
      id: `fragment-${state.generation}-${index}-${crypto.randomUUID()}`,
      text: candidate.text,
      seed: `${seed}:${index}`,
      createdAt: now,
      semanticKey: candidate.semanticKey,
      motifs: candidate.motifs,
      speaker: candidate.speaker,
      thesis: candidate.thesis,
      rhetoric: candidate.rhetoric,
      lengthTier: candidate.lengthTier,
      revealLevel: candidate.revealLevel
    })));
    await saveState(state);
  });
}

async function generateFragments(
  apiKey: string,
  briefs: WorldFragmentBrief[],
  seed: string,
  framework: WorldLoreFramework,
  avoid: string[]
) {
  const response = await fetch(process.env.MINIMAX_API_BASE_URL?.trim() || "https://api.minimaxi.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.WORLD_FRAGMENT_MODEL?.trim() || "MiniMax-M2.7-highspeed",
      temperature: 0.9,
      reasoning_split: true,
      max_completion_tokens: 4096,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: buildWorldFragmentSystemPrompt(framework)
        },
        {
          role: "user",
          content: JSON.stringify({
            task: "根据 briefs 逐条创作，每张任务卡只产出一条，items 顺序与 briefs 严格一致",
            randomSeed: seed,
            candidate_multiplier: 1,
            avoid_texts: avoid,
            arcVersion: framework.arcVersion,
            reveal_level: framework.maxRevealLevel,
            briefs: briefs.map((brief) => ({
              id: brief.id,
              speaker: brief.speaker,
              motif: brief.motif,
              thesis: brief.thesis,
              rhetoric: brief.rhetoric,
              length_tier: brief.lengthTier,
              reveal_level: brief.revealLevel,
              must_avoid: brief.mustAvoid
            }))
          })
        }
      ]
    }),
    signal: AbortSignal.timeout(worldFragmentTimeoutMs())
  });
  if (!response.ok) throw new Error(`MiniMax world fragment HTTP ${response.status}`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
  const raw = payload.choices?.[0]?.message?.content;
  if (typeof raw !== "string") return [];
  const values = parseWorldFragmentResponse(raw);
  const byBriefId = new Map(values.flatMap((value) => typeof value.brief_id === "string" ? [[value.brief_id, value] as const] : []));
  return briefs.flatMap((brief, index) => {
    const value = byBriefId.get(brief.id) ?? values[index];
    if (!value) return [];
    const normalized = normalizeGeneratedWorldFragment({ value, brief, framework });
    return normalized ? [normalized] : [];
  });
}

function tooSimilar(left: string, right: string) {
  const a = bigrams(left);
  const b = bigrams(right);
  const overlap = [...a].filter((part) => b.has(part)).length;
  return overlap / Math.max(1, Math.min(a.size, b.size)) >= 0.62;
}

function bigrams(value: string) {
  const normalized = value.replace(/[，。！？；：、\s]/g, "");
  return new Set(Array.from({ length: Math.max(0, normalized.length - 1) }, (_, index) => normalized.slice(index, index + 2)));
}

async function loadState(): Promise<PoolState> {
  try {
    const raw = await readFile(poolStateFile(), "utf8");
    const parsed = JSON.parse(raw) as Partial<PoolState>;
    if (parsed.version === 1 && Array.isArray(parsed.available) && Array.isArray(parsed.consumed)) {
      return { version: 1, generation: Number(parsed.generation) || 0, available: parsed.available, consumed: parsed.consumed };
    }
  } catch { /* first use */ }
  return { version: 1, generation: 0, available: [], consumed: [] };
}

async function saveState(state: PoolState) {
  const stateFile = poolStateFile();
  await mkdir(path.dirname(stateFile), { recursive: true });
  const temporary = `${stateFile}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(state, null, 2), "utf8");
  await rename(temporary, stateFile);
}

async function loadClaimState(): Promise<ClaimState> {
  try {
    const raw = await readFile(claimStateFile(), "utf8");
    const parsed = JSON.parse(raw) as Partial<ClaimState>;
    if (parsed.version === 1 && parsed.claims && typeof parsed.claims === "object") {
      return { version: 1, claims: parsed.claims };
    }
  } catch { /* first claim */ }
  return { version: 1, claims: {} };
}

async function saveClaimState(state: ClaimState) {
  const stateFile = claimStateFile();
  await mkdir(path.dirname(stateFile), { recursive: true });
  const temporary = `${stateFile}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(state, null, 2), "utf8");
  await rename(temporary, stateFile);
}

function normalizeClaimInput(input: ClaimWorldFragmentInput): ClaimWorldFragmentInput {
  const requestId = requiredText(input.requestId, "requestId", 160);
  const cityKey = requiredText(input.cityKey, "cityKey", 120);
  const platform = requiredText(input.platform, "platform", 80).toLowerCase();
  const viewerId = requiredText(input.viewerId, "viewerId", 160);
  if (input.accessSource !== "observed" && input.accessSource !== "whitelist" && input.accessSource !== "unknown") {
    throw new TypeError("accessSource must be observed, whitelist, or unknown");
  }
  return { requestId, cityKey, platform, viewerId, accessSource: input.accessSource };
}

function requiredText(value: unknown, field: string, maxLength: number) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new TypeError(`${field} must be a non-empty string up to ${maxLength} characters`);
  }
  return value.trim();
}

function sameClaimIdentity(record: ClaimRecord, input: ClaimWorldFragmentInput) {
  return record.cityKey === input.cityKey
    && record.platform === input.platform
    && record.viewerId === input.viewerId;
}

function claimKey(requestId: string) {
  return createHash("sha256").update(requestId).digest("hex");
}

function buildArchiveCode(requestId: string, cityKey: string) {
  let hash = 2166136261;
  const key = `${requestId}|${cityKey}`;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const digest = (hash >>> 0).toString(16).toUpperCase().padStart(8, "0");
  return `OE-01-${digest.slice(0, 4)}-${digest.slice(4)}`;
}

function selectionIndex(key: string, length: number) {
  const prefix = createHash("sha256").update(key).digest().readUInt32BE(0);
  return prefix % length;
}

function poolStateFile() {
  return process.env.WORLD_FRAGMENT_POOL_STATE_FILE?.trim() || DEFAULT_POOL_STATE_FILE;
}

function claimStateFile() {
  return process.env.WORLD_FRAGMENT_CLAIM_STATE_FILE?.trim() || DEFAULT_CLAIM_STATE_FILE;
}

function worldFragmentMaxConcurrency() {
  const configured = Number(process.env.WORLD_FRAGMENT_MAX_CONCURRENCY);
  return Number.isFinite(configured) ? Math.max(1, Math.min(5, Math.floor(configured))) : 5;
}

function worldFragmentTimeoutMs() {
  const configured = Number(process.env.WORLD_FRAGMENT_TIMEOUT_MS);
  return Number.isFinite(configured) ? Math.max(10_000, Math.min(180_000, Math.floor(configured))) : 120_000;
}

function withPoolLock<T>(operation: () => Promise<T>) {
  const result = poolQueue.then(operation, operation);
  poolQueue = result.then(() => undefined, () => undefined);
  return result;
}

function withClaimLock<T>(operation: () => Promise<T>) {
  const result = claimQueue.then(operation, operation);
  claimQueue = result.then(() => undefined, () => undefined);
  return result;
}
