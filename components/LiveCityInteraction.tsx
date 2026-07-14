"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { CloudRain, Droplets, LoaderCircle, Thermometer, Wind, X, type LucideIcon } from "lucide-react";
import type { CityBriefing } from "@/lib/cityBriefingData";
import type { CityAttention, CityAttentionAnchor, CityInteractionRequest } from "@/lib/liveCityInteraction";

const FLASH_DURATION_MS = 1_000;
const PANEL_DEPLOY_DURATION_MS = 1_020;
const CARD_DURATION_MS = 14_000;

type Presentation =
  | { state: "idle" }
  | { state: "loading"; request: CityInteractionRequest }
  | { state: "acquiring"; request: CityInteractionRequest; cityName: string }
  | { state: "flash"; request: CityInteractionRequest; briefing: CityBriefing }
  | { state: "deploy"; request: CityInteractionRequest; briefing: CityBriefing }
  | { state: "card"; request: CityInteractionRequest; briefing: CityBriefing }
  | { state: "error"; request: CityInteractionRequest };

export function LiveCityInteraction({
  interaction,
  anchor,
  onAttentionChange,
  onComplete
}: {
  interaction: CityInteractionRequest | null;
  anchor: CityAttentionAnchor | null;
  onAttentionChange: (attention: CityAttention | null) => void;
  onComplete: (id: string) => void;
}) {
  const [presentation, setPresentation] = useState<Presentation>({ state: "idle" });
  const cardRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!interaction) {
      setPresentation({ state: "idle" });
      onAttentionChange(null);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    let phaseTimer: number | null = null;
    let deployTimer: number | null = null;
    let closeTimer: number | null = null;
    let attentionStartedAt = 0;
    let attention: Omit<CityAttention, "phase"> | null = null;
    setPresentation({ state: "loading", request: interaction });
    onAttentionChange(null);

    const startAttention = (next: Omit<CityAttention, "phase">) => {
      if (attentionStartedAt) return;
      attention = next;
      attentionStartedAt = Date.now();
      onAttentionChange({ ...next, phase: "flash" });
    };

    void fetch(`/api/city-briefing?city=${encodeURIComponent(interaction.cityQuery)}&stage=location`, {
      cache: "no-store",
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<CityBriefing["city"]>;
      })
      .then((city) => {
        if (cancelled) return;
        startAttention({ id: interaction.id, city: city.name, longitude: city.longitude, latitude: city.latitude });
        setPresentation((current) => current.state === "loading"
          ? { state: "acquiring", request: interaction, cityName: city.name }
          : current);
      })
      .catch(() => undefined);

    void fetch(`/api/city-briefing?city=${encodeURIComponent(interaction.cityQuery)}`, {
      cache: "no-store",
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<CityBriefing>;
      })
      .then((briefing) => {
        if (cancelled) return;
        startAttention({
          id: interaction.id,
          city: briefing.city.name,
          longitude: briefing.city.longitude,
          latitude: briefing.city.latitude
        });
        const attentionBase = attention ?? {
          id: interaction.id,
          city: briefing.city.name,
          longitude: briefing.city.longitude,
          latitude: briefing.city.latitude
        };
        setPresentation({ state: "flash", request: interaction, briefing });
        onAttentionChange({ ...attentionBase, phase: "flash" });
        // The locator can finish long before the weather bundle. Preserve a
        // short decoding beat even then, so the card never teleports in.
        const decodeDelay = Math.max(160, FLASH_DURATION_MS - (Date.now() - attentionStartedAt));
        phaseTimer = window.setTimeout(() => {
          if (cancelled) return;
          setPresentation({ state: "deploy", request: interaction, briefing });
          onAttentionChange({ ...attentionBase, phase: "card" });
        }, decodeDelay);
        deployTimer = window.setTimeout(() => {
          if (!cancelled) setPresentation({ state: "card", request: interaction, briefing });
        }, decodeDelay + PANEL_DEPLOY_DURATION_MS);
        closeTimer = window.setTimeout(() => {
          if (!cancelled) onComplete(interaction.id);
        }, FLASH_DURATION_MS + CARD_DURATION_MS);
      })
      .catch(() => {
        if (cancelled || controller.signal.aborted) return;
        setPresentation({ state: "error", request: interaction });
        closeTimer = window.setTimeout(() => onComplete(interaction.id), 1_500);
      });

    return () => {
      cancelled = true;
      controller.abort();
      if (phaseTimer !== null) window.clearTimeout(phaseTimer);
      if (deployTimer !== null) window.clearTimeout(deployTimer);
      if (closeTimer !== null) window.clearTimeout(closeTimer);
    };
  }, [interaction, onAttentionChange, onComplete]);

  const resolvedAnchor = useResolvedCardAnchor(anchor, cardRef, presentation.state);
  // An off-screen or stale map anchor must never suppress the report. The
  // resolved position is clamped to the viewport, while the fallback keeps
  // the decoding/card sequence visible until MapLibre reports a fresh point.
  const hasUsableAnchor = anchor !== null
    && Number.isFinite(resolvedAnchor.left)
    && Number.isFinite(resolvedAnchor.top);
  const placement = hasUsableAnchor ? `is-anchored is-positioned is-${resolvedAnchor.horizontal} is-${resolvedAnchor.vertical}` : "is-fallback";
  const placementStyle = hasUsableAnchor
    ? ({
      "--city-card-x": `${anchor!.x}px`, "--city-card-y": `${anchor!.y}px`,
      "--city-card-left": `${resolvedAnchor.left}px`, "--city-card-top": `${resolvedAnchor.top}px`
    } as CSSProperties)
    : undefined;

  if (presentation.state === "idle") return null;
  if (presentation.state === "loading") {
    return <aside ref={cardRef} className={`live-city-card is-loading ${placement}`} style={placementStyle} role="status" aria-live="polite"><LoaderCircle /><span>正在锁定 {presentation.request.cityQuery} 城市战况</span></aside>;
  }
  if (presentation.state === "acquiring") {
    return <AcquisitionCard cardRef={cardRef} cityName={presentation.cityName} placement={placement} placementStyle={placementStyle} detail="坐标锁定，正在回收战区资料" />;
  }
  if (presentation.state === "error") {
    return <aside ref={cardRef} className={`live-city-card is-error ${placement}`} style={placementStyle} role="status">{presentation.request.cityQuery} 暂无可用城市数据</aside>;
  }
  if (presentation.state === "flash") {
    return <AcquisitionCard cardRef={cardRef} cityName={presentation.briefing.city.name} placement={placement} placementStyle={placementStyle} detail="战区资料解封中" />;
  }

  const { briefing, request } = presentation;
  const currentMetrics: TacticalMetric[] = [
    { label: "实况温度", value: numberLabel(briefing.current.temperatureC, "°C"), detail: `体感 ${numberLabel(briefing.current.apparentTemperatureC, "°C")}`, icon: Thermometer, level: temperatureProgress(briefing.current.temperatureC) },
    { label: "相对湿度", value: percentageLabel(briefing.current.relativeHumidityPct), detail: "空气含水", icon: Droplets, level: briefing.current.relativeHumidityPct ?? 0 },
    { label: "实况降水", value: numberLabel(briefing.current.precipitationMm, " mm"), detail: "当前时段", icon: CloudRain, level: precipitationProgress(briefing.current.precipitationMm) },
    { label: "近地风速", value: numberLabel(briefing.current.windSpeedMps, " m/s"), detail: "当前实况", icon: Wind, level: windProgress(briefing.current.windSpeedMps) }
  ];
  const forecastMetrics: TacticalMetric[] = [
    { label: "6小时累计", value: numberLabel(briefing.nextSixHours.precipitationMm, " mm"), detail: "降水总量", icon: CloudRain, level: precipitationProgress(briefing.nextSixHours.precipitationMm) },
    { label: "小时峰值", value: numberLabel(briefing.nextSixHours.maxHourlyPrecipitationMm, " mm"), detail: "最大单小时", icon: Droplets, level: precipitationProgress(briefing.nextSixHours.maxHourlyPrecipitationMm) },
    { label: "降水机会", value: percentageLabel(briefing.nextSixHours.maxPrecipitationProbabilityPct), detail: "未来6小时", icon: CloudRain, level: briefing.nextSixHours.maxPrecipitationProbabilityPct ?? 0 },
    { label: "阵风峰值", value: numberLabel(briefing.nextSixHours.maxWindGustMps, " m/s"), detail: "未来6小时", icon: Wind, level: windProgress(briefing.nextSixHours.maxWindGustMps) }
  ];
  const windowLabel = timeWindow(briefing.nextSixHours.startsAt, briefing.nextSixHours.endsAt);
  const observedAt = briefing.current.observedAt ?? briefing.generatedAt;
  const riskScore = Math.max(...briefing.risks.map((risk) => riskProgress([risk], risk.kind)));

  return (
    <aside ref={cardRef} className={`live-city-card is-visible is-${presentation.state} ${placement}`} style={placementStyle} aria-live="polite">
      <div className="city-card-damage city-card-damage-a" aria-hidden="true" />
      <div className="city-card-damage city-card-damage-b" aria-hidden="true" />
      <div className="city-card-decode" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /><i /></div>
      <svg className="city-card-cracks" viewBox="0 0 430 310" preserveAspectRatio="none" aria-hidden="true"><path d="M12 16 61 45 90 39 123 78 164 91 180 126" /><path d="M428 230 377 210 352 229 301 194 262 207 232 170" /><path d="M344 8 317 35 324 67 284 90" /></svg>
      <div className="live-city-card-corners" aria-hidden="true"><i /><i /><i /><i /></div>
      <div className="live-city-card-signal" aria-hidden="true" />
      <header>
        <div><span>STORM FRONTIER // CITY INSTANCE</span><strong>{briefing.city.name}<em>战区接入</em></strong></div>
        <button type="button" onClick={() => onComplete(request.id)} aria-label="关闭城市战况卡"><X /></button>
      </header>
      <div className="live-city-card-command">
        <ThreatDial score={riskScore} />
        <TypewriterText text={briefing.narrative.summary} active={presentation.state === "card"} className="live-city-card-verdict city-card-tactical-copy" speed={42} />
      </div>
      <div className="live-city-risk-arcs" aria-label="三项风险等级">
        {briefing.risks.map((risk) => (
          <article key={risk.kind} data-level={risk.level} style={{ "--city-risk-progress": `${riskProgress([risk], risk.kind)}%` } as CSSProperties}>
            <i /><span>{risk.label}</span><b>{levelLabel(risk.level)}</b><small>{risk.summary}</small>
          </article>
        ))}
      </div>
      <TelemetryDeck title="实时链路" metrics={currentMetrics} />
      <TelemetryDeck title="未来六小时" metrics={forecastMetrics} />
      <div className="live-city-nowcast">
        <span>短临降水推演</span>
        <b>未来2小时 {numberLabel(briefing.minutelyRain.precipitationNextTwoHoursMm, " mm")}</b>
        <b>5分钟峰值 {numberLabel(briefing.minutelyRain.maxFiveMinutePrecipitationMm, " mm")}</b>
        <small>{briefing.minutelyRain.available ? "分钟级降水资料已接入" : "分钟级降水资料暂缺"}</small>
      </div>
      <div className="live-city-actions">
        <span>{windowLabel ? `关键窗口：${windowLabel}` : "未来 6 小时研判"}</span>
        {briefing.narrative.actions.map((action, index) => <b key={action} style={{ "--city-action-index": index } as CSSProperties}>› {action}</b>)}
      </div>
      <WorldFragment active={presentation.state === "card"} />
      <footer>
        <span>数据模板直出 · 不等待大模型</span>
        <time>更新 {formatTime(observedAt)}</time>
      </footer>
    </aside>
  );
}

