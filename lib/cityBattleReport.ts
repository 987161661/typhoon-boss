import type { CityBriefing, CityBriefingNarrative } from "@/lib/cityBriefingData";
import { currentWeatherText, isCurrentPrecipitation } from "@/lib/cityWeatherSemantics";

type Briefing = Omit<CityBriefing, "narrative">;
type Stage = CityBriefingNarrative["stage"];

export function buildCityBattleReport(briefing: Briefing, stage: Stage, variant = 0): string {
  const city = briefing.city.name;
  const key = city + "|" + briefing.current.observedAt + "|" + stage + "|" + briefing.nextSixHours.precipitationMm + "|" + variant;
  const warning = briefing.officialWarnings[0];
  if (warning) return "【预警优先】" + warning.title + "已生效。今天不安排段子，请优先遵从属地气象和应急部门指引。";
  if (stage === "recovery_watch") return "【恢复观察】" + city + "的主雨幕暂时撤场，地面还在处理它留下的加班单。天上安静不等于路面轻松，低洼与临水路线今天继续保持谨慎。";
  if (stage === "data_gap") return "【资料待补】" + city + "的天气画面还没收齐，先别急着给今天下结论。出门前看一眼属地预警，给行程留一点回旋余地。";

  const apparent = briefing.current.apparentTemperatureC ?? briefing.current.temperatureC ?? 0;
  const rainSoon = (briefing.minutelyRain.precipitationNextTwoHoursMm ?? 0) >= 1;
  const rainLater = (briefing.nextSixHours.precipitationMm ?? 0) >= 3 || (briefing.nextSixHours.maxPrecipitationProbabilityPct ?? 0) >= 55;
  const wetNow = isCurrentPrecipitation(briefing.current);
  const windy = (briefing.nextSixHours.maxWindGustMps ?? 0) >= 9;
  if (wetNow) {
    const condition = currentWeatherText(briefing.current) ?? "有降水";
    const amount = briefing.current.precipitationMm;
    const amountText = amount === null ? "" : `，降水量读数 ${formatNumber(amount)} mm`;
    return `【代表点${condition}】${city}城市代表点在 ${briefing.current.observedAt ?? "最近更新时间"} 记录为${condition}${amountText}；这是代表点近实时资料，不代表全城同步降雨。`;
  }
  if (apparent >= 33 && (rainSoon || rainLater)) return compose("闷热待雨", key, hotOpen, rainWaitTurn, rainWaitClose);
  if (apparent >= 33) return compose("高温值守", key, hotOpen, hotTurn, hotClose);
  if (rainSoon || rainLater) return compose("雨云候场", key, rainWaitOpen, rainWaitTurn, rainWaitClose);
  if (windy) return compose("风场扰动", key, windOpen, windTurn, windClose);
  return compose("短时平稳", key, calmOpen, calmTurn, calmClose);
}

function compose(label: string, key: string, open: readonly string[], turn: readonly string[], close: readonly string[]) {
  return "【" + label + "】" + pick(open, key + ":0") + pick(turn, key + ":1") + pick(close, key + ":2");
}
function pick(items: readonly string[], key: string) { return items[hash(key) % items.length]; }
function hash(value: string) { let result = 2166136261; for (let i = 0; i < value.length; i += 1) { result ^= value.charCodeAt(i); result = Math.imul(result, 16777619); } return result >>> 0; }
function formatNumber(value: number) { return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, ""); }

const hotOpen = ["空气像刚合上的锅盖，城市被闷得很有参与感。", "太阳今天不打卡，它直接坐镇现场。", "热感把街道调成了低速模式，连影子都懒得离岗。"] as const;
const hotTurn = ["空调获得加班许可，午后出门请给自己预留一条阴影路线。", "今天适合把补水当作日程，不适合把正午当作散步邀请。", "外出可以，别把自己当成可重复加热的便当。"] as const;
const hotClose = ["城市在发烫，节奏可以慢一点。", "防晒和水，比意志力更有用。", "凉快的地方今天拥有稀缺资源属性。"] as const;
const rainWaitOpen = ["云层今天在门口徘徊，像一封还没按下发送的消息。", "天空看着克制，雨云却没有离开会场。", "天气正在修改剧本，下一幕可能比开场更湿。"] as const;
const rainWaitTurn = ["伞先别退休，通勤路线也给自己留一点弹性。", "出门和回家未必属于同一套天气，包里留把伞更省心。", "雨不一定抢戏，但很擅长挑你觉得没事的时候登场。"] as const;
const rainWaitClose = ["今天的关键不是硬扛，是留一个转身的余地。", "先把伞带上，剩下的交给云层自己纠结。", "鞋面不必参加天气的即兴演出。"] as const;
const windOpen = ["风场开始巡逻，街边招牌和发型都在接受压力测试。", "空气今天有了推力，直线行走变成协商项目。", "风正在给城市做免费通风，手里的伞未必同意。"] as const;
const windTurn = ["高处物品和临时搭建物今天值得多看一眼。", "沿街走可以，别和伞展开拔河比赛。", "帽子若想离家出走，请先把它劝住。"] as const;
const windClose = ["把重心放低，城市就没那么爱开玩笑。", "今天适合稳一点，不适合轻一点。", "风会过去，别让东西先飞走。"] as const;
const calmOpen = ["天气暂时把音量调低，城市获得一段安静窗口。", "天空今天没准备整活，先把普通日子过好。", "云层目前按兵不动，适合把计划照常推进。"] as const;
const calmTurn = ["这不是永久免战牌，只是眼下没有明显插曲。", "该出门就出门，顺手保留看预警的习惯。", "今天可以轻装，但别把常识留在家里。"] as const;
const calmClose = ["平静窗口值得使用，不值得过度解读。", "天气暂时配合，行程照常即可。", "把这段清静留给生活本身。"] as const;
