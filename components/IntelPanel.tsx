"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import {
  Activity,
  AlertTriangle,
  BatteryCharging,
  Crosshair,
  Database,
  Gauge,
  MapPin,
  RadioTower,
  RotateCw,
  Satellite,
  Wind
} from "lucide-react";
import { BossEmblem } from "./BossEmblem";
import { HudPanel, MetricRow, MiniReadout } from "./HudPrimitives";
import type { BossProfile, BossSkill } from "@/lib/bossEngine/types";
import type { Storm } from "@/lib/types";

const UI = {
  currentIntel: "\u5f53\u524d\u53f0\u98ce Boss \u60c5\u62a5",
  linkError: "\u94fe\u8def\u5f02\u5e38",
  standby: "\u5f85\u673a\u5de1\u822a",
  noActiveStorm: "\u5f53\u524d\u65e0\u6d3b\u52a8\u53f0\u98ce",
  noActiveDesc: "\u4e3b\u96f7\u8fbe\u4fdd\u6301\u626b\u63cf\uff0c\u5c1a\u672a\u52a0\u8f7d\u6f14\u793a Boss\u3002\u5386\u53f2\u6863\u6848\u4ecd\u53ef\u67e5\u770b\uff0c\u5b9e\u65f6\u94fe\u8def\u6bcf 60 \u79d2\u5237\u65b0\u4e00\u6b21\u3002",
  dataErrorPrefix: "\u6570\u636e\u63a5\u53e3\u8fd4\u56de\u5f02\u5e38\uff1a",
  dataSourcePrefix: "\u6570\u636e\u6765\u6e90\uff1a",
  waitingSource: "\u7b49\u5f85\u6570\u636e\u6e90",
  viewDex: "\u67e5\u770b\u5386\u53f2 Boss \u56fe\u9274",
  targetIntel: "BOSS INTEL \u76ee\u6807\u60c5\u62a5",
  code: "\u7f16\u53f7",
  internationalName: "\u56fd\u9645\u540d",
  typhoon: "\u53f0\u98ce",
  publicApi: "\u516c\u5f00\u53f0\u98ce\u8def\u5f84\u63a5\u53e3",
  maxWind: "\u4e2d\u5fc3\u6700\u5927\u98ce\u529b",
  pressure: "\u4e2d\u5fc3\u6c14\u538b",
  r7: "\u4e03\u7ea7\u98ce\u5708\u534a\u5f84",
  r10: "\u5341\u7ea7\u98ce\u5708\u534a\u5f84",
  r12: "\u5341\u4e8c\u7ea7\u98ce\u5708\u534a\u5f84",
  moveDirection: "\u79fb\u52a8\u65b9\u5411",
  moveSpeed: "\u79fb\u52a8\u901f\u5ea6",
  threatSkills: "\u5a01\u80c1\u6280\u80fd",
  energy: "\u80fd\u91cf\u69fd",
  dataBasis: "\u6839\u636e\u516c\u5f00\u6570\u636e\uff1a\u98ce\u901f",
  hpa: "\u6c14\u538b",
  dossierAria: "\u53f0\u98ce\u5386\u53f2\u6863\u6848",
  tabOverview: "\u60c5\u62a5\u603b\u89c8",
  tabMeteorology: "\u6c14\u8c61\u5206\u6790",
  tabForecast: "\u8def\u5f84\u9884\u62a5",
  tabHistory: "\u5386\u53f2\u8bb0\u5f55",
  targetInfo: "\u76ee\u6807\u60c5\u62a5",
  bossTargetFile: "BOSS INTEL \u76ee\u6807\u6863\u6848",
  noArchive: "\u6682\u65e0\u6d3b\u52a8\u6863\u6848",
  noArchiveDesc: "\u96f7\u8fbe\u4fdd\u6301\u5de1\u822a\uff0c\u7b49\u5f85\u4e0b\u4e00\u4efd\u516c\u5f00\u53f0\u98ce\u8d44\u6599\u3002",
  liveLinkError: "\u5b9e\u65f6\u94fe\u8def\u5f02\u5e38\uff1a",
  disasterLevel: "\u707e\u5bb3\u7ea7\u522b",
  windSpeed: "\u98ce\u901f",
  historicalArchive: "\u5386\u53f2\u60c5\u62a5\u6863\u6848",
  targetFile: "\u76ee\u6807\u6863\u6848",
  firstRecord: "\u9996\u4e2a\u8bb0\u5f55",
  latestFix: "\u6700\u65b0\u5b9a\u4f4d",
  sampleSpan: "\u6837\u672c\u8de8\u5ea6",
  confidential: "\u673a\u5bc6",
  pending: "\u5f85\u786e\u8ba4",
};

