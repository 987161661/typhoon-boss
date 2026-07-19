"use client";

import { AlertTriangle, Clock3 } from "lucide-react";
import type { LiveTyphoonOutlookView } from "@/lib/liveTyphoonOutlook";

export function LiveTyphoonOutlookTicker({ model }: { model: LiveTyphoonOutlookView }) {
  return (
    <aside
      className={`live-typhoon-outlook ${model.available ? "is-ready" : "is-pending"}`}
      aria-label="台风预测实况播报"
    >
      <div className="live-typhoon-outlook-heading">
        <AlertTriangle aria-hidden="true" />
        <span>
          <small>TC GENESIS OUTLOOK</small>
          <strong>台风预测</strong>
        </span>
      </div>
      <div className="live-typhoon-outlook-time">
        <Clock3 aria-hidden="true" />
        <span>研判时间</span>
        <time>{model.timestampLabel}</time>
      </div>
      <div className="live-typhoon-outlook-rail" aria-live="polite">
        <div className="live-typhoon-outlook-track">
          <span>{model.tickerText}</span>
          <span aria-hidden="true">{model.tickerText}</span>
        </div>
      </div>
      <b>{model.sourceLabel}</b>
    </aside>
  );
}
