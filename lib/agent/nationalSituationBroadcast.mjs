const SCHEMA_VERSION = 1;
const MAX_SEGMENTS = 8;
const MAX_FACT_REFS = 4;
const MAX_TEXT_CHARS = 140;

const CATEGORIES = new Set(["official_fact", "observation", "model"]);
const OFFICIAL_SCOPES = new Set(["official-warning", "official-risk"]);
const DISASTER_OUTCOME = /(?:受灾|灾情|伤亡|死亡|失踪|经济损失|房屋倒塌|停电|停工|停课|交通中断|道路中断|河流决堤)/;
const UNSUPPORTED_CAUSATION = /(?:归因于|由.{0,24}(?:导致|造成|引发)|因.{0,24}(?:影响|导致|造成|引发)|受.{0,24}影响(?:而|，|,)?(?:导致|造成|引发)|(?:台风|雷达|卫星|GFS|模式).{0,24}(?:影响|导致|造成|引发))/;
const NO_RISK_CLAIM = /(?:无风险|没有风险|风险解除|安全无虞|可以放心|确认安全|天气安全)/;
const WARNING_CLAIM = /(?:(?:发布|发出|生效|升级|降级|解除|确认|存在|出现).{0,12}(?:预警|警报)|(?:预警|警报).{0,12}(?:发布|生效|升级|降级|解除|确认))/;
const METADATA_INFERENCE = /(?:雷达|卫星|产品目录|图像索引|GFS).{0,30}(?:显示|表明|证明|确认|监测到|意味着|预示|导致|造成|引发).{0,30}(?:暴雨|强降水|降水量|回波强度|灾害|预警|登陆|增强|减弱|风力)/;
const ADMINISTRATIVE_NAME = /([\u4e00-\u9fff]{2,10}(?:特别行政区|自治区|自治州|省|市|县|区|旗))/g;
const FACTUAL_CLOSING = /(?:预警|警报|灾情|受灾|伤亡|降水|暴雨|大风|气温|雷达|卫星|GFS|台风|登陆|风险|安全|省|市|县|区)/;

export const NATIONAL_SITUATION_BROADCAST_SCHEMA_VERSION = SCHEMA_VERSION;

/**
 * Builds the only fact catalogue the national-situation model may cite.
 * Product catalog entries are deliberately excluded: their metadata does not
 * describe weather conditions. Radar/satellite metadata is retained only with
 * an explicit metadata-only scope.
 */