export function IntelPanel({
  storm,
  bossProfile,
  source,
  dataError,
  theme = "night-radar"
}: {
  storm: Storm | null;
  bossProfile?: BossProfile | null;
  source?: string;
  dataError?: string | null;
  theme?: "night-radar" | "archive-command";
}) {
  if (theme === "archive-command") {
    return <DossierIntelPanel storm={storm} source={source} dataError={dataError} />;
  }

  if (!storm) {
    return (
      <aside className="intel-panel" aria-label={UI.currentIntel}>
        <div className="panel-topline">
          <span>BOSS INTEL</span>
          <strong>{dataError ? UI.linkError : UI.standby}</strong>
        </div>
        <HudPanel className="no-boss-panel">
          <RadioTower size={38} />
          <h1>{UI.noActiveStorm}</h1>
          <p>{UI.noActiveDesc}</p>
        </HudPanel>
        <HudPanel className="notice-box">
          <AlertTriangle size={18} />
          <p>{dataError ? `${UI.dataErrorPrefix}${dataError}` : `${UI.dataSourcePrefix}${source ?? UI.waitingSource}`}</p>
        </HudPanel>
        <Link className="dex-link" href="/dex">
          <Database size={18} />
          {UI.viewDex}
        </Link>
      </aside>
    );
  }

  return (
    <aside className="intel-panel" aria-label={UI.currentIntel}>
      <div className="panel-topline">
        <span>{bossProfile ? "BOSS PROFILE 气象事实生成" : UI.targetIntel}</span>
        <strong>{bossProfile?.phaseLabel ?? storm.updatedAt}</strong>
      </div>

      <HudPanel className="boss-card">
        <BossEmblem stage={storm.stage} label={`${storm.nameZh} ${storm.stage}`} />
        <div className="boss-title">
          <span>{UI.code} {storm.code} / {UI.internationalName} {storm.nameEn || "UNKNOWN"}</span>
          <h1>{bossProfile?.archetypeLabel ?? storm.stage}</h1>
          <p>
            {UI.typhoon} &quot;{storm.nameZh}&quot; <b>{bossProfile?.subtitle ?? storm.status}</b>
          </p>
        </div>
      </HudPanel>

      <div className="rating-strip">
        <span>{storm.rating}</span>
        <b>{bossProfile?.phaseLabel ?? storm.stage}</b>
      </div>

      {bossProfile ? (
        <HudPanel as="section" className="boss-profile-brief">
          <div>
            <span>FACT DRIVEN BOSS</span>
            <strong>{bossProfile.title}</strong>
          </div>
          <p>{bossProfile.riskSummary}</p>
        </HudPanel>
      ) : null}

      {bossProfile ? <SatelliteEvidenceBrief bossProfile={bossProfile} /> : null}

      <BossEnergyGauge storm={storm} bossProfile={bossProfile} />

      <HudPanel className="mini-readout-grid">
        <MiniReadout label="LAT" value={storm.position.lat.toFixed(2)} />
        <MiniReadout label="LON" value={storm.position.lon.toFixed(2)} />
        <MiniReadout label="TRACK" value={storm.track.length} />
        <MiniReadout label="FCST" value={storm.forecast.length} />
      </HudPanel>

      <HudPanel className="metric-table">
        <MetricRow icon={<Wind size={17} />} label={UI.maxWind} value={storm.maxWind || UI.pending} unit="m/s" hot />
        <MetricRow icon={<Gauge size={17} />} label={UI.pressure} value={storm.minPressure || UI.pending} unit="hPa" />
        <MetricRow icon={<Crosshair size={17} />} label={UI.r7} value={storm.windRadiiKm.r7 || UI.pending} unit="km" />
        <MetricRow icon={<Crosshair size={17} />} label={UI.r10} value={storm.windRadiiKm.r10 || UI.pending} unit="km" hot={storm.windRadiiKm.r10 > 0} />
        <MetricRow icon={<Crosshair size={17} />} label={UI.r12} value={storm.windRadiiKm.r12 || UI.pending} unit="km" hot={storm.windRadiiKm.r12 > 0} />
        <MetricRow icon={<MapPin size={17} />} label={UI.moveDirection} value={storm.moveDirection} />
        <MetricRow icon={<RotateCw size={17} />} label={UI.moveSpeed} value={storm.moveSpeed || UI.pending} unit="km/h" />
      </HudPanel>

      <HudPanel className="data-source-panel">
        <Satellite size={17} />
        <div>
          <span>{bossProfile ? "AUTHORITY / TRACK SOURCE" : "DATA SOURCE"}</span>
          <p>
            {bossProfile
              ? `${bossProfile.sourcePolicy.canonicalAuthority} / 路径源：${bossProfile.sourcePolicy.machineReadableTrackSource}`
              : source ?? UI.publicApi}
          </p>
        </div>
      </HudPanel>

      <HudPanel className="notice-box">
        <AlertTriangle size={18} />
        <p>{storm.notice}</p>
      </HudPanel>

      <Link className="dex-link" href="/dex">
        <Database size={18} />
        {UI.viewDex}
      </Link>
    </aside>
  );
}

