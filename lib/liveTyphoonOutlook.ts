export type TyphoonOutlookSourceStatus = "fresh" | "stale" | "unknown" | "unavailable";

export type TyphoonEvolutionOutlook = {
  schemaVersion: 1;
  generatedAt: string;
  basin: "western-north-pacific";
  summary: string;
  sources: Record<string, {
    url: string;
    updatedAt: string | null;
    status: TyphoonOutlookSourceStatus;
    error: string | null;
  }>;
  nearTermDisturbances: Array<{
    factRef: string;
    id: string;
    latitude: number;
    longitude: number;
    potential: "low" | "medium" | "high";
    timeWindowHours: number;
    numericProbability: null;
    maximumWindKt: number | null;
    minimumPressureHpa: number | null;
    favorableSignals: string[];
    limitingSignals: string[];
    sourceText: string;
  }>;
  extendedRangeAreas: Array<{
    factRef: string;
    week: 2 | 3;
    probabilityPercent: 20 | 40 | 60;
    validPeriod: string | null;
    center: { latitude: number; longitude: number };
    bounds: { south: number; north: number; west: number; east: number };
    sourceUrl: string;
  }>;
  limitations: string[];
};

export type TyphoonEvolutionOutlookPayload = {
  status: "available" | "unavailable";
  updatedAt: string | null;
  outlook: TyphoonEvolutionOutlook | null;
};

export type LiveTyphoonOutlookView = {
  available: boolean;
  timestampLabel: string;
  tickerText: string;
  sourceLabel: string;
};

export type TyphoonOutlookMarkerModel = {
  id: string;
  longitude: number;
  latitude: number;
  label: string;
  detail: string;
};

const POTENTIAL_LABELS = { low: "低", medium: "中", high: "高" } as const;

function formatShanghaiTimestamp(value: string | null | undefined) {
  if (!value) return "等待首份研判";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "时间待核验";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date).replaceAll("/", "-");
}

function coordinateText(latitude: number, longitude: number) {
  const lat = `${Math.abs(latitude).toFixed(1)}°${latitude >= 0 ? "N" : "S"}`;
  const lon = `${Math.abs(longitude).toFixed(1)}°${longitude >= 0 ? "E" : "W"}`;
  return `${lat}、${lon}`;
}

export function buildLiveTyphoonOutlookView(
  payload: TyphoonEvolutionOutlookPayload
): LiveTyphoonOutlookView {
  const outlook = payload.outlook;
  if (payload.status !== "available" || !outlook) {
    return {
      available: false,
      timestampLabel: "等待首份研判",
      tickerText: "台风生成研判暂不可用；系统正在等待下一次资料同步。",
      sourceLabel: "DATA PENDING"
    };
  }

  const items = outlook.nearTermDisturbances.map((disturbance) =>
    `JTWC ${disturbance.id}：未来${disturbance.timeWindowHours}小时发展潜势${POTENTIAL_LABELS[disturbance.potential]}，中心约${coordinateText(disturbance.latitude, disturbance.longitude)}`
  );
  if (outlook.nearTermDisturbances.length === 0) {
    items.push("JTWC未来24小时当前未列出西北太平洋热带扰动；这不等于零概率");
  }
  items.push(...outlook.extendedRangeAreas.map((area) =>
    `NOAA CPC第${area.week}周区域生成概率 ${area.probabilityPercent}%，几何中心约${coordinateText(area.center.latitude, area.center.longitude)}${area.validPeriod ? `，有效期${area.validPeriod}` : ""}`
  ));
  if (outlook.extendedRangeAreas.length > 0) {
    items.push("CPC百分比表示区域内至少一次热带气旋生成的概率，不是单个胚胎的定点概率");
  }

  return {
    available: true,
    timestampLabel: formatShanghaiTimestamp(outlook.generatedAt),
    tickerText: items.join("　◆　"),
    sourceLabel: "JTWC / NOAA CPC"
  };
}

export function buildTyphoonOutlookMarkerModels(
  payload: TyphoonEvolutionOutlookPayload
): TyphoonOutlookMarkerModel[] {
  if (payload.status !== "available" || !payload.outlook) return [];
  return payload.outlook.extendedRangeAreas.map((area) => ({
    id: area.factRef,
    longitude: area.center.longitude,
    latitude: area.center.latitude,
    label: `第${area.week}周 · 区域生成概率${area.probabilityPercent}%`,
    detail: `${coordinateText(area.center.latitude, area.center.longitude)}${area.validPeriod ? ` · ${area.validPeriod}` : ""}`
  }));
}
