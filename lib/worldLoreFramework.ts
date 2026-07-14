import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

export interface WorldLoreFramework {
  arcVersion: number;
  status: "unresolved" | "canon";
  canonFacts: string[];
  allowedMotifs: string[];
  forbiddenTerms: string[];
  maxRevealLevel: number;
}

const FRAMEWORK_PATH = path.join(process.cwd(), ".runtime", "world-lore-framework.json");

const UNRESOLVED_FRAMEWORK: WorldLoreFramework = {
  arcVersion: 0,
  status: "unresolved",
  canonFacts: [],
  // These are deliberately reusable observations rather than story facts.
  allowedMotifs: ["封存", "回声", "旧网络", "边界", "维护", "时间误差", "未读档案", "光源", "沉积", "静默"],
  forbiddenTerms: ["阵营", "人物", "地名", "具体年代", "战争", "死亡", "血腥", "预言", "末日承诺"],
  maxRevealLevel: 0
};

export async function loadWorldLoreFramework(): Promise<WorldLoreFramework> {
  try {
    const candidate = JSON.parse(await readFile(FRAMEWORK_PATH, "utf8")) as Partial<WorldLoreFramework>;
    if (candidate.status !== "canon") return UNRESOLVED_FRAMEWORK;
    return {
      arcVersion: Number.isInteger(candidate.arcVersion) ? Math.max(1, candidate.arcVersion!) : 1,
      status: "canon",
      canonFacts: stringList(candidate.canonFacts, 24),
      allowedMotifs: stringList(candidate.allowedMotifs, 24).length ? stringList(candidate.allowedMotifs, 24) : UNRESOLVED_FRAMEWORK.allowedMotifs,
      forbiddenTerms: [...UNRESOLVED_FRAMEWORK.forbiddenTerms, ...stringList(candidate.forbiddenTerms, 40)],
      maxRevealLevel: Number.isInteger(candidate.maxRevealLevel) ? Math.max(0, Math.min(5, candidate.maxRevealLevel!)) : 0
    };
  } catch {
    return UNRESOLVED_FRAMEWORK;
  }
}

export function buildWorldFragmentSystemPrompt(framework: WorldLoreFramework) {
  return `你是“赤曜档案局”的原创微叙事生成器。输出供气象战术界面底部逐字播放的世界观碎片；它绝不是天气预报、灾情报告或行动命令，也不得从城市名和气象数据推断剧情。
世界状态：${framework.status}；设定版本：${framework.arcVersion}；已确认设定：${framework.canonFacts.join(" / ") || "尚未确认"}；允许母题：${framework.allowedMotifs.join(" / ")}；禁用概念：${framework.forbiddenTerms.join(" / ")}；最高揭示等级：${framework.maxRevealLevel}。
主线未定时只能写可回收的朦胧线索：营造未知，但不确认世界历史，不命名组织、人物、地点或重大事件。文风冷峻、后启示录、哲思、具有仪器和档案质感，但必须完全原创，禁止模仿或复述任何现有作品。
只输出 JSON：{"items":[{"text":"","semantic_key":"","motifs":[""],"reveal_level":0}]}。每条 text 为 32-56 个汉字、1-2 句、最多一个无解释神秘名词；semantic_key 为 2-5 个抽象关键词，以 / 连接；每条使用不同观察角度。不要 Markdown、解释、口号、暴力煽动、现实政治或具体预言。`;
}

function stringList(value: unknown, limit: number) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, limit)
    : [];
}
