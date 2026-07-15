export const ACCEPTANCE_SCENARIOS = [
  "no-storm",
  "single-storm",
  "multi-storm",
  "official-red",
  "ordinary-city",
  "source-failure"
] as const;

export type AcceptanceScenario = (typeof ACCEPTANCE_SCENARIOS)[number];

const ACCEPTANCE_SCENARIO_SET = new Set<string>(ACCEPTANCE_SCENARIOS);

export function normalizeAcceptanceScenario(value: string | null | undefined): AcceptanceScenario | null {
  return value && ACCEPTANCE_SCENARIO_SET.has(value) ? value as AcceptanceScenario : null;
}

export function acceptanceScenarioFromLocation(
  location: Pick<Location, "search"> | null = typeof window === "undefined" ? null : window.location
): AcceptanceScenario | null {
  if (!location) return null;
  return normalizeAcceptanceScenario(new URLSearchParams(location.search).get("acceptanceScenario"));
}

export function withAcceptanceScenario(url: string, scenario: AcceptanceScenario | null): string {
  if (!scenario) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}acceptanceScenario=${encodeURIComponent(scenario)}`;
}
