import { distanceBetweenKm, parseBeijingTime } from "@/lib/meteorology";
import type { Storm, WindFieldPayload, WindFieldPoint } from "@/lib/types";

export interface WindAnalysisReference {
  lon: number;
  lat: number;
  validAt: string;
  method: "track-interpolated" | "track-nearest" | "current-position";
}

/**
 * Resolve the storm position at the model valid time. A diagnostic field must
 * not be searched around a newer best-track position when an older track
 * position is available for the same instant.
 */
export function resolveWindAnalysisReference(storm: Storm, validAt: string): WindAnalysisReference {
  const targetTime = parseBeijingTime(validAt);
  const timedTrack = storm.track
    .map((point) => ({ ...point, parsedTime: parseBeijingTime(point.time) }))
    .filter((point): point is typeof point & { parsedTime: number } => point.parsedTime !== null)
    .sort((left, right) => left.parsedTime - right.parsedTime);

  if (targetTime !== null && timedTrack.length > 0) {
    for (let index = 1; index < timedTrack.length; index += 1) {
      const before = timedTrack[index - 1];
      const after = timedTrack[index];
      if (targetTime < before.parsedTime || targetTime > after.parsedTime) continue;
      const duration = after.parsedTime - before.parsedTime;
      const progress = duration > 0 ? (targetTime - before.parsedTime) / duration : 0;
      return {
        lon: interpolateLongitude(before.lon, after.lon, progress),
        lat: before.lat + (after.lat - before.lat) * progress,
        validAt: new Date(targetTime).toISOString(),
        method: "track-interpolated"
      };
    }

    const nearest = timedTrack.reduce((best, point) =>
      Math.abs(point.parsedTime - targetTime) < Math.abs(best.parsedTime - targetTime) ? point : best
    );
    if (Math.abs(nearest.parsedTime - targetTime) <= 12 * 60 * 60 * 1000) {
      return {
        lon: nearest.lon,
        lat: nearest.lat,
        validAt: new Date(targetTime).toISOString(),
        method: "track-nearest"
      };
    }
  }

  return {
    lon: storm.position.lon,
    lat: storm.position.lat,
    validAt: targetTime === null ? storm.updatedAt : new Date(targetTime).toISOString(),
    method: "current-position"
  };
}

/**
 * Diagnose a model vortex from the raw U/V grid. The result is deliberately
 * conservative: weak shear maxima are rejected instead of being promoted to
 * a tropical-cyclone centre.
 */
export function findCyclonicVorticityCenter(
  points: WindFieldPoint[],
  reference: WindAnalysisReference
): WindFieldPayload["analysisCenter"] {
  if (points.length < 9) return undefined;
  const longitudes = [...new Set(points.map((point) => point.lon))].sort((left, right) => left - right);
  const latitudes = [...new Set(points.map((point) => point.lat))].sort((left, right) => left - right);
  if (longitudes.length < 3 || latitudes.length < 3) return undefined;
  const lonStep = longitudes[1] - longitudes[0];
  const latStep = latitudes[1] - latitudes[0];
  if (!Number.isFinite(lonStep) || !Number.isFinite(latStep) || lonStep <= 0 || latStep <= 0) return undefined;

  const hemisphereSign = reference.lat >= 0 ? 1 : -1;
  const grid = new Map(points.map((point) => [windSampleKey(point.lon, point.lat), point]));
  let strongest: {
    lon: number;
    lat: number;
    signedVorticity: number;
    circulationMs: number;
    circulationBalance: number;
    offsetKm: number;
    score: number;
  } | null = null;

  for (const point of points) {
    if (Math.abs(point.lon - reference.lon) > 5 || Math.abs(point.lat - reference.lat) > 5) continue;
    const west = grid.get(windSampleKey(point.lon - lonStep, point.lat));
    const east = grid.get(windSampleKey(point.lon + lonStep, point.lat));
    const south = grid.get(windSampleKey(point.lon, point.lat - latStep));
    const north = grid.get(windSampleKey(point.lon, point.lat + latStep));
    if (!west || !east || !south || !north) continue;

    const dx = 2 * lonStep * 111_320 * Math.max(0.1, Math.cos((point.lat * Math.PI) / 180));
    const dy = 2 * latStep * 111_320;
    const signedVorticity = hemisphereSign * ((east.v - west.v) / dx - (north.u - south.u) / dy);
    const eastWestCirculation = hemisphereSign * (east.v - west.v) / 2;
    const southNorthCirculation = hemisphereSign * (south.u - north.u) / 2;
    if (signedVorticity <= 0 || eastWestCirculation <= 0 || southNorthCirculation <= 0) continue;
    const circulationMs = (eastWestCirculation + southNorthCirculation) / 2;
    const circulationBalance = Math.min(eastWestCirculation, southNorthCirculation) /
      Math.max(eastWestCirculation, southNorthCirculation);

    const offsetKm = distanceBetweenKm(reference, point);
    const score = signedVorticity * 100_000 + Math.min(10, circulationMs) * 0.04 + circulationBalance * 0.12 - offsetKm / 2_500;
    if (!strongest || score > strongest.score) {
      strongest = { lon: point.lon, lat: point.lat, signedVorticity, circulationMs, circulationBalance, offsetKm, score };
    }
  }

  if (!strongest) return undefined;
  const confidence = diagnosticConfidence(strongest);
  if (confidence === "low") return undefined;
  return {
    lon: strongest.lon,
    lat: strongest.lat,
    method: "peak-cyclonic-vorticity",
    confidence,
    referenceAt: reference.validAt,
    referenceMethod: reference.method,
    referencePosition: { lon: reference.lon, lat: reference.lat },
    offsetKm: Math.round(strongest.offsetKm),
    vorticityPerSecond: strongest.signedVorticity,
    circulationMs: strongest.circulationMs,
    circulationBalance: strongest.circulationBalance
  };
}

function diagnosticConfidence(candidate: { signedVorticity: number; circulationMs: number; circulationBalance: number; offsetKm: number }) {
  if (candidate.signedVorticity >= 4e-5 && candidate.circulationMs >= 2 && candidate.circulationBalance >= 0.55 && candidate.offsetKm <= 350) return "high" as const;
  if (candidate.signedVorticity >= 1.5e-5 && candidate.circulationMs >= 0.75 && candidate.circulationBalance >= 0.3 && candidate.offsetKm <= 500) return "medium" as const;
  return "low" as const;
}

function interpolateLongitude(start: number, end: number, progress: number) {
  const delta = ((end - start + 540) % 360) - 180;
  const value = start + delta * progress;
  return ((value + 540) % 360) - 180;
}

function windSampleKey(lon: number, lat: number) {
  return `${lon.toFixed(4)}:${lat.toFixed(4)}`;
}
