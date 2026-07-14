import assert from "node:assert/strict";
import test from "node:test";
import { windCoverageContains } from "../components/map/useViewportWindField";

test("wind coverage is reused while the required viewport remains inside its buffer", () => {
  assert.equal(
    windCoverageContains(
      { west: 80, south: 5, east: 160, north: 55 },
      { west: 92, south: 12, east: 148, north: 48 }
    ),
    true
  );
});

test("wind coverage refreshes before the viewport crosses a cached edge", () => {
  assert.equal(
    windCoverageContains(
      { west: 80, south: 5, east: 160, north: 55 },
      { west: 76, south: 12, east: 148, north: 48 }
    ),
    false
  );
});
