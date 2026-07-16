import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
await loadEnv(path.join(root, ".env.local"));
const key = process.env.MINIMAX_API_KEY?.trim();
if (!key) throw new Error("MINIMAX_API_KEY is not configured");
const base = process.env.CITY_BRIEFING_BASE_URL ?? "http://127.0.0.1:3038";
const endpoint = process.env.MINIMAX_API_BASE_URL ?? "https://api.minimaxi.com/v1/chat/completions";
const model = process.env.MINIMAX_MODEL ?? "MiniMax-M3";
const cities = [["北京","ABJ/beijing"],["沈阳","ALN/shenyang"],["上海","ASH/shanghai"],["杭州","AZJ/hangzhou"],["广州","AGD/guangzhou"],["福州","AFJ/fuzhou"],["武汉","AHB/wuhan"],["成都","ASC/chengdu"],["郑州","AHA/zhengzhou"],["南京","AJS/nanjing"]];
const targetCities = Number.isInteger(Number(process.env.CITY_EXPERIMENT_LIMIT))
  ? cities.slice(0, Math.max(1, Number(process.env.CITY_EXPERIMENT_LIMIT)))
  : cities;
const selectedCities = process.env.CITY_EXPERIMENT_CITY
  ? targetCities.filter(([city]) => city === process.env.CITY_EXPERIMENT_CITY)
  : targetCities;

const system = `你是“赤曜档案局”的城市态势直播导演。只依据输入 facts 写直播短播报，不是预报员，也不是故事作者。
硬规则：
1. 只能使用 facts；不得补造灾情、预警、停工、积涝、伤亡、因果或官方结论。
2. 严格区分近期事件、当前实况、未来预报、官方预警和数据缺口。未来数小时无明显风雨绝不等于城市安全。
3. 若 recent_events、regional_risks 或 local_official_alerts 非空，必须优先说明风险仍在、回落或需要观察；若预报平静而近期发生强天气，必须指出时间尺度差异。
4. “未检出本地预警”只能说明输入中没有本地预警，不可改写成“没有风险”。
5. 语气冷静、利落，有少量克制的档案局式幽默；幽默只能调侃天气、系统或装备，绝不调侃受灾者、救援或群体。
6. 世界观只能是修辞，不能伪装成事实。
输出严格 JSON，不能有 Markdown 或解释：
{"event_stage":"active|continuing|recovery_watch|ordinary|data_gap","spoken":"55-95个汉字，2-3句，可直接TTS","fact_refs":["事实ID"],"official_check_needed":true,"tone":"calm|dry_wit|urgent"}`;

const results = [];
for (const [city, nmcPath] of selectedCities) {
  try {
    const briefing = await json(`${base}/api/city-briefing?city=${encodeURIComponent(city)}`);
    const facts = packet(briefing, city, await nmc(nmcPath));
    // Verified, explicit test evidence: it makes the prior Shenyang failure case reproducible.
    if (city === "沈阳") {
      facts.recent_events = ["[cma-shenyang-rainfall] 截至7月14日08时前24小时，沈阳累计雨量177.8毫米，报道为破当地观测史纪录的强降雨。"];
      facts.regional_risks = ["[cma-liaoning-flood] 7月14日18时中央气象台提示：7月14日20时至15日20时辽宁中东部部分地区中小河流洪水气象风险较高至高。"];
    }
    const generated = await generate(facts);
    results.push({ city, facts, generated });
    console.log(`${city}: ${generated.spoken}`);
  } catch (error) {
    results.push({ city, error: error instanceof Error ? error.message : String(error) });
    console.warn(`${city}: experiment failed, continuing`);
  }
}
const output = { generatedAt: new Date().toISOString(), model, base, systemPrompt: system, results };
await mkdir(path.join(root, ".runtime"), { recursive: true });
const outputPath = path.join(root, ".runtime", process.env.CITY_EXPERIMENT_CITY ? `city-broadcast-experiment-${process.env.CITY_EXPERIMENT_CITY}.json` : "city-broadcast-experiment.json");
await writeFile(outputPath, JSON.stringify(output, null, 2), "utf8");
console.log(`Saved ${outputPath}`);

