import type { CityBriefing } from "@/lib/cityBriefingData";

export type CitySignalSeverity = "critical" | "watch" | "notable" | "calm";
export type CitySignalIcon = "rain" | "humidity" | "heat" | "wind" | "warning";

export interface CitySignal {
  id: string;
  label: string;
  value: string;
  detail: string;
  severity: CitySignalSeverity;
  icon: CitySignalIcon;
  comment: string;
  rank?: { position: number; total: number; scope: string };
}

export interface CityEvidenceChip { label: string; value: string; }
export interface CitySignalBoard { signals: CitySignal[]; evidence: CityEvidenceChip[]; }

const HUMID_COMMENTS = ["空气今天选择贴身办公。", "晾衣架正在申请带薪休假。", "呼吸像穿过一层温热滤镜。"];
const HEAT_COMMENTS = ["太阳今天没打卡，它直接坐镇现场。", "出门像把自己交给蒸箱预热。", "阴凉处今天属于战略资源。"];
const WIND_COMMENTS = ["发型今天拥有独立外交权。", "伞面请先和风场谈判。", "轻物件正在考虑离家出走。"];
const RAIN_COMMENTS = ["伞先别退休，路线给自己留个转身位。", "雨云正在往通勤时间表里塞任务。", "鞋底今天需要一点预见性。"];

export function buildCitySignalBoard(briefing: CityBriefing): CitySignalBoard {
  const { current, nextSixHours: next, minutelyRain, recentRain, comparison } = briefing;
  const signals: CitySignal[] = [];
  const warning = briefing.officialWarnings[0];
  if (warning) {
    signals.push({ id: "warning", label: "官方预警", value: warning.title, detail: warning.senderName ?? "以属地最新发布为准", severity: "critical", icon: "warning", comment: "这不是整活区：先按属地指引安排。" });
  }
  if ((recentRain?.total24hMm ?? 0) >= 20) {
    const value = recentRain!.total24hMm!.toFixed(1).replace(/\.0$/, "");
    signals.push({ id: "recent-rain", label: "雨后遗留", value: `24h ${value} mm`, detail: `历史实况 · ${recentRain?.observedDate ?? "前一日"}`, severity: (recentRain?.total24hMm ?? 0) >= 50 ? "critical" : "watch", icon: "rain", comment: "天上安静不等于地面下班，低洼路线仍要留心。" });
  }
  const rainSoon = minutelyRain.precipitationNextTwoHoursMm ?? next.precipitationMm ?? 0;
  if (rainSoon >= 2 || (next.maxHourlyPrecipitationMm ?? 0) >= 3) {
    signals.push({ id: "incoming-rain", label: "雨幕推进", value: `2h ${formatNumber(rainSoon)} mm`, detail: minutelyRain.available ? `5分钟峰值 ${formatNumber(minutelyRain.maxFiveMinutePrecipitationMm)} mm` : `6小时累计 ${formatNumber(next.precipitationMm)} mm`, severity: rainSoon >= 15 ? "critical" : "watch", icon: "rain", comment: pick(RAIN_COMMENTS, briefing, "incoming-rain") });
  }
  const apparent = current.apparentTemperatureC ?? current.temperatureC;
  if (apparent !== null && (apparent >= 32 || comparison?.apparentTemperatureRank && comparison.apparentTemperatureRank.position <= 3)) {
    signals.push({ id: "heat", label: "体感加码", value: `体感 ${formatNumber(apparent)}°`, detail: `气温 ${formatNumber(current.temperatureC)}°`, severity: apparent >= 35 ? "critical" : "watch", icon: "heat", comment: pick(HEAT_COMMENTS, briefing, "heat"), rank: comparison?.apparentTemperatureRank });
  }
  const humidity = current.relativeHumidityPct;
  if (humidity !== null && (humidity >= 80 || comparison?.relativeHumidityRank && comparison.relativeHumidityRank.position <= 3)) {
    signals.push({ id: "humidity", label: "湿热黏人", value: `湿度 ${formatNumber(humidity)}%`, detail: "相对湿度 · 近实时", severity: humidity >= 90 ? "watch" : "notable", icon: "humidity", comment: pick(HUMID_COMMENTS, briefing, "humidity"), rank: comparison?.relativeHumidityRank });
  }
  const wind = next.maxWindGustMps ?? current.windSpeedMps;
  if (wind !== null && (wind >= 10 || comparison?.windSpeedRank && comparison.windSpeedRank.position <= 3)) {
    signals.push({ id: "wind", label: "风场插队", value: `阵风 ${formatNumber(wind)} m/s`, detail: next.maxWindGustMps !== null ? "未来6小时峰值" : "近地实时风", severity: wind >= 17 ? "critical" : "watch", icon: "wind", comment: pick(WIND_COMMENTS, briefing, "wind"), rank: comparison?.windSpeedRank });
  }
  if (!signals.length) {
    signals.push({ id: "calm", label: "平稳窗口", value: "暂无强异动", detail: "不把低风、零雨硬凑成警报", severity: "calm", icon: "heat", comment: "天气今天走低调路线，行程照常，但别把它当永久免战牌。" });
  }
  const priority = { critical: 0, watch: 1, notable: 2, calm: 3 };
  signals.sort((a, b) => priority[a.severity] - priority[b.severity]);
  return { signals: signals.slice(0, 4), evidence: buildEvidence(briefing, signals) };
}

function buildEvidence(briefing: CityBriefing, signals: CitySignal[]): CityEvidenceChip[] {
  const ids = new Set(signals.map((signal) => signal.id));
  const values: CityEvidenceChip[] = [];
  if (!ids.has("heat") && briefing.current.apparentTemperatureC !== null) values.push({ label: "体感", value: `${formatNumber(briefing.current.apparentTemperatureC)}°` });
  if (!ids.has("humidity") && briefing.current.relativeHumidityPct !== null) values.push({ label: "湿度", value: `${formatNumber(briefing.current.relativeHumidityPct)}%` });
  if (!ids.has("incoming-rain") && briefing.minutelyRain.available) values.push({ label: "2h雨量", value: `${formatNumber(briefing.minutelyRain.precipitationNextTwoHoursMm)} mm` });
  if (!ids.has("wind") && briefing.nextSixHours.maxWindGustMps !== null) values.push({ label: "阵风", value: `${formatNumber(briefing.nextSixHours.maxWindGustMps)} m/s` });
  return values.slice(0, 3);
}

function formatNumber(value: number | null) { return value === null ? "--" : value.toFixed(1).replace(/\.0$/, ""); }
function pick(pool: string[], briefing: CityBriefing, key: string) {
  const seed = `${briefing.city.name}|${briefing.current.observedAt ?? briefing.generatedAt}|${key}`;
  const hash = [...seed].reduce((total, char) => (total * 31 + char.charCodeAt(0)) >>> 0, 0);
  return pool[hash % pool.length]!;
}
