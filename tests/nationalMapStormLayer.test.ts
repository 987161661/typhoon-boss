import assert from "node:assert/strict";
import test from "node:test";
import type { FeatureCollection } from "geojson";
import type { Map as MapLibreMap } from "maplibre-gl";
import {
  TYPHOON_STORM_LAYER_IDS,
  TYPHOON_STORM_SOURCE_IDS,
  installTyphoonStormLayer,
  removeTyphoonStormLayer,
  updateTyphoonStormLayer
} from "../components/map/TyphoonStormLayer";

function featureCollection(id?: string): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: id ? [{
      type: "Feature",
      id,
      geometry: { type: "Point", coordinates: [121.25, 22.75] },
      properties: { routeKind: "forecast", agencyCode: "CMA" }
    }] : []
  };
}

function fakeMap() {
  const sources = new Map<string, { data: FeatureCollection; setData: (data: FeatureCollection) => void }>();
  const layers = new Map<string, unknown>();
  const container = { dataset: {} as Record<string, string> };
  const canvas = { dataset: {} as Record<string, string> };
  const map = {
    getSource: (id: string) => sources.get(id),
    addSource: (id: string, source: { data: FeatureCollection }) => {
      const model = { data: source.data, setData: (data: FeatureCollection) => { model.data = data; } };
      sources.set(id, model);
    },
    removeSource: (id: string) => { sources.delete(id); },
    getLayer: (id: string) => layers.get(id),
    addLayer: (layer: { id: string }) => { layers.set(layer.id, layer); },
    removeLayer: (id: string) => { layers.delete(id); },
    getContainer: () => container,
    getCanvas: () => canvas
  } as unknown as MapLibreMap;
  return { map, sources, layers, container, canvas };
}

test("TyphoonStormLayer installs fixed resources, updates by setData, and cleans up independently", () => {
  const fixture = fakeMap();
  installTyphoonStormLayer(fixture.map);
  assert.equal(fixture.sources.size, Object.values(TYPHOON_STORM_SOURCE_IDS).length);
  assert.equal(fixture.layers.size, TYPHOON_STORM_LAYER_IDS.length);
  assert.equal(fixture.container.dataset.typhoonStormLayer, "installed");

  const officialCenter = featureCollection("official-center");
  const fleetRoutes = featureCollection("fleet-route");
  updateTyphoonStormLayer(fixture.map, {
    storm: {
      track: officialCenter,
      forecast: featureCollection(),
      trackPoints: featureCollection(),
      forecastPoints: featureCollection(),
      r7: featureCollection(),
      r10: featureCollection(),
      r12: featureCollection()
    },
    fleet: { routes: fleetRoutes, points: featureCollection() }
  });

  assert.equal(fixture.sources.get(TYPHOON_STORM_SOURCE_IDS.track)?.data, officialCenter);
  assert.deepEqual(officialCenter.features[0].geometry, { type: "Point", coordinates: [121.25, 22.75] });
  assert.equal(fixture.canvas.dataset.fleetForecastRoutes, "1");
  assert.equal(fixture.canvas.dataset.fleetForecastAgencies, "CMA");

  removeTyphoonStormLayer(fixture.map);
  assert.equal(fixture.layers.size, 0);
  assert.equal(fixture.sources.size, 0);
  assert.equal(fixture.container.dataset.typhoonStormLayer, "removed");
});