function packet(b, city, officialForecast) {
  const warn = b.sources.find((s) => s.id === "qweather-warning");
  return {
    city, generated_at: b.generatedAt,
    current_conditions: [`[${b.current.sourceId ?? "unavailable"}] ${b.current.observedAt ?? "时间未知"}：${b.current.temperatureC ?? "未知"}°C，湿度${b.current.relativeHumidityPct ?? "未知"}%，降水${b.current.precipitationMm ?? "未知"}mm，风速${b.current.windSpeedMps ?? "未知"}m/s。`],
    forecast_6h: [`[${b.nextSixHours.sourceId ?? "unavailable"}] ${b.nextSixHours.startsAt ?? "起始未知"}至${b.nextSixHours.endsAt ?? "结束未知"}：累计降水${b.nextSixHours.precipitationMm ?? "未知"}mm，最大小时降水${b.nextSixHours.maxHourlyPrecipitationMm ?? "未知"}mm，最大阵风${b.nextSixHours.maxWindGustMps ?? "未知"}m/s，降水概率峰值${b.nextSixHours.maxPrecipitationProbabilityPct ?? "未知"}%。`],
    minute_rain: b.minutelyRain.available ? [`[qweather-minutely] 未来两小时${b.minutelyRain.precipitationNextTwoHoursMm ?? "未知"}mm，5分钟峰值${b.minutelyRain.maxFiveMinutePrecipitationMm ?? "未知"}mm。`] : ["[qweather-minutely] 分钟级降水数据不可用。"],
    local_official_alerts: b.officialWarnings.map((x) => `[qweather-warning] ${x.title}；${x.senderName ?? "发布机构未提供"}；${x.issuedAt ?? "发布时间未提供"}`),
    regional_risks: [], recent_events: [],
    independent_official_forecast: [officialForecast ? `[nmc-city-forecast] ${officialForecast}` : "[nmc-city-forecast] 国家气象中心城市预报抓取失败。"],
    data_gaps: [warn?.status === "available" ? "未接入城市积涝点、河道水位、交通管制和救援事件数据。" : "官方预警通道不可用，且未接入城市积涝点、河道水位、交通管制和救援事件数据。", "除明确列出的 recent_events 外，未接入过去24/48小时城市实测雨量。"],
    source_health: b.sources.map((s) => `[${s.id}] ${s.status}/${s.evidenceLevel}`).join("; ")
  };
}
async function nmc(nmcPath) {
  const r = await fetch(`https://www.nmc.cn/publish/forecast/${nmcPath}.html`, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) return null;
  const h = await r.text();
  const stamp = /发布时间：\s*([^<]+)/.exec(h)?.[1]?.trim() ?? "发布时间未解析";
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit" }).format(new Date()).replace("/", "/");
  const at = h.indexOf(day);
  return at < 0 ? `发布时间${stamp}；当日条目未解析。` : `发布时间${stamp}；${h.slice(at, at + 1100).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 360)}`;
}
async function generate(facts) {
  for (const compact of [false, true]) {
    const r = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, temperature: 0.25, max_completion_tokens: 4_096, reasoning_split: false, messages: [{ role: "system", content: compact ? "直接输出一个合法 JSON 对象，字段只能有 event_stage、spoken、fact_refs、official_check_needed、tone。不得输出解释或思考。" : system }, { role: "user", content: compact ? JSON.stringify({ facts, instruction: "立即生成55-95个汉字的播报；必须解释近期事件和短期预报是否处在不同时间尺度。" }) : JSON.stringify({ facts }) }] }), signal: AbortSignal.timeout(60_000) });
    const p = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`MiniMax HTTP ${r.status}: ${p?.base_resp?.status_msg ?? "unknown"}`);
    const raw = p?.choices?.[0]?.message?.content;
    const cleaned = typeof raw === "string" ? raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim() : "";
    console.warn(`MiniMax attempt ${compact ? 2 : 1}: content=${cleaned.length}, reasoning=${typeof p?.choices?.[0]?.message?.reasoning_content === "string" ? p.choices[0].message.reasoning_content.length : 0}`);
    const jsonText = cleaned.match(/\{[\s\S]*\}/)?.[0];
    try {
      const out = JSON.parse(jsonText ?? "");
      if (typeof out.spoken === "string" && Array.isArray(out.fact_refs)) return out;
    } catch { /* One compact retry is part of the experiment. */ }
  }
  throw new Error("MiniMax returned no schema-valid publishable broadcast after retry");
}
async function json(url) { const r = await fetch(url, { signal: AbortSignal.timeout(30_000) }); if (!r.ok) throw new Error(`${url} HTTP ${r.status}`); return r.json(); }
async function loadEnv(file) {
  try { for (const line of (await readFile(file, "utf8")).split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, ""); } }
  catch (e) { if (e?.code !== "ENOENT") throw e; }
}
