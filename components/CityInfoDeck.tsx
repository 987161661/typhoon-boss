import {
  CircleAlert,
  CloudFog,
  CloudLightning,
  CloudRain,
  Flame,
  Snowflake,
  ThermometerSun,
  Waves,
  Wind,
  type LucideIcon
} from "lucide-react";
import { useEffect, useState, type CSSProperties, type RefObject } from "react";
import type {
  CityPanelsModel,
  PanelEvidence,
  PanelMetric,
  PanelRisk,
  PanelWarning
} from "@/lib/cityPanelsPresentation";
import type { LayoutRect } from "@/lib/cityPanelLayout";
import { resolveCityWarningVisual, type CityWarningKind } from "@/lib/cityWarningVisual";
import styles from "./CityInfoDeck.module.css";

export interface CityInfoDeckProps {
  panelRef: RefObject<HTMLElement | null>;
  rect: LayoutRect;
  phase: "deploy" | "card";
  model: CityPanelsModel;
}

/**
 * The factual companion to the battle show. This component deliberately owns
 * no data decisions: every value, evidence label and warning boundary comes
 * from the shared CityPanelsModel.
 */
export function CityInfoDeck({ panelRef, rect, phase, model }: CityInfoDeckProps) {
  const warning = model.info.warning;
  const severity = warningSeverity(warning);
  const time = model.shared.observedAt ?? model.shared.generatedAt;
  // The live page can finish loading an older presentation chunk while a new
  // briefing is already in flight. Treat the additive warning queue as an
  // optional runtime boundary: a malformed/stale value must never take down
  // the entire city overlay (the primary official warning remains usable).
  const relatedWarnings = Array.isArray(model.info.relatedWarnings) ? model.info.relatedWarnings : [];

  return (
    <aside
      ref={panelRef}
      className={styles.deck}
      style={rectStyle(rect)}
      aria-label={`${model.shared.cityLabel}气象信息副屏`}
      data-role="info-panel"
      data-phase={phase}
      data-warning-feed={model.shared.warningFeed}
      data-severity={severity}
      data-status={model.shared.dataStatus}
    >
      <div className={styles.calibrationRail} aria-hidden="true"><i /><i /><i /></div>

      <header className={styles.header} data-role="info-header">
        <div className={styles.identity}>
          <span>CITY OBSERVATORY // FACT CHANNEL</span>
          <h3>{model.shared.cityLabel}</h3>
        </div>
        <div className={styles.freshness} data-status={model.shared.dataStatus}>
          <b>{dataStatusLabel(model.shared.dataStatus)}</b>
          <time dateTime={time}>{formatTime(time)}</time>
        </div>
      </header>

      <WarningConsole warning={warning} relatedWarnings={relatedWarnings} />

      <section className={styles.observationSection} aria-labelledby="city-info-current" data-role="current-observations">
        <SectionHeading id="city-info-current" title="实况观测" meta="06 CHANNELS" />
        <div className={styles.currentGrid}>
          {model.info.currentMetrics.map((metric) => <MetricCell key={metric.id} metric={metric} />)}
        </div>
      </section>

      <section className={styles.horizonSection} aria-label="短临与六小时趋势" data-role="forecast-horizons">
        <div className={styles.horizonBlock} data-role="nowcast-metrics">
          <SectionHeading title="两小时短临" meta="NOWCAST" />
          <div className={styles.nowcastGrid}>
            {model.info.nowcastMetrics.map((metric) => <MetricCell key={metric.id} metric={metric} />)}
          </div>
        </div>
        <div className={styles.horizonBlock} data-role="trend-metrics">
          <SectionHeading title="六小时趋势" meta="MODEL" />
          <div className={styles.trendGrid}>
            {model.info.trendMetrics.map((metric) => <MetricCell key={metric.id} metric={metric} />)}
          </div>
        </div>
      </section>

      <section className={styles.riskSection} aria-labelledby="city-info-risk" data-role="risk-matrix">
        <SectionHeading id="city-info-risk" title="风险证据矩阵" meta="04 AXES" />
        <div className={styles.riskGrid}>
          {model.info.risks.map((risk) => <RiskCell key={risk.id} risk={risk} />)}
        </div>
      </section>

      <footer className={styles.footer} data-role="decision-boundary">
        <section className={styles.actionList} aria-label="行动提示" data-role="action-guidance">
          <b>行动提示</b>
          {model.info.actions.map((action) => <p key={action}>{action}</p>)}
        </section>
        <section className={styles.limitationList} aria-label="资料限制" data-role="data-limitations">
          <b>资料边界</b>
          {model.info.limitations.map((limitation) => <p key={limitation}>{limitation}</p>)}
        </section>
      </footer>
    </aside>
  );
}

