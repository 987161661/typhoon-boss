import type { PanelWarning } from "@/lib/cityPanelsPresentation";

export type CityWarningSeverity = "red" | "orange" | "yellow" | "blue" | "watch" | "none" | "unavailable";
export type CityWarningKind = "heat" | "rain" | "thunder" | "wind" | "typhoon" | "cold" | "fog" | "dust" | "fire" | "generic";

export interface CityWarningVisual {
  severity: CityWarningSeverity;
  kind: CityWarningKind;
  levelLabel: string;
  kindLabel: string;
}

/** Visual treatment only decorates the official warning already in the panel. */
export function resolveCityWarningVisual(warning: PanelWarning): CityWarningVisual {
  const severity = resolveSeverity(warning);
  const kind = resolveKind(`${warning.title} ${warning.description ?? ""}`);
  return { severity, kind, levelLabel: severityLabel(severity), kindLabel: kindLabel(kind) };
}

function resolveSeverity(warning: PanelWarning): CityWarningSeverity {
  if (warning.status !== "active") return warning.status === "unavailable" ? "unavailable" : "none";
  const level = warning.level?.toLowerCase() ?? "";
  if (level.includes("red") || level.includes("红")) return "red";
  if (level.includes("orange") || level.includes("橙")) return "orange";
  if (level.includes("yellow") || level.includes("黄")) return "yellow";
  if (level.includes("blue") || level.includes("蓝")) return "blue";
  return "watch";
}

function resolveKind(text: string): CityWarningKind {
  if (/台风/u.test(text)) return "typhoon";
  if (/暴雨|暴雪|冰雹/u.test(text)) return "rain";
  if (/雷电|雷暴|强对流/u.test(text)) return "thunder";
  if (/高温/u.test(text)) return "heat";
  if (/大风/u.test(text)) return "wind";
  if (/寒潮|低温|霜冻|道路结冰|冰冻/u.test(text)) return "cold";
  if (/大雾/u.test(text)) return "fog";
  if (/沙尘|霾/u.test(text)) return "dust";
  if (/干旱|森林.*火险|火险/u.test(text)) return "fire";
  return "generic";
}

function severityLabel(severity: CityWarningSeverity) {
  return ({ red: "红色", orange: "橙色", yellow: "黄色", blue: "蓝色", watch: "预警", none: "无有效预警", unavailable: "链路受限" })[severity];
}

function kindLabel(kind: CityWarningKind) {
  return ({ heat: "高温", rain: "强降水", thunder: "雷电对流", wind: "大风", typhoon: "台风", cold: "低温冰冻", fog: "浓雾", dust: "沙尘", fire: "火险", generic: "气象" })[kind];
}
