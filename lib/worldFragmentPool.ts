import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildWorldFragmentSystemPrompt, loadWorldLoreFramework } from "./worldLoreFramework";

const TARGET_SIZE = 50;
const REFILL_AT = 10;
const REFILL_SIZE = 40;
const STATE_FILE = path.join(process.cwd(), ".runtime", "world-fragment-pool.json");

export type WorldFragmentPoolStatus = {
  fragment: string | null;
  available: number;
  refill: "idle" | "running" | "unavailable" | "sealed";
};

type PoolState = {
  version: 1;
  generation: number;
  available: Array<{ id: string; text: string; seed: string; createdAt: string }>;
  consumed: Array<{ id: string; text: string; seed: string; consumedAt: string }>;
};

let refillTask: Promise<void> | null = null;

export async function warmWorldFragmentPool() {
  const framework = await loadWorldLoreFramework();
  if (framework.status !== "canon") return;
  const state = await loadState();
  if (state.available.length < TARGET_SIZE) void scheduleRefill(state.available.length ? REFILL_SIZE : TARGET_SIZE);
}

export async function consumeWorldFragment(): Promise<WorldFragmentPoolStatus> {
  const framework = await loadWorldLoreFramework();
  if (framework.status !== "canon") return { fragment: null, available: 0, refill: "sealed" };
  const state = await loadState();
  const entry = state.available.shift() ?? null;
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
  const state = await loadState();
  const capacity = Math.max(0, TARGET_SIZE - state.available.length);
  const count = Math.min(requested, capacity);
  if (!count) return;
  const seed = `${Date.now().toString(36)}-${crypto.randomUUID()}`;
  // Small parallel batches return predictably on MiniMax. A single 50-line
  // JSON completion can otherwise sit behind the provider's long-form
  // generation policy and defeat the purpose of prewarming the cache.
  const candidates: string[] = [];
  for (let index = 0; index < Math.ceil(count / 10); index += 1) {
    const batch = await generateFragments(apiKey, Math.min(10, count - index * 10), `${seed}:${index}`, state);
    candidates.push(...batch);
  }
  const known = [...state.available, ...state.consumed].map((entry) => entry.text);
  const accepted = candidates
    .map(cleanFragment)
    .filter((text): text is string => Boolean(text))
    .filter((text) => !known.some((prior) => tooSimilar(prior, text)))
    .slice(0, count);
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
  if (hanCount < 32 || hanCount > 56 || /[{}<>]/.test(text)) return null;
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
    const raw = await readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<PoolState>;
    if (parsed.version === 1 && Array.isArray(parsed.available) && Array.isArray(parsed.consumed)) {
      return { version: 1, generation: Number(parsed.generation) || 0, available: parsed.available, consumed: parsed.consumed };
    }
  } catch { /* first use */ }
  return { version: 1, generation: 0, available: [], consumed: [] };
}

async function saveState(state: PoolState) {
  await mkdir(path.dirname(STATE_FILE), { recursive: true });
  const temporary = `${STATE_FILE}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(state, null, 2), "utf8");
  await rename(temporary, STATE_FILE);
}
