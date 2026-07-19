export const JTWC_WESTERN_PACIFIC_ADVISORY_URL = "https://www.metoc.navy.mil/jtwc/products/abpwweb.txt";
export const CPC_WEEK2_TC_KML_URL = "https://www.cpc.ncep.noaa.gov/products/precip/CWlink/ghaz/kmzs/W2_TC.kml";
export const CPC_WEEK3_TC_KML_URL = "https://www.cpc.ncep.noaa.gov/products/precip/CWlink/ghaz/kmzs/W3_TC.kml";

const MONTHS = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11
};

export function buildTropicalDisturbanceOutlook(inputs, options = {}) {
  const now = new Date(options.now ?? Date.now());
  const jtwc = parseJtwcAdvisory(inputs.jtwcAdvisory, now);
  const week2 = parseCpcKml(inputs.cpcWeek2Kml, 2, now);
  const week3 = parseCpcKml(inputs.cpcWeek3Kml, 3, now);
  const extendedRangeAreas = [...week2.areas, ...week3.areas]
    .sort((a, b) => a.week - b.week || b.probabilityPercent - a.probabilityPercent);
  const summary = jtwc.disturbances.length
    ? `JTWC 在西北太平洋列出 ${jtwc.disturbances.length} 个热带扰动；延伸期有 ${extendedRangeAreas.length} 个 CPC 概率区域。`
    : `JTWC 当前未列出热带扰动；延伸期有 ${extendedRangeAreas.length} 个 CPC 概率区域。`;

  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    basin: "western-north-pacific",
    summary,
    sources: {
      jtwc: jtwc.source,
      cpcWeek2: week2.source,
      cpcWeek3: week3.source
    },
    nearTermDisturbances: jtwc.disturbances,
    extendedRangeAreas,
    limitations: [
      "JTWC LOW/MEDIUM/HIGH 是未来约 24 小时的定性等级，不等于官方百分比。",
      "CPC 20/40/60% 是第 2 周或第 3 周区域内至少一次热带气旋生成的区域概率，不是单个胚胎的精确路径或定点概率。",
      "没有被官方扰动公报或概率区覆盖时，只能表述为当前未识别到可信候选，不能表述为零概率。"
    ]
  };
}

export function renderTropicalDisturbanceReport(outlook) {
  const nearTerm = outlook.nearTermDisturbances.length
    ? outlook.nearTermDisturbances.map((item) => {
        const potential = { low: "LOW（较低）", medium: "MEDIUM（中等）", high: "HIGH（较高）" }[item.potential] ?? "未定级";
        const signals = [...item.favorableSignals, ...item.limitingSignals].join("、") || "公报未提供可结构化提取的环境信号";
        return `- **${item.id}**：中心约 ${formatCoordinate(item.latitude, "N", "S")} / ${formatCoordinate(item.longitude, "E", "W")}；JTWC 未来 ${item.timeWindowHours ?? 24} 小时发展潜势为 ${potential}。JTWC 未发布对应数值概率，因此本报告不把该等级擅自换算成百分比。环境信号：${signals}。`;
      }).join("\n")
    : "- JTWC 最新西北太平洋显著天气公报在未来24小时监测窗内未列出热带扰动；这表示当前没有官方近时胚胎候选，不表示生成概率为零。";

  const extended = outlook.extendedRangeAreas.length
    ? outlook.extendedRangeAreas.map((area) => {
        const bounds = `${formatCoordinate(area.bounds.south, "N", "S")}–${formatCoordinate(area.bounds.north, "N", "S")}、${formatCoordinate(area.bounds.west, "E", "W")}–${formatCoordinate(area.bounds.east, "E", "W")}`;
        return `- **第${area.week}周 ${area.probabilityPercent}% 区域**（有效期 ${area.validPeriod || "以源产品为准"}）：概率区几何中心约 ${formatCoordinate(area.center.latitude, "N", "S")} / ${formatCoordinate(area.center.longitude, "E", "W")}，覆盖范围约 ${bounds}。这是区域生成概率，不是单个胚胎的精确路径。`;
      }).join("\n")
    : "- CPC 最新第2周/第3周产品中，未解析到落入西北太平洋的热带气旋生成概率区，或概率产品暂不可用。";

  return `## 潜在台风胚胎研判

### 未来24小时官方扰动监测

${nearTerm}

### 第2周至第3周概率区域

${extended}

### 研判口径

${outlook.limitations.map((item) => `- ${item}`).join("\n")}`;
}

