import type { FeatureCollection } from "geojson";
import type { GeoJSONSource, LayerSpecification, Map as MapLibreMap } from "maplibre-gl";

export const TYPHOON_STORM_SOURCE_IDS = {
  track: "track",
  forecast: "forecast",
  trackPoints: "trackPoints",
  forecastPoints: "forecastPoints",
  fleetRoutes: "fleetRoutes",
  fleetPoints: "fleetPoints",
  windR7: "windR7",
  windR10: "windR10",
  windR12: "windR12"
} as const;

export const TYPHOON_STORM_LAYER_IDS = [
  "fleet-track-lines",
  "fleet-forecast-lines",
  "fleet-track-points",
  "track-line",
  "forecast-glow",
  "forecast-line",
  "track-points",
  "forecast-points"
] as const;

export interface TyphoonStormGeoData {
  track: FeatureCollection;
  forecast: FeatureCollection;
  trackPoints: FeatureCollection;
  forecastPoints: FeatureCollection;
  r7: FeatureCollection;
  r10: FeatureCollection;
  r12: FeatureCollection;
}

export interface TyphoonStormFleetGeoData {
  routes: FeatureCollection;
  points: FeatureCollection;
}

export interface TyphoonStormLayerData {
  storm: TyphoonStormGeoData;
  fleet: TyphoonStormFleetGeoData;
}

const emptyFeatureCollection = (): FeatureCollection => ({ type: "FeatureCollection", features: [] });

export function installTyphoonStormLayer(map: MapLibreMap) {
  Object.values(TYPHOON_STORM_SOURCE_IDS).forEach((sourceId) => {
    if (!map.getSource(sourceId)) map.addSource(sourceId, { type: "geojson", data: emptyFeatureCollection() });
  });

  const layers: LayerSpecification[] = [
    {
      id: "fleet-track-lines", type: "line", source: TYPHOON_STORM_SOURCE_IDS.fleetRoutes,
      filter: ["==", ["get", "routeKind"], "track"],
      paint: { "line-color": ["coalesce", ["get", "trackColor"], "#31d6f4"], "line-width": 2.6, "line-opacity": 0.82 }
    },
    {
      id: "fleet-forecast-lines", type: "line", source: TYPHOON_STORM_SOURCE_IDS.fleetRoutes,
      filter: ["all", ["==", ["get", "active"], false], ["==", ["get", "routeKind"], "forecast"]],
      paint: {
        "line-color": ["coalesce", ["get", "color"], "#e8f5fb"],
        "line-width": ["case", ["boolean", ["get", "isPrimary"], false], 2.8, 1.8],
        "line-dasharray": [2, 1.6],
        "line-opacity": ["case", ["boolean", ["get", "isPrimary"], false], 0.88, 0.7]
      }
    },
    {
      id: "fleet-track-points", type: "circle", source: TYPHOON_STORM_SOURCE_IDS.fleetPoints,
      filter: ["==", ["get", "routeKind"], "track"],
      paint: {
        "circle-radius": 3.2, "circle-color": "#071015",
        "circle-stroke-color": ["coalesce", ["get", "trackColor"], "#31d6f4"],
        "circle-stroke-width": 1.5, "circle-opacity": 0.9
      }
    },
    {
      id: "track-line", type: "line", source: TYPHOON_STORM_SOURCE_IDS.track,
      paint: { "line-color": "#ff4b3e", "line-width": 4, "line-opacity": 0, "line-blur": 1.2 }
    },
    {
      id: "forecast-glow", type: "line", source: TYPHOON_STORM_SOURCE_IDS.forecast,
      paint: {
        "line-color": ["coalesce", ["get", "color"], "#e8f5fb"],
        "line-width": ["case", ["boolean", ["get", "isPrimary"], false], 11, 7],
        "line-opacity": ["case", ["boolean", ["get", "isPrimary"], false], 0.28, 0.16],
        "line-blur": 5
      }
    },
    {
      id: "forecast-line", type: "line", source: TYPHOON_STORM_SOURCE_IDS.forecast,
      paint: {
        "line-color": ["coalesce", ["get", "color"], "#e8f5fb"],
        "line-width": ["case", ["boolean", ["get", "isPrimary"], false], 4.2, 2.6],
        "line-dasharray": [2.2, 1.35],
        "line-opacity": ["case", ["boolean", ["get", "isPrimary"], false], 0.98, 0.82]
      }
    },
    {
      id: "track-points", type: "circle", source: TYPHOON_STORM_SOURCE_IDS.trackPoints,
      paint: {
        "circle-radius": 5, "circle-color": "#071015", "circle-stroke-color": "#ff4b3e",
        "circle-stroke-width": 2.4, "circle-opacity": 0
      }
    },
    {
      id: "forecast-points", type: "circle", source: TYPHOON_STORM_SOURCE_IDS.forecastPoints,
      paint: {
        "circle-radius": ["case", ["boolean", ["get", "isPrimary"], false], 5, 3.4],
        "circle-color": ["coalesce", ["get", "color"], "#e8f5fb"],
        "circle-stroke-color": "#071015", "circle-stroke-width": 1.4,
        "circle-opacity": ["case", ["boolean", ["get", "isPrimary"], false], 0.98, 0.82]
      }
    }
  ];

  layers.forEach((layer) => {
    if (!map.getLayer(layer.id)) map.addLayer(layer);
  });
  map.getContainer().dataset.typhoonStormLayer = "installed";
}

export function updateTyphoonStormLayer(map: MapLibreMap, data: TyphoonStormLayerData) {
  const sourceData: Record<keyof typeof TYPHOON_STORM_SOURCE_IDS, FeatureCollection> = {
    track: data.storm.track,
    forecast: data.storm.forecast,
    trackPoints: data.storm.trackPoints,
    forecastPoints: data.storm.forecastPoints,
    fleetRoutes: data.fleet.routes,
    fleetPoints: data.fleet.points,
    windR7: data.storm.r7,
    windR10: data.storm.r10,
    windR12: data.storm.r12
  };
  Object.entries(sourceData).forEach(([key, featureCollection]) => {
    const sourceId = TYPHOON_STORM_SOURCE_IDS[key as keyof typeof TYPHOON_STORM_SOURCE_IDS];
    (map.getSource(sourceId) as GeoJSONSource | undefined)?.setData(featureCollection);
  });

  const forecastFeatures = data.fleet.routes.features.filter((feature) => feature.properties?.routeKind === "forecast");
  map.getCanvas().dataset.fleetForecastRoutes = String(forecastFeatures.length);
  map.getCanvas().dataset.fleetForecastAgencies = [...new Set(forecastFeatures
    .map((feature) => String(feature.properties?.agencyCode ?? ""))
    .filter(Boolean))].join(",");
}

export function removeTyphoonStormLayer(map: MapLibreMap) {
  [...TYPHOON_STORM_LAYER_IDS].reverse().forEach((layerId) => {
    if (map.getLayer(layerId)) map.removeLayer(layerId);
  });
  [...Object.values(TYPHOON_STORM_SOURCE_IDS)].reverse().forEach((sourceId) => {
    if (map.getSource(sourceId)) map.removeSource(sourceId);
  });
  map.getContainer().dataset.typhoonStormLayer = "removed";
  delete map.getCanvas().dataset.fleetForecastRoutes;
  delete map.getCanvas().dataset.fleetForecastAgencies;
}
