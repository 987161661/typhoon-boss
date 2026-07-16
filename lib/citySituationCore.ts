import type {
  NationalSituationSnapshot,
  NationalWeatherEvent,
  WeatherEventLevel,
  WeatherHazard
} from "@/lib/nationalWeatherTypes";

export interface CitySituationTarget {
  name: string;
  /** The deterministic prefecture/municipality root from the administrative hierarchy. */
  cityCode: string;
  /** Optional exact location ids when the requested target is below the city root. */
  locationIds?: readonly string[];
}

export interface CityObservedAnomaly {
  id: string;
  hazard: Exclude<WeatherHazard, "typhoon">;
  label: string;
  severity: "notable" | "high" | "severe";
  factSummary: string;
  observedAt: string | null;
  sourceIds: string[];
  limitations: string[];
}

export interface CitySituation {
  target: CitySituationTarget;
  mode: "official-warning" | "observed-anomaly" | "ordinary" | "data-unavailable";
  headline: string;
  primaryWarning: NationalWeatherEvent | null;
  officialWarnings: NationalWeatherEvent[];
  anomalies: CityObservedAnomaly[];
  /** Ordinary readings stay available as context but never become the headline. */
  ordinarySummary: string | null;
  limitations: string[];
}

const WARNING_WEIGHT: Record<WeatherEventLevel, number> = {
  red: 5,
  orange: 4,
  yellow: 3,
  blue: 2,
  watch: 1
};

const ANOMALY_WEIGHT: Record<CityObservedAnomaly["severity"], number> = {
  severe: 3,
  high: 2,
  notable: 1
};

/**
 * Builds a city card from the already-frozen national snapshot. It never
 * performs upstream parsing and deliberately rejects ambiguous attribution.
 */
export function buildCitySituation(
  snapshot: NationalSituationSnapshot | null,
  target: CitySituationTarget,
  anomalies: readonly CityObservedAnomaly[],
  ordinarySummary: string | null = null
): CitySituation {
  const rankedAnomalies = [...anomalies].sort(compareAnomalies);
  if (!snapshot) {
    return {
      target,
      mode: "data-unavailable",
      headline: "全国预警快照不可用；仅显示环境底色，无法判断城市预警风险。",
      primaryWarning: null,
      officialWarnings: [],
      anomalies: rankedAnomalies,
      ordinarySummary,
      limitations: ["全国官方预警事实当前不可用，不能据此判断无预警或低风险。"]
    };
  }
  const officialWarnings = snapshot.events
    .filter((event) => event.kind === "official-warning" && belongsToCity(event, target))
    .sort(compareWarnings);
  const primaryWarning = officialWarnings[0] ?? null;

  if (primaryWarning) {
    return {
      target,
      mode: "official-warning",
      headline: primaryWarning.factSummary || primaryWarning.title,
      primaryWarning,
      officialWarnings,
      anomalies: rankedAnomalies,
      ordinarySummary,
      limitations: uniqueLimitations(primaryWarning.limitations, rankedAnomalies)
    };
  }

  const primaryAnomaly = rankedAnomalies[0] ?? null;
  if (primaryAnomaly) {
    return {
      target,
      mode: "observed-anomaly",
      headline: primaryAnomaly.factSummary || primaryAnomaly.label,
      primaryWarning: null,
      officialWarnings: [],
      anomalies: rankedAnomalies,
      ordinarySummary,
      limitations: uniqueLimitations(primaryAnomaly.limitations, rankedAnomalies)
    };
  }

  return {
    target,
    mode: "ordinary",
    headline: "当前未发现显著战况；这只是已接入资料的环境底色，不代表没有风险。",
    primaryWarning: null,
    officialWarnings: [],
    anomalies: [],
    ordinarySummary,
    limitations: ["仅覆盖当前已接入且仍在有效期内的资料。"]
  };
}

function belongsToCity(event: NationalWeatherEvent, target: CitySituationTarget) {
  if (event.geography.cityAttribution !== "deterministic") return false;
  // A deterministic event already carries its authoritative city root. Raw
  // provider location ids may collide with stale caller context and must not
  // override a different resolved cityCode.
  if (event.geography.cityCode !== target.cityCode) return false;
  if (!target.locationIds?.length || event.geography.countyCode === null) return true;
  const targetIds = new Set(target.locationIds);
  return event.geography.locationIds.some((locationId) => targetIds.has(locationId));
}

function compareWarnings(left: NationalWeatherEvent, right: NationalWeatherEvent) {
  const byLevel = WARNING_WEIGHT[right.level] - WARNING_WEIGHT[left.level];
  if (byLevel !== 0) return byLevel;
  const byIssuedAt = timestamp(right.issuedAt) - timestamp(left.issuedAt);
  return byIssuedAt || left.id.localeCompare(right.id);
}

function compareAnomalies(left: CityObservedAnomaly, right: CityObservedAnomaly) {
  const bySeverity = ANOMALY_WEIGHT[right.severity] - ANOMALY_WEIGHT[left.severity];
  if (bySeverity !== 0) return bySeverity;
  const byObservedAt = timestamp(right.observedAt) - timestamp(left.observedAt);
  return byObservedAt || left.id.localeCompare(right.id);
}

function timestamp(value: string | null) {
  const parsed = value ? Date.parse(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function uniqueLimitations(primary: readonly string[], anomalies: readonly CityObservedAnomaly[]) {
  return [...new Set([...primary, ...anomalies.flatMap((anomaly) => anomaly.limitations)])];
}
