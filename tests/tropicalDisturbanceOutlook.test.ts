import assert from "node:assert/strict";
import test from "node:test";
import {
  assessTropicalDisturbanceOutlook,
  buildTropicalDisturbanceOutlook,
  renderTropicalDisturbanceReport
} from "../lib/agent/tropicalDisturbanceOutlook.mjs";

const NOW = "2026-07-19T15:00:00.000Z";

test("all unavailable sources remain unknown instead of becoming a zero forecast", () => {
  const outlook = buildTropicalDisturbanceOutlook({
    jtwcAdvisory: null,
    cpcWeek2Kml: null,
    cpcWeek3Kml: null
  }, { now: NOW });

  assert.equal(outlook.evidenceStatus, "unavailable");
  assert.deepEqual(assessTropicalDisturbanceOutlook(outlook), {
    status: "unavailable",
    coverage: { nearTerm: "unavailable", week2: "unavailable", week3: "unavailable" }
  });
  assert.match(outlook.summary, /状态未知/);
  assert.doesNotMatch(outlook.summary, /未列出热带扰动|有 0 个/);
  const report = renderTropicalDisturbanceReport(outlook);
  assert.match(report, /资料缺失/);
  assert.match(report, /不得报告为 0 个概率区域/);
});

test("an empty JTWC advisory is preserved as evidence instead of inventing an embryo", () => {
  const outlook = buildTropicalDisturbanceOutlook({
    jtwcAdvisory: `ABPW10 PGTW 190600
SUBJ/SIGNIFICANT TROPICAL WEATHER ADVISORY FOR THE WESTERN AND SOUTH PACIFIC OCEANS/190600Z-200600ZJUL2026//
RMKS/
1. WESTERN NORTH PACIFIC AREA (180 TO MALAY PENINSULA):
 A. TROPICAL CYCLONE SUMMARY: NONE.
 B. TROPICAL DISTURBANCE SUMMARY: NONE.
 C. SUBTROPICAL SYSTEM SUMMARY: NONE.
2. SOUTH PACIFIC AREA (WEST COAST OF SOUTH AMERICA TO 135 EAST):`,
    cpcWeek2Kml: null,
    cpcWeek3Kml: null
  }, { now: NOW });

  assert.equal(outlook.nearTermDisturbances.length, 0);
  assert.equal(outlook.evidenceStatus, "degraded");
  assert.equal(outlook.sources.jtwc.status, "fresh");
  assert.match(outlook.summary, /未列出热带扰动/);
  assert.match(outlook.summary, /资料均不可用/);
});

test("a stale empty advisory cannot claim the current basin has no disturbances", () => {
  const outlook = buildTropicalDisturbanceOutlook({
    jtwcAdvisory: `ABPW10 PGTW 150600
SUBJ/SIGNIFICANT TROPICAL WEATHER ADVISORY FOR THE WESTERN AND SOUTH PACIFIC OCEANS/150600Z-160600ZJUL2026//
1. WESTERN NORTH PACIFIC AREA (180 TO MALAY PENINSULA):
 B. TROPICAL DISTURBANCE SUMMARY: NONE.
 C. SUBTROPICAL SYSTEM SUMMARY: NONE.
2. SOUTH PACIFIC AREA (WEST COAST OF SOUTH AMERICA TO 135 EAST):`,
    cpcWeek2Kml: null,
    cpcWeek3Kml: null
  }, { now: NOW });

  assert.equal(outlook.sources.jtwc.status, "stale");
  assert.equal(outlook.coverage.nearTerm, "degraded");
  assert.match(outlook.summary, /时效待核验/);
  assert.doesNotMatch(outlook.summary, /JTWC 当前未列出/);
  assert.match(renderTropicalDisturbanceReport(outlook), /不能代表当前完整扰动状态/);
});

