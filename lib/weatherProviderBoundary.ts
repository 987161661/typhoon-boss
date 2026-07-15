export type WeatherProviderFailureKind =
  | "timeout"
  | "forbidden"
  | "invalid-json"
  | "invalid-jsonp"
  | "http"
  | "network";

export interface WeatherProviderFailure {
  kind: WeatherProviderFailureKind;
  message: string;
}

export function assertWeatherProviderResponse(
  response: Pick<Response, "ok" | "status">,
  provider: string
) {
  if (response.ok) return;
  const detail = response.status === 403 ? "forbidden by upstream" : `HTTP ${response.status}`;
  throw new Error(`${provider}: ${detail}; last-good snapshot remains authoritative`);
}

export function describeWeatherProviderFailure(provider: string, error: unknown): WeatherProviderFailure {
  const name = error instanceof Error ? error.name : "";
  const detail = error instanceof Error ? error.message : String(error);
  const normalized = detail.toLowerCase();
  const kind: WeatherProviderFailureKind =
    name === "TimeoutError" || name === "AbortError" || normalized.includes("timeout")
      ? "timeout"
      : normalized.includes("forbidden") || normalized.includes("http 403")
        ? "forbidden"
        : normalized.includes("jsonp")
          ? "invalid-jsonp"
          : error instanceof SyntaxError || normalized.includes("json")
            ? "invalid-json"
            : normalized.includes("http ")
              ? "http"
              : "network";
  const meaning = {
    timeout: "upstream timed out",
    forbidden: "upstream returned 403",
    "invalid-json": "upstream returned invalid JSON",
    "invalid-jsonp": "upstream returned invalid JSONP",
    http: detail,
    network: detail
  }[kind];
  return {
    kind,
    message: `${provider}: ${meaning}; data is unavailable, not no-risk; last-good snapshot is retained when present`
  };
}