export function BossSkillSlotPanel({
  storm,
  bossProfile,
  className = ""
}: {
  storm: Storm | null;
  bossProfile?: BossProfile | null;
  className?: string;
}) {
  if (!storm) return null;

  const displaySkills = bossProfile?.skills ?? storm.skills.map(convertLegacySkill);
  const visibleSkills = bossProfile ? chooseVisibleBossSkills(displaySkills) : displaySkills.slice(0, 3);

  return (
    <HudPanel as="section" className={`skill-panel boss-skill-panel ${className}`.trim()}>
      <div className="section-title">
        <Activity size={18} />
        <span>{bossProfile ? "BOSS 技能槽" : UI.threatSkills}</span>
      </div>
      {visibleSkills.map((skill) => (
        <div className="skill-row" key={skill.name}>
          <div>
            <strong>{skill.name}</strong>
            <p>{skill.detail}</p>
            <small className={`evidence-tag evidence-${skill.evidenceLevel}`}>{evidenceLabel(skill.evidenceLevel)}</small>
          </div>
          <span>{skill.severity}</span>
        </div>
      ))}
    </HudPanel>
  );
}

function DossierIntelPanel({
  storm,
  source,
  dataError
}: {
  storm: Storm | null;
  source?: string;
  dataError?: string | null;
}) {
  const energy = storm ? calculateBossEnergy(storm).value : 0;
  const archiveRows = storm
    ? [
        { label: UI.maxWind, value: storm.maxWind || UI.pending, unit: "m/s", hot: true },
        { label: UI.pressure, value: storm.minPressure || UI.pending, unit: "hPa" },
        { label: UI.r7, value: storm.windRadiiKm.r7 || UI.pending, unit: "km" },
        { label: UI.r10, value: storm.windRadiiKm.r10 || UI.pending, unit: "km", hot: storm.windRadiiKm.r10 > 0 },
        { label: UI.r12, value: storm.windRadiiKm.r12 || UI.pending, unit: "km", hot: storm.windRadiiKm.r12 > 0 },
        { label: UI.moveDirection, value: storm.moveDirection || UI.pending },
        { label: UI.moveSpeed, value: storm.moveSpeed || UI.pending, unit: "km/h" }
      ]
    : [];

  return (
    <aside className="intel-panel dossier-panel" aria-label={UI.dossierAria}>
      <div className="dossier-side-tabs" aria-hidden="true">
        <span>{UI.tabOverview}</span>
        <span>{UI.tabMeteorology}</span>
        <span>{UI.tabForecast}</span>
        <span>{UI.tabHistory}</span>
      </div>

      <div className="dossier-tabs" aria-hidden="true">
        <span className="active">{UI.targetInfo}</span>
        <span>{UI.tabMeteorology}</span>
        <span>{UI.tabHistory}</span>
      </div>

      <section className="dossier-sheet dossier-cover">
        <div className="dossier-kicker">
          <span>{UI.bossTargetFile}</span>
          <strong>{formatDossierDate(storm?.updatedAt)}</strong>
        </div>
        {storm ? (
          <div className="dossier-identity">
            <div className="dossier-seal" aria-hidden="true">
              <BossEmblem stage={storm.stage} label={`${storm.nameZh} ${storm.stage}`} />
            </div>
            <div>
              <span>{UI.code} {storm.code} / {UI.internationalName} {storm.nameEn || "UNKNOWN"}</span>
              <h1>{storm.stage}</h1>
              <p>
                {UI.typhoon} &quot;{storm.nameZh}&quot; <b>{storm.status}</b>
              </p>
            </div>
          </div>
        ) : (
          <div className="dossier-empty">
            <RadioTower size={34} />
            <h1>{UI.noArchive}</h1>
            <p>{dataError ? `${UI.liveLinkError}${dataError}` : UI.noArchiveDesc}</p>
          </div>
        )}
      </section>

      {storm ? (
        <>
          <section className="dossier-classification">
            <div>
              <span>{UI.disasterLevel}</span>
              <strong>{storm.rating}</strong>
            </div>
            <b>{storm.stage}</b>
          </section>

          <section className="dossier-sheet dossier-energy">
            <div className="dossier-section-head">
              <span>PUBLIC DATA ENERGY</span>
              <strong>{energy}%</strong>
            </div>
            <div className="dossier-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={energy}>
              <i style={{ width: `${energy}%` }} />
            </div>
            <p>{UI.windSpeed} {storm.maxWind || "--"} m/s / {UI.hpa} {storm.minPressure || "--"} hPa / {UI.r7} {storm.windRadiiKm.r7 || "--"} km</p>
          </section>

          <section className="dossier-sheet dossier-coordinate-grid">
            <DossierField label="LAT" value={storm.position.lat.toFixed(2)} />
            <DossierField label="LON" value={storm.position.lon.toFixed(2)} />
            <DossierField label="TRACK" value={storm.track.length} />
            <DossierField label="FCST" value={storm.forecast.length} />
          </section>

          <section className="dossier-sheet dossier-metric-ledger">
            {archiveRows.map((row) => (
              <div className={`dossier-ledger-row ${row.hot ? "is-hot" : ""}`} key={row.label}>
                <span>{row.label}</span>
                <strong>{row.value}</strong>
                {row.unit ? <small>{row.unit}</small> : null}
              </div>
            ))}
          </section>

          <DossierArchiveStack storm={storm} />
        </>
      ) : null}

      <div className="dossier-footer">
        <section className="dossier-sheet dossier-source">
          <Satellite size={16} />
          <div>
            <span>DATA SOURCE</span>
            <p>{source ?? UI.publicApi}</p>
          </div>
        </section>

        {storm ? (
          <section className="dossier-sheet dossier-notice">
            <AlertTriangle size={16} />
            <p>{storm.notice}</p>
          </section>
        ) : null}

        <Link className="dossier-history-link" href="/dex">
          <Database size={17} />
          {UI.viewDex}
        </Link>
      </div>
    </aside>
  );
}

