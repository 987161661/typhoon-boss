import assert from "node:assert/strict";
import test from "node:test";
import { parseJtwcStructureBulletin } from "../lib/bossEngine/structureIntelligence";
import type { Storm } from "../lib/types";

const storm = {
  id: "202609", code: "202609", nameZh: "巴威", nameEn: "BAVI", stage: "台风", rating: "台风级", status: "实时监测中",
  position: { lon: 130, lat: 20 }, maxWind: 40, minPressure: 960, moveDirection: "西北", moveSpeed: 15,
  updatedAt: "2026-07-12T00:00:00.000Z",
  windRadiiKm: { r7: 300, r10: 100, r12: 50, quadrants: {
    r7: { ne: 300, se: 280, sw: 200, nw: 220, max: 300 },
    r10: { ne: 100, se: 90, sw: 80, nw: 70, max: 100 },
    r12: { ne: 50, se: 40, sw: 30, nw: 20, max: 50 }
  } }, track: [], forecast: [], forecastScenarios: [], landfalls: [], skills: [], notice: ""
} satisfies Storm;

test("JTWC bulletin must match the storm identity", () => {
  assert.throws(() => parseJtwcStructureBulletin("WDPN31 PGTW 120900 PROGNOSTIC REASONING FOR TYPHOON 10W (MAYSAK)", storm, "https://example.invalid"), /identity did not match/);
  const parsed = parseJtwcStructureBulletin("WDPN31 PGTW 120900 PROGNOSTIC REASONING FOR TYPHOON 09W (BAVI) WITH A STABLE EYE", storm, "https://example.invalid");
  assert.equal(parsed.source, "jtwc");
});

test("JTWC final warning takes precedence over eyewall interpretation", () => {
  const parsed = parseJtwcStructureBulletin(
    "SUBJ: TROPICAL STORM 09W (BAVI) WARNING NR 044 WTPN31 PGTW 112100 " +
      "TROPICAL STORM 09W (BAVI) DOWNGRADED FROM TYPHOON. " +
      "DISSIPATING AS A SIGNIFICANT TROPICAL CYCLONE OVER LAND. " +
      "THIS IS THE FINAL WARNING ON THIS SYSTEM.",
    storm,
    "https://science.nrlmry.navy.mil/atcf/docs/current_storms/wp092026.wrn"
  );
  assert.equal(parsed.state, "overland-dissipation");
  assert.equal(parsed.stateLabel, "登陆后内核衰减");
  assert.match(parsed.detail, /眼墙置换判读结束/);
  assert.equal(parsed.sourceLabel, "JTWC 警报（NRL ATCF 镜像）");
  assert.equal(parsed.observedAt, "2026-07-11T21:00:00.000Z");
});
