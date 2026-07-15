import { readFile } from "node:fs/promises";
import path from "node:path";
import builtInFramework from "@/config/world-lore-framework.v1.json";

export interface WorldLoreFramework {
  arcVersion: number;
  status: "unresolved" | "canon";
  title: string;
  canonFacts: string[];
  allowedMotifs: string[];
  forbiddenTerms: string[];
  maxRevealLevel: number;
}

const BASE_FORBIDDEN_TERMS = [
  "现实灾害预测",
  "真实预警解释",
  "现实伤亡",
  "避险命令",
  "真实人物隐私",
  "末日承诺",
  "现实政治"
];

export async function loadWorldLoreFramework(): Promise<WorldLoreFramework> {
  const fallback = normalizeFramework(builtInFramework) ?? unresolvedFramework();
  try {
    const runtimePath = process.env.WORLD_LORE_FRAMEWORK_PATH?.trim()
      || path.join(process.cwd(), ".runtime", "world-lore-framework.json");
    const candidate = JSON.parse(await readFile(runtimePath, "utf8")) as unknown;
    return normalizeFramework(candidate) ?? fallback;
  } catch {
    return fallback;
  }
}

export function buildWorldFragmentSystemPrompt(framework: WorldLoreFramework) {
  return `你是“${framework.title}”的原创微叙事生成器。输出供气象战术界面解锁的世界观档案碎片。天气只允许作为传感器捕获回声的载体，绝不是科幻事件的成因；文本绝不是天气预报、灾情报告或行动命令，也不得从城市名和气象数据推断现实事件。
世界状态：${framework.status}；设定版本：${framework.arcVersion}；已确认设定：${framework.canonFacts.join(" / ") || "尚未确认"}；允许母题：${framework.allowedMotifs.join(" / ")}；禁用内容：${framework.forbiddenTerms.join(" / ")}；最高揭示等级：${framework.maxRevealLevel}。
文风冷峻、克制、具有仪器与档案质感；制造可继续探索的疑问，但不解释谜底。必须完全原创，禁止模仿或复述任何现有作品。
只输出 JSON：{"items":[{"text":"","semantic_key":"","motifs":[""],"reveal_level":0}]}。每条 text 为 36-60 个汉字、1-2 句，不含关注、点赞或订阅引导；semantic_key 为 2-5 个抽象关键词，以 / 连接。不要 Markdown、解释、口号、暴力煽动、现实政治、现实灾害结论或具体预言。`;
}

function normalizeFramework(value: unknown): WorldLoreFramework | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<WorldLoreFramework>;
  if (candidate.status !== "canon") return null;
  const canonFacts = stringList(candidate.canonFacts, 24);
  const allowedMotifs = stringList(candidate.allowedMotifs, 24);
  if (!canonFacts.length || !allowedMotifs.length) return null;
  return {
    arcVersion: Number.isInteger(candidate.arcVersion) ? Math.max(1, candidate.arcVersion!) : 1,
    status: "canon",
    title: typeof candidate.title === "string" && candidate.title.trim() ? candidate.title.trim().slice(0, 40) : "观测回声档案",
    canonFacts,
    allowedMotifs,
    forbiddenTerms: [...new Set([...BASE_FORBIDDEN_TERMS, ...stringList(candidate.forbiddenTerms, 40)])],
    maxRevealLevel: Number.isInteger(candidate.maxRevealLevel) ? Math.max(0, Math.min(5, candidate.maxRevealLevel!)) : 1
  };
}

function unresolvedFramework(): WorldLoreFramework {
  return {
    arcVersion: 0,
    status: "unresolved",
    title: "观测回声档案",
    canonFacts: [],
    allowedMotifs: ["封存", "回声", "未读档案", "时间误差"],
    forbiddenTerms: BASE_FORBIDDEN_TERMS,
    maxRevealLevel: 0
  };
}

function stringList(value: unknown, limit: number) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, limit)
    : [];
}
