import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildWorldFragmentSystemPrompt, loadWorldLoreFramework } from "./worldLoreFramework";

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

type PoolState = {
  version: 1;
  generation: number;
  available: Array<{ id: string; text: string; seed: string; createdAt: string }>;
  consumed: Array<{ id: string; text: string; seed: string; consumedAt: string }>;
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
  const snapshot = await loadState();
  const capacity = Math.max(0, TARGET_SIZE - snapshot.available.length);
  const count = Math.min(requested, capacity);
  if (!count) return;
  const seed = `${Date.now().toString(36)}-${crypto.randomUUID()}`;
  // Small parallel batches return predictably on MiniMax. A single 50-line
  // JSON completion can otherwise sit behind the provider's long-form
  // generation policy and defeat the purpose of prewarming the cache.
  const candidates: string[] = [];
  for (let index = 0; index < Math.ceil(count / 10); index += 1) {
    const batch = await generateFragments(apiKey, Math.min(10, count - index * 10), `${seed}:${index}`, snapshot);
    candidates.push(...batch);
  }
  await withPoolLock(async () => {
    // Re-read after the provider round-trip. Claims may have consumed entries
    // while MiniMax was generating; merging into the current state prevents a
    // stale refill snapshot from resurrecting consumed fragments.
    const state = await loadState();
    const known = [...state.available, ...state.consumed].map((entry) => entry.text);
    const currentCapacity = Math.max(0, TARGET_SIZE - state.available.length);
    const accepted = candidates
      .map(cleanFragment)
      .filter((text): text is string => Boolean(text))
      .filter((text) => !known.some((prior) => tooSimilar(prior, text)))
      .slice(0, currentCapacity);
    if (!accepted.length) return;
    const now = new Date().toISOString();
    state.generation += 1;
    state.available.push(...accepted.map((text, index) => ({
      id: `fragment-${state.generation}-${index}-${crypto.randomUUID()}`,
      text,
      seed: `${seed}:${index}`,
      createdAt: now
    })));
    await saveState(state);
  });
}

async function generateFragments(apiKey: string, count: number, seed: string, state: PoolState) {
  const framework = await loadWorldLoreFramework();
  const response = await fetch(process.env.MINIMAX_API_BASE_URL?.trim() || "https://api.minimaxi.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.MINIMAX_MODEL?.trim() || "MiniMax-M3",
      temperature: 1.05,
      // This is a compact quote cache, not a reasoning task. Keeping hidden
      // reasoning disabled prevents the pool warmer from monopolising the
      // model while the live card has already moved on.
      reasoning_split: false,
      max_completion_tokens: 900,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: buildWorldFragmentSystemPrompt(framework)
        },
        {
          role: "user",
          content: JSON.stringify({
            count,
            randomSeed: seed,
            avoid: state.consumed.slice(-120).map((entry) => entry.text),
            instruction: "每条使用不同意象和语法起势；随机种子只用于保证本批表达差异。",
            arcVersion: framework.arcVersion,
            motifPlan: framework.allowedMotifs.slice(0, count)
          })
        }
      ],
      signal: AbortSignal.timeout(45_000)
    })
  });
  if (!response.ok) throw new Error(`MiniMax world fragment HTTP ${response.status}`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
  const raw = payload.choices?.[0]?.message?.content;
  if (typeof raw !== "string") return [];
  try {
    // MiniMax M3 may still prepend a private reasoning block in JSON mode.
    // Only the final object is publishable pool material.
    const withoutThinking = raw.trim().replace(/^<think>[\s\S]*?<\/think>\s*/i, "");
    const unfenced = withoutThinking.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
    const firstBrace = unfenced.indexOf("{");
    const lastBrace = unfenced.lastIndexOf("}");
    const json = JSON.parse(firstBrace >= 0 && lastBrace > firstBrace ? unfenced.slice(firstBrace, lastBrace + 1) : unfenced) as { items?: unknown };
    return Array.isArray(json.items)
      ? json.items.flatMap((value) => value && typeof value === "object" && typeof (value as { text?: unknown }).text === "string" ? [(value as { text: string }).text] : [])
      : [];
  } catch {
    return [];
  }
}

function cleanFragment(value: string) {
  const text = value.replace(/[\r\n]+/g, "").replace(/^[-•\d.\s]+/, "").trim();
  const hanCount = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  if (hanCount < 36 || hanCount > 60 || /[{}<>]/.test(text)) return null;
  if (/关注|点赞|订阅|现实灾害|人员伤亡|立即撤离|避险指令/.test(text)) return null;
  return text;
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
