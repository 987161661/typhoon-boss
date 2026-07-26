export interface CurrentWeatherSignal {
  sourceId: "open-meteo" | "qweather-now" | "qweather-hourly" | null;
  weatherCode: number | null;
  weatherText?: string | null;
}

/**
 * Current precipitation is a condition claim, not a numeric-amount claim.
 * Prefer the provider's explicit condition text; only fall back to WMO codes
 * for Open-Meteo, whose code system is known here. QWeather's `precip` amount
 * alone does not prove that rain is falling at this instant.
 */
export function isCurrentPrecipitation(signal: CurrentWeatherSignal) {
  const text = signal.weatherText?.trim();
  if (text) return /雨|雪|冰雹|霰/u.test(text);
  if (signal.sourceId !== "open-meteo" || signal.weatherCode === null) return false;
  const code = signal.weatherCode;
  return (code >= 51 && code <= 67) || (code >= 71 && code <= 86) || (code >= 95 && code <= 99);
}

export function currentWeatherText(signal: CurrentWeatherSignal) {
  const text = signal.weatherText?.trim();
  if (text) return text;
  if (signal.sourceId === "open-meteo" && signal.weatherCode !== null) return wmoWeatherText(signal.weatherCode);
  return null;
}

function wmoWeatherText(code: number) {
  if (code === 0) return "晴";
  if (code <= 3) return "多云";
  if (code === 45 || code === 48) return "雾";
  if (code >= 51 && code <= 57) return "毛毛雨";
  if (code >= 61 && code <= 67) return "降雨";
  if (code >= 71 && code <= 77) return "降雪";
  if (code >= 80 && code <= 82) return "阵雨";
  if (code >= 85 && code <= 86) return "阵雪";
  if (code >= 95 && code <= 99) return "雷暴";
  return null;
}
