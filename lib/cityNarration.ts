import type { CityBriefing, CityBriefingNarrative } from "@/lib/cityBriefingData";

const MAX_SPOKEN_CHARS = 92;
const MIN_SPOKEN_CHARS = 48;
const DISASTER_OUTCOME = /(?:受灾|灾情|伤亡|死亡|失踪|经济损失|房屋倒塌|内涝|积水成灾|停电|停工|停课|交通中断|道路中断|无法通行|河流决堤)/;
const NO_RISK_CLAIM = /(?:无风险|没有风险|风险解除|安全无虞|可以放心|确认安全|天气安全)/;
const WARNING_CLAIM = /(?:(?:发布|发出|生效|升级|降级|解除|确认|存在|出现).{0,12}(?:预警|警报)|(?:预警|警报).{0,12}(?:发布|生效|升级|降级|解除|确认))/;
const UNSUPPORTED_CAUSATION = /(?:归因于|由.{0,24}(?:导致|造成|引发)|因.{0,24}(?:影响|导致|造成|引发))/;

export async function narrateCitySituation(
  briefing: Omit<CityBriefing, "narrative">,
  fallback: CityBriefingNarrative
): Promise<CityBriefingNarrative> {
  if (process.env.CITY_LLM_NARRATION_ENABLED !== "true") return fallback;
  const apiKey = process.env.MINIMAX_API_KEY?.trim();
  if (!apiKey) return fallback;
  const facts = {
    city: briefing.city.name,
    stage: fallback.stage,
    current: briefing.current,
    forecast_6h: briefing.nextSixHours,
    recent_rain_24h: briefing.recentRain,
    minute_rain: briefing.minutelyRain,
    official_alerts: briefing.officialWarnings.map((warning) => ({
      title: warning.title, sender: warning.senderName, issued_at: warning.issuedAt
    })),
    data_gaps: fallback.caveat ? [fallback.caveat] : [],
    source_refs: fallback.factRefs
  };
  try {
    const response = await fetch(process.env.MINIMAX_API_BASE_URL?.trim() || "https://api.minimaxi.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.MINIMAX_MODEL?.trim() || "MiniMax-M3",
        temperature: 0.2,
        max_completion_tokens: 700,
        reasoning_split: false,
        messages: [
          { role: "system", content: systemPrompt() },
          { role: "user", content: JSON.stringify({ facts }) }
        ]
      }),
      signal: AbortSignal.timeout(8_000)
    });
    const payload = await response.json().catch(() => null);
    const raw = payload?.choices?.[0]?.message?.content;
    const parsed = parseNarration(raw, fallback.factRefs);
    if (!response.ok || !parsed || !isNarrationSupported(parsed.spoken, briefing)) return fallback;
    return {
      ...fallback,
      engine: "minimax",
      summary: parsed.spoken,
      caveat: parsed.caveat ?? fallback.caveat,
      factRefs: parsed.fact_refs,
      actions: fallback.actions
    };
  } catch {
    return fallback;
  }
}

function systemPrompt() {
  return `你是“赤曜档案局”的城市态势主播。只依据 facts 写中文短播报。
规则：只陈述输入事实；绝不把缺少数据说成没有风险；绝不编造灾情、预警、交通或水位；stage=ordinary_weather 只能称“未来短时天气平稳”，不得称城市安全；stage=recovery_watch 必须先说过去24小时累计降水与当前回落，再说明仍需观察；若有官方预警，优先提及；幽默只可调侃天气或设备，不能调侃受灾者。
输出严格 JSON：{"spoken":"","caveat":"","fact_refs":[""]}。
spoken 为48-92个汉字、2-3句、适合TTS；caveat 最多18个汉字，只有关键缺口才填写；fact_refs 只能引用输入 source_refs 中已有值。不要提及模型、系统、输入、数据通道、抓取或内部错误。`;
}

function parseNarration(value: unknown, allowedRefs: string[]): { spoken: string; caveat: string | null; fact_refs: string[] } | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value.replace(/<think>[\s\S]*?<\/think>/g, "").trim()) as Partial<{ spoken: unknown; caveat: unknown; fact_refs: unknown }>;
    if (typeof parsed.spoken !== "string") return null;
    const spoken = parsed.spoken.trim();
    if ([...spoken].length < MIN_SPOKEN_CHARS || [...spoken].length > MAX_SPOKEN_CHARS) return null;
    if (!Array.isArray(parsed.fact_refs) || parsed.fact_refs.length < 1 || !parsed.fact_refs.every((item) => typeof item === "string" && allowedRefs.includes(item))) return null;
    return { spoken, caveat: typeof parsed.caveat === "string" && [...parsed.caveat.trim()].length <= 18 ? parsed.caveat.trim() || null : null, fact_refs: parsed.fact_refs };
  } catch {
    return null;
  }
}

function isNarrationSupported(spoken: string, briefing: Omit<CityBriefing, "narrative">) {
  // This feed does not contain verified disaster outcomes or causal attribution,
  // so an LLM may never introduce either class of claim.
  if (DISASTER_OUTCOME.test(spoken) || NO_RISK_CLAIM.test(spoken) || UNSUPPORTED_CAUSATION.test(spoken)) return false;
  if (WARNING_CLAIM.test(spoken) && briefing.officialWarnings.length === 0) return false;

  const supportedPlaces = [
    briefing.city.name,
    briefing.city.province,
    briefing.city.administrativePath?.province,
    briefing.city.administrativePath?.city,
    briefing.city.administrativePath?.county
  ].filter((value): value is string => Boolean(value));
  for (const match of spoken.matchAll(/([\u4e00-\u9fff]{2,10}(?:特别行政区|自治区|自治州|省|市|县|区|旗))/g)) {
    const place = match[1];
    if (!supportedPlaces.some((supported) => place.includes(supported) || supported.includes(place))) return false;
  }
  return true;
}
