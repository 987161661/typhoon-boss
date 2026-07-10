# Boss 图鉴详情数据审计

审计时间：2026-07-10  
范围：右侧世界路径图、出生/消亡/影响档案、游戏化详情卡。  
结论：路径、强度、风圈、起止和登陆可由现有浙江省水利厅公开接口稳定生成；“出生原因”“影响时间”“直接经济损失”必须逐条接入可追溯的官方灾情/业务报告，缺证据时宁可显示“未收录”，不能由路径或大模型补写。

## 已核验的现有机器可读数据

当前项目使用：

- `https://typhoon.slt.zj.gov.cn/Api/TyphoonList/{year}`
- `https://typhoon.slt.zj.gov.cn/Api/TyphoonInfo/{tfid}`

以 2025 年第 1 号台风“蝴蝶”（`202501`）和 2026 年接口返回样本复核，`TyphoonInfo` 包含：

| 图鉴字段 | 原始字段 | 可用性与展示边界 |
|---|---|---|
| 出生/首报时间 | `starttime` | 可作为“纳入公开路径档案时间”；不要写成未经确认的热带扰动物理生成时刻。 |
| 出生坐标 | `points` 的首个有效点 `time/lng/lat` | 标为“首报中心位置”。若首点时间与 `starttime` 不一致，保留两者并优先显示 `starttime`。 |
| 消亡/停止时间 | `endtime` | 可作为“档案结束/停止编号时间”；不等同于所有天气影响结束。 |
| 存在时间 | `endtime - starttime` | 以小时计算，跨时区不要使用浏览器本地时区；接口时间按中国业务时次原样显示。 |
| 实况路径 | `points[].time/lng/lat` | 可画从首报到最后实况点的红色中心路径。绝不能混入嵌套 `forecast` 预报点。 |
| 各时次强度 | `points[].strong/power/speed/pressure` | 可求全程最大风速和最低气压；标签必须写“公开路径记录峰值”。 |
| 风圈 | `points[].radius7/radius10/radius12` | 字段为以 `|` 分隔的多值风圈半径。可做各路径点的红色 7 级风圈包络；目前未找到接口正式公开的象限顺序说明，保留原串，并在未核验前使用最大半径的圆形近似，不能伪造精确不对称扇形。 |
| 登陆 | `land[].landtime/landaddress/lng/lat/info` | 可展示“登陆事件”和其时间地点；多个登陆必须逐条呈现，不能只保留第一次。 |
| 预报 | `points[].forecast` | 仅用于活动台风的预测，不进入历史 Boss 的实际经过路径。 |

### 关键修正

1. **红色范围应叫“7级风圈记录范围”，不是“影响范围”或“灾害范围”。** 风圈表示达到相应风力的气象范围，不能代表降雨、风暴潮、停运或经济损失的实际覆盖面。
2. **历史详情页不要加载当前卫星图充当该历史台风影像。** 若无带时间、来源和覆盖范围的历史卫星归档，则顶部应是世界底图 + 历史路径/风圈；“当前卫星实况”只能另作参照层，必须明确标注。
3. `starttime/endtime`、路径、登陆均由同一聚合接口提供，适合图鉴第一版；全国权威业务口径仍应由中央气象台/国家气象中心校验，尤其是正在活动的台风。

## 建议的数据契约

将“可自动生成的气象轨迹”与“逐台风核验的灾情事实”拆开。前者可在 `getDexEntries` 生成；后者仅由证据库合并。不要把 100 个台风的灾情文字塞进组件逻辑。

```ts
type EvidenceLevel = "confirmed" | "curated" | "unavailable";

interface SourceRef {
  publisher: string;             // 例如：中央气象台、应急管理部、广东省应急管理厅
  url: string;
  publishedAt?: string;
  accessedAt: string;
  title: string;
}

interface WindRadiusRecord {
  level: 7 | 10 | 12;
  raw: string;                   // 保留 "150|260|100|260"，用于审计
  maxKm: number;                 // 未确认象限顺序时仅用于圆形近似
  quadrantKm?: [number, number, number, number];
  quadrantOrder?: "NE-SE-SW-NW"; // 只有经源文档验证后才写入
}

interface ArchiveTrackPoint {
  observedAt: string;
  lon: number;
  lat: number;
  windMps: number | null;
  pressureHpa: number | null;
  windRadii: WindRadiusRecord[];
}

interface VerifiedImpactFact {
  kind: "formation_context" | "impact_window" | "direct_economic_loss";
  value: string;
  scope: "storm" | "storm_and_periphery" | "multiple_storms" | "region";
  attribution: "official" | "official-associated";
  evidence: SourceRef;
}

interface TyphoonDexDetail {
  id: string;
  lifecycle: {
    startedAt: string | null;
    endedAt: string | null;
    durationHours: number | null;
    firstObservedCenter: ArchiveTrackPoint | null;
    lastObservedCenter: ArchiveTrackPoint | null;
  };
  track: ArchiveTrackPoint[];
  landfalls: Array<{ at: string; place: string; lon: number; lat: number; note?: string }>;
  verifiedFacts: VerifiedImpactFact[];
  sources: SourceRef[];
}
```

UI 取值规则：