function parseJtwcAdvisory(text, now) {
  if (typeof text !== "string" || !text.trim()) {
    return { disturbances: [], source: sourceStatus(JTWC_WESTERN_PACIFIC_ADVISORY_URL, null, "unavailable", "未取得 JTWC 公报") };
  }
  const issuedAt = parseJtwcIssuedAt(text);
  const westernPacific = text.match(/1\.\s*WESTERN NORTH PACIFIC AREA[\s\S]*?(?=\n\s*2\.\s*SOUTH PACIFIC AREA|\/\/\s*NNNN|$)/i)?.[0] ?? text;
  const disturbanceSection = westernPacific.match(/B\.\s*TROPICAL DISTURBANCE SUMMARY\s*:\s*([\s\S]*?)(?=\n\s*C\.\s*SUBTROPICAL SYSTEM SUMMARY|$)/i)?.[1] ?? "";
  const status = freshnessStatus(issuedAt, now, 36);
  if (!disturbanceSection || /^\s*NONE\b/i.test(disturbanceSection)) {
    return { disturbances: [], source: sourceStatus(JTWC_WESTERN_PACIFIC_ADVISORY_URL, issuedAt, status, null) };
  }

  const paragraphs = disturbanceSection
    .split(/(?=\s*\(\d+\)\s*)/)
    .map((value) => value.replace(/^\s*\(\d+\)\s*/, "").replace(/\s+/g, " ").trim())
    .filter((value) => value && !/NO OTHER SUSPECT AREAS|NO LONGER SUSPECT/i.test(value));
  const disturbances = paragraphs.map((paragraph, index) => parseJtwcDisturbance(paragraph, index)).filter(Boolean);
  return { disturbances, source: sourceStatus(JTWC_WESTERN_PACIFIC_ADVISORY_URL, issuedAt, status, null) };
}

function parseJtwcDisturbance(text, index) {
  const preferredPosition = text.match(/(?:NOW LOCATED|HAS PERSISTED)\s+NEAR\s+(\d+(?:\.\d+)?)([NS])\s+(\d+(?:\.\d+)?)([EW])/i);
  const allPositions = [...text.matchAll(/NEAR\s+(\d+(?:\.\d+)?)([NS])\s+(\d+(?:\.\d+)?)([EW])/gi)];
  const position = preferredPosition ?? allPositions.at(-1);
  const potentialMatch = text.match(/WITHIN THE NEXT\s+(\d+)\s+HOURS[\s\S]{0,80}?\b(LOW|MEDIUM|HIGH)\b/i);
  if (!position || !potentialMatch) return null;
  const id = text.match(/INVEST\s+(\d{2}[A-Z])/i)?.[1]?.toUpperCase() ?? `AREA-${index + 1}`;
  const windMatch = text.match(/MAXIMUM SUSTAINED SURFACE WINDS (?:ARE|WERE) ESTIMATED AT\s+(\d+)\s+TO\s+(\d+)\s+KNOTS/i);
  const pressureMatch = text.match(/MINIMUM SEA LEVEL PRESSURE IS ESTIMATED TO BE NEAR\s+(\d+)\s+MB/i);
  return {
    factRef: `jtwc:invest:${id}`,
    id,
    latitude: signedCoordinate(position[1], position[2]),
    longitude: signedCoordinate(position[3], position[4]),
    potential: potentialMatch[2].toLowerCase(),
    timeWindowHours: Number(potentialMatch[1]),
    numericProbability: null,
    maximumWindKt: windMatch ? Number(windMatch[2]) : null,
    minimumPressureHpa: pressureMatch ? Number(pressureMatch[1]) : null,
    favorableSignals: extractSignals(text, [
      [/LOW VERTICAL WIND SHEAR/i, "低垂直风切变"],
      [/(?:GOOD|STRONG) (?:POLEWARD |EQUATORWARD )?OUTFLOW/i, "高空辐散条件良好"],
      [/WARM[^.]{0,30}SEA SURFACE TEMPERATURES|SSTS? (?:ARE )?FAVORABLE/i, "海温偏暖"]
    ]),
    limitingSignals: extractSignals(text, [
      [/HIGH VERTICAL WIND SHEAR/i, "垂直风切变偏强"],
      [/DRY AIR/i, "干空气侵入"],
      [/LAND INTERACTION/i, "陆地相互作用"],
      [/(?:POOR|WEAK) OUTFLOW/i, "高空辐散不足"]
    ]),
    sourceText: text
  };
}

