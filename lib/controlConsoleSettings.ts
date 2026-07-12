export type RouteConfig = {
  endpoint: string;
  model: string;
  apiKey?: string;
  protocol: "openai-compatible" | "native";
  timeoutSeconds: number;
};

export type ControlConsoleSettings = {
  version: 1;
  routes: {
    documentAgent: RouteConfig;
  };
  dataSources: {
    typhoonTrackBaseUrl: string;
    satelliteBaseUrl: string;
    weatherProvider: "open-meteo" | "met-norway";
  };
  automation: { evolutionEnabled: boolean; intervalMinutes: number; retryCount: number };
  map: { defaultTheme: "night-radar" | "archive-command"; defaultLayers: { satellite: boolean; impact: boolean; wind: boolean }; performanceMode: "full" | "reduced" };
  reliability: { requestTimeoutSeconds: number; retainLastGoodDataHours: number; auditLogEnabled: boolean };
  digitalHostUrl: string;
  updatedAt?: string;
};

const environment = (name: string, fallback = "") => process.env[name]?.trim() || fallback;

export function defaultControlConsoleSettings(): ControlConsoleSettings {
  return {
    version: 1,
    routes: {
      documentAgent: { endpoint: environment("MINIMAX_API_BASE_URL", "https://api.minimaxi.com/v1/chat/completions"), model: environment("MINIMAX_MODEL", "MiniMax-M3"), protocol: "openai-compatible", timeoutSeconds: 60 }
    },
    dataSources: {
      typhoonTrackBaseUrl: environment("TYPHOON_TRACK_API_BASE_URL", "https://typhoon.slt.zj.gov.cn/Api"),
      satelliteBaseUrl: environment("SATELLITE_BASE_URL", "https://www.ospo.noaa.gov"),
      weatherProvider: environment("WEATHER_PROVIDER") === "met-norway" ? "met-norway" : "open-meteo"
    },
    automation: { evolutionEnabled: true, intervalMinutes: 30, retryCount: 1 },
    map: { defaultTheme: "night-radar", defaultLayers: { satellite: true, impact: true, wind: true }, performanceMode: "full" },
    reliability: { requestTimeoutSeconds: 12, retainLastGoodDataHours: 24, auditLogEnabled: true },
    digitalHostUrl: environment("LINGLAN_HOST_URL", "http://127.0.0.1:5173")
  };
}

export function sanitizeControlConsoleSettings(settings: ControlConsoleSettings) {
  const mask = (value?: string) => value ? { configured: true, hint: `••••${value.slice(-4)}` } : { configured: false, hint: "使用环境变量或未配置" };
  return { ...settings, routes: {
    documentAgent: { ...settings.routes.documentAgent, apiKey: undefined, apiKeyState: mask(settings.routes.documentAgent.apiKey || process.env.MINIMAX_API_KEY) }
  }};
}
