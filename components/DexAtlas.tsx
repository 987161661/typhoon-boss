"use client";

import Link from "next/link";
import { ArrowLeft, CalendarClock, ChevronRight, CircleDollarSign, Clock3, Crosshair, Gauge, MapPinned, ShieldAlert, Wind } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { DexEntry } from "@/lib/types";

type GdacsEvidence = NonNullable<DexEntry["impactData"]["gdacs"]>;

export default function DexAtlas({ entries }: { entries: DexEntry[] }) {
  const grouped = useMemo(() => {
    const groups = new Map<number, DexEntry[]>();
    entries.forEach((entry) => groups.set(entry.year, [...(groups.get(entry.year) ?? []), entry]));
    return [...groups.entries()].sort(([a], [b]) => b - a);
  }, [entries]);
  const [year, setYear] = useState(grouped[0]?.[0] ?? new Date().getFullYear());
  const yearEntries = grouped.find(([value]) => value === year)?.[1] ?? [];
  const [selectedId, setSelectedId] = useState(yearEntries[0]?.id ?? "");
  const selectedSummary = yearEntries.find((entry) => entry.id === selectedId) ?? yearEntries[0];
  const [selectedDetail, setSelectedDetail] = useState<DexEntry | null>(null);
  const selected = selectedDetail?.id === selectedSummary?.id ? selectedDetail : selectedSummary;
  const [gdacs, setGdacs] = useState<GdacsEvidence | null>(null);
  useEffect(() => { setSelectedId(grouped.find(([value]) => value === year)?.[1][0]?.id ?? ""); }, [year, grouped]);
  useEffect(() => {
    if (!selectedSummary?.id) { setSelectedDetail(null); return; }
    let live = true;
    setSelectedDetail(null);
    fetch(`/api/dex/${encodeURIComponent(selectedSummary.id)}`, { cache: "force-cache" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => { if (live) setSelectedDetail(payload?.entry ?? null); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [selectedSummary?.id]);
  useEffect(() => {
    if (!selected?.nameEn || !selected.lifecycle.startedAt) { setGdacs(null); return; }
    const query = new URLSearchParams({ name: selected.nameEn, startedAt: selected.lifecycle.startedAt, ...(selected.lifecycle.endedAt ? { endedAt: selected.lifecycle.endedAt } : {}) });
    let live = true; setGdacs(null);
    fetch(`/api/dex/evidence?${query}`, { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((payload) => { if (live) setGdacs(payload?.gdacs ?? null); }).catch(() => { if (live) setGdacs(null); });
    return () => { live = false; };
  }, [selected?.id, selected?.nameEn, selected?.lifecycle.startedAt, selected?.lifecycle.endedAt]);
  if (!selected) return <main className="atlas-empty">公开台风档案暂时无法载入，请稍后重试。</main>;

  return <main className="boss-atlas">
    <header className="atlas-topbar"><Link href="/" className="atlas-back"><ArrowLeft size={17} /> 返回雷达</Link><div><span>TYHOON BOSS ARCHIVE</span><strong>台风 Boss 图鉴</strong></div><p>红色路径、风圈和登陆节点均来自公开路径档案；灾损只展示可核验官方来源。</p></header>
    <div className="atlas-layout"><aside className="atlas-sidebar" aria-label="按年份浏览"><div className="atlas-rail-title"><span>ARCHIVE / 年份</span><b>{grouped.length} 年</b></div><nav className="atlas-years">{grouped.map(([value, list]) => <button className={value === year ? "active" : ""} key={value} onClick={() => setYear(value)}><strong>{value}</strong><span>{list.length} 个个体<ChevronRight size={15} /></span></button>)}</nav><section className="atlas-storm-list" aria-label={`${year} 年台风列表`}><div className="atlas-rail-title"><span>{year} / 出现个体</span><b>{yearEntries.length}</b></div>{yearEntries.map((entry) => <button className={entry.id === selected.id ? "active" : ""} onClick={() => setSelectedId(entry.id)} key={entry.id}><i className={entry.retired ? "retired" : ""} /><span><b>{entry.nameZh}</b><small>{entry.nameEn || "UNNAMED"}</small></span></button>)}</section></aside>
      <section className="atlas-detail" aria-live="polite"><AtlasRouteMap entry={selected} /><div className="atlas-detail-body"><div className="atlas-identity"><div className="atlas-mark"><Wind /></div><div><span>NO. {selected.id} · {selected.retired ? "除名档案" : "已收录个体"}</span><h1>{selected.nameZh}</h1><p>{selected.nameEn}</p></div><b>{selected.rating}</b></div>
        <div className="atlas-stat-grid"><Stat icon={<Gauge />} label="最大风力" value={selected.maxWind ? `${selected.maxWind} m/s` : "待补全"} note={selected.stage} /><Stat icon={<Crosshair />} label="最低气压" value={selected.minPressure ? `${selected.minPressure} hPa` : "待补全"} note="强度档案峰值" /><Stat icon={<MapPinned />} label="形态阶段" value={selected.stage} note="公开路径记录" /><Stat icon={<ShieldAlert />} label="图鉴状态" value={selected.retired ? "已除名" : "常规名录"} note={selected.replacement ? `替补名：${selected.replacement}` : "名称仍在名录中"} /></div>
        <section className="atlas-fact-deck" aria-label="台风生命记录"><Fact icon={<MapPinned />} label="出生坐标" value={coordinate(selected.lifecycle.origin)} note={selected.lifecycle.origin ? `首个公开路径点 · ${formatTime(selected.lifecycle.origin.time)}` : "路径档案未提供"} /><Fact icon={<CalendarClock />} label="出生时间" value={formatTime(selected.lifecycle.startedAt)} note="公开路径档案" /><Fact icon={<Clock3 />} label="存在时间" value={formatDuration(selected.lifecycle.durationHours)} note={selected.lifecycle.endedAt ? `终止记录 · ${formatTime(selected.lifecycle.endedAt)}` : "仍在活动或终止时次未收录"} /><Fact icon={<Wind />} label="出生原因" value={selected.impactData.formationCause ?? "未接入可靠诊断"} note="不以推测性气象成因替代证据" /><Fact icon={<ShieldAlert />} label="影响时段" value={gdacs?.from && gdacs?.to ? `GDACS ${gdacs.from.slice(0, 10)} 至 ${gdacs.to.slice(0, 10)}` : selected.impactData.affectedWindow ?? "未有登陆记录"} note={gdacs?.countries.length ? gdacs.countries.join("；") : selected.landfalls.length ? selected.landfalls.map((item) => item.place).join("；") : "路径档案未记录登陆点"} /><Fact icon={<CircleDollarSign />} label="直接经济损失" value={selected.impactData.directEconomicLoss ?? "待官方灾情报告"} note="不将估算值或媒体转述写入图鉴" /></section>
        <section className="atlas-landfall-log"><span>IMPACT LOG / 登陆与影响节点</span>{gdacs && <div className="atlas-gdacs-evidence"><i /><b>GDACS {gdacs.alertLevel} ALERT</b><strong>{gdacs.countries.join(" · ") || "未列出影响国家/地区"}</strong><small>{gdacs.severity} · <a href={gdacs.sourceUrl} target="_blank" rel="noreferrer">查看 GDACS 事件证据</a></small></div>}{selected.landfalls.length ? selected.landfalls.map((item) => <div key={`${item.time}-${item.place}`}><i /><b>{formatTime(item.time)}</b><strong>{item.place}</strong><small>{item.note ?? "公开路径接口记录"}</small></div>) : <p>当前公开路径档案未收录登陆节点；上方红色范围仅表示已记录的七级风圈最大半径。</p>}</section>
        <div className="atlas-lore"><span>ENCOUNTER LOG / 遭遇记录</span><p>{selected.summary}</p><p className="game-copy">{gameCopy(selected)}</p></div><div className="atlas-tags">{selected.tags.map((tag) => <span key={tag}>{tag}</span>)}</div></div></section></div>
  </main>;
}

function AtlasRouteMap({ entry }: { entry: DexEntry }) {
  const [land, setLand] = useState<GeoJSON.FeatureCollection | null>(null);
  useEffect(() => { fetch("/data/ne_110m_land.geojson").then((r) => r.ok ? r.json() : null).then(setLand).catch(() => setLand(null)); }, []);
  const points = entry.track.map(project); const route = points.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const start = points[0]; const end = points.at(-1);
  const frame = trackViewBox(entry.track);
  const uiScale = frame.uiScale;
  return <section className="atlas-route-map" aria-label="世界路径与影响范围图"><svg viewBox={frame.viewBox} role="img" aria-label={`${entry.nameZh} 从出生到终止的公开路径与七级风圈范围`}><defs><pattern id="atlas-grid" width="83.333" height="55.556" patternUnits="userSpaceOnUse"><path d="M 83.333 0 L 0 0 0 55.556" fill="none" stroke="rgba(175,214,203,.14)" strokeWidth="1" /></pattern><filter id="route-glow"><feGaussianBlur stdDeviation={3 * uiScale} result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs><rect x="-80" y="-80" width="1160" height="660" fill="url(#atlas-grid)" />{land?.features.map((feature, i) => <path key={i} d={geoPath(feature.geometry)} className="atlas-world-land" style={{ strokeWidth: 1.1 * uiScale }} />)}{points.map((p, i) => entry.track[i].windRadiusKm > 0 ? <circle key={`range-${i}`} cx={p.x} cy={p.y} r={radiusPx(entry.track[i].windRadiusKm, entry.track[i].lat)} className="atlas-impact-range" style={{ strokeWidth: 1.2 * uiScale }} /> : null)}{route && <><path d={route} className="atlas-route-glow" filter="url(#route-glow)" style={{ strokeWidth: 8 * uiScale }} /><path d={route} className="atlas-route-line" style={{ strokeWidth: 2.5 * uiScale, strokeDasharray: `${7 * uiScale} ${5 * uiScale}` }} /></>}{start && <g className="atlas-route-start"><circle cx={start.x} cy={start.y} r={8 * uiScale} style={{ strokeWidth: 2 * uiScale }} /><text x={start.x + 12 * uiScale} y={start.y - 12 * uiScale} style={labelStyle(uiScale)}>SPAWN</text></g>}{end && <g className="atlas-route-end"><circle cx={end.x} cy={end.y} r={7 * uiScale} style={{ strokeWidth: 2 * uiScale }} /><text x={end.x + 12 * uiScale} y={end.y + 20 * uiScale} style={labelStyle(uiScale)}>END</text></g>}{entry.landfalls.map((item) => { const p = project(item); return <g className="atlas-landfall-pin" key={`${item.time}-${item.place}`} transform={`translate(${p.x} ${p.y}) scale(${uiScale})`}><path d="M 0 -9 l 7 9 -7 9 -7 -9 z" /><text x="11" y="4" style={labelStyle(1)}>LAND</text></g>; })}</svg><div className="atlas-route-caption"><span><i /> WORLD TRACK / 自动取景 · 红色为公开路径与七级风圈记录</span><strong>{entry.nameZh} · 出生 → 消亡</strong><small>路径点：{entry.track.length} · 登陆节点：{entry.landfalls.length} · 风圈并非灾损范围</small></div></section>;
}

function Stat({ icon, label, value, note }: { icon: ReactNode; label: string; value: string; note: string }) { return <article><span>{icon}{label}</span><strong>{value}</strong><small>{note}</small></article>; }
function Fact({ icon, label, value, note }: { icon: ReactNode; label: string; value: string; note: string }) { return <article><span>{icon}{label}</span><strong>{value}</strong><small>{note}</small></article>; }
function formatTime(value: string | null | undefined) { return value ? value.replace("T", " ").slice(0, 16) : "未收录"; }
function formatDuration(value: number | null) { return value === null ? "未收录" : value < 24 ? `${value} 小时` : `${Math.floor(value / 24)} 天 ${value % 24} 小时`; }
function coordinate(point: DexEntry["lifecycle"]["origin"]) { return point ? `${point.lat.toFixed(1)}°N, ${point.lon.toFixed(1)}°E` : "未收录"; }
function gameCopy(entry: DexEntry) { return `${entry.nameZh} 的战斗标签是「${entry.stage}」。峰值强度记录为${entry.maxWind ? `${entry.maxWind} m/s` : "待补全"}；这不是战力预测，而是一份把公开观测转译成 Boss 档案的遭遇笔记。`; }
function project(point: { lon: number; lat: number }) { return { x: ((point.lon + 180) / 360) * 1000, y: ((90 - point.lat) / 180) * 500 }; }
function radiusPx(radiusKm: number, lat: number) { return Math.max(4, Math.min(42, (radiusKm / 111) * (1000 / 360) / Math.max(.5, Math.cos((lat * Math.PI) / 180)))); }
function trackViewBox(track: DexEntry["track"]) {
  if (!track.length) return { viewBox: "0 0 1000 500", uiScale: 1 };
  const projected = track.map((point) => ({ ...project(point), radius: radiusPx(point.windRadiusKm, point.lat) }));
  let left = Math.min(...projected.map((point) => point.x - point.radius)); let right = Math.max(...projected.map((point) => point.x + point.radius));
  let top = Math.min(...projected.map((point) => point.y - point.radius)); let bottom = Math.max(...projected.map((point) => point.y + point.radius));
  const pad = Math.max(10, Math.max(right - left, bottom - top) * .2); left -= pad; right += pad; top -= pad; bottom += pad;
  const centerX = (left + right) / 2; const centerY = (top + bottom) / 2; let width = Math.max(72, right - left); let height = Math.max(36, bottom - top);
  if (width / height < 2) width = height * 2; else height = width / 2;
  width = Math.min(1000, width); height = Math.min(500, height);
  const x = Math.max(0, Math.min(1000 - width, centerX - width / 2)); const y = Math.max(0, Math.min(500 - height, centerY - height / 2));
  return { viewBox: `${x.toFixed(1)} ${y.toFixed(1)} ${width.toFixed(1)} ${height.toFixed(1)}`, uiScale: Math.min(width / 1000, height / 500) };
}
function labelStyle(scale: number) { return { fontSize: `${10 * scale}px`, strokeWidth: `${Math.max(.35, 4 * scale)}px` }; }
function geoPath(geometry: GeoJSON.Geometry): string { const rings = geometry.type === "Polygon" ? geometry.coordinates : geometry.type === "MultiPolygon" ? geometry.coordinates.flat() : []; return rings.map((ring) => ring.map((coord, i) => { const p = project({ lon: coord[0], lat: coord[1] }); return `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`; }).join(" ") + " Z").join(" "); }
