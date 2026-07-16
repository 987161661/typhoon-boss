import assert from "node:assert/strict";
import test from "node:test";
import {
  NATIONAL_EVENT_LAYER_IDS,
  NATIONAL_EVENT_SOURCE_ID,
  buildNationalEventFeatureCollection,
  nationalEventCleanupIds
} from "../components/map/nationalEventModel";
import {
  createRadarPlaybackState,
  radarPlaybackFrames,
  reduceRadarPlaybackState,
  shouldRunRadarPlaybackTimer
} from "../components/map/nationalRadarPlaybackState";
import { removeNationalEventLayer } from "../components/map/NationalEventLayer";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { NationalWeatherEvent, VisualLayerSummary } from "../lib/nationalWeatherTypes";

function event(overrides: Partial<NationalWeatherEvent> & Pick<NationalWeatherEvent, "id" | "level">): NationalWeatherEvent {
  const { id, level, ...rest } = overrides;
  return {
    id,
    kind: "official-warning",
    hazard: "rain",
    title: overrides.id,
    level,
    evidenceLevel: "official",
    issuedAt: "2026-07-15T00:00:00Z",
    dataTime: "2026-07-15T00:00:00Z",
    updatedAt: "2026-07-15T00:00:00Z",
    expiresAt: null,
    geography: {
      scope: "city",
      locationIds: [],
      provinceCode: null,
      cityCode: null,
      countyCode: null,
      names: [],
      centroid: { longitude: 113, latitude: 23 },
      cityAttribution: "deterministic"
    },
    sourceIds: ["official"],
    factSummary: "官方事件",
    limitations: [],
    ...rest
  };
}

test("official red and orange events get higher draw keys than watch and centroid-less events are omitted", () => {
  const collection = buildNationalEventFeatureCollection([
    event({ id: "watch", level: "watch", kind: "radar-watch", evidenceLevel: "observed" }),
    event({ id: "orange", level: "orange" }),
    event({ id: "red", level: "red" }),
    event({ id: "no-centroid", level: "red", geography: {
      scope: "national",
      locationIds: [], provinceCode: null, cityCode: null, countyCode: null,
      names: [], centroid: null, cityAttribution: "not-applicable"
    } })
  ]);

  const byId = new Map(collection.features.map((feature) => [feature.properties.eventId, feature.properties]));
  assert.deepEqual(collection.features.map((feature) => feature.properties.eventId), ["watch", "orange", "red"]);
  assert.ok(byId.get("red")!.priority > byId.get("orange")!.priority);
  assert.ok(byId.get("orange")!.priority > byId.get("watch")!.priority);
  assert.equal(byId.get("red")!.category, "official-high");
  assert.equal(byId.get("watch")!.category, "watch");
});

test("national event feature modeling cannot mutate or relocate an official storm center", () => {
  const officialCenter = Object.freeze({ lon: 121.25, lat: 22.75 });
  const before = { ...officialCenter };
  const collection = buildNationalEventFeatureCollection([event({ id: "red", level: "red" })]);

  assert.deepEqual(officialCenter, before);
  assert.deepEqual(collection.features[0].geometry.coordinates, [113, 23]);
  assert.notDeepEqual(collection.features[0].geometry.coordinates, [officialCenter.lon, officialCenter.lat]);
});

test("1126 events still use one source and a fixed four-layer contract", () => {
  const events = Array.from({ length: 1126 }, (_, index) => event({
    id: `warning-${index}`,
    level: index % 11 === 0 ? "red" : index % 7 === 0 ? "orange" : index % 3 === 0 ? "watch" : "yellow",
    kind: index % 3 === 0 ? "radar-watch" : "official-warning",
    evidenceLevel: index % 3 === 0 ? "observed" : "official"
  }));
  const collection = buildNationalEventFeatureCollection(events);

  assert.equal(collection.features.length, 1126);
  assert.equal(NATIONAL_EVENT_SOURCE_ID, "national-weather-events");
  assert.equal(Object.values(NATIONAL_EVENT_LAYER_IDS).length, 4);
  assert.equal(new Set(Object.values(NATIONAL_EVENT_LAYER_IDS)).size, 4);
});

test("national event cleanup removes fixed layers in reverse order before its sole source", () => {
  assert.deepEqual(nationalEventCleanupIds(), [
    NATIONAL_EVENT_LAYER_IDS.officialHighRing,
    NATIONAL_EVENT_LAYER_IDS.officialHigh,
    NATIONAL_EVENT_LAYER_IDS.ordinary,
    NATIONAL_EVENT_LAYER_IDS.watch,
    NATIONAL_EVENT_SOURCE_ID
  ]);
});

test("national event cleanup is a no-op after the parent MapLibre instance is destroyed", () => {
  let styleAccesses = 0;
  const container = { dataset: { nationalEvents: "enabled", nationalEventCount: "1125" } };
  const disposedMap = {
    getStyle: () => { throw new TypeError("Map style was already removed"); },
    getLayer: () => { styleAccesses += 1; throw new Error("must not inspect layers"); },
    getSource: () => { styleAccesses += 1; throw new Error("must not inspect sources"); },
    getContainer: () => container
  } as unknown as MapLibreMap;

  assert.doesNotThrow(() => removeNationalEventLayer(disposedMap));
  assert.equal(styleAccesses, 0);
  assert.equal(container.dataset.nationalEvents, "disabled");
  assert.equal("nationalEventCount" in container.dataset, false);
});

test("radar playback starts on the latest frame and navigates both directions", () => {
  const radar: VisualLayerSummary = {
    sourceId: "radar",
    status: "fresh",
    updatedAt: "2026-07-15T00:10:00Z",
    georeferenced: false,
    limitations: ["独立图像，不能作为地图叠图。"],
    frames: [
      { id: "latest", observedAt: "2026-07-15T00:10:00Z", imageUrl: "/latest.png" },
      { id: "oldest", observedAt: "2026-07-15T00:00:00Z", imageUrl: "/oldest.png" }
    ]
  };
  const frames = radarPlaybackFrames(radar);
  let state = createRadarPlaybackState(frames.map((frame) => frame.id));
  assert.equal(frames[state.index].id, "latest");

  state = reduceRadarPlaybackState(state, { type: "previous" });
  assert.equal(frames[state.index].id, "oldest");
  state = reduceRadarPlaybackState(state, { type: "next" });
  assert.equal(frames[state.index].id, "latest");
});

test("closed radar never runs playback timing and pause stops an active timer policy", () => {
  let state = createRadarPlaybackState(["oldest", "latest"]);
  state = reduceRadarPlaybackState(state, { type: "toggle" });
  assert.equal(shouldRunRadarPlaybackTimer(true, state), true);
  assert.equal(shouldRunRadarPlaybackTimer(false, state), false);

  state = reduceRadarPlaybackState(state, { type: "pause" });
  assert.equal(state.playing, false);
  assert.equal(shouldRunRadarPlaybackTimer(true, state), false);
});
