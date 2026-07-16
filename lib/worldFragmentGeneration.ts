import { createHash } from "node:crypto";
import type { WorldLoreFramework } from "./worldLoreFramework";

export type WorldFragmentLengthTier = "short" | "standard" | "long";
export type WorldFragmentSpeaker = "archive" | "observer" | "unknown_echo" | "dome";

export interface WorldFragmentBrief {
  id: string;
  speaker: WorldFragmentSpeaker;
  motif: string;
  thesis: string;
  rhetoric: string;
  lengthTier: WorldFragmentLengthTier;
  revealLevel: number;
  mustAvoid: string[];
}

export interface GeneratedWorldFragment {
  briefId: string;
  text: string;
  semanticKey: string;
  motifs: string[];
  speaker: WorldFragmentSpeaker;
  thesis: string;
  rhetoric: string;
  lengthTier: WorldFragmentLengthTier;
  revealLevel: number;
}

export interface WorldFragmentBatchFailure {
  batchIndex: number;
  message: string;
}

const SPEAKERS: WorldFragmentSpeaker[] = ["archive", "observer", "unknown_echo", "dome"];
const RHETORICS = [
  "定义改写",
  "双重命名",
  "代价揭示",
  "制度悖论",
  "时间错位",
  "主体倒置",
  "冷静裁决",
  "极短铭文",
  "反问裁决"
];
const THESES = [
  "被制度判定为错误的事物也可能是证据",
  "记忆可能先于事件抵达",
  "绝对安全也可能让人失去选择的重量",
  "无法被量化不等于不存在",
  "被删除的地点仍能保留归属",
  "观测对象也可能在记录观测者",
  "迟到的记录可能比准时的遗忘更真实",
  "档案的缺失有时来自拒绝承认",
  "效率可以主动给偏差留下位置",
  "被淘汰的信号仍可能保存必要之物",
  "保存不等于拯救但拒绝删除是一种立场",
  "秩序可能把沉默误认作和平",
  "降低损失也可能制造不可见的损失",
  "完整有时只是删除工作做得彻底",
  "个体消失后记录仍可能保持连续",
  "被选择成为见证者不等于获得答案",
  "正确的时间可能只是被多数钟表同意",
  "不可计算的代价不会自动归零",
  "零风险也可能意味着零选择",
  "稳定若不允许退出就不再只是保护"
];
const DEFAULT_MUST_AVOID = ["命运", "星辰", "末日", "觉醒", "预言"];
const HARD_FORBIDDEN = /关注|点赞|订阅|现实灾害|人员伤亡|立即撤离|避险指令|现实政治|世界末日|人类灭亡|AI统治|预言/;

export function buildWorldFragmentBriefs({
  count,
  seed,
  framework,
  offset = 0
}: {
  count: number;
  seed: string;
  framework: WorldLoreFramework;
  offset?: number;
}) {
  const safeCount = Math.max(0, Math.min(50, Math.floor(count)));
  const tiers = buildLengthTiers(safeCount, seed);
  const motifCount = Math.max(1, framework.allowedMotifs.length);
  return Array.from({ length: safeCount }, (_, localIndex): WorldFragmentBrief => {
    const index = offset + localIndex;
    const hash = seedNumber(`${seed}|${index}`);
    return {
      id: `brief-${offset + localIndex + 1}-${hash.toString(16).padStart(8, "0")}`,
      speaker: SPEAKERS[(index + hash) % SPEAKERS.length],
      motif: framework.allowedMotifs[(index * 5 + hash) % motifCount] ?? "封存页",
      thesis: THESES[(index * 7 + hash) % THESES.length],
      rhetoric: RHETORICS[(index + Math.floor(hash / 17)) % RHETORICS.length],
      lengthTier: tiers[localIndex] ?? "standard",
      revealLevel: framework.maxRevealLevel,
      mustAvoid: DEFAULT_MUST_AVOID
    };
  });
}

