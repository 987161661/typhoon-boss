# Boss 图鉴页面：项目审计

## 结论

现有项目可以在不重写雷达主页的前提下完成“年份 → 当年台风 → 单个 Boss 档案”的三段式图鉴。当前 `/dex` 是服务端一次性卡片网格，尚不具备选中态、逐年索引或详情态；最小可行路径是将其改为由一个客户端图鉴壳组件驱动的主从布局，并扩展图鉴数据读取的颗粒度。

## 技术与现有页面

- Next.js 15 App Router、React 19、TypeScript；全局样式在 `app/globals.css`，图标来自 `lucide-react`。
- 路由 `app/dex/page.tsx` 当前直接调用 `getDexEntries(100)`，展示除名殿堂和四列 `dex-card` 网格；它是本次重构的唯一页面入口。
- 既有图鉴样式集中在 `app/globals.css` 的 `.dex-*`、`.retired-*` 规则（约 4895 行起）。这些规则可替换为图鉴三栏/两栏布局；不要影响主页的 `.dex-link`。
- 主页的 `components/IntelPanel.tsx` 已有可复用的游戏化度量语言（中心最大风力、气压、风圈、移动方向/速度），但其数据类型是活动台风 `Storm`，不可直接替换历史图鉴详情。
- 现有 `ui-rebuild/` 已包含本轮工作所需的共享制品（brief、tokens、component map、assets、QA 等）。本审计只新增本文件。

## 数据地图与可用字段

| 需求 | 当前来源 | 是否满足 | 说明 |
| --- | --- | --- | --- |
| 年份列表 | `getDexEntries()` 内部构造 2010 至当前年 | 部分 | 年份没有作为 UI/接口字段单独输出；可由 entries 分组，但当前 100 条截断会漏掉较早年份。 |
| 当年台风列表 | 浙江省水利厅 `TyphoonList/{year}` | 是 | 有 `tfid`、中英文名、起止时间、`isactive`、预警级别；接口在 2026-07-10 实测 2026/2025/2024 分别返回 11/30/27 条。 |
| 峰值风速、最低气压、等级 | `TyphoonInfo/{tfid}.points[]` → `convertDexEntry()` | 是 | 已按峰值点计算 `maxWind`/`stage`/`rating`，按最低压点计算 `minPressure`。 |
| 路径、风圈、移动等详细档案 | `TyphoonInfo/{tfid}.points[]` | 原始数据有，图鉴 DTO 未输出 | `DexEntry` 只保留峰值汇总。详情页/抽屉应扩充为 `DexDetail`，或复用单独的按 id 转换器。 |
| 真实卫星影像 | NOAA OSPO/JMA Himawari 当前帧；JMA Himawari 产品探测 | 仅当前影像 | `getSatelliteLayer()` 是当前同步区域云图；`getHimawariProductsForStorm()` 只从 `getCurrentStorms()` 选择活动台风。不能把它标为某一历史台风的真实影像。 |

## 推荐组件与写入集合

1. 保留 `app/dex/page.tsx` 作为服务端加载入口；传入完整或按年预加载的数据，并新增 `components/BossDexExplorer.tsx`（客户端）持有 `selectedYear`、`selectedStormId`、年份展开状态和移动端抽屉状态。
2. 在该组件内以三个可组合区块渲染：`DexYearNav`（左侧年份）、`DexStormList`（当年个体列表）、`DexBossDossier`（右侧主档案）。不要为每一年手写组件。
3. 在 `lib/types.ts` 新增 `DexDetail`（基于单一 `tfid` 的完整路径、峰值记录、风圈/移动数据、起止时间和游戏化文案所需字段）；在 `lib/realTyphoonData.ts` 增加按年列表和按 id 详情的导出函数。保持 `getDexEntries()` 给现有 API 的兼容性。
4. 扩展 `app/api/dex/route.ts`，支持 `year` 和 `stormId` 查询参数，避免加载全量路径详情；或新增受限的 `app/api/dex/[stormId]/route.ts`。两者都要沿用 `no-store`。
5. 在 `app/globals.css` 新增独立 `.boss-dex-*` 作用域。右侧顶部是明确标注时间、来源和产品名的影像舞台；下方是“档案参数 / Boss 特性 / 行动轨迹 / 战斗简报”而非新闻复述。

预期产品源写集：`app/dex/page.tsx`、`components/BossDexExplorer.tsx`（新增）、`lib/types.ts`、`lib/realTyphoonData.ts`、`app/api/dex/route.ts`（或新增详情路由）、`app/globals.css`。不需要改动 `TyphoonMap.tsx`、实时 Boss 引擎或地图路由。

## 影像策略与风险

- “真实影像”必须分两种状态展示：活动台风可显示带来源/时次/产品标识的实时 Himawari 云图；历史台风没有本仓库已接入的、按 `tfid` 可验证的卫星档案，必须显示“历史影像档案待接入”的资料位或视觉化路径图，不能复用今天的云图冒充历史照片。
- 当前 JMA `himawari-products` API 在无活动台风时返回 unavailable；而且按当前活动台风自动选区，不能作为历史条目详情接口。
- `/api/dex` 和页面均固定 `limit=100`。年份导航若要承诺“2010—至今”，先移除截断或改为用户选年后只抓该年；全量逐个详情请求会产生较多外部访问，按年延迟加载更稳。
- 台风编号存在不规则形式（如热带低压编号），年份归属应优先使用 `starttime`，`tfid.slice(0,4)` 仅作回退；当前实现反过来优先 tfid，建议在重构时纠正。
- 游戏化只用于表达：绝不把游戏等级、技能描述、影像解读当官方预警或事实结论。页面必须保留现有官方预警免责声明和数据源/时次。

## 验证

- `cmd /c npm run typecheck`
- `cmd /c npm run build`
- 浏览器：桌面 1440px 与移动 390px，依次验证切换年份、选择台风、无影像历史态、活动影像态、键盘焦点和数据加载失败态。
- 接口：`/api/dex?year=2026`、单条详情接口（若新增）均应返回 `Cache-Control: no-store, max-age=0`。

## 交接

实施方先决定详情接口形态；推荐“按年列表 + 按 id 详情”以避免全量历史点位请求，再以 `BossDexExplorer` 为唯一状态所有者实施布局。