test("JTWC invest position and qualitative 24-hour potential remain source-faithful", () => {
  const outlook = buildTropicalDisturbanceOutlook({
    jtwcAdvisory: `ABPW10 PGTW 090600
SUBJ/SIGNIFICANT TROPICAL WEATHER ADVISORY FOR THE WESTERN AND SOUTH PACIFIC OCEANS/090600Z-100600ZOCT2022//
RMKS/
1. WESTERN NORTH PACIFIC AREA (180 TO MALAY PENINSULA):
 A. TROPICAL CYCLONE SUMMARY: NONE.
 B. TROPICAL DISTURBANCE SUMMARY:
 (1) AN AREA OF CONVECTION (INVEST 98W) HAS PERSISTED NEAR 15.9N 132.1E, APPROXIMATELY 645 NM EAST OF MANILA, PHILIPPINES. ENVIRONMENTAL ANALYSIS INDICATES LOW VERTICAL WIND SHEAR (10 TO 15 KNOTS), GOOD OUTFLOW AND WARM (29-30C) SEA SURFACE TEMPERATURES. MAXIMUM SUSTAINED SURFACE WINDS ARE ESTIMATED AT 15 TO 20 KNOTS. MINIMUM SEA LEVEL PRESSURE IS ESTIMATED TO BE NEAR 1006 MB. THE POTENTIAL FOR THE DEVELOPMENT OF A SIGNIFICANT TROPICAL CYCLONE WITHIN THE NEXT 24 HOURS IS LOW.
 (2) NO OTHER SUSPECT AREAS.
 C. SUBTROPICAL SYSTEM SUMMARY: NONE.
2. SOUTH PACIFIC AREA (WEST COAST OF SOUTH AMERICA TO 135 EAST):`,
    cpcWeek2Kml: null,
    cpcWeek3Kml: null
  }, { now: NOW });

  assert.equal(outlook.nearTermDisturbances.length, 1);
  assert.deepEqual({ ...outlook.nearTermDisturbances[0], sourceText: "captured" }, {
    factRef: "jtwc:invest:98W",
    id: "98W",
    latitude: 15.9,
    longitude: 132.1,
    potential: "low",
    timeWindowHours: 24,
    numericProbability: null,
    maximumWindKt: 20,
    minimumPressureHpa: 1006,
    favorableSignals: ["低垂直风切变", "高空辐散条件良好", "海温偏暖"],
    limitingSignals: [],
    sourceText: "captured"
  });
  assert.match(outlook.nearTermDisturbances[0].sourceText, /INVEST 98W/);
});

test("CPC KML yields numeric probability areas and filters out non-western-Pacific polygons", () => {
  const outlook = buildTropicalDisturbanceOutlook({
    jtwcAdvisory: null,
    cpcWeek2Kml: cpcKml("Week-2", "07/22/2026 - 07/28/2026", [
      { probability: 40, coordinates: "120,8,0 150,8,0 150,24,0 120,24,0 120,8,0" },
      { probability: 60, coordinates: "-120,8,0 -105,8,0 -105,18,0 -120,18,0 -120,8,0" }
    ]),
    cpcWeek3Kml: null
  }, { now: NOW });

  assert.equal(outlook.extendedRangeAreas.length, 1);
  assert.equal(outlook.extendedRangeAreas[0].probabilityPercent, 40);
  assert.equal(outlook.extendedRangeAreas[0].week, 2);
  assert.deepEqual(outlook.extendedRangeAreas[0].center, { latitude: 14.4, longitude: 132 });
  assert.equal(outlook.extendedRangeAreas[0].validPeriod, "07/22/2026 - 07/28/2026");
});

test("no-storm report separates near-term qualitative evidence from extended numeric probability", () => {
  const outlook = buildTropicalDisturbanceOutlook({
    jtwcAdvisory: `ABPW10 PGTW 190600
SUBJ/SIGNIFICANT TROPICAL WEATHER ADVISORY FOR THE WESTERN AND SOUTH PACIFIC OCEANS/190600Z-200600ZJUL2026//
1. WESTERN NORTH PACIFIC AREA (180 TO MALAY PENINSULA):
 B. TROPICAL DISTURBANCE SUMMARY: NONE.
 C. SUBTROPICAL SYSTEM SUMMARY: NONE.
2. SOUTH PACIFIC AREA (WEST COAST OF SOUTH AMERICA TO 135 EAST):`,
    cpcWeek2Kml: cpcKml("Week-2", "07/22/2026 - 07/28/2026", [
      { probability: 20, coordinates: "122,5,0 155,5,0 155,20,0 122,20,0 122,5,0" }
    ]),
    cpcWeek3Kml: null
  }, { now: NOW });

  const report = renderTropicalDisturbanceReport(outlook);
  assert.match(report, /潜在台风胚胎研判/);
  assert.match(report, /未来24小时.*未列出/);
  assert.match(report, /第2周.*20%/);
  assert.match(report, /不是单个胚胎的精确路径/);
  assert.doesNotMatch(report, /LOW.*20%/);
});

function cpcKml(
  week: string,
  validPeriod: string,
  areas: Array<{ probability: number; coordinates: string }>
) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml><Document><name>${week}: Probability(%) of Tropical Cyclogenesis: Issued: 07/14/2026 Valid: ${validPeriod}</name>
${areas.map((area, index) => `<Placemark id="area-${index}"><description><![CDATA[
<table><tr><td>prob</td><td>${area.probability}</td></tr></table>
]]></description><Polygon><outerBoundaryIs><LinearRing><coordinates>${area.coordinates}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`).join("\n")}
</Document></kml>`;
}