function WarningConsole({ warning: primaryWarning, relatedWarnings = [] }: { warning: PanelWarning; relatedWarnings?: PanelWarning[] }) {
  const [selectedTitle, setSelectedTitle] = useState(primaryWarning.title);
  const [showAllWarnings, setShowAllWarnings] = useState(false);

  useEffect(() => {
    setSelectedTitle(primaryWarning.title);
    setShowAllWarnings(false);
  }, [primaryWarning.title]);
  const safeRelatedWarnings = Array.isArray(relatedWarnings) ? relatedWarnings : [];
  const warnings = [primaryWarning, ...safeRelatedWarnings];
  const warning = warnings.find((item) => item.title === selectedTitle) ?? primaryWarning;
  const visual = resolveCityWarningVisual(warning);
  const visibleWarnings = showAllWarnings ? warnings : warnings.filter((_, index) => index < 3);
  const hiddenWarningCount = Math.max(0, warnings.length - visibleWarnings.length);
  return (
    <section
      className={styles.warningConsole}
      role={warning.status === "active" ? "alert" : "status"}
      aria-label="官方预警事实"
      data-role="official-warning"
      data-warning-feed={warning.status}
      data-evidence={warning.evidence}
      data-severity={visual.severity}
      data-warning-kind={visual.kind}
    >
      <div className={styles.warningHero}>
        <div className={styles.warningEmblem} data-role="warning-emblem" data-warning-kind={visual.kind} aria-hidden="true">
          <WarningIcon kind={visual.kind} />
        </div>
        <div className={styles.warningLevelBlock}>
          <span>OFFICIAL WARNING VISUAL</span>
          <strong className={styles.warningLevelSeal} data-role="warning-level-seal">{visual.levelLabel} · {visual.kindLabel}</strong>
        </div>
      </div>
      {safeRelatedWarnings.length > 0 && <div className={styles.warningQueue} data-role="related-warning-queue" aria-label="同城其他官方预警">
        {visibleWarnings.map((item) => {
          const itemVisual = resolveCityWarningVisual(item);
          const selected = item.title === warning.title;
          return <button
            key={`${item.title}|${item.issuedAt ?? ""}`}
            type="button"
            data-role="related-warning-chip"
            data-selected={selected ? "true" : "false"}
            data-severity={itemVisual.severity}
            data-warning-kind={itemVisual.kind}
            aria-pressed={selected}
            aria-label={`${itemVisual.levelLabel}${itemVisual.kindLabel}预警：${item.title}`}
            onClick={() => setSelectedTitle(item.title)}
          ><WarningIcon kind={itemVisual.kind} /><span>{itemVisual.levelLabel} · {itemVisual.kindLabel}</span></button>;
        })}
        {hiddenWarningCount > 0 && <button
          className={styles.warningOverflow}
          data-role="related-warning-overflow"
          type="button"
          onClick={() => setShowAllWarnings(true)}
          aria-label={`展开其余 ${hiddenWarningCount} 条属地官方预警`}
        >+{hiddenWarningCount}</button>}
      </div>}
      <div className={styles.warningTitleRow}>
        <span>官方预警链路</span>
        <EvidenceTag evidence={warning.evidence} />
      </div>
      <strong className={styles.warningTitle}>{warning.title}</strong>
      {(warning.issuer || warning.issuedAt || warning.effectiveAt || warning.expiresAt) && (
        <dl className={styles.warningMeta}>
          {warning.issuer && <><dt>发布机构</dt><dd>{warning.issuer}</dd></>}
          {warning.issuedAt && <><dt>发布时间</dt><dd><time dateTime={warning.issuedAt}>{formatTime(warning.issuedAt)}</time></dd></>}
          {warning.effectiveAt && <><dt>生效时间</dt><dd><time dateTime={warning.effectiveAt}>{formatTime(warning.effectiveAt)}</time></dd></>}
          {warning.expiresAt && <><dt>有效期至</dt><dd><time dateTime={warning.expiresAt}>{formatTime(warning.expiresAt)}</time></dd></>}
        </dl>
      )}
      {(warning.description || warning.instruction) && (
        <div className={styles.warningCopy}>
          {warning.description && <p data-role="warning-description">{warning.description}</p>}
          {warning.instruction && <p data-role="warning-instruction"><b>属地指引</b>{warning.instruction}</p>}
        </div>
      )}
    </section>
  );
}

