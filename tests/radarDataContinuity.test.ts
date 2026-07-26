import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  evaluateTrackSnapshotRecovery,
  retainAvailableRadarPayload,
  retainNewestWindField,
  retainUsableBossProfiles
} from "../lib/radarDataContinuity";
import type { BossProfile } from "../lib/bossEngine/types";
import type { WindFieldPayload } from "../lib/types";

test("a partial refresh retains the last usable structure for an active storm", () => {
  const previous = profile("jtwc", "stable-eye");
  const next = profile("unavailable", "unknown");
  next.structure.warnings = ["new structure source unavailable"];

  const [result] = retainUsableBossProfiles([next], [previous], ["202612"]);

  assert.equal(result.structure.state, "stable-eye");
  assert.equal(result.structure.source, "jtwc");
  assert.equal(result.structure.stale, true);
  assert.deepEqual(result.structure.warnings, ["new structure source unavailable"]);
});

test("continuity never carries a profile into a different or inactive storm", () => {
  assert.deepEqual(retainUsableBossProfiles([], [profile("jtwc", "stable-eye")], ["202613"]), []);
});

test("an unavailable payload keeps the last available frame while a fresh frame replaces it", () => {
  const previous = { status: "available", value: "old" };
  assert.strictEqual(retainAvailableRadarPayload({ status: "unavailable", value: "empty" }, previous), previous);
  assert.deepEqual(retainAvailableRadarPayload({ status: "available", value: "new" }, previous), { status: "available", value: "new" });
});

test("a late viewport response cannot roll a rendered GFS frame back to an older cycle", () => {
  const newer = windField("2026-07-25T18:00:00Z");
  const older = windField("2026-07-25T06:00:00Z");

  assert.strictEqual(retainNewestWindField(older, newer), newer);
  assert.equal(
    retainNewestWindField(windField("2026-07-26T00:00:00Z"), newer).updatedAt,
    "2026-07-26T00:00:00Z"
  );
});

test("an active track survives the normal retention limit while its published forecast window is still open", () => {
  const result = evaluateTrackSnapshotRecovery({
    fetchedAt: "2026-07-24T10:04:44.750Z",
    now: Date.parse("2026-07-25T22:49:00.000Z"),
    retainLastGoodDataHours: 24,
    active: true,
    forecastTimes: ["2026-07-26T21:00:00.000Z", "2026-07-28T09:00:00.000Z"]
  });

  assert.deepEqual(result, {
    retain: true,
    mode: "forecast-window",
    ageHours: 36.74,
    forecastEndsAt: "2026-07-28T09:00:00.000Z"
  });
});

test("an expired forecast window cannot keep an old storm active indefinitely", () => {
  const result = evaluateTrackSnapshotRecovery({
    fetchedAt: "2026-07-24T10:04:44.750Z",
    now: Date.parse("2026-07-29T09:00:00.000Z"),
    retainLastGoodDataHours: 24,
    active: true,
    forecastTimes: ["2026-07-28T09:00:00.000Z"]
  });

  assert.equal(result.retain, false);
  assert.equal(result.mode, "expired");
});

test("live presentation copy does not expose background synchronization states", async () => {
  const files = [
    "components/LiveBroadcastView.tsx",
    "components/StormSatellitePortrait.tsx",
    "components/NationalSituationHud.tsx",
    "components/IntelPanel.tsx",
    "components/LiveCityInteraction.tsx"
  ];
  const source = (await Promise.all(
    files.map((file) => readFile(resolve(process.cwd(), file), "utf8"))
  )).join("\n");

  assert.doesNotMatch(source, /待同步|同步中|待恢复|正在同步|正在刷新|次同步/);
});

function profile(
  source: BossProfile["structure"]["source"],
  state: BossProfile["structure"]["state"]
): BossProfile {
  return {
    stormId: "202612",
    structure: {
      source,
      state,
      stateLabel: state,
      cycleOrdinal: null,
      monitoredCycle: null,
      cycleLabel: "",
      confidence: source === "unavailable" ? 0 : 0.8,
      evidenceLevel: source === "unavailable" ? "visualHint" : "confirmed",
      sourceLabel: "JTWC",
      sourceUrl: null,
      bulletinId: null,
      observedAt: "2026-07-24T00:00:00.000Z",
      detail: "",
      signals: {
        innerEyewall: "unknown",
        outerEyewall: "unknown",
        innerRadiusNm: null,
        outerRadiusNm: null
      },
      stale: false,
      warnings: []
    },
    environment: { status: "available" } as BossProfile["environment"],
    satellite: { status: "available" } as BossProfile["satellite"],
    ahi: { status: "available" } as BossProfile["ahi"]
  } as unknown as BossProfile;
}

function windField(updatedAt: string): WindFieldPayload {
  return {
    source: "NOAA/NCEP NOMADS Grib Filter",
    updatedAt,
    status: "available",
    attribution: "NOAA NCEP GFS",
    model: "GFS",
    unit: "m/s",
    stormId: "202612",
    sampling: "viewport",
    points: [{ lon: 114, lat: 23, u: 1, v: 1, speed: Math.SQRT2, direction: 45 }]
  };
}