export function buildNationalSituationBroadcastPrompt(snapshot, options = {}) {
  const now = validIso(options.now) ?? new Date().toISOString();
  const maxEvents = clampInteger(options.maxEvents, 1, 12, 4);
  const facts = [];

  if (!isNationalSnapshot(snapshot)) {
    facts.push(makeFact({
      ref: "source:national-situation",
      category: "observation",
      scope: "source-status",
      statement: "全国态势快照不可用；这只表示本轮没有可发布的全国态势事实，不表示全国没有气象风险。",
      sourceIds: ["national-situation"],
      dataTime: null,
      limitations: ["来源失败或无记录不得表述为无风险。"]
    }));
    return promptBundle(facts, now, null);
  }

  const warningSource = sourceHealthById(snapshot, snapshot.warnings?.sourceId);
  if (snapshot.warnings && Number.isFinite(snapshot.warnings.total)) {
    facts.push(makeFact({
      ref: "summary:official-warnings",
      category: "official_fact",
      scope: "warning-summary",
      statement: warningSummaryStatement(snapshot.warnings, warningSource),
      sourceIds: compactStrings([snapshot.warnings.sourceId]),
      dataTime: snapshot.warnings.updatedAt,
      locations: ["全国"],
      hazards: ["warning"],
      limitations: [
        "全国汇总不建立预警与任一台风、城市或省份之间的因果关系。",
        ...(warningSource?.limitations ?? [])
      ]
    }));
  }

  for (const event of snapshot.events.slice(0, maxEvents)) {
    const category = categoryForEvidence(event.evidenceLevel);
    const metadataOnly = event.evidenceLevel === "metadata";
    facts.push(makeFact({
      ref: `event:${safeRefPart(event.id)}`,
      category,
      scope: metadataOnly ? "metadata-only" : event.kind,
      statement: eventStatement(event),
      sourceIds: compactStrings(event.sourceIds),
      dataTime: event.dataTime ?? event.issuedAt ?? event.updatedAt ?? null,
      locations: compactStrings(event.geography?.names),
      hazards: compactStrings([event.hazard, event.level]),
      limitations: compactStrings([
        ...(event.limitations ?? []),
        ...(metadataOnly ? ["该引用只能支持帧、索引、产品时次或可用性，不支持天气或灾害结论。"] : [])
      ])
    }));
  }

  const relevantSourceIds = new Set(facts.flatMap((fact) => fact.sourceIds));
  relevantSourceIds.add(snapshot.radar?.sourceId);
  relevantSourceIds.add(snapshot.satellite?.sourceId);
  const sourceHealth = [...snapshot.sourceHealth]
    .sort((left, right) => Number(relevantSourceIds.has(right.sourceId)) - Number(relevantSourceIds.has(left.sourceId)))
    .filter((health) => relevantSourceIds.has(health.sourceId) || !["fresh", "no-record"].includes(health.status))
    .slice(0, 4);
  for (const health of sourceHealth) {
    facts.push(makeFact({
      ref: `source:${safeRefPart(health.sourceId)}`,
      category: "observation",
      scope: "source-status",
      statement: `${health.label}的快照状态为${health.status}；最后成功时间${health.lastSuccessfulAt ?? "未记录"}，本条只描述数据通道状态。`,
      sourceIds: [health.sourceId],
      dataTime: health.updatedAt ?? health.lastSuccessfulAt,
      limitations: compactStrings([
        ...(health.limitations ?? []),
        ...(health.error ? [`当前错误：${health.error}`] : []),
        "数据通道状态不能改写为天气风险状态。"
      ])
    }));
  }

  if (snapshot.radar) {
    facts.push(visualMetadataFact("radar", "全国雷达", snapshot.radar));
  }
  if (snapshot.satellite) {
    facts.push(visualMetadataFact("satellite", "卫星索引", snapshot.satellite));
  }

  const snapshotAgeMinutes = ageMinutes(snapshot.generatedAt, now);
  if (snapshotAgeMinutes !== null && snapshotAgeMinutes > 15) {
    facts.push(makeFact({
      ref: "source:national-snapshot-age",
      category: "observation",
      scope: "source-status",
      statement: `全国态势快照生成于${snapshot.generatedAt}，读取时距生成已约${Math.floor(snapshotAgeMinutes)}分钟。`,
      sourceIds: ["national-situation"],
      dataTime: snapshot.generatedAt,
      limitations: ["快照生成时间不等于各上游事实的发布时间。"]
    }));
  }

  return promptBundle(dedupeFacts(facts), now, snapshot.generatedAt);
}