function DossierArchiveStack({ storm }: { storm: Storm }) {
  const archivePoints = storm.track.slice(-8);
  const energy = calculateBossEnergy(storm).value;
  const latestPoint = archivePoints[archivePoints.length - 1] ?? storm.track[storm.track.length - 1];
  const firstPoint = storm.track[0];
  const distanceSample = firstPoint && latestPoint ? Math.round(distanceBetweenPoints(firstPoint, latestPoint)) : 0;

  return (
    <section className="dossier-archive-stack dossier-archive-stack-v2" aria-label={UI.historicalArchive}>
      <div className="archive-folder-stack" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <div className="archive-main-file dossier-sheet">
        <div className="archive-file-head">
          <div>
            <span>HISTORICAL DOSSIER</span>
            <strong>{storm.code}</strong>
          </div>
          <b>{storm.track.length}</b>
        </div>

        <div className="archive-index-strip" aria-hidden="true">
          <span>OBSERVATION LOG</span>
          <span>EVIDENCE CHAIN</span>
          <span>{storm.track.length} OBS</span>
        </div>

        <div className="archive-case-layout">
          <div className="archive-photo-plate" aria-hidden="true" style={{ "--archive-energy": `${energy}%` } as CSSProperties}>
            <span className="archive-cyclone-print" />
            <i>TRACE</i>
          </div>

          <div className="archive-case-meta">
            <span>{UI.targetFile}</span>
            <h2>{storm.nameZh}</h2>
            <p>{storm.stage} / {storm.rating}</p>
            <dl>
              <div>
                <dt>WIND</dt>
                <dd>{storm.maxWind || "--"} m/s</dd>
              </div>
              <div>
                <dt>PRESS</dt>
                <dd>{storm.minPressure || "--"} hPa</dd>
              </div>
              <div>
                <dt>HIST</dt>
                <dd>{storm.track.length} pts</dd>
              </div>
              <div>
                <dt>FCST</dt>
                <dd>{storm.forecast.length} pts</dd>
              </div>
            </dl>
          </div>
        </div>

        <div className="archive-route-summary" aria-label="route summary">
          <div>
            <span>{UI.firstRecord}</span>
            <strong>{firstPoint ? formatDossierDate(firstPoint.time) : "--"}</strong>
          </div>
          <div>
            <span>{UI.latestFix}</span>
            <strong>{latestPoint ? formatDossierDate(latestPoint.time) : "--"}</strong>
          </div>
          <div>
            <span>{UI.sampleSpan}</span>
            <strong>{distanceSample ? `${distanceSample} km` : "--"}</strong>
          </div>
        </div>

        <div className="archive-route-board" aria-label="historical route evidence">
          <div className="archive-route-board-head">
            <span>EVIDENCE TRACE</span>
            <b>{archivePoints.length} FIXES</b>
          </div>
          <ArchiveRouteTrace points={archivePoints} />
        </div>

        <div className="archive-timeline">
          {archivePoints.map((point, index) => {
            const previous = archivePoints[index - 1];
            const movement = previous ? Math.round(distanceBetweenPoints(previous, point)) : 0;
            const fixNumber = String(storm.track.length - archivePoints.length + index + 1).padStart(2, "0");
            return (
              <div className={`archive-event ${index === archivePoints.length - 1 ? "is-latest" : ""}`} key={`${point.time}-${index}`}>
                <i aria-hidden="true" />
                <span>
                  <em>FIX {fixNumber}</em>
                  {formatDossierDate(point.time)}
                </span>
                <b>{point.lat.toFixed(1)} / {point.lon.toFixed(1)}</b>
                <small>{point.wind || storm.maxWind || "--"} m/s</small>
                <strong>{movement ? `+${movement} km` : "ORIGIN"}</strong>
              </div>
            );
          })}
        </div>

        <div className="archive-file-foot">
          <span>LAST FIX</span>
          <strong>{latestPoint ? `${latestPoint.lat.toFixed(2)} / ${latestPoint.lon.toFixed(2)}` : "-- / --"}</strong>
          <em>{UI.confidential}</em>
        </div>
      </div>
    </section>
  );
}

