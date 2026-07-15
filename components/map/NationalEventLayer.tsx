"use client";

import { useEffect, useMemo } from "react";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { NationalWeatherEvent } from "@/lib/nationalWeatherTypes";
import {
  NATIONAL_EVENT_LAYER_IDS,
  NATIONAL_EVENT_SOURCE_ID,
  buildNationalEventFeatureCollection
} from "./nationalEventModel";

const EMPTY_EVENTS = buildNationalEventFeatureCollection([]);

export function installNationalEventLayer(map: MapLibreMap) {
  if (!nationalEventMapHasStyle(map)) return;
  if (!map.getSource(NATIONAL_EVENT_SOURCE_ID)) {
    map.addSource(NATIONAL_EVENT_SOURCE_ID, { type: "geojson", data: EMPTY_EVENTS });
  }

  if (!map.getLayer(NATIONAL_EVENT_LAYER_IDS.watch)) {
    map.addLayer({
      id: NATIONAL_EVENT_LAYER_IDS.watch,
      type: "circle",
      source: NATIONAL_EVENT_SOURCE_ID,
      filter: ["==", ["get", "category"], "watch"],
      layout: { "circle-sort-key": ["get", "priority"] },
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 3, 7, 6],
        "circle-color": "#1d657c",
        "circle-opacity": 0.58,
        "circle-stroke-color": "#7fd7e9",
        "circle-stroke-opacity": 0.72,
        "circle-stroke-width": 1
      }
    });
  }

  if (!map.getLayer(NATIONAL_EVENT_LAYER_IDS.ordinary)) {
    map.addLayer({
      id: NATIONAL_EVENT_LAYER_IDS.ordinary,
      type: "circle",
      source: NATIONAL_EVENT_SOURCE_ID,
      filter: ["==", ["get", "category"], "ordinary"],
      layout: { "circle-sort-key": ["get", "priority"] },
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 4, 7, 8],
        "circle-color": ["match", ["get", "level"], "red", "#c92727", "orange", "#df6a18", "yellow", "#e6c934", "blue", "#2878c7", "#2878c7"],
        "circle-opacity": 0.78,
        "circle-stroke-color": "#fff0ae",
        "circle-stroke-width": 1.2
      }
    });
  }

  if (!map.getLayer(NATIONAL_EVENT_LAYER_IDS.officialHigh)) {
    map.addLayer({
      id: NATIONAL_EVENT_LAYER_IDS.officialHigh,
      type: "circle",
      source: NATIONAL_EVENT_SOURCE_ID,
      filter: ["==", ["get", "category"], "official-high"],
      layout: { "circle-sort-key": ["get", "priority"] },
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 7, 7, 13],
        "circle-color": ["match", ["get", "level"], "red", "#c92727", "#df6a18"],
        "circle-opacity": 0.94,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2
      }
    });
  }

  if (!map.getLayer(NATIONAL_EVENT_LAYER_IDS.officialHighRing)) {
    map.addLayer({
      id: NATIONAL_EVENT_LAYER_IDS.officialHighRing,
      type: "circle",
      source: NATIONAL_EVENT_SOURCE_ID,
      filter: ["==", ["get", "category"], "official-high"],
      layout: { "circle-sort-key": ["get", "priority"] },
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 10, 7, 17],
        "circle-color": "rgba(0, 0, 0, 0)",
        "circle-opacity": 1,
        "circle-stroke-color": ["match", ["get", "level"], "red", "#ffffff", "#ffcf8a"],
        "circle-stroke-opacity": 0.9,
        "circle-stroke-width": ["match", ["get", "level"], "red", 2.4, 1.8]
      },
    });
  }
  setNationalEventDataset(map, "enabled");
}

export function removeNationalEventLayer(map: MapLibreMap) {
  // React may run the parent map-disposal effect before this child effect's
  // cleanup. MapLibre keeps the Map object but clears `style`, so even
  // getLayer/getSource throw after map.remove(). Treat that as already clean.
  if (!nationalEventMapHasStyle(map)) {
    setNationalEventDataset(map, "disabled", null);
    return;
  }
  [...Object.values(NATIONAL_EVENT_LAYER_IDS)].reverse().forEach((layerId) => {
    if (map.getLayer(layerId)) map.removeLayer(layerId);
  });
  if (map.getSource(NATIONAL_EVENT_SOURCE_ID)) map.removeSource(NATIONAL_EVENT_SOURCE_ID);
  setNationalEventDataset(map, "disabled", null);
}

export function nationalEventMapHasStyle(map: MapLibreMap) {
  try {
    return Boolean(map.getStyle());
  } catch {
    return false;
  }
}

function setNationalEventDataset(map: MapLibreMap, state: "enabled" | "disabled", count?: number | null) {
  try {
    const dataset = map.getContainer().dataset;
    dataset.nationalEvents = state;
    if (typeof count === "number") dataset.nationalEventCount = String(count);
    else if (count === null) delete dataset.nationalEventCount;
  } catch {
    // The container may also be detached during a full MapLibre teardown.
  }
}

export function NationalEventLayer({
  map,
  events,
  enabled
}: {
  map: MapLibreMap | null;
  events: readonly NationalWeatherEvent[];
  enabled: boolean;
}) {
  const featureCollection = useMemo(() => buildNationalEventFeatureCollection(events), [events]);

  useEffect(() => {
    if (!map || !enabled) {
      if (map) removeNationalEventLayer(map);
      return;
    }
    installNationalEventLayer(map);
    return () => removeNationalEventLayer(map);
  }, [enabled, map]);

  useEffect(() => {
    if (!map || !enabled || !nationalEventMapHasStyle(map)) return;
    (map.getSource(NATIONAL_EVENT_SOURCE_ID) as GeoJSONSource | undefined)?.setData(featureCollection);
    setNationalEventDataset(map, "enabled", featureCollection.features.length);
  }, [enabled, featureCollection, map]);

  return null;
}