export async function runWorldFragmentBatches<T>({
  briefs,
  batchSize = 10,
  maxConcurrency = 5,
  generate
}: {
  briefs: WorldFragmentBrief[];
  batchSize?: number;
  maxConcurrency?: number;
  generate: (batch: WorldFragmentBrief[], batchIndex: number) => Promise<T[]>;
}) {
  const safeBatchSize = Math.max(1, Math.min(10, Math.floor(batchSize)));
  const safeConcurrency = Math.max(1, Math.min(5, Math.floor(maxConcurrency)));
  const batches = Array.from({ length: Math.ceil(briefs.length / safeBatchSize) }, (_, index) =>
    briefs.slice(index * safeBatchSize, index * safeBatchSize + safeBatchSize));
  const items: T[] = [];
  const failures: WorldFragmentBatchFailure[] = [];

  for (let start = 0; start < batches.length; start += safeConcurrency) {
    const wave = batches.slice(start, start + safeConcurrency);
    const settled = await Promise.allSettled(
      wave.map((batch, waveIndex) => generate(batch, start + waveIndex))
    );
    settled.forEach((result, waveIndex) => {
      const batchIndex = start + waveIndex;
      if (result.status === "fulfilled") items.push(...result.value);
      else failures.push({
        batchIndex,
        message: result.reason instanceof Error ? result.reason.message : String(result.reason)
      });
    });
  }

  return { items, failures };
}

export function parseWorldFragmentResponse(raw: string) {
  const withoutThinking = raw.trim().replace(/^<think>[\s\S]*?<\/think>\s*/i, "");
  const unfenced = withoutThinking.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  if (!unfenced) return [];
  const parsed = parseJsonValue(unfenced);
  const values = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { items?: unknown }).items)
      ? (parsed as { items: unknown[] }).items
      : [];
  return values.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object");
}

export function normalizeGeneratedWorldFragment({
  value,
  brief,
  framework
}: {
  value: Record<string, unknown>;
  brief: WorldFragmentBrief;
  framework: WorldLoreFramework;
}): GeneratedWorldFragment | null {
  if (typeof value.text !== "string") return null;
  const text = value.text.replace(/[\r\n]+/g, "").replace(/^[-•\d.\s]+/, "").trim();
  const hanCount = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  if (hanCount < 8 || hanCount > 48 || /[{}<>]/.test(text)) return null;
  if (HARD_FORBIDDEN.test(text)) return null;
  if (framework.forbiddenTerms.some((term) => term && text.includes(term))) return null;
  if (brief.mustAvoid.some((term) => term && text.includes(term))) return null;

  const semanticKey = typeof value.semantic_key === "string" && value.semantic_key.trim()
    ? value.semantic_key.trim().slice(0, 80)
    : `${brief.motif}/${brief.thesis.slice(0, 12)}`;
  return {
    briefId: typeof value.brief_id === "string" ? value.brief_id : brief.id,
    text,
    semanticKey,
    motifs: [brief.motif],
    speaker: brief.speaker,
    thesis: brief.thesis,
    rhetoric: brief.rhetoric,
    lengthTier: hanCount <= 15 ? "short" : hanCount <= 30 ? "standard" : "long",
    revealLevel: Math.min(brief.revealLevel, framework.maxRevealLevel)
  };
}

function buildLengthTiers(count: number, seed: string) {
  const shortCount = Math.round(count * 0.16);
  const longCount = Math.round(count * 0.2);
  const tiers: WorldFragmentLengthTier[] = [
    ...Array.from({ length: shortCount }, () => "short" as const),
    ...Array.from({ length: Math.max(0, count - shortCount - longCount) }, () => "standard" as const),
    ...Array.from({ length: longCount }, () => "long" as const)
  ];
  return tiers
    .map((tier, index) => ({ tier, score: seedNumber(`${seed}|tier|${index}`) }))
    .sort((left, right) => left.score - right.score)
    .map((item) => item.tier);
}

function parseJsonValue(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch { /* try a wrapped object or array */ }
  const objectStart = value.indexOf("{");
  const objectEnd = value.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    try { return JSON.parse(value.slice(objectStart, objectEnd + 1)); } catch { /* continue */ }
  }
  const arrayStart = value.indexOf("[");
  const arrayEnd = value.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    try { return JSON.parse(value.slice(arrayStart, arrayEnd + 1)); } catch { /* invalid */ }
  }
  return null;
}

function seedNumber(value: string) {
  return createHash("sha256").update(value).digest().readUInt32BE(0);
}