function parseCpcKml(text, week, now) {
  const url = week === 2 ? CPC_WEEK2_TC_KML_URL : CPC_WEEK3_TC_KML_URL;
  if (typeof text !== "string" || !text.trim()) {
    return { areas: [], source: sourceStatus(url, null, "unavailable", "未取得 CPC KML") };
  }
  const name = decodeXml(text.match(/<Document[^>]*>[\s\S]*?<name>([\s\S]*?)<\/name>/i)?.[1] ?? "");
  const issuedAt = parseCpcDate(name.match(/Issued:\s*(\d{2}\/\d{2}\/\d{4})/i)?.[1]);
  const validPeriod = name.match(/Valid:\s*([^<]+)$/i)?.[1]?.trim() ?? null;
  const placemarks = [...text.matchAll(/<Placemark\b[\s\S]*?<\/Placemark>/gi)];
  const areas = [];
  for (const [index, match] of placemarks.entries()) {
    const block = match[0];
    const probability = Number(block.match(/<td>\s*prob\s*<\/td>\s*<td>\s*(\d+)\s*<\/td>/i)?.[1]);
    const coordinateTexts = [...block.matchAll(/<coordinates>([\s\S]*?)<\/coordinates>/gi)].map((item) => item[1]);
    const points = coordinateTexts.flatMap(parseCoordinates);
    if (![20, 40, 60].includes(probability) || !points.length) continue;
    const normalized = points.map((point) => ({ latitude: point.latitude, longitude: normalizeLongitude(point.longitude) }));
    const center = {
      latitude: round1(normalized.reduce((sum, point) => sum + point.latitude, 0) / normalized.length),
      longitude: round1(normalized.reduce((sum, point) => sum + point.longitude, 0) / normalized.length)
    };
    if (center.latitude < 0 || center.latitude > 40 || center.longitude < 100 || center.longitude > 180) continue;
    const latitudes = normalized.map((point) => point.latitude);
    const longitudes = normalized.map((point) => point.longitude);
    areas.push({
      factRef: `cpc:week-${week}:area-${index + 1}`,
      week,
      probabilityPercent: probability,
      validPeriod,
      center,
      bounds: {
        south: round1(Math.min(...latitudes)), north: round1(Math.max(...latitudes)),
        west: round1(Math.min(...longitudes)), east: round1(Math.max(...longitudes))
      },
      sourceUrl: url
    });
  }
  return { areas, source: sourceStatus(url, issuedAt, freshnessStatus(issuedAt, now, 8 * 24), null) };
}

function parseCoordinates(value) {
  return value.trim().split(/\s+/).map((tuple) => {
    const [longitude, latitude] = tuple.split(",").map(Number);
    return { latitude, longitude };
  }).filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude));
}

function parseJtwcIssuedAt(text) {
  const match = text.match(/\/(\d{2})(\d{2})\d{2}Z-\d{6}Z([A-Z]{3})(\d{4})\/\//i);
  if (!match || !(match[3].toUpperCase() in MONTHS)) return null;
  return new Date(Date.UTC(Number(match[4]), MONTHS[match[3].toUpperCase()], Number(match[1]), Number(match[2]))).toISOString();
}

function parseCpcDate(value) {
  const match = value?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? new Date(Date.UTC(Number(match[3]), Number(match[1]) - 1, Number(match[2]))).toISOString() : null;
}

function freshnessStatus(updatedAt, now, maxAgeHours) {
  if (!updatedAt) return "unknown";
  return now.getTime() - Date.parse(updatedAt) <= maxAgeHours * 60 * 60 * 1000 ? "fresh" : "stale";
}

function sourceStatus(url, updatedAt, status, error) { return { url, updatedAt, status, error }; }
function signedCoordinate(value, hemisphere) { return Number(value) * (/S|W/i.test(hemisphere) ? -1 : 1); }
function normalizeLongitude(value) { return value < 0 ? value + 360 : value; }
function round1(value) { return Math.round(value * 10) / 10; }
function extractSignals(text, definitions) { return definitions.filter(([pattern]) => pattern.test(text)).map(([, label]) => label); }
function decodeXml(value) { return value.replace(/&#37;/g, "%").replace(/&amp;/g, "&").trim(); }
function formatCoordinate(value, positive, negative) { return Number.isFinite(value) ? `${Math.abs(value).toFixed(1)}°${value >= 0 ? positive : negative}` : "—"; }
