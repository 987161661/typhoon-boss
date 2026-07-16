import { readFile } from "node:fs/promises";
import path from "node:path";
import builtInFramework from "@/config/world-lore-framework.v1.json";

export interface WorldLoreFramework {
  arcVersion: number;
  status: "unresolved" | "canon";
  title: string;
  canonFacts: string[];
  generationCanon: string[];
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
  return `你是“${framework.title}”的原创短句编剧，为科幻气象档案界面创作可解锁的中文微型文案。

【唯一设定来源】
世界状态：${framework.status}；版本：${framework.arcVersion}；最高揭示等级：${framework.maxRevealLevel}。
已确认设定：${framework.canonFacts.join(" / ") || "尚未确认"}。
当前章节设定包：${framework.generationCanon.join(" / ") || "只允许最低揭示"}。
允许母题：${framework.allowedMotifs.join(" / ")}。

【写作目标】
写出文明尺度的判断、冷峻反转、制度化措辞和决定性收束。像一个时代、一套系统、一份档案或来源不明的合声在发言。情感藏在协议、权限、校验、归档、调度和误差等词中。每条必须有一个清晰的哲学判断，不能只是雨、海、仪器等意象堆积。
前半句可建立常识，后半句改变它；也可用制度化裁决揭示代价。结尾必须有力量，少用“似乎、也许、仿佛、或许、可能”。完全原创，不得引用、近写或替换名词改写任何现有游戏、小说、影视台词。

【任务卡】
严格逐条遵守 briefs 指定的 id、speaker、motif、thesis、rhetoric、length_tier 与 reveal_level。short 为8-15个汉字，standard为16-30个汉字，long为31-48个汉字；标点不计。每条一至两句，单句优先。同批不得连续使用相同开头、结尾或句法；“我们将”最多一次；“不是……而是……”最多两次；问句最多两条。

【安全边界】
天气只能作为传感器与档案意象，绝不是虚构事件成因。不得从现实城市、台风或实时气象数据推断故事事件；不得输出天气预报、灾情报告、行动命令、现实政治、现实伤亡、灭绝煽动、关注点赞引导或准确预言。禁用内容：${framework.forbiddenTerms.join(" / ")}。不得泄露高于任务卡 reveal_level 的设定，不得写 Markdown、标题、编号、解释或思考过程。

只输出一个合法 JSON 对象：{"items":[{"brief_id":"","text":"","semantic_key":"","motifs":[""],"speaker":"","thesis":"","rhetoric":"","length_tier":"standard","reveal_level":1}]}。items 顺序与 briefs 完全一致。`;
}

function normalizeFramework(value: unknown): WorldLoreFramework | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<WorldLoreFramework>;
  if (candidate.status !== "canon") return null;
  const canonFacts = stringList(candidate.canonFacts, 24);
  const generationCanon = stringList(candidate.generationCanon, 24);
  const allowedMotifs = stringList(candidate.allowedMotifs, 24);
  if (!canonFacts.length || !allowedMotifs.length) return null;
  return {
    arcVersion: Number.isInteger(candidate.arcVersion) ? Math.max(1, candidate.arcVersion!) : 1,
    status: "canon",
    title: typeof candidate.title === "string" && candidate.title.trim() ? candidate.title.trim().slice(0, 40) : "观测回声档案",
    canonFacts,
    generationCanon,
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
    generationCanon: [],
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