export function validateNationalSituationBroadcast(rawValue, prompt) {
  const errors = [];
  const parsed = parseJsonObject(rawValue);
  if (!parsed) return { ok: false, errors: ["output is not one complete JSON object"] };
  const extraTopLevelKeys = Object.keys(parsed).filter((key) => !["schemaVersion", "segments", "closing"].includes(key));
  if (extraTopLevelKeys.length) errors.push(`unexpected top-level fields: ${extraTopLevelKeys.join(", ")}`);
  if (parsed.schemaVersion !== SCHEMA_VERSION) errors.push(`schemaVersion must be ${SCHEMA_VERSION}`);
  if (!Array.isArray(parsed.segments) || parsed.segments.length < 1 || parsed.segments.length > MAX_SEGMENTS) {
    errors.push(`segments must contain 1-${MAX_SEGMENTS} items`);
  }

  const facts = Array.isArray(prompt?.request?.facts) ? prompt.request.facts : [];
  const byRef = new Map(facts.map((fact) => [fact.ref, fact]));
  const segments = Array.isArray(parsed.segments) ? parsed.segments : [];
  const normalizedSegments = [];

  for (const [index, segment] of segments.entries()) {
    const prefix = `segments[${index}]`;
    if (!segment || typeof segment !== "object" || Array.isArray(segment)) {
      errors.push(`${prefix} must be an object`);
      continue;
    }
    const extraSegmentKeys = Object.keys(segment).filter((key) => !["category", "text", "factRefs"].includes(key));
    if (extraSegmentKeys.length) errors.push(`${prefix} has unexpected fields: ${extraSegmentKeys.join(", ")}`);
    const category = segment.category;
    const text = typeof segment.text === "string" ? segment.text.trim() : "";
    const factRefs = Array.isArray(segment.factRefs) ? [...new Set(segment.factRefs)] : [];
    if (!CATEGORIES.has(category)) errors.push(`${prefix}.category is invalid`);
    if (text.length < 1 || [...text].length > MAX_TEXT_CHARS) errors.push(`${prefix}.text must contain 1-${MAX_TEXT_CHARS} characters`);
    if (factRefs.length < 1 || factRefs.length > MAX_FACT_REFS || !factRefs.every((ref) => typeof ref === "string")) {
      errors.push(`${prefix}.factRefs must contain 1-${MAX_FACT_REFS} string references`);
      continue;
    }
    const citedFacts = factRefs.map((ref) => byRef.get(ref)).filter(Boolean);
    const unknownRefs = factRefs.filter((ref) => !byRef.has(ref));
    if (unknownRefs.length) errors.push(`${prefix} has unknown factRefs: ${unknownRefs.join(", ")}`);
    if (citedFacts.some((fact) => fact.category !== category)) errors.push(`${prefix}.category does not match every cited fact`);
    validateClaimText(text, citedFacts, facts, prefix, errors);
    normalizedSegments.push({ category, text, factRefs });
  }

  if (NO_RISK_CLAIM.test(String(parsed.closing ?? ""))) errors.push("closing contains a prohibited no-risk claim");
  if (parsed.closing !== undefined && parsed.closing !== null && typeof parsed.closing !== "string") errors.push("closing must be a string or null");
  const closing = typeof parsed.closing === "string" ? parsed.closing.trim() : null;
  if (closing && [...closing].length > 60) errors.push("closing must not exceed 60 characters");
  if (closing && FACTUAL_CLOSING.test(closing)) errors.push("closing contains an uncited factual claim");
  return errors.length
    ? { ok: false, errors }
    : { ok: true, value: { schemaVersion: SCHEMA_VERSION, segments: normalizedSegments, closing: closing || null } };
}

export function buildDeterministicNationalSituationBroadcast(prompt) {
  const facts = Array.isArray(prompt?.request?.facts) ? prompt.request.facts : [];
  const preferred = [];
  const take = (predicate) => {
    const found = facts.find((fact) => !preferred.includes(fact) && predicate(fact));
    if (found) preferred.push(found);
  };
  take((fact) => OFFICIAL_SCOPES.has(fact.scope));
  take((fact) => fact.scope === "warning-summary");
  take((fact) => fact.scope === "typhoon");
  take((fact) => fact.scope === "source-status");
  take((fact) => fact.scope === "metadata-only");
  take(() => true);
  const segments = preferred.slice(0, 4).map((fact) => ({
    category: fact.category,
    text: fact.statement,
    factRefs: [fact.ref]
  }));
  return {
    schemaVersion: SCHEMA_VERSION,
    segments,
    closing: null
  };
}

/**
 * The legacy typhoon report remains Markdown and therefore cannot carry the
 * national factRefs schema. Keep it compatible by rejecting the exact classes
 * of claim that would require a separate official/disaster/causal source.
 */
