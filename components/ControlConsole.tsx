"use client";
import Link from "next/link";
import { Activity, ArrowLeft, Bot, Database, Eye, Map, Plus, RefreshCw, Save, ShieldCheck, Trash2, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

type Settings = any;
const sections = [
  ["models", "模型路由", Bot], ["sources", "数据源路由", Database], ["automation", "自动化任务", Activity], ["map", "地图与画面", Map], ["reliability", "可靠性与安全", ShieldCheck], ["audience", "观众权限", Users]
] as const;

export function ControlConsole() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [active, setActive] = useState<(typeof sections)[number][0]>("models");
  const [saving, setSaving] = useState(false);
  const [audienceReloadToken, setAudienceReloadToken] = useState(0);
  const [message, setMessage] = useState("正在读取当前有效配置…");
  const [secretDraft, setSecretDraft] = useState<Record<string, string>>({});
  const selected = useMemo(() => sections.find(([id]) => id === active)!, [active]);

  useEffect(() => { void load(); }, []);
  async function load() {
    const response = await fetch("/api/control-console", { cache: "no-store" });
    const payload = await response.json();
    setSettings(payload.settings); setMessage(response.ok ? "当前运行配置已载入；密钥仅由服务端环境变量管理。" : payload.error);
  }
  function patch(path: string, value: unknown) {
    setSettings((current: Settings) => { const next = structuredClone(current); let target = next; const keys = path.split("."); for (const key of keys.slice(0, -1)) target = target[key]; target[keys.at(-1)!] = value; return next; });
  }
  async function save() {
    if (!settings) return; setSaving(true); setMessage("正在安全保存覆盖项…");
    const payload = structuredClone(settings);
    for (const [route, key] of Object.entries(secretDraft)) if (key.trim()) payload.routes[route].apiKey = key.trim();
    for (const route of Object.values(payload.routes) as any[]) { delete route.apiKeyState; if (!route.apiKey) delete route.apiKey; }
    const response = await fetch("/api/control-console", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const result = await response.json(); setSaving(false);
    if (response.ok) { setSettings(result.settings); setSecretDraft({}); setMessage("已保存。未显式覆盖的值仍继承当前环境变量。"); } else setMessage(result.error || "保存失败");
  }
  if (!settings) return <main className="console-shell"><p className="console-loading">正在连接控制台…</p></main>;
  const title = selected[1];
  const Icon = selected[2];
  return <main className="console-shell">
    <header className="console-topbar"><Link href="/" className="console-back"><ArrowLeft size={16}/> 返回雷达</Link><div><span>TYHOON BOSS / OPS</span><strong>雷达控制台</strong></div><button onClick={() => active === "audience" ? setAudienceReloadToken((value) => value + 1) : void load()} className="console-quiet"><RefreshCw size={15}/> 重新读取</button></header>
    <aside className="console-nav">{sections.map(([id, label, SectionIcon]) => <button key={id} className={active === id ? "active" : ""} onClick={() => setActive(id)}><SectionIcon size={17}/><span>{label}</span></button>)}<div className="console-nav-note"><Eye size={15}/><span>密钥从不回传到浏览器；只显示配置状态。</span></div></aside>
    <section className="console-workspace"><header className="console-section-title"><Icon size={21}/><div><span>CONTROL PLANE</span><h1>{title}</h1></div></header>
      {active === "models" && <ModelRoutes settings={settings} patch={patch} secrets={secretDraft} setSecrets={setSecretDraft}/>}
      {active === "sources" && <SourceRoutes settings={settings} patch={patch}/>}
      {active === "automation" && <Automation settings={settings} patch={patch}/>}
      {active === "map" && <MapSettings settings={settings} patch={patch}/>}
      {active === "reliability" && <Reliability settings={settings} patch={patch}/>}
      {active === "audience" && <AudienceAccess reloadToken={audienceReloadToken}/>}
    </section>
    <footer className="console-footer"><p>{active === "audience" ? "观众权限独立保存在 runtime 白名单中，不会写入通用直播设置。" : message}</p>{active !== "audience" && <button className="console-save" onClick={() => void save()} disabled={saving}><Save size={16}/>{saving ? "保存中" : "保存并应用"}</button>}</footer>
  </main>;
}

function Field({ label, value, onChange, hint, type = "text" }: any) { return <label className="console-field"><span>{label}</span><input type={type} value={value ?? ""} onChange={(event) => onChange(type === "number" ? Number(event.target.value) : event.target.value)} />{hint && <small>{hint}</small>}</label>; }
function Toggle({ label, detail, value, onChange }: any) { return <label className="console-toggle"><span><b>{label}</b><small>{detail}</small></span><input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)}/><i/></label>; }
function ModelRoutes({ settings, patch, secrets, setSecrets }: any) { const key = "documentAgent"; const route = settings.routes[key]; return <div className="console-stack"><article className="route-card"><header><div><b>文档整理 LLM</b><small>用于台风演进分析任务；数字人 LLM 与 TTS 由外部凌岚运行时管理。</small></div><em>{route.apiKeyState?.configured ? `密钥已配置 ${route.apiKeyState.hint}` : "未单独配置"}</em></header><div className="console-grid three"><Field label="API Base URL" value={route.endpoint} onChange={(v:any) => patch(`routes.${key}.endpoint`, v)} /><Field label="模型" value={route.model} onChange={(v:any) => patch(`routes.${key}.model`, v)} /><Field label="超时（秒）" type="number" value={route.timeoutSeconds} onChange={(v:any) => patch(`routes.${key}.timeoutSeconds`, v)} /></div><Field label="替换 API Key（可选）" type="password" value={secrets[key] ?? ""} onChange={(v:any) => setSecrets((x:any) => ({...x, [key]: v}))} hint="留空即保留当前密钥或环境变量，不会清空现有配置。" /></article><p className="console-callout">本项目不直接请求数字人 TTS 或 LLM；凌岚服务的模型配置请在其自身运行时管理。</p></div>; }
function SourceRoutes({ settings, patch }: any) { return <div className="console-stack"><article className="route-card"><header><div><b>路径与实况</b><small>当前雷达使用的公开台风路径入口</small></div></header><Field label="台风路径 API Base URL" value={settings.dataSources.typhoonTrackBaseUrl} onChange={(v:any) => patch("dataSources.typhoonTrackBaseUrl", v)} /></article><p className="console-callout">仅展示会被当前运行链路读取的来源设置。官方预警与 Boss 解释层仍保持分离。</p></div>; }
function Automation({ settings, patch }: any) { const a = settings.automation; return <div className="console-stack"><article className="route-card"><Toggle label="台风演进自动整理" detail="定时读取公开实况并生成分析文档。" value={a.evolutionEnabled} onChange={(v:any) => patch("automation.evolutionEnabled", v)} /><div className="console-grid two"><Field label="运行间隔（分钟）" type="number" value={a.intervalMinutes} onChange={(v:any) => patch("automation.intervalMinutes", v)} /><Field label="失败重试次数" type="number" value={a.retryCount} onChange={(v:any) => patch("automation.retryCount", v)} /></div></article><p className="console-callout">关闭自动化不会删除已有演进报告；手动运行脚本仍可使用。</p></div>; }
function MapSettings({ settings, patch }: any) { const map = settings.map; return <div className="console-stack"><article className="route-card"><div className="console-grid two"><label className="console-field"><span>首页默认主题</span><select value={map.defaultTheme} onChange={(e) => patch("map.defaultTheme", e.target.value)}><option value="night-radar">夜间雷达</option><option value="archive-command">档案指挥</option></select></label><label className="console-field"><span>渲染档位</span><select value={map.performanceMode} onChange={(e) => patch("map.performanceMode", e.target.value)}><option value="full">完整效果</option><option value="reduced">低性能模式</option></select></label></div><Toggle label="默认显示卫星云图" detail="只影响首次进入首页的图层状态。" value={map.defaultLayers.satellite} onChange={(v:any) => patch("map.defaultLayers.satellite", v)} /><Toggle label="默认显示影响区" detail="基于已获取风圈半径生成。" value={map.defaultLayers.impact} onChange={(v:any) => patch("map.defaultLayers.impact", v)} /><Toggle label="默认显示风场" detail="低性能模式下建议关闭。" value={map.defaultLayers.wind} onChange={(v:any) => patch("map.defaultLayers.wind", v)} /></article></div>; }
function Reliability({ settings, patch }: any) { const r = settings.reliability; return <div className="console-stack"><article className="route-card"><div className="console-grid two"><Field label="外部请求超时（秒）" type="number" value={r.requestTimeoutSeconds} onChange={(v:any) => patch("reliability.requestTimeoutSeconds", v)} /><Field label="最近有效数据保留（小时）" type="number" value={r.retainLastGoodDataHours} onChange={(v:any) => patch("reliability.retainLastGoodDataHours", v)} /></div></article><p className="console-callout">本地覆盖配置保存在 <code>.runtime/control-console.json</code>，已被 Git 忽略。环境变量继续作为无配置时的安全回退。</p></div>; }

