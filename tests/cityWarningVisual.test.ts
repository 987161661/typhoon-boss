import assert from "node:assert/strict";
import test from "node:test";
import { resolveCityWarningVisual } from "../lib/cityWarningVisual";
import type { PanelWarning } from "../lib/cityPanelsPresentation";

const active = (level: string, title: string): PanelWarning => ({
  status: "active", level, title, issuer: null, issuedAt: null, effectiveAt: null, expiresAt: null,
  description: null, instruction: null, evidence: "official"
});

test("official warning visuals bind severity color and hazard icon independently", () => {
  const heat = resolveCityWarningVisual(active("Orange", "乌鲁木齐市发布高温橙色预警信号"));
  assert.deepEqual(heat, { severity: "orange", kind: "heat", levelLabel: "橙色", kindLabel: "高温" });

  const rain = resolveCityWarningVisual(active("red", "某地发布暴雨红色预警信号"));
  assert.equal(rain.severity, "red");
  assert.equal(rain.kind, "rain");

  const thunder = resolveCityWarningVisual(active("yellow", "某地发布雷电黄色预警信号"));
  assert.equal(thunder.severity, "yellow");
  assert.equal(thunder.kind, "thunder");

  const wind = resolveCityWarningVisual(active("blue", "某地发布大风蓝色预警信号"));
  assert.equal(wind.severity, "blue");
  assert.equal(wind.kind, "wind");
});