export function validateLegacyTyphoonNarrative(value) {
  if (typeof value !== "string" || !value.trim()) return { ok: false, errors: ["legacy narrative is empty"] };
  const errors = [];
  if (DISASTER_OUTCOME.test(value)) errors.push("legacy narrative contains an uncited disaster outcome");
  if (WARNING_CLAIM.test(value)) errors.push("legacy narrative contains an uncited warning conclusion");
  if (UNSUPPORTED_CAUSATION.test(value)) errors.push("legacy narrative contains an uncited causal attribution");
  if (/(?:登陆|卫星显示|雷达显示|GFS显示)/.test(value)) errors.push("legacy narrative contains a fact class not present in its typhoon packet");
  return errors.length ? { ok: false, errors } : { ok: true, value: value.trim() };
}

function promptBundle(facts, now, snapshotGeneratedAt) {
  return {
    systemPrompt: `你是“气象 Boss 雷达”的全国态势播报器。只能从 facts 选择事实并逐段引用。
硬规则：
1. 输出严格 JSON，不要 Markdown、解释或思维过程。
2. 每段必须属于 official_fact、observation、model 之一，并且 factRefs 只能引用同类别事实。
3. 不得把全国预警归因给台风、城市或省份；只有输入显式关系才能作归因，而本合同默认不提供因果关系。
4. metadata-only 只可播报索引、帧时次或可用性；不得从雷达、卫星、GFS 或产品目录补造降水、强度、灾害、预警或登陆结论。
5. 来源失败、不可用、无记录或没有活动台风都不得改写成“无风险”或“安全”。
6. 不得补造灾情、伤亡、损失、交通、水位、停工停课或机构结论。
7. 只输出2-4段，每段不超过90个汉字；只选最高优先级事实，不要逐条复述 facts、规则或限制；closing 设为 null。
输出形状：{"schemaVersion":1,"segments":[{"category":"official_fact|observation|model","text":"","factRefs":["fact ref"]}],"closing":"可选非事实收束语"}`,
    request: {
      task: "生成一段可发布的中文全国气象态势短播报；优先官方红橙预警，其次其他官方事实，再到观察和模型，类别不得混写。",
      generatedAt: now,
      snapshotGeneratedAt,
      facts,
      outputSchema: {
        schemaVersion: SCHEMA_VERSION,
        segments: [{ category: "official_fact", text: "不超过90个汉字", factRefs: ["known fact ref"] }],
        closing: "string|null"
      },
      outputPolicy: {
        segmentCount: "2-4",
        maximumCharactersPerSegment: 90,
        closing: "优先为 null；不得在 closing 放任何事实、风险或来源判断",
        selection: "只选最高优先级事实，不要逐条复述 facts，不要复述规则或限制"
      }
    }
  };
}

function validateClaimText(text, citedFacts, allFacts, prefix, errors) {
  if (NO_RISK_CLAIM.test(text)) errors.push(`${prefix} contains a prohibited no-risk claim`);
  if (DISASTER_OUTCOME.test(text) && !citedFacts.some((fact) => fact.supportsDisasterOutcome)) {
    errors.push(`${prefix} contains an unsupported disaster outcome`);
  }
  if (UNSUPPORTED_CAUSATION.test(text) && !citedFacts.some((fact) => fact.supportsAttribution)) {
    errors.push(`${prefix} contains an unsupported causal attribution`);
  }
  if (WARNING_CLAIM.test(text) && !citedFacts.some((fact) => OFFICIAL_SCOPES.has(fact.scope) || fact.scope === "warning-summary")) {
    errors.push(`${prefix} turns a non-warning fact into a warning conclusion`);
  }
  if (METADATA_INFERENCE.test(text) && citedFacts.some((fact) => fact.scope === "metadata-only" || fact.scope === "source-status")) {
    errors.push(`${prefix} derives weather from metadata or source status`);
  }
  const mentionedKnownLocations = new Set(
    allFacts.flatMap((fact) => fact.locations ?? []).filter((name) => name !== "全国" && text.includes(name))
  );
  const citedLocations = new Set(citedFacts.flatMap((fact) => fact.locations ?? []));
  for (const name of mentionedKnownLocations) {
    if (!citedLocations.has(name)) errors.push(`${prefix} attributes a claim to uncited location ${name}`);
  }
  for (const match of text.matchAll(ADMINISTRATIVE_NAME)) {
    const name = match[1];
    if (!citedFacts.some((fact) => fact.locations?.some((location) => name.includes(location) || location.includes(name)) || fact.statement.includes(name))) {
      errors.push(`${prefix} names unsupported administrative area ${name}`);
    }
  }
}