function AcquisitionCard({ cardRef, cityName, placement, placementStyle, detail }: {
  cardRef: RefObject<HTMLElement | null>;
  cityName: string;
  placement: string;
  placementStyle: CSSProperties | undefined;
  detail: string;
}) {
  return (
    <aside ref={cardRef} className={`live-city-card city-card-acquiring ${placement}`} style={placementStyle} aria-live="polite">
      <div className="city-card-acquisition-link" aria-hidden="true"><i /><b /></div>
      <div className="city-card-acquisition-shards" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div>
      <div className="city-card-acquisition-copy"><span>DECODE // SIGNAL LOCK</span><strong>{cityName}</strong><b>{detail}</b></div>
    </aside>
  );
}

type ResolvedCardAnchor = Pick<CityAttentionAnchor, "horizontal" | "vertical"> & { left: number; top: number };

function useResolvedCardAnchor(anchor: CityAttentionAnchor | null, cardRef: RefObject<HTMLElement | null>, presentationState: Presentation["state"]): ResolvedCardAnchor {
  const fallback: ResolvedCardAnchor = {
    horizontal: anchor?.horizontal ?? "right",
    vertical: anchor?.vertical ?? "down",
    left: anchor?.x ?? 0,
    top: anchor?.y ?? 0
  };
  const [resolved, setResolved] = useState(fallback);

  useLayoutEffect(() => {
    if (!anchor) return;
    const update = () => {
      const rect = cardRef.current?.getBoundingClientRect();
      const next = resolveCardAnchor(anchor, rect?.width ?? 700, rect?.height ?? 570);
      setResolved((current) => current.left === next.left && current.top === next.top && current.horizontal === next.horizontal && current.vertical === next.vertical ? current : next);
    };
    update();
    const observer = typeof ResizeObserver === "undefined" || !cardRef.current ? null : new ResizeObserver(update);
    if (observer && cardRef.current) observer.observe(cardRef.current);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [anchor, cardRef, presentationState]);

  return anchor ? resolved : fallback;
}

function resolveCardAnchor(anchor: CityAttentionAnchor, width: number, height: number): ResolvedCardAnchor {
  const margin = 18;
  const horizontalGap = 46;
  const verticalGap = 30;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const fitsRight = anchor.x + horizontalGap + width <= viewportWidth - margin;
  const fitsLeft = anchor.x - horizontalGap - width >= margin;
  const horizontal = fitsRight && (!fitsLeft || anchor.horizontal === "right") ? "right" : "left";
  const fitsDown = anchor.y + verticalGap + height <= viewportHeight - margin;
  const fitsUp = anchor.y - verticalGap - height >= margin;
  const vertical = fitsDown && (!fitsUp || anchor.vertical === "down") ? "down" : "up";
  return {
    horizontal,
    vertical,
    left: clamp(horizontal === "right" ? anchor.x + horizontalGap : anchor.x - horizontalGap - width, margin, Math.max(margin, viewportWidth - width - margin)),
    top: clamp(vertical === "down" ? anchor.y + verticalGap : anchor.y - verticalGap - height, margin, Math.max(margin, viewportHeight - height - margin))
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

type TacticalMetric = { label: string; value: string; detail: string; icon: LucideIcon; level: number };

function TelemetryDeck({ title, metrics }: { title: string; metrics: TacticalMetric[] }) {
  return <section className="live-city-telemetry" aria-label={title}>
    <div className="city-telemetry-title"><span>{title}</span><i /></div>
    <div className="city-telemetry-grid">
      {metrics.map((metric) => {
        const Icon = metric.icon;
        return <article key={metric.label} style={{ "--city-metric-level": `${metric.level}%` } as CSSProperties}>
          <Icon /><span>{metric.label}</span><strong>{metric.value}</strong><small>{metric.detail}</small><i />
        </article>;
      })}
    </div>
  </section>;
}

function WorldFragment({ active }: { active: boolean }) {
  const [text, setText] = useState<string | null>(null);
  const [available, setAvailable] = useState<number | null>(null);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    void fetch("/api/world-fragments", { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() as Promise<{ fragment?: string | null; available?: number }> : null)
      .then((payload) => {
        if (!payload) return;
        setText(payload.fragment ?? null);
        setAvailable(typeof payload.available === "number" ? payload.available : null);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [active]);
  if (!text) {
    return <section className="world-fragment is-sealed" aria-label="终端档案碎片"><span>ARCHIVE FRAGMENT {available === null ? "UPLINK PENDING" : `${available.toString().padStart(2, "0")} READY`}</span><p>档案层仍在封存，未获授权的记录不会被投放。</p></section>;
  }
  return <section className="world-fragment" aria-label="终端档案碎片"><span>ARCHIVE FRAGMENT {available === null ? "" : `${available.toString().padStart(2, "0")} LEFT`}</span><TypewriterText text={text} active={active} /></section>;
}

function TypewriterText({ text, active, className = "live-city-card-verdict", speed = 108 }: { text: string; active: boolean; className?: string; speed?: number }) {
  const [visible, setVisible] = useState("");
  const audioContext = useRef<AudioContext | null>(null);
  useEffect(() => {
    if (!active) return;
    let position = 0;
    setVisible("");
    let timer: number | null = null;
    const typeNext = () => {
      position += 1;
      const character = text.slice(position - 1, position);
      setVisible(text.slice(0, position));
      playTypewriterTick(audioContext);
      if (position < text.length) timer = window.setTimeout(typeNext, /[。！？]/.test(character) ? speed * 5 : speed);
    };
    timer = window.setTimeout(typeNext, 220);
    return () => { if (timer !== null) window.clearTimeout(timer); };
  }, [active, speed, text]);
  return <p className={className}>{visible}<i className="live-city-type-cursor" aria-hidden="true" /></p>;
}

function playTypewriterTick(contextRef: { current: AudioContext | null }) {
  try {
    const context = contextRef.current ?? new AudioContext();
    contextRef.current = context;
    if (context.state === "suspended") void context.resume();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "square";
    oscillator.frequency.value = 1100;
    gain.gain.setValueAtTime(0.016, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.024);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.028);
  } catch { /* audio is optional when the browser blocks autoplay */ }
}

function ThreatDial({ score }: { score: number }) {
  return (
    <div className="live-city-threat-dial" style={{ "--city-threat-score": `${score}%` } as CSSProperties}>
      <div><b>{score}</b><span>战况指数</span></div>
    </div>
  );
}

function riskProgress(risks: CityBriefing["risks"], kind: CityBriefing["risks"][number]["kind"]) {
  const level = risks.find((risk) => risk.kind === kind)?.level ?? "unavailable";
  return ({ low: 24, moderate: 49, high: 74, severe: 96, unavailable: 8 })[level];
}

function numberLabel(value: number | null, unit: string) {
  return value === null ? "—" : `${value.toFixed(value >= 10 ? 0 : 1)}${unit}`;
}

function percentageLabel(value: number | null) {
  return value === null ? "—" : `${Math.round(value)}%`;
}

function precipitationProgress(value: number | null) {
  return Math.min(100, Math.max(0, (value ?? 0) * 8));
}

function windProgress(value: number | null) {
  return Math.min(100, Math.max(0, (value ?? 0) * 4));
}

function temperatureProgress(value: number | null) {
  return Math.min(100, Math.max(0, ((value ?? 0) + 10) * 2.2));
}

function levelLabel(level: CityBriefing["risks"][number]["level"]) {
  return ({ low: "低", moderate: "中", high: "高", severe: "极高", unavailable: "暂无" })[level];
}

function timeWindow(start: string | null, end: string | null) {
  if (!start || !end) return null;
  return `${formatTime(start)}–${formatTime(end)}`;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai" }).format(date);
}
