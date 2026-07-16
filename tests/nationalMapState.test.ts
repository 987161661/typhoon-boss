import assert from "node:assert/strict";
import test from "node:test";
import {
  activeStormIndexForMap,
  createNationalMapState,
  reduceNationalMapState,
  selectedStormForMap
} from "../components/map/nationalMapState";
import type { Storm } from "../lib/types";

function storm(id: string): Storm {
  return {
    id,
    code: id,
    nameZh: `台风${id}`,
    nameEn: id,
    stage: "台风",
    rating: "虎级",
    status: "active",
    position: { lon: 120, lat: 24 },
    maxWind: 35,
    minPressure: 970,
    moveDirection: "西北",
    moveSpeed: 15,
    updatedAt: "2026-07-15T00:00:00Z",
    windRadiiKm: {
      r7: 180,
      r10: 80,
      r12: 40,
      quadrants: {
        r7: { max: 180, ne: 180, se: 160, sw: 140, nw: 170 },
        r10: { max: 80, ne: 80, se: 70, sw: 60, nw: 75 },
        r12: { max: 40, ne: 40, se: 35, sw: 30, nw: 38 }
      }
    },
    track: [],
    forecast: [],
    forecastScenarios: [],
    landfalls: [],
    skills: [],
    notice: ""
  };
}

test("no storms remains in national mode", () => {
  const initial = createNationalMapState();
  assert.deepEqual(reduceNationalMapState(initial, { type: "reconcile-storms", stormIds: [] }), initial);
  assert.equal(selectedStormForMap(initial, []), null);
});

test("one storm is opt-in and return-national clears the selection", () => {
  const storms = [storm("202610")];
  const initial = createNationalMapState();
  assert.equal(selectedStormForMap(initial, storms), null);

  const selected = reduceNationalMapState(initial, { type: "select-storm", stormId: "202610" });
  assert.equal(selectedStormForMap(selected, storms)?.id, "202610");
  assert.equal(activeStormIndexForMap(selected, storms), 0);
  assert.deepEqual(reduceNationalMapState(selected, { type: "return-national" }), initial);
});

test("multi-storm selection is identity-stable across reordering and removal", () => {
  const firstOrder = [storm("202610"), storm("202611")];
  const selected = reduceNationalMapState(createNationalMapState(), { type: "select-storm", stormId: "202611" });
  assert.equal(activeStormIndexForMap(selected, firstOrder), 1);

  const reordered = [firstOrder[1], firstOrder[0]];
  const reconciled = reduceNationalMapState(selected, { type: "reconcile-storms", stormIds: reordered.map((item) => item.id) });
  assert.equal(selectedStormForMap(reconciled, reordered)?.id, "202611");
  assert.equal(activeStormIndexForMap(reconciled, reordered), 0);

  assert.deepEqual(
    reduceNationalMapState(reconciled, { type: "reconcile-storms", stormIds: ["202610"] }),
    createNationalMapState()
  );
});
