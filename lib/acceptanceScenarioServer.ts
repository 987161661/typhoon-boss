import { normalizeAcceptanceScenario, type AcceptanceScenario } from "@/lib/acceptanceScenario";

interface AcceptanceEnvironment {
  NODE_ENV?: string;
  WEATHER_ACCEPTANCE_FIXTURES?: string;
}

/**
 * Acceptance fixtures require two independent signals: a valid request query
 * and an explicit server-side switch. Production rejects them even if a
 * deployment accidentally retains the switch.
 */
export function resolveServerAcceptanceScenario(
  value: string | null | undefined,
  environment: AcceptanceEnvironment = process.env
): AcceptanceScenario | null {
  if (environment.NODE_ENV === "production") return null;
  if (environment.WEATHER_ACCEPTANCE_FIXTURES !== "1") return null;
  return normalizeAcceptanceScenario(value);
}
