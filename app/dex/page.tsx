import Link from "next/link";
import { ArrowLeft, BadgeAlert, Search, Shield } from "lucide-react";
import { getDexEntries } from "@/lib/realTyphoonData";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DexPage() {
  const dexEntries = await loadDexEntries();
  const retired = dexEntries.filter((entry) => entry.retired).slice(0, 12);
  const normal = dexEntries.slice(0, 100);

  return (
    <main className="dex-page">
      <header className="dex-hero">
        <Link className="back-link" href="/">
          <ArrowLeft size={18} />
          返回雷达
        </Link>
        <div>
          <span className="eyebrow">历史台风档案</span>
          <h1>Boss 图鉴</h1>
          <p>
            这里收录公开台风路径接口中的历史个体，用统一的 Boss 等级、峰值强度和除名标记整理成档案。
          </p>
        </div>
        <div className="dex-search">
          <Search size={18} />
          <span>{normal.length} 个档案已载入</span>
        </div>
      </header>

      <section className="retired-hall hud-panel" aria-label="除名殿堂">
        <div className="section-title">
          <BadgeAlert size={20} />
          <span>除名殿堂</span>
        </div>
        <div className="retired-grid">
          {retired.length > 0 ? (
            retired.map((entry) => (
              <article className="retired-card" key={entry.id}>
                <span>{entry.year}</span>
                <strong>{entry.nameZh}</strong>
                <p>{entry.rating}</p>
                <small>替换名称：{entry.replacement ?? "待记录"}</small>
              </article>
            ))
          ) : (
            <p className="empty-copy">当前档案范围内暂未识别到已除名个体。</p>
          )}
        </div>
      </section>

      <section className="dex-grid" aria-label="历史台风图鉴">
        {normal.length > 0 ? (
          normal.map((entry) => (
            <article className={`dex-card ${entry.retired ? "retired" : ""}`} key={entry.id}>
              <div className="dex-card-head">
                <span>{entry.year}</span>
                <b>{entry.rating}</b>
              </div>
              <div className="mini-emblem" />
              <h2>{entry.nameZh}</h2>
              <p className="latin">{entry.nameEn}</p>
              <p>{entry.summary}</p>
              <div className="dex-stats">
                <span>{entry.stage}</span>
                <span>{entry.maxWind || "暂无"} 米/秒</span>
                <span>{entry.minPressure || "暂无"} 百帕</span>
              </div>
              <div className="tag-row">
                {entry.tags.slice(0, 3).map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            </article>
          ))
        ) : (
          <p className="empty-copy">图鉴接口暂时不可用，雷达稍后会重新请求公开台风路径数据。</p>
        )}
      </section>

      <footer className="dex-footer">
        <Shield size={18} />
        <span>图鉴来自公开台风路径接口整理；真实灾害记录和预警以官方机构发布为准。</span>
      </footer>
    </main>
  );
}

async function loadDexEntries() {
  try {
    return await getDexEntries(100);
  } catch {
    return [];
  }
}
