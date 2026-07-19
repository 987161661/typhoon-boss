import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_LIVE_CONTROL_SETTINGS,
  normalizeLiveControlSettings
} from "../lib/liveControlSettings";

test("old live settings receive safe city-report effect defaults without a migration", () => {
  const normalized = normalizeLiveControlSettings({
    version: 1,
    sceneRotationEnabled: false,
    briefingDurationSeconds: 9,
    analysisDurationSeconds: 6,
    evolutionAgentEnabled: false,
    evolutionAgentIntervalMinutes: 30
  });
  assert.equal(normalized.cityReportEffectsEnabled, true);
  assert.equal(normalized.cityReportEffectsVolume, "standard");
  assert.equal(normalized.typhoonOutlookVisible, true);
});

test("typhoon outlook broadcast visibility persists through normalization", () => {
  assert.equal(normalizeLiveControlSettings({ typhoonOutlookVisible: false }).typhoonOutlookVisible, false);
});

test("city-report sound switch and three volume levels normalize predictably", () => {
  for (const volume of ["low", "standard", "high"] as const) {
    const normalized = normalizeLiveControlSettings({
      cityReportEffectsEnabled: false,
      cityReportEffectsVolume: volume
    });
    assert.equal(normalized.cityReportEffectsEnabled, false);
    assert.equal(normalized.cityReportEffectsVolume, volume);
  }
  assert.equal(
    normalizeLiveControlSettings({ cityReportEffectsVolume: "max" as never }).cityReportEffectsVolume,
    DEFAULT_LIVE_CONTROL_SETTINGS.cityReportEffectsVolume
  );
});
