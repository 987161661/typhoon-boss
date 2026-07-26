import type { Storm, WindFieldPayload } from "./types";
import type { StormWindCenter } from "./radarSnapshot";

export const FORECAST_ROUTE_COLORS: Record<string, string> = {
  CMA: "#fff0a8",
  JMA: "#61efff",
  JTWC: "#9cff72",
  CWA: "#ff70c7",
  HKO: "#ff985d"
};

// These colors identify a storm's observed route, rather than its forecast
// provider. The mapping is stable for a storm id, so changing the locked
// target never recolors the fleet.
export const STORM_TRACK_COLORS = ["#ff5b4d", "#31d6f4", "#c98cff", "#ffd166", "#6ee7a8"];

export function stormTrackColor(stormId: string) {
  let hash = 0;
  for (const character of stormId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return STORM_TRACK_COLORS[hash % STORM_TRACK_COLORS.length];
}

export interface StormFleetGeo {
  routes: GeoJSON.FeatureCollection;
  points: GeoJSON.FeatureCollection;
}

export interface GfsAnalysisCenterMarkerModel {
  stormId: string;
  stormName: string;
  active: boolean;
  updatedAt: string;
  center: NonNullable<WindFieldPayload["analysisCenter"]>;
}

export function alignStormToWindCenter(storm: Storm, windCenter?: StormWindCenter) {
  // Best-track and model-vortex positions are separate facts. Never move an
  // official storm marker to make it agree with a model analysis.
  void windCenter;
  return storm;
}

export function windFieldMatchesStorm(windField: WindFieldPayload | null, storm: Storm | null) {
  return Boolean(windField && storm && windField.stormId === storm.id);
}

export function selectCanonicalStormWindField(
  storm: Storm | null,
  coreWindField: WindFieldPayload | null,
  renderedWindField: WindFieldPayload | null
) {
  // The marker and the visible vectors must share one model frame. Prefer the
  // rendered high-resolution core, then the rendered ambient field; never use
  // an independently refreshed snapshot that is not on the canvas.
  for (const candidate of [coreWindField, renderedWindField]) {
    if (
      candidate?.status === "available" &&
      candidate.source === "NOAA/NCEP NOMADS Grib Filter" &&
      candidate.analysisCenter &&
      windFieldMatchesStorm(candidate, storm)
    ) return candidate;
  }
  return null;
}

export function buildGfsAnalysisCenterMarkerModels(
  storms: Storm[],
  activeStormId: string | null,
  activeCanonicalField: WindFieldPayload | null,
  windCenters?: Record<string, StormWindCenter> | null
): GfsAnalysisCenterMarkerModel[] {
  return storms.flatMap((storm) => {
    const activeField = storm.id === activeStormId
      && activeCanonicalField?.stormId === storm.id
      && activeCanonicalField.status === "available"
      && activeCanonicalField.source === "NOAA/NCEP NOMADS Grib Filter"
      && activeCanonicalField.analysisCenter
      ? {
          updatedAt: activeCanonicalField.updatedAt,
          center: activeCanonicalField.analysisCenter
        }
      : null;
    const recordedCenter = windCenters?.[storm.id];
    const fallback = recordedCenter?.status === "available"
      && recordedCenter.source === "NOAA/NCEP NOMADS Grib Filter"
      && recordedCenter.analysisCenter
      ? {
          updatedAt: recordedCenter.updatedAt,
          center: recordedCenter.analysisCenter
        }
      : null;
    const field = activeField ?? fallback;
    if (!field) return [];
    return [{
      stormId: storm.id,
      stormName: storm.nameZh,
      active: storm.id === activeStormId,
      ...field
    }];
  });
}

export function buildStormFleetGeo(storms: Storm[], activeStormId: string | null): StormFleetGeo {
  const routeFeatures: GeoJSON.Feature[] = [];
  const pointFeatures: GeoJSON.Feature[] = [];

  storms.forEach((storm) => {
    const properties = {
      stormId: storm.id,
      code: storm.code,
      nameZh: storm.nameZh,
      active: storm.id === activeStormId,
      trackColor: stormTrackColor(storm.id)
    };
    const track = storm.track.map((point) => [point.lon, point.lat]);

    if (track.length >= 2) {
      routeFeatures.push(lineFeature(track, { ...properties, routeKind: "track" }));
    }
    const scenarios = storm.forecastScenarios.length > 0
      ? storm.forecastScenarios
      : [{ agencyCode: "CMA", isPrimary: true, points: storm.forecast }];
    scenarios.forEach((scenario) => {
      const forecast = scenario.points.map((point) => [point.lon, point.lat]);
      if (forecast.length < 2) return;
      routeFeatures.push(lineFeature(forecast, {
        ...properties,
        routeKind: "forecast",
        agencyCode: scenario.agencyCode,
        isPrimary: scenario.isPrimary,
        color: FORECAST_ROUTE_COLORS[scenario.agencyCode] ?? "#e8f5fb"
      }));
    });

    storm.track.forEach((point, index) => {
      if (index !== storm.track.length - 1 && index % 2 !== 0) return;
      pointFeatures.push(pointFeature([point.lon, point.lat], { ...properties, routeKind: "track" }));
    });
  });

  return {
    routes: featureCollection(routeFeatures),
    points: featureCollection(pointFeatures)
  };
}

export function stormFleetBounds(storms: Storm[]): [[number, number], [number, number]] | null {
  const coordinates = storms.flatMap((storm) => [
    ...storm.track.map((point) => [point.lon, point.lat] as [number, number]),
    ...(storm.forecastScenarios.length > 0 ? storm.forecastScenarios.flatMap((scenario) => scenario.points) : storm.forecast)
      .map((point) => [point.lon, point.lat] as [number, number]),
    [storm.position.lon, storm.position.lat] as [number, number]
  ]);
  if (coordinates.length === 0) return null;

  return [
    [Math.min(...coordinates.map(([lon]) => lon)), Math.min(...coordinates.map(([, lat]) => lat))],
    [Math.max(...coordinates.map(([lon]) => lon)), Math.max(...coordinates.map(([, lat]) => lat))]
  ];
}

function lineFeature(coordinates: number[][], properties: GeoJSON.GeoJsonProperties): GeoJSON.Feature {
  return { type: "Feature", properties, geometry: { type: "LineString", coordinates } };
}

function pointFeature(coordinates: number[], properties: GeoJSON.GeoJsonProperties): GeoJSON.Feature {
  return { type: "Feature", properties, geometry: { type: "Point", coordinates } };
}

function featureCollection(features: GeoJSON.Feature[]): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features };
}
