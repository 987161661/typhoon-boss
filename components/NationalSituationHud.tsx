"use client";

import type { NationalSituationSnapshot, SourceFreshness, WeatherEventLevel } from "@/lib/nationalWeatherTypes";
import { buildNationalSituationHudModel } from "@/components/nationalSituationHudModel";
import styles from "./NationalSituationHud.module.css";

export interface NationalSituationHudProps {
  snapshot: NationalSituationSnapshot;
  className?: string;
  variant?: "full" | "compact";
  onSelectEvent?: (eventId: string) => void;
  onOpenCitySituation?: () => void;
}

export function NationalSituationHud({
  snapshot,
  className = "",
  variant = "full",
  onSelectEvent,
  onOpenCitySituation
}: NationalSituationHudProps) {
  const model = buildNationalSituationHudModel(snapshot);
  const main = model.mainEvent;

  if (variant === "compact") {
    const primarySource = model.sources[0] ?? null;
    return (
      <section
        className={`${styles.hud} ${styles.compact} ${main ? styles[`level_${main.level}`] : styles.level_none} ${className}`.trim()}
        aria-label="全国气象态势摘要"
        data-highest-event-level={main?.level ?? "none"}
      >
        <div className={styles.compactBrand}>
          <strong>气象 Boss 雷达</strong>
          <time dateTime={snapshot.generatedAt}>{model.generatedLabel}</time>
        </div>
        <div className={styles.compactEvent}>
          <span
            className={styles.compactBadge}
            style={main ? { backgroundImage: `url(${main.badgeAsset})` } : undefined}
            aria-hidden="true"
          />
          <div>
            <span>{main?.levelLabel ?? "统一快照无事件记录"}</span>
            <strong>{main?.title ?? "当前未发现显著全国战况"}</strong>
            <small>{main ? `${main.locationLabel} · ${main.evidenceLabel}` : "无事件记录不等于无风险"}</small>
          </div>
          <div className={styles.compactSource}>
            <span>{primarySource ? `主证据 ${primarySource.statusLabel}` : "来源待同步"}</span>
            <small>{primarySource?.label ?? "全国态势来源尚未载入"}</small>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      className={`${styles.hud} ${className}`.trim()}
      aria-labelledby="national-situation-hud-title"
      data-highest-event-level={main?.level ?? "none"}
    >
      <div className={styles.brandRail}>
        <div>
          <span className={styles.eyebrow}>NATIONAL WEATHER EVIDENCE</span>
          <h2 id="national-situation-hud-title">气象 Boss 雷达</h2>
        </div>
        <div className={styles.syncTime}>
          <span>统一快照</span>
          <time dateTime={snapshot.generatedAt}>{model.generatedLabel}</time>
        </div>
      </div>

      <article
        className={`${styles.mainDossier} ${main ? styles[`level_${main.level}`] : styles.level_none}`}
        aria-labelledby="national-main-event-title"
      >
        <span className={styles.dossierSkin} aria-hidden="true" />
        {main ? (
          <>
            <span
              className={styles.eventBadge}
              style={{ backgroundImage: `url(${main.badgeAsset})` }}
              aria-hidden="true"
            />
            <span
              className={styles.riskSeal}
              style={{ backgroundImage: `url(${main.sealAsset})` }}
              aria-hidden="true"
            />
            <div className={styles.eventCopy}>
              <div className={styles.eventMeta}>
                <span className={styles.levelLabel}>{main.levelLabel}</span>
                <span className={styles.evidenceLabel}>{main.evidenceLabel}</span>
                <time>{main.timeLabel}</time>
              </div>
              <h3 id="national-main-event-title">{main.title}</h3>
              <strong className={styles.location}>{main.locationLabel}</strong>
              <p className={styles.fact}>{main.factSummary}</p>
              <p className={styles.limitation}><span>边界</span>{main.limitation}</p>
              {onSelectEvent ? (
                <button className={styles.eventAction} type="button" onClick={() => onSelectEvent(main.id)}>
                  核对主事件
                </button>
              ) : null}
            </div>
          </>
        ) : (
          <div className={styles.emptyEvent}>
            <span className={styles.levelLabel}>统一快照无事件记录</span>
            <h3 id="national-main-event-title">当前未发现显著全国战况</h3>
            <p>继续显示雷达、环境图层与来源时效；无事件记录不等于无风险。</p>
          </div>
        )}
      </article>

      <div className={styles.evidenceRail} aria-hidden="true" />

      <div className={styles.summaryGrid}>
        <section className={`${styles.warningSummary} ${levelClass(model.warning.highestLevel)}`} aria-label="最高官方预警摘要">
          <span>最高官方预警</span>
          <strong>{model.warning.highestLevelLabel}</strong>
          <p>{model.warning.countsLabel}</p>
          <time>{model.warning.updatedLabel}</time>
        </section>

        {onOpenCitySituation ? (
          <button
            type="button"
            className={`${styles.cityEntry} ${styles[`city_${model.city.state}`]}`}
            onClick={onOpenCitySituation}
          >
            <span>异常城市入口</span>
            <strong>{model.city.label}</strong>
            <small>{model.city.detail}</small>
            <small>{model.city.coverageLabel}</small>
          </button>
        ) : (
          <section className={`${styles.cityEntry} ${styles[`city_${model.city.state}`]}`} aria-label="城市战况摘要">
            <span>异常城市入口</span>
            <strong>{model.city.label}</strong>
            <small>{model.city.detail}</small>
            <small>{model.city.coverageLabel}</small>
          </section>
        )}
      </div>

      <section className={styles.sourceLedger} aria-labelledby="source-health-title">
        <div className={styles.ledgerHeading}>
          <h3 id="source-health-title">来源时效</h3>
          <span>{model.sources.length} 路证据</span>
        </div>
        <ul>
          {model.sources.map((source) => (
            <li
              key={source.sourceId}
              className={`${styles.sourceRow} ${styles[`source_${source.status}`]}`}
              data-primary-evidence={source.isPrimaryEvidence || undefined}
            >
              <span className={`${styles.healthGlyph} ${healthGlyphClass(source.status)}`} aria-hidden="true" />
              <span className={styles.sourceName}>{source.label}</span>
              <span className={styles.sourceStatus}>{source.statusLabel}</span>
              <time>{source.updatedLabel}</time>
              <small>{source.statusDetail}</small>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}

function levelClass(level: Exclude<WeatherEventLevel, "watch"> | null) {
  return level ? styles[`summary_${level}`] : styles.summary_none;
}

function healthGlyphClass(status: SourceFreshness) {
  return styles[`glyph_${status.replace("-", "_")}`];
}
