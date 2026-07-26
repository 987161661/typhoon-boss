import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mapSource = readFileSync(new URL("../components/TyphoonMap.tsx", import.meta.url), "utf8");
const intelSource = readFileSync(new URL("../components/IntelPanel.tsx", import.meta.url), "utf8");
const radarSource = readFileSync(new URL("../lib/radarSnapshot.ts", import.meta.url), "utf8");

test("main-interface status controls prefetch metadata before their disabled toggles can be used", () => {
  const cwaBlock = mapSource.slice(
    mapSource.indexOf("const cwaRadarLayer"),
    mapSource.indexOf("const ecmwfTrackLayer")
  );
  const observationBlock = mapSource.slice(
    mapSource.indexOf("const regionalObservations"),
    mapSource.indexOf("const nationalSituation")
  );

  assert.match(cwaBlock, /enabled:\s*noncriticalLayersReady\s*[,}]/);
  assert.doesNotMatch(cwaBlock, /enabled:[^\n]*cwaRadarVisible/);
  assert.match(observationBlock, /enabled:\s*noncriticalLayersReady\s*[,}]/);
  assert.doesNotMatch(observationBlock, /enabled:[^\n]*observationsVisible/);
});

test("national overview and operational satellite status feed every visible status panel", () => {
  assert.match(mapSource, /<TopCommandBar\s+storm=\{overviewStorm\}/);
  assert.match(
    intelSource,
    /<SatelliteEvidenceBrief bossProfile=\{bossProfile\} satelliteLayer=\{satelliteLayer\}/
  );
});

test("slow wind enrichment has a background budget long enough for the real provider", () => {
  assert.match(radarSource, /const WIND_DERIVED_TIMEOUT_MS = 20_000/);
  assert.match(
    radarSource,
    /withTimeout\(getWindField\(activeStormId\), "Local wind field", WIND_DERIVED_TIMEOUT_MS\)/
  );
  assert.match(
    radarSource,
    /withTimeout\(getWindField\(activeStormId, CHINA_WIND_BOUNDS\), "Nationwide wind field", WIND_DERIVED_TIMEOUT_MS\)/
  );
});

test("the GFS center marker is derived from the exact wind frame sent to the renderer", () => {
  const selectionBlock = mapSource.slice(
    mapSource.indexOf("const canonicalStormWindField"),
    mapSource.indexOf("const gfsAlignedStorm")
  );

  assert.match(
    selectionBlock,
    /selectCanonicalStormWindField\(storm,\s*compatibleCoreWindField,\s*stormWindField\)/
  );
  assert.doesNotMatch(
    selectionBlock,
    /selectCanonicalStormWindField\(storm,\s*compatibleCoreWindField,\s*windField\)/
  );
});