function WarningIcon({ kind }: { kind: CityWarningKind }) {
  const icons: Record<CityWarningKind, LucideIcon> = {
    heat: ThermometerSun,
    rain: CloudRain,
    thunder: CloudLightning,
    wind: Wind,
    typhoon: Waves,
    cold: Snowflake,
    fog: CloudFog,
    dust: Wind,
    fire: Flame,
    generic: CircleAlert
  };
  const Icon = icons[kind];
  return <Icon strokeWidth={2.2} />;
}

function SectionHeading({ id, title, meta }: { id?: string; title: string; meta: string }) {
  return <div className={styles.sectionHeading}><h4 id={id}>{title}</h4><span>{meta}</span></div>;
}

function MetricCell({ metric }: { metric: PanelMetric }) {
  return (
    <article className={styles.metric} data-role={`metric-${metric.id}`} data-evidence={metric.evidence}>
      <span>{metric.label}</span>
      <strong>{metric.value}{metric.unit && <small>{metric.unit}</small>}</strong>
      {metric.detail && <p>{metric.detail}</p>}
      <EvidenceTag evidence={metric.evidence} />
    </article>
  );
}

function RiskCell({ risk }: { risk: PanelRisk }) {
  return (
    <article
      className={styles.risk}
      data-role={`risk-${risk.id}`}
      data-level={risk.level}
      data-evidence={risk.evidence}
      aria-label={`${risk.label}：${riskLevelLabel(risk.level)}。${risk.summary}`}
    >
      <div><span>{risk.label}</span><b>{riskLevelLabel(risk.level)}</b></div>
      <p>{risk.summary}</p>
      <EvidenceTag evidence={risk.evidence} />
    </article>
  );
}

function EvidenceTag({ evidence }: { evidence: PanelEvidence }) {
  return <em className={styles.evidence} data-role="evidence" data-evidence={evidence}>{evidenceLabel(evidence)}</em>;
}

function warningSeverity(warning: PanelWarning) {
  if (warning.status !== "active") return warning.status;
  const level = warning.level?.toLowerCase() ?? "watch";
  if (level.includes("red") || level.includes("红")) return "red";
  if (level.includes("orange") || level.includes("橙")) return "orange";
  if (level.includes("yellow") || level.includes("黄")) return "yellow";
  if (level.includes("blue") || level.includes("蓝")) return "blue";
  return "watch";
}

function evidenceLabel(evidence: PanelEvidence) {
  return ({ official: "官方", observed: "观测", model: "模式", unavailable: "不可用" })[evidence];
}

function riskLevelLabel(level: PanelRisk["level"]) {
  return ({ severe: "严重", high: "高", moderate: "中", low: "低", unavailable: "待定" })[level];
}

function dataStatusLabel(status: CityPanelsModel["shared"]["dataStatus"]) {
  return status === "available" ? "资料在线" : status === "degraded" ? "部分资料" : "资料受限";
}

function formatTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function rectStyle(rect: LayoutRect): CSSProperties {
  return { left: rect.x, top: rect.y, width: rect.width, height: rect.height };
}