function ArchiveRouteTrace({ points }: { points: Array<{ lat: number; lon: number; time?: string }> }) {
  const trace = buildArchiveRouteTrace(points);
  if (!trace) {
    return (
      <div className="archive-route-trace is-empty">
        <span>{UI.pending}</span>
      </div>
    );
  }

  return (
    <svg className="archive-route-trace" role="img" aria-label="historical route trace" viewBox="0 0 120 44" preserveAspectRatio="none">
      <polyline className="archive-route-line" points={trace.line} />
      {trace.points.map((point, index) => (
        <circle className={index === trace.points.length - 1 ? "is-latest" : ""} cx={point.x} cy={point.y} key={`${point.x}-${point.y}-${index}`} r={index === trace.points.length - 1 ? 3.4 : 2.2} />
      ))}
    </svg>
  );
}

function buildArchiveRouteTrace(points: Array<{ lat: number; lon: number }>) {
  if (points.length < 2) return null;
  const lats = points.map((point) => point.lat);
  const lons = points.map((point) => point.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const latSpan = Math.max(maxLat - minLat, 0.01);
  const lonSpan = Math.max(maxLon - minLon, 0.01);
  const projected = points.map((point) => ({
    x: 8 + ((point.lon - minLon) / lonSpan) * 104,
    y: 36 - ((point.lat - minLat) / latSpan) * 28
  }));
  return {
    points: projected,
    line: projected.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ")
  };
}

function DossierField({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="dossier-field">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatDossierDate(value?: string) {
  if (!value) return UI.pending;
  const date = new Date(value.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function distanceBetweenPoints(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const radiusKm = 6371;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return radiusKm * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function BossEnergyGauge({ storm, bossProfile }: { storm: Storm; bossProfile?: BossProfile | null }) {
  const energy = bossProfile ? { value: bossProfile.energy } : calculateBossEnergy(storm);
  return (
    <HudPanel as="section" className="energy-panel" aria-label={UI.energy}>
      <div className="energy-head">
        <div>
          <span>PUBLIC DATA ENERGY</span>
          <strong>{bossProfile ? bossProfile.phaseLabel : UI.energy}</strong>
        </div>
        <b>{energy.value}%</b>
      </div>
      <div className="energy-track" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={energy.value}>
        <i className="energy-fill" style={{ width: `${energy.value}%` }} />
        <BatteryCharging size={16} />
      </div>
      <p>
        {UI.dataBasis} {storm.maxWind || "--"} m/s / {UI.hpa} {storm.minPressure || "--"} hPa / {UI.r7} {storm.windRadiiKm.r7 || "--"} km
      </p>
    </HudPanel>
  );
}

function calculateBossEnergy(storm: Storm) {
  const windScore = clamp((storm.maxWind / 70) * 48, 0, 48);
  const pressureScore = clamp(((1010 - storm.minPressure) / 120) * 30, 0, 30);
  const radiusScore = clamp((storm.windRadiiKm.r7 / 650) * 22, 0, 22);
  return {
    value: Math.round(clamp(windScore + pressureScore + radiusScore, 0, 100))
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function convertLegacySkill(skill: Storm["skills"][number]): BossSkill {
  return {
    id: skill.name,
    name: skill.name,
    category: "wind",
    severity: skill.severity,
    confidence: 0.7,
    evidenceLevel: "confirmed",
    detail: skill.detail,
    evidence: []
  };
}

function chooseVisibleBossSkills(skills: BossSkill[]) {
  const visible: BossSkill[] = [];
  const pushUnique = (skill: BossSkill | undefined) => {
    if (skill && !visible.some((item) => item.id === skill.id)) visible.push(skill);
  };

  pushUnique(skills[0]);
  pushUnique(skills.find((skill) => skill.evidenceLevel === "confirmed" && skill.id !== skills[0]?.id));
  const nonConfirmed = [
    skills.find((skill) => skill.evidenceLevel === "inferred" && (skill.category === "rain" || skill.category === "environment")),
    skills.find((skill) => skill.evidenceLevel === "visualHint")
  ].filter((skill): skill is BossSkill => Boolean(skill));

  if (nonConfirmed.length >= 2) visible.splice(1, 1);
  for (const skill of nonConfirmed) pushUnique(skill);

  for (const skill of skills) {
    if (visible.length >= 3) break;
    pushUnique(skill);
  }

  return visible.slice(0, 3);
}

function SatelliteEvidenceBrief({ bossProfile }: { bossProfile: BossProfile }) {
  const satellite = bossProfile.satellite;
  const available = satellite.products.filter((product) => product.status === "available");
  const statusLabel =
    satellite.status === "available" ? "全产品可用" : satellite.status === "degraded" ? "部分可用" : "链路不可用";

  return (
    <HudPanel as="section" className="satellite-evidence-brief">
      <div>
        <Satellite size={16} />
        <span>HIMAWARI VISUAL HINT</span>
        <strong>{statusLabel}</strong>
      </div>
      <p>
        {satellite.status === "unavailable"
          ? satellite.warnings[0] ?? "卫星产品暂不可用。"
          : `${satellite.area.toUpperCase()} 区域：${available.map((product) => product.product.toUpperCase()).join(" / ")}。仅作卫星提示。`}
      </p>
    </HudPanel>
  );
}

function evidenceLabel(level: BossSkill["evidenceLevel"]) {
  if (level === "confirmed") return "实况确认";
  if (level === "inferred") return "模型推断";
  return "卫星提示";
}
