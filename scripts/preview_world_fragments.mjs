import fs from "node:fs";

function readEnvFile(file) {
  const values = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function extractPrompt(source) {
  const section = source.match(/## 7\.[\s\S]*?```text\s*([\s\S]*?)```[\s\S]*?## 8\./);
  if (!section) throw new Error("generator system prompt fence not found");
  return section[1].trim();
}

function parseJsonText(raw) {
  const clean = raw
    .trim()
    .replace(/^<think>[\s\S]*?<\/think>\s*/i, "")
    .replace(/^```json\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  if (!clean) throw new Error(`MiniMax returned empty publishable content; raw length=${raw.length}`);
  try {
    const parsed = JSON.parse(clean);
    return Array.isArray(parsed) ? { items: parsed } : parsed;
  } catch { /* fall through to extracting a wrapped object */ }
  const first = clean.indexOf("{");
  const last = clean.lastIndexOf("}");
  const candidate = first >= 0 && last > first ? clean.slice(first, last + 1) : clean;
  try {
    const parsed = JSON.parse(candidate);
    return Array.isArray(parsed) ? { items: parsed } : parsed;
  } catch (error) {
    throw new Error(`MiniMax returned invalid JSON; raw length=${raw.length}; preview=${JSON.stringify(raw.slice(0, 240))}`, { cause: error });
  }
}

const localEnv = fs.existsSync(".env.local") ? readEnvFile(".env.local") : {};
const env = { ...localEnv, ...process.env };
if (!env.MINIMAX_API_KEY) throw new Error("MINIMAX_API_KEY is not configured");

const design = fs.readFileSync("docs/world-fragment-minimax-prompt-design.md", "utf8");
const chronicle = fs.readFileSync("docs/world-lore-chronicle.md", "utf8");
if (!chronicle.includes("第七气候体") || !chronicle.includes("第一阶段：档案的错页")) {
  throw new Error("world chronicle does not contain the expected canon markers");
}
// The full chronicle is the authoring source, but M3 can spend its entire
// completion budget re-reasoning over it. Compile only the active reveal layer
// into the generation context; later chapters remain unavailable to the model.
const currentChapterCanon = `
时代：2078年，长晴纪元。穹顶系统是全球气象、能源与物流协同基础设施，降低了绝大多数气候风险。它不是公开的人格化统治者。
核心矛盾：人类拥有自由的形式，却因风险与偏差总被提前消除，逐渐失去必须选择的重量。安全与自由、保存与消亡、预测与记忆构成主要哲学冲突。
当前揭示阶段：档案的错页，reveal_level=1。观测员只知道某些气象记录不属于当前时间；异常表现为九分钟偏差、旧气象站回传、倒置校验码、缺失坐标、玻璃雨痕、无声观测站、未读权限与未解释的晴朗。
可见主体：赤曜自动归档协议、注册观测员、来源不明的回声、少量无人格的系统记录。
必须隐藏：第七气候体全名及本质、意识投射、迁徙者各派、后续历史、AI觉醒结论。不得暗示现实天气由虚构事件造成。
世界规则：异常不能准确预言未来，不能操控现实天气制造灾害；穹顶只能优化被授权的损失，不能凭空消除代价；档案只保存错误、偏差与回声，不提供现实行动命令。
`;
const systemPrompt = extractPrompt(design).replace("{{CHRONICLE}}", currentChapterCanon.trim());

const tasks = [
  ["archive", "倒置校验码", "被制度判定为错误的事物也可能是证据", "制度悖论", "standard"],
  ["unknown_echo", "玻璃雨痕", "记忆可能先于事件抵达", "时间错位", "short"],
  ["observer", "晴朗", "绝对安全也可能让人失去选择的重量", "代价揭示", "standard"],
  ["dome", "静默频段", "无法被量化不等于不存在", "冷静裁决", "standard"],
  ["archive", "缺失坐标", "被删除的地点仍能保留归属", "定义改写", "long"],
  ["observer", "无声观测站", "观测对象也可能在记录观测者", "主体倒置", "standard"],
  ["unknown_echo", "延迟九分钟", "迟到的记录可能比准时的遗忘更真实", "双重命名", "long"],
  ["archive", "封存页", "档案的缺失有时来自拒绝承认", "冷静裁决", "standard"],
  ["dome", "礼让窗口", "效率可以主动给偏差留下位置", "制度悖论", "standard"],
  ["observer", "旧频段", "被淘汰的信号仍可能保存必要之物", "反问裁决", "standard"],
  ["archive", "未读权限", "资格可能在身份之前被系统承认", "时间错位", "standard"],
  ["unknown_echo", "海岸", "边界并非终点而是记忆的书写面", "定义改写", "short"],
  ["observer", "雨痕", "没有发生的事也会留下伦理代价", "代价揭示", "standard"],
  ["dome", "误差阈值", "完美来自对偏差的命名权", "制度悖论", "long"],
  ["archive", "冷存储", "保存不等于拯救但拒绝删除是一种立场", "双重命名", "long"],
  ["unknown_echo", "潮位", "人称与海域的边界可能发生错位", "主体倒置", "standard"],
  ["observer", "晴空协议", "秩序可能把沉默误认作和平", "定义改写", "standard"],
  ["archive", "签名", "来源未知的证据仍可能通过全部校验", "冷静裁决", "standard"],
  ["dome", "调度记录", "降低损失也可能制造不可见的损失", "代价揭示", "long"],
  ["observer", "缺页", "完整有时只是删除工作做得彻底", "双重命名", "standard"],
  ["unknown_echo", "回声", "回应可能早于提问存在", "时间错位", "short"],
  ["archive", "连续性", "个体消失后记录仍可能保持连续", "定义改写", "standard"],
  ["observer", "未建成的防潮堤", "共同记忆可以指向不存在的地点", "反问裁决", "long"],
  ["dome", "审计记录", "系统可以保留无法解释但不能忽视的异常", "冷静裁决", "standard"],
  ["archive", "观测员权限", "被选择成为见证者不等于获得答案", "代价揭示", "standard"],
  ["unknown_echo", "旧港口", "记住一个地方未必证明曾经抵达", "主体倒置", "long"],
  ["observer", "九分钟偏差", "正确的时间可能只是被多数钟表同意", "定义改写", "standard"],
  ["archive", "海雾", "模糊不是缺少信息而是拒绝单一解释", "制度悖论", "standard"],
  ["dome", "原始噪声", "沉默无法证明稳定", "极短铭文", "short"],
  ["unknown_echo", "封存页", "记录也可能在等待被记录的人", "主体倒置", "standard"],
  ["archive", "异常索引", "制度只能为已经承认的事物建立目录", "制度悖论", "standard"],
  ["observer", "长晴纪元", "没有坏天气不等于拥有好生活", "定义改写", "standard"],
  ["unknown_echo", "错误时间戳", "被更正的时间仍保留最初的记忆", "时间错位", "short"],
  ["dome", "损失函数", "不可计算的代价不会自动归零", "冷静裁决", "standard"],
  ["archive", "撤销记录", "一项决定被撤销不等于它从未发生", "代价揭示", "standard"],
  ["observer", "未抵达的降雨", "等待也能形成真实的历史", "双重命名", "long"],
  ["unknown_echo", "空白签名", "没有姓名的记录仍可能拥有意志", "主体倒置", "standard"],
  ["archive", "审计权限", "获准查看错误不代表获准纠正错误", "制度悖论", "standard"],
  ["dome", "风险归零", "零风险也可能意味着零选择", "极短铭文", "short"],
  ["observer", "海雾边界", "看不清边界时人仍必须决定是否跨越", "反问裁决", "long"],
  ["archive", "旧站编号", "设施停止运行后职责可能继续存在", "定义改写", "standard"],
  ["unknown_echo", "雨声底稿", "复制一种声音不等于复制它的来源", "双重命名", "standard"],
  ["observer", "晴空记录", "被安排好的平静仍然需要有人同意", "代价揭示", "standard"],
  ["dome", "偏差清单", "删除偏差只是删除承认偏差的方式", "冷静裁决", "long"],
  ["archive", "无效密钥", "无法开启当前档案的钥匙可能属于另一扇门", "定义改写", "standard"],
  ["unknown_echo", "潮声回执", "收到回应不代表对方曾经发送", "时间错位", "short"],
  ["observer", "观测死角", "看不见的事物不会因此停止注视我们", "主体倒置", "standard"],
  ["archive", "归档日期", "记录的诞生时间可能晚于它保存的记忆", "时间错位", "standard"],
  ["dome", "稳定区间", "稳定若不允许退出就不再只是保护", "制度悖论", "standard"],
  ["unknown_echo", "无门观测站", "不存在入口的地方仍可能保存归途", "反问裁决", "long"]
];

const endpoint = env.MINIMAX_API_BASE_URL || "https://api.minimaxi.com/v1/chat/completions";
const model = env.MINIMAX_MODEL || "MiniMax-M3";
const batchCount = Math.ceil(tasks.length / 10);
const startedAt = Date.now();

async function generateBatch(batch) {
  const batchStartedAt = Date.now();
  const briefs = tasks.slice(batch * 10, batch * 10 + 10).map((task, index) => ({
    id: `b${String(batch * 10 + index + 1).padStart(2, "0")}`,
    speaker: task[0],
    motif: task[1],
    thesis: task[2],
    rhetoric: task[3],
    length_tier: task[4],
    must_avoid: ["命运", "星辰", "末日", "觉醒"]
  }));

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.MINIMAX_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.9,
      reasoning_split: true,
      max_completion_tokens: 4096,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: JSON.stringify({
            task: "根据 briefs 逐条创作，每张任务卡只产出一条，items 顺序与 briefs 严格一致",
            arc_version: 1,
            reveal_level: 1,
            candidate_multiplier: 1,
            avoid_texts: [],
            briefs
          })
        }
      ]
    }),
    signal: AbortSignal.timeout(120_000)
  });

  if (!response.ok) {
    throw new Error(`MiniMax HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
  const payload = await response.json();
  const raw = payload.choices?.[0]?.message?.content;
  if (typeof raw !== "string") throw new Error("MiniMax returned no text content");
  const parsed = parseJsonText(raw);
  if (!Array.isArray(parsed.items)) throw new Error(`batch ${batch + 1} returned invalid items`);
  const elapsedMs = Date.now() - batchStartedAt;
  process.stderr.write(`batch ${batch + 1}: ${parsed.items.length} items in ${(elapsedMs / 1000).toFixed(1)}s\n`);
  return { batch, elapsedMs, items: parsed.items };
}

const settled = await Promise.allSettled(
  Array.from({ length: batchCount }, (_, batch) => generateBatch(batch))
);
const succeeded = settled
  .filter((result) => result.status === "fulfilled")
  .map((result) => result.value)
  .sort((left, right) => left.batch - right.batch);
const failed = settled.flatMap((result, batch) => result.status === "rejected"
  ? [{ batch: batch + 1, error: result.reason instanceof Error ? result.reason.message : String(result.reason) }]
  : []);
const items = succeeded.flatMap((batch) => batch.items);
const result = items.map((item, index) => ({ index: index + 1, ...item }));
console.log(JSON.stringify({
  model,
  requested: tasks.length,
  count: result.length,
  concurrency: batchCount,
  elapsedMs: Date.now() - startedAt,
  batches: succeeded.map(({ batch, elapsedMs, items: batchItems }) => ({ batch: batch + 1, count: batchItems.length, elapsedMs })),
  failed,
  items: result
}, null, 2));