- `formation_context` 只能显示“官方诊断/报告说明”，并附来源按钮；没有逐台风证据时显示“未收录官方成因诊断”。
- `impact_window` 与“登陆时间”分开。仅有 `land[]` 时显示“首次登陆记录”，不显示“影响时间”。
- `direct_economic_loss` 只接受 `scope="storm"` 或明确归因到该台风的 `storm_and_periphery`。多台风合并灾损、年度台风灾损、地区总灾损不填到单一 Boss 数字中。
- 所有事实字段旁显示来源机构、发布日期和“原文”链接；游戏化文案只读这些已标准化字段，不能反向生成事实。

## 可靠来源分层

### A. 自动路径层（现已可用）

**浙江省水利厅台风路径公开接口**：机读路径、中心位置、强度、气压、风圈、移动、起止、登陆和多机构预报。它是运行时主数据源，但不是全国灾情的唯一权威来源。

### B. 气象业务校验层（活动台风优先）

**中央气象台 / 国家气象中心《台风快讯与报文》**：
`https://www.nmc.cn/publish/nwp/index.html`

快讯直接给出中心位置、强度、最大风力、中心气压、七/十/十二级风圈和路径预报。用于校验活动台风关键字段和业务措辞；归档个体若能定位到对应报文，也可作为逐时事实证据。不要把当前页面的快讯数据回填到历史台风。

### C. 灾情与直接经济损失层（必须逐台风取证）

优先顺序：

1. 应急管理部 / 国家防灾减灾救灾委员会的单次灾情通报：`https://www.mem.gov.cn/`
2. 受影响省、自治区、直辖市应急管理厅（局）或政府官网的台风灾情核定通报。
3. 中国气象局、国家气候中心的《中国气候公报》或单台风专题复盘：`https://www.cma.gov.cn/`。

经济损失字段需要保留“统计口径”。国家统计局《特别重大自然灾害损失统计调查制度》明确：直接经济损失不包括抢险救援费用、停工停产等间接损失、生态系统损失与恢复重建费用。来源：
`https://www.stats.gov.cn/fw/bmdcxmsp/bmzd/202404/t20240423_1948676.html`

因此，保险估损、新闻引述的“或超/预计”、损失归属于多个台风或同时期暴雨的汇总，不得填为单一 Boss 的“直接经济损失”。

### D. 成因字段的正确边界

“出生原因”不是路径接口字段，也不是仅凭首报坐标可得的事实。可接受的两种展示：

- **官方个例诊断**：中央气象台、国家气候中心、属地气象台的复盘明确说明生成环境或触发机制时，摘要为“生成环境”，并给出原文来源。
- **可复算环境背景**：未来如接入 ERA5/权威再分析，可展示首报前后海温、垂直风切变、低层涡度等，并统一标注“环境背景推断，非官方归因”。这一项不能写成“因 X 而生成”。

第一版推荐只启用前者；没有官方诊断则留空，避免把一般台风生成常识伪装成该个体结论。

## 世界地图实现建议

1. 底图覆盖世界范围，但初始视野以 `track` 的 bbox 加 12% padding 为准；跨 180° 经线时先进行经度展开，避免路线横穿整张地图。
2. 绘制三层：灰/深色世界陆海底图、红色实况中心路径、半透明红色 `radius7` 包络。`radius10/radius12` 可作为更深的内圈开关。
3. 对每个历史点的 `maxKm` 生成圆，再做 union 或仅渲染采样圆。图例固定写“公开路径接口：7级风圈记录范围（圆形近似）”。
4. 出生点、最后实况点和每个登陆点单独标记；点击路径节点可见该时次的风速、气压和原始风圈值。
5. 轨迹只用实况点。预测轨迹只在当前活跃 Boss 的独立“预报”层出现，并使用虚线且与历史记录颜色区分。

## 建议的详情排版与事实文案

| 卡片 | 优先值 | 无证据时 |
|---|---|---|
| 初现坐标 | 首个有效实况点 | “公开路径档案未提供首报坐标” |
| 初现时间 | `starttime` | “未收录” |
| 档案终止 | `endtime` | “仍在活动/未收录终止时次” |
| 存在时长 | 结束减开始 | “无法计算” |
| 登陆/接触事件 | `land[]` | “未记录登陆” |
| 影响时段 | `impact_window` 的逐台风官方证据 | “未收录单台风影响期” |
| 生成环境 | `formation_context` 的逐台风官方证据 | “未收录官方成因诊断” |
| 直接经济损失 | 单台风官方核定值、区域与口径 | “未收录可归因的官方核定值” |

游戏化标题可以是“生成坐标”“行动时长”“登陆战报”“风圈领域”“灾情战果”，但数值正文必须保留正式含义和来源。例如：

> 风圈领域：7级风圈记录范围（圆形近似，非实际灾害影响范围）。

> 灾情战果：仅收录已公开、可归因至本台风的直接经济损失；不含间接损失与多灾种合并统计。

## 落地顺序

1. 立即：把已存在的 `starttime/endtime/track/land/radius7` 传给右侧图鉴；所有数据源标为浙江公开路径接口。
2. 立即：顶部替换为世界路径图，移除历史个体与当前卫星影像的暗示性关联。
3. 下一步：建立 `data/dex-evidence/<tfid>.json` 或数据库表，只存带 URL 的官方逐台风事实；页面按 `tfid` 合并。
4. 再下一步：为活动台风接入中央气象台快讯校验；发现与浙江接口关键字段不一致时展示来源差异而非静默覆盖。
5. 后续：为已收录的著名历史台风逐条补证据。不要为了填满图鉴，使用年度总损失、新闻估计或模型推断替代单台风官方事实。
