import assert from "node:assert/strict";
import test from "node:test";
import { isWindFieldSourceStale, isWindFieldSourceUsable } from "../lib/windFieldFreshness";

test("GFS analysis freshness follows source time rather than request completion", () => {
  const now = Date.parse("2026-07-26T09:30:00.000Z");
  assert.equal(isWindFieldSourceStale("2026-07-26T00:00:00.000Z", now), false);
  assert.equal(isWindFieldSourceStale("2026-07-25T12:00:00.000Z", now), true);
  assert.equal(isWindFieldSourceStale(null, now), true);
});

test("an expired analysis can never be reused as a successful fallback", () => {
  const now = Date.parse("2026-07-26T10:00:00.000Z");
  assert.equal(isWindFieldSourceUsable("2026-07-26T00:00:00.000Z", now), true);
  assert.equal(isWindFieldSourceUsable("2026-07-25T06:00:00.000Z", now), false);
});