type AudienceEntry = { platform: string; viewerId: string; note: string; createdAt: string; updatedAt: string };
type FragmentPoolStatus = { canon: "ready" | "sealed"; available: number; targetSize: number; refillAt: number; refill: "idle" | "running" | "sealed" };

function AudienceAccess({ reloadToken }: { reloadToken: number }) {
  const [entries, setEntries] = useState<AudienceEntry[]>([]);
  const [fragmentPool, setFragmentPool] = useState<FragmentPoolStatus | null>(null);
  const [platform, setPlatform] = useState("");
  const [viewerId, setViewerId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("正在读取独立白名单…");

  const loadAccess = useCallback(async () => {
    try {
      const [response, poolResponse] = await Promise.all([
        fetch("/api/city-audience-access", { cache: "no-store" }),
        fetch("/api/world-fragments", { cache: "no-store" })
      ]);
      const [payload, poolPayload] = await Promise.all([
        response.json() as Promise<{ entries?: AudienceEntry[]; error?: string }>,
        poolResponse.json() as Promise<FragmentPoolStatus>
      ]);
      if (!response.ok) throw new Error(payload.error || "读取观众权限失败");
      if (!poolResponse.ok) throw new Error("读取档案语料池状态失败");
      setEntries(payload.entries ?? []);
      setFragmentPool(poolPayload);
      setStatus(`已载入 ${payload.entries?.length ?? 0} 条精确身份记录。`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "读取观众权限失败");
    }
  }, []);

  useEffect(() => { void loadAccess(); }, [loadAccess, reloadToken]);

  async function addEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch("/api/city-audience-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, viewerId, note })
      });
      const payload = await response.json() as { entry?: AudienceEntry; error?: string };
      if (!response.ok) throw new Error(payload.error || "新增观众权限失败");
      setPlatform(""); setViewerId(""); setNote("");
      await loadAccess();
      setStatus(`已加入 ${payload.entry?.platform}:${payload.entry?.viewerId}。`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "新增观众权限失败");
    } finally {
      setBusy(false);
    }
  }

  async function removeEntry(entry: AudienceEntry) {
    setBusy(true);
    try {
      const response = await fetch("/api/city-audience-access", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: entry.platform, viewerId: entry.viewerId })
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "删除观众权限失败");
      await loadAccess();
      setStatus(`已删除 ${entry.platform}:${entry.viewerId}。`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "删除观众权限失败");
    } finally {
      setBusy(false);
    }
  }

  return <div className="console-stack console-audience-access">
    <article className="route-card">
      <header><div><b>观测回声档案运行状态</b><small>只显示池状态；碎片领取仍必须经过精确观众权限校验。</small></div><em>{fragmentPool?.canon === "ready" ? "CANON READY" : "CANON SEALED"}</em></header>
      <div className="console-grid three">
        <div className="console-callout"><strong>{fragmentPool?.available ?? "—"}</strong><br/>可领取碎片</div>
        <div className="console-callout"><strong>{fragmentPool?.targetSize ?? 50}</strong><br/>开播目标库存</div>
        <div className="console-callout"><strong>{fragmentPool?.refill === "running" ? "补充中" : fragmentPool?.refill === "sealed" ? "已封存" : "待命"}</strong><br/>低于 {fragmentPool?.refillAt ?? 10} 自动补充</div>
      </div>
    </article>
    <form className="route-card" onSubmit={(event) => void addEntry(event)}>
      <header><div><b>历史关注白名单</b><small>只使用 platform + viewerId 精确匹配；viewerId 区分大小写，绝不按昵称匹配。</small></div></header>
      <div className="console-grid three console-audience-form">
        <label className="console-field"><span>Platform</span><input required maxLength={32} value={platform} onChange={(event) => setPlatform(event.target.value)} placeholder="例如 bilibili" /></label>
        <label className="console-field"><span>Viewer ID</span><input required maxLength={128} value={viewerId} onChange={(event) => setViewerId(event.target.value)} placeholder="平台稳定用户 ID" /></label>
        <label className="console-field"><span>备注</span><input maxLength={200} value={note} onChange={(event) => setNote(event.target.value)} placeholder="可选，不能用于匹配" /></label>
      </div>
      <button className="console-save console-audience-add" type="submit" disabled={busy}><Plus size={16}/>{busy ? "处理中" : "加入白名单"}</button>
    </form>
    <p className="console-callout"><strong>未知不等于未关注。</strong> 当平台没有提供可验证的关注状态，且该精确 ID 不在白名单时，只能标记为 unknown，不能推断观众未关注。</p>
    <article className="route-card console-audience-table-card">
      <header><div><b>精确身份记录</b><small>{status}</small></div><em>{entries.length} 条</em></header>
      <div className="console-audience-table-wrap">
        <table className="console-audience-table">
          <thead><tr><th>Platform</th><th>Viewer ID</th><th>备注</th><th>加入时间</th><th>操作</th></tr></thead>
          <tbody>{entries.length === 0
            ? <tr><td colSpan={5} className="console-audience-empty">暂无白名单记录</td></tr>
            : entries.map((entry) => <tr key={`${entry.platform}\u0000${entry.viewerId}`}><td>{entry.platform}</td><td><code>{entry.viewerId}</code></td><td>{entry.note || "—"}</td><td>{formatAudienceTime(entry.createdAt)}</td><td><button type="button" className="console-audience-delete" disabled={busy} onClick={() => void removeEntry(entry)} aria-label={`删除 ${entry.platform} ${entry.viewerId}`}><Trash2 size={14}/> 删除</button></td></tr>)}</tbody>
        </table>
      </div>
    </article>
  </div>;
}

function formatAudienceTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}
