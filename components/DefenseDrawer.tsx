"use client";

import { ShieldAlert, X } from "lucide-react";
import type { ProvinceDefenseStatus } from "@/lib/types";
import { HudPanel } from "./HudPrimitives";

export function DefenseDrawer({
  defense,
  onClose
}: {
  defense: ProvinceDefenseStatus | null;
  onClose: () => void;
}) {
  if (!defense) return null;

  return (
    <HudPanel as="div" className="defense-drawer" role="dialog" aria-label={`${defense.province}防御态势`}>
      <button className="icon-button close-defense" type="button" onClick={onClose} aria-label="关闭防御态势">
        <X size={18} />
      </button>
      <div className="section-title">
        <ShieldAlert size={18} />
        <span>{defense.province}防御态势</span>
      </div>
      <div className="defense-rank">
        <strong>{defense.status}</strong>
        <span>{defense.rating}</span>
      </div>
      <p className="risk-line">{defense.riskLine}</p>
      <div className="defense-copy">
        <span>行动建议</span>
        <p>{defense.advice}</p>
      </div>
      <div className="defense-copy banter">
        <span>雷达备注</span>
        <p>{defense.banter}</p>
      </div>
      <small>距当前 Boss 中心约 {defense.distanceKm} 公里。真实预警以官方部门发布为准。</small>
    </HudPanel>
  );
}
