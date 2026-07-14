import assert from "node:assert/strict";
import test from "node:test";
import {
  calibrateMercatorImageBounds,
  globalMercatorLatitudeCrop,
  HIMAWARI_TEASIA_BOUNDS,
  mercatorLatitudePixel,
  selectSynchronizedSatellitePair
} from "../lib/satelliteGeoreference";

test("current 836x500 GMGSI browse image crops exactly to its 60 degree grid lines", () => {
  assert.equal(Math.round(mercatorLatitudePixel(60, 836, 500)), 75);
  assert.equal(Math.round(mercatorLatitudePixel(30, 836, 500)), 177);
  assert.equal(Math.round(mercatorLatitudePixel(0, 836, 500)), 250);
  assert.equal(Math.round(mercatorLatitudePixel(-30, 836, 500)), 323);
  assert.equal(Math.round(mercatorLatitudePixel(-60, 836, 500)), 425);
  assert.deepEqual(globalMercatorLatitudeCrop(836, 500), { left: 0, top: 75, width: 836, height: 350 });
});

test("Mercator crop adapts to source size instead of retaining old pixel ratios", () => {
  const oldSize = globalMercatorLatitudeCrop(835, 488);
  const currentSize = globalMercatorLatitudeCrop(836, 500);
  assert.notEqual(oldSize.top / 488, currentSize.top / 500);
  assert.equal(currentSize.top, 75);
  assert.equal(currentSize.top + currentSize.height, 425);
});

test("Mercator latitude projection is symmetric around the image equator", () => {
  const north = mercatorLatitudePixel(42, 1200, 700);
  const south = mercatorLatitudePixel(-42, 1200, 700);
  assert.ok(Math.abs((north + south) - 700) < 1e-9);
});

test("regional Himawari bounds follow the official LALO grid instead of pinning the equator to the image edge", () => {
  assert.ok(Math.abs(HIMAWARI_TEASIA_BOUNDS.west - 69.78417) < 0.0001);
  assert.ok(Math.abs(HIMAWARI_TEASIA_BOUNDS.east - 150.35971) < 0.0001);
  assert.ok(Math.abs(HIMAWARI_TEASIA_BOUNDS.north - 39.71122) < 0.0001);
  assert.ok(Math.abs(HIMAWARI_TEASIA_BOUNDS.south - (-2.66041)) < 0.0001);
});

test("Mercator calibration is reusable rather than tied to one image", () => {
  const bounds = calibrateMercatorImageBounds(
    200,
    100,
    [{ longitude: -10, x: 50 }, { longitude: 10, x: 150 }],
    [{ latitude: -10, y: 75 }, { latitude: 10, y: 25 }]
  );
  assert.ok(Math.abs(bounds.west - (-20)) < 1e-9);
  assert.ok(Math.abs(bounds.east - 20) < 1e-9);
  assert.ok(Math.abs(bounds.north - 19.70215) < 0.001);
  assert.ok(Math.abs(bounds.south - (-19.70215)) < 0.001);
});

test("regional imagery follows the newest global frame time instead of creating a three-hour ghost", () => {
  const regional = ["2026-07-14T02:00:00Z", "2026-07-14T03:30:00Z", "2026-07-14T05:00:00Z"].map(capturedAt => ({ capturedAt }));
  const global = ["2026-07-14T01:00:00Z", "2026-07-14T02:00:00Z"].map(capturedAt => ({ capturedAt }));
  const pair = selectSynchronizedSatellitePair(regional, global, Date.parse("2026-07-14T06:00:00Z"));
  assert.equal(pair.global.capturedAt, "2026-07-14T02:00:00Z");
  assert.equal(pair.regional.capturedAt, "2026-07-14T02:00:00Z");
});