function makeFact(value) {
  return {
    ref: value.ref,
    category: value.category,
    scope: value.scope,
    statement: value.statement,
    sourceIds: compactStrings(value.sourceIds),
    dataTime: value.dataTime ?? null,
    locations: compactStrings(value.locations),
    hazards: compactStrings(value.hazards),
    limitations: compactStrings(value.limitations),
    supportsAttribution: value.supportsAttribution === true,
    supportsDisasterOutcome: value.supportsDisasterOutcome === true
  };
}

function visualMetadataFact(id, label, layer) {
  const latest = layer.frames?.[0];
  return makeFact({
    ref: `metadata:${id}`,
    category: "observation",
    scope: "metadata-only",
    statement: `${label}状态为${layer.status}；最新可用索引时次${latest?.observedAt ?? "未记录"}；地理标定${layer.georeferenced ? "已确认" : "未确认"}。`,
    sourceIds: compactStrings([layer.sourceId]),
    dataTime: latest?.observedAt ?? layer.updatedAt ?? null,
    locations: ["全国"],
    limitations: compactStrings([
      ...(layer.limitations ?? []),
      "本条只支持索引、帧时次、可用性和标定状态，不支持天气或灾害结论。"
    ])
  });
}

function warningSummaryStatement(warnings, health) {
  const levels = ["red", "orange", "yellow", "blue"]
    .map((level) => `${level}:${Number(warnings.byLevel?.[level] ?? 0)}`)
    .join("，");
  return `全国官方预警快照记录${warnings.total}条，分级为${levels}；最高等级${warnings.highestLevel ?? "无记录"}；汇总时次${warnings.updatedAt ?? "未记录"}；来源状态${health?.status ?? "未记录"}。`;
}

function eventStatement(event) {
  const place = compactStrings(event.geography?.names).join("、") || "地域未明确";
  return `${event.title}；${event.factSummary}；等级${event.level}；地域${place}；事实时次${event.dataTime ?? event.issuedAt ?? "未记录"}。`;
}

function categoryForEvidence(evidenceLevel) {
  if (evidenceLevel === "official") return "official_fact";
  if (evidenceLevel === "model") return "model";
  return "observation";
}

function sourceHealthById(snapshot, sourceId) {
  return snapshot.sourceHealth.find((health) => health.sourceId === sourceId) ?? null;
}

function isNationalSnapshot(value) {
  return value?.schemaVersion === 1 && Array.isArray(value.events) && Array.isArray(value.sourceHealth);
}

function parseJsonObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  const withoutThinking = value.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (/<think>/i.test(withoutThinking)) return null;
  try {
    // The report is persisted and rebroadcast automatically. Accept exactly
    // one JSON object, not a recoverable fragment hidden in prose or fences.
    const parsed = JSON.parse(withoutThinking);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function dedupeFacts(facts) {
  return [...new Map(facts.map((fact) => [fact.ref, fact])).values()];
}

function safeRefPart(value) {
  return String(value ?? "unknown").trim().replace(/[^A-Za-z0-9._:-]+/g, "-") || "unknown";
}

function compactStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))];
}

function validIso(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

function ageMinutes(from, to) {
  const start = Date.parse(from ?? "");
  const end = Date.parse(to ?? "");
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, (end - start) / 60_000) : null;
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.min(max, Math.max(min, number)) : fallback;
}
