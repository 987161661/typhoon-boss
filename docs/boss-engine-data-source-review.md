# 气象事实驱动的 Boss 生成系统设计与数据源评审

更新时间：2026-07-08  
适用项目：`typhoon-boss-radar`  
目标：把“实时台风路径 + 游戏化 Boss 表现”做成可自动运营的系统，而不是为每个台风手写人设。

## 1. 总结

自动 Boss 生成引擎可以进入开发。当前公开实时数据已经足够支撑第一版系统，但长期维护的全国性产品不能把单一省级接口定义为唯一 P0 canonical source：

- 中央气象台/国家气象中心应作为全国权威口径的首选来源和校验来源。
- 浙江省水利厅台风路径接口适合作为机器可读路径聚合源，支撑活动状态、路径、强度、风速、气压、风圈、移动、历史变化、多机构预报，但不应单独承担全国 canonical source 角色。
- Open-Meteo Forecast API 足够补充环境推断：水汽、降水、湿度、云量、CAPE、环境风、海平面气压。
- JMA Himawari realtime image 足够补充视觉证据：真彩、红外、水汽、暴雨潜势图层。

核心设计原则：

- 气象事实是底座，游戏化是解释层。
- Boss 技能必须能追溯到数据字段、计算方法和证据等级。
- 不给每个台风写定制人设，改用规则引擎从气象特征自动生成 Boss Profile。
- 所有推断必须分级：实况确认、模型推断、卫星提示。
- 眼壁置换等专业结构判断不能在第一版自动断言，只能显示为“核心重构迹象”。

## 2. 产品定位

这个系统不是普通天气看板，也不是娱乐化灾害模拟器。它的产品形态是：

> 让用户用低门槛、强视觉、游戏化的方式持续关注真实台风态势，同时保留严肃气象边界。

用户看到的是 Boss：

- 它有形态、阶段、技能、能量槽、路径、威胁范围。
- 每个技能背后都有真实气象数据。
- 当台风数据更新，Boss 自动更新，不依赖人工配置。

用户真正获得的是：

- 当前台风有多强。
- 它为什么危险。
- 危险来自风、雨、路径、风圈还是登陆压迫。
- 哪些结论是实况，哪些只是模型推断。
- 应该继续关注哪些官方预警。

## 3. 非目标

第一版不要做这些事：

- 不做每个台风专属剧情、人设、台词包。
- 不用 AI 看图直接判定眼壁置换。
- 不把 Open-Meteo 模型降水当官方预警。
- 不抓中国天气网页作为稳定 API。
- 不把商业鉴权 API 作为默认数据源。
- 不用大量手写 if/else 枚举所有台风类型。
- 不把 UI 做成静态海报，所有核心状态必须数据驱动。

## 4. 正式采用的数据源

| 等级 | 数据源 | 用途 | 状态 |
|---|---|---|---|
| P0-A | 中央气象台/国家气象中心台风产品 | 全国权威实况、台风快讯、台风预警、公报、权威口径校验 | 应作为长期 canonical authority，需补稳定采集适配 |
| P0-B | 浙江省水利厅台风路径接口 | 活动台风、路径、强度、气压、风圈、多机构预报 | 采用为机器可读路径聚合源，不单独作为全国 canonical source |
| P1 | Open-Meteo Forecast API | 水汽、降水、湿度、云量、环境风、CAPE、海平面气压 | 采用，环境数值补充 |
| P1 | JMA Himawari realtime image | 卫星、水汽、红外、暴雨潜势图层 | 采用，视觉/辅助证据 |
| P2 | 浙江 `LeastCloud` | 备用云图来源 | 保留为降级备用 |
| Reject | 浙江 `LeastRain` | 近期雨图 | 当前 404，不采用 |
| Reject | 中国天气台风网页 | 台风新闻/专题/页面信息 | 可人工参考，不进自动链路 |
| Reject | 和风天气热带气旋 API | 商业/鉴权 API | 非公开免鉴权，不进默认链路 |

### 4.1 全国长期产品的数据源边界

如果产品目标是“全国各地台风战况一手了解”，单独把浙江省水利厅接口定义为 P0 主源是不妥的。浙江接口可以继续用，但它的角色应降为 P0-B：机器可读路径聚合源。P0-A 应是中央气象台/国家气象中心等全国权威台风产品。

原因：

- 产品面向全国时，用户会默认“主源”具备全国权威口径。省级水利厅接口即使覆盖西北太平洋/南海路径，也不应被表达成全国权威来源。
- 中央气象台/国家气象中心页面提供台风快讯、台风路径预报、台风公报、台风预警、海区预报等全国气象业务产品，更符合全国长期产品的权威定位。
- 浙江接口的优势是字段完整、机器可读、历史路径和多机构预报稳定，适合作为实时计算源和 fallback，而不是唯一主权威源。

当台风主要影响广东、福建、海南、台湾或其他地区时：

- Boss 的基础路径、强度、风圈、移动、历史趋势仍可采信浙江路径接口，只要其字段与中央气象台等公开权威源保持一致。
- 属地影响、预警等级、防御建议不能只采信浙江接口，应以中央气象台、国家海洋预报台、广东省气象台、深圳/广州等属地气象台和应急部门发布为准。
- UI 文案应区分“路径数据来源”和“预警/防御来源”。例如：路径数据来自浙江省水利厅公开路径接口；真实预警以中央气象台和属地气象/应急部门为准。
- 省份防线模块输出的是游戏化风险分层和关注提示，不等同于广东、浙江或其他省份的官方预警信号。

实现上建议把数据源分成两类：

```text
canonicalAuthority: 中央气象台 / 国家气象中心台风产品
machineReadableTrackSource: 浙江省水利厅公开台风路径接口
regionalWarningAuthority: 国家海洋预报台 / 属地气象台与应急部门
```

在没有完成中央气象台稳定采集适配前，本项目可以继续用浙江接口生成 Boss 技能，但 UI 和文档必须显示为“路径聚合源”，并明确“权威口径以中央气象台/国家气象中心和属地气象应急部门为准”。系统不自动生成“官方预警等级”。

后续开发优先级应调整为：

1. 保留浙江接口作为现有可运行路径源，确保 Boss 引擎不断档。
2. 新增中央气象台/国家气象中心适配器，先抓取或解析台风快讯/公报中的当前实况字段。
3. 做 P0-A/P0-B 字段一致性校验：中心位置、风速、气压、风圈、移动方向。
4. 当中央源可稳定结构化后，将 Boss Profile 的 `canonicalAuthority` 指向中央源，浙江源保留为 `machineReadableTrackSource` 和 fallback。
5. 对省级预警/防御建议，按影响区域再接入属地源，而不是用任一单省源覆盖全国。

## 5. 证据等级

Boss 引擎的每个结论都必须带证据等级。

```ts
type EvidenceLevel = "confirmed" | "inferred" | "visualHint";
```

| 证据等级 | 含义 | 可用于 |
|---|---|---|
| `confirmed` | 来自台风路径实况、历史点、风圈、强度、预报点的确定字段 | Boss 等级、风压核心、风圈压制、路径威胁、省份防线 |
| `inferred` | 来自历史差分、多机构预报离散度、环境网格模型的计算结果 | 快速增强、水汽吞噬、雨幕领域、滞留消耗、路径诡诈 |
| `visualHint` | 来自卫星图像产品或图层可用性的辅助提示 | 云系表现、暴雨潜势提示、核心重构迹象 |

UI 展示规则：

- `confirmed`：可写“实况确认”。
- `inferred`：必须写“模型推断”或“公开模型推断”。
- `visualHint`：必须写“卫星提示”或“视觉提示”。

禁止规则：

- `visualHint` 不得升级为 `confirmed`。
- `inferred` 不得写成官方预警。
- 只有 P0 路径数据能驱动 Boss 生死状态、等级和主路径。

## 6. 系统架构

建议新增独立目录：

```text
lib/bossEngine/
  index.ts
  types.ts
  adapters/
    zhejiangAdapter.ts
    openMeteoAdapter.ts
    himawariAdapter.ts
  normalize/
    stormSeries.ts
    environmentGrid.ts
    satelliteProducts.ts
  features/
    intensity.ts
    windRadii.ts
    motion.ts
    forecastSpread.ts
    landfall.ts
    moisture.ts
    rainfall.ts
    structureHints.ts
  rules/
    archetypeRules.ts
    phaseRules.ts
    skillRules.ts
    ratingRules.ts
  output/
    bossProfile.ts
    uiViewModel.ts
```

模块职责：

| 模块 | 职责 |
|---|---|
| `adapters` | 只负责拉取外部数据和保留原始响应，不做游戏化判断 |
| `normalize` | 把不同来源统一成内部气象事实模型 |
| `features` | 计算强度、趋势、风圈、路径、环境、水汽、结构提示等特征 |
| `rules` | 把特征映射为 Boss 原型、阶段、技能、等级 |
| `output` | 生成 UI 可消费的 BossProfile 和证据说明 |

## 7. 数据流

```text
公开数据源
  -> Source Adapters
  -> Normalized Weather Facts
  -> Feature Extraction
  -> Boss Rules Engine
  -> BossProfile
  -> UI ViewModel
  -> Radar / Intel / Skill Bar / Dex
```

详细流程：

1. 拉取 P0 活动台风列表。
2. 对每个活动台风拉取 `TyphoonInfo/{tfid}`。
3. 解析历史点、当前点、风圈、多机构预报。
4. 为每个台风生成基础 `StormSeries`。
5. 按台风中心、风圈边界、未来路径走廊采样 Open-Meteo。
6. 拉取 Himawari 当前可用产品元数据。
7. 计算气象特征。
8. 应用 Boss 规则。
9. 输出 BossProfile。
10. UI 只读取 BossProfile，不重复写业务规则。

## 8. 领域模型

### 8.1 Source Snapshot

用于保存外部接口原始状态，便于调试和审计。

```ts
interface SourceSnapshot<T> {
  source: "zhejiang-typhoon" | "open-meteo" | "jma-himawari";
  fetchedAt: string;
  status: "available" | "degraded" | "unavailable";
  url?: string;
  payload?: T;
  error?: string;
}
```

### 8.2 Normalized Storm Series

```ts
interface NormalizedStormPoint {
  time: string;
  lon: number;
  lat: number;
  stage: string;
  power: number | null;
  windMps: number | null;
  pressureHpa: number | null;
  moveDirection?: string;
  moveSpeedKmh?: number | null;
  radiiKm: {
    r7?: QuadrantRadii;
    r10?: QuadrantRadii;
    r12?: QuadrantRadii;
  };
}

interface QuadrantRadii {
  ne: number;
  se: number;
  sw: number;
  nw: number;
  max: number;
  mean: number;
}

interface NormalizedStormSeries {
  id: string;
  code: string;
  nameZh: string;
  nameEn: string;
  isActive: boolean;
  current: NormalizedStormPoint;
  history: NormalizedStormPoint[];
  forecasts: ForecastAgencyTrack[];
  sourceUpdatedAt: string;
}
```

### 8.3 Environment Grid

```ts
interface EnvironmentSample {
  time: string;
  lon: number;
  lat: number;
  role: "center" | "r7-edge" | "forecast-corridor" | "province";
  windSpeed10mMps?: number;
  windGust10mMps?: number;
  windDirection10mDeg?: number;
  precipitationMm?: number;
  relativeHumidityPct?: number;
  cloudCoverPct?: number;
  pressureMslHpa?: number;
  totalColumnWaterVapourKgM2?: number;
  capeJkg?: number;
}

interface EnvironmentGrid {
  source: "open-meteo";
  updatedAt: string;
  samples: EnvironmentSample[];
  status: "available" | "degraded" | "unavailable";
}
```

### 8.4 Satellite Evidence

```ts
type HimawariProduct = "dnc" | "b13" | "b08" | "tre" | "hrp";

interface SatelliteProductState {
  source: "jma-himawari";
  area: "se2" | "r2w" | "r5w";
  product: HimawariProduct;
  time: string;
  imageUrl: string;
  status: "available" | "unavailable";
}
```

### 8.5 Boss Profile

```ts
type BossArchetype =
  | "wind-core"
  | "rain-bulk"
  | "giant-radius"
  | "track-trickster"
  | "landfall-siege"
  | "weak-remnant"
  | "balanced-threat";

type BossPhase =
  | "forming"
  | "intensifying"
  | "mature"
  | "restructuring-hint"
  | "landfall-pressure"
  | "weakening"
  | "archived";

interface BossSkillEvidence {
  source: "zhejiang-typhoon" | "open-meteo" | "jma-himawari";
  level: EvidenceLevel;
  fields: string[];
  summary: string;
}

interface BossSkill {
  id: string;
  name: string;
  category: "wind" | "rain" | "track" | "structure" | "landfall" | "environment";
  severity: number; // 1-9
  confidence: number; // 0-1
  evidenceLevel: EvidenceLevel;
  detail: string;
  evidence: BossSkillEvidence[];
}

interface BossProfile {
  stormId: string;
  title: string;
  subtitle: string;
  archetype: BossArchetype;
  phase: BossPhase;
  rating: string;
  energy: number; // 0-100
  riskSummary: string;
  primarySkillIds: string[];
  skills: BossSkill[];
  evidenceSummary: BossSkillEvidence[];
  generatedAt: string;
}
```

## 9. 气象特征提取

### 9.1 强度特征

输入：

- 当前风速 `speed`
- 当前气压 `pressure`
- 当前风力 `power`
- 当前强度 `strong`
- 6h/12h/24h 历史差分

输出：

```ts
interface IntensityFeatures {
  currentWindMps: number | null;
  currentPressureHpa: number | null;
  pressureDeficit: number | null;
  windDelta6h: number | null;
  windDelta12h: number | null;
  pressureDelta6h: number | null;
  pressureDelta12h: number | null;
  isRapidIntensifying: boolean;
  isWeakening: boolean;
}
```

第一版阈值建议：

- `wind >= 51 m/s` 或 `stage=强台风/超强台风`：高强度。
- `wind >= 58 m/s` 或 `stage=超强台风`：天灾级表现。
- 6h 风速上升 `>= 5 m/s` 且气压下降：触发“爆发强化”。
- 12h 风速下降 `>= 8 m/s` 或气压上升 `>= 10 hPa`：触发“衰减”趋势。

### 9.2 风圈特征

输入：

- `radius7`
- `radius10`
- `radius12`

注意浙江接口风圈常见格式为四象限字符串，例如：

```text
500|350|500|400
```

归一化：

- 保留四象限半径。
- 计算最大值、均值、非对称度。

输出：

```ts
interface WindRadiiFeatures {
  r7MaxKm: number | null;
  r10MaxKm: number | null;
  r12MaxKm: number | null;
  r7Asymmetry: number | null;
  isGiantRadius: boolean;
  hasInnerCore: boolean;
}
```

第一版阈值建议：

- `r7MaxKm >= 450`：巨型外环。
- `r10MaxKm >= 180`：强风内核明显。
- `r12MaxKm >= 80`：核心风墙明显。
- 四象限最大/最小比值 `>= 1.8`：不对称风圈，可作为路径影响解释。

### 9.3 移动特征

输入：

- `movespeed`
- `movedirection`
- 历史点位移
- 未来 24/48h 预报点

输出：

```ts
interface MotionFeatures {
  moveSpeedKmh: number | null;
  moveDirection: string;
  headingChangeDeg12h: number | null;
  isFastMover: boolean;
  isSlowMover: boolean;
  isTurning: boolean;
}
```

第一版阈值建议：

- `moveSpeed >= 30 km/h`：急行。
- `moveSpeed <= 8 km/h`：滞留。
- 12h 方向变化明显：路径转向提示。

### 9.4 多机构预报离散度

输入：

- 中国、中国台湾、日本、中国香港、美国等 forecast groups。

计算：

- 按相同预报时间聚合不同机构点。
- 计算经纬度跨度或最大两点距离。
- 计算强度跨度。

输出：

```ts
interface ForecastSpreadFeatures {
  agencyCount: number;
  maxTrackSpreadKm24h: number | null;
  maxTrackSpreadKm48h: number | null;
  maxWindSpreadMps: number | null;
  isTrackUncertain: boolean;
}
```

第一版阈值建议：

- 24h 机构路径离散 `>= 120 km`：路径分歧。
- 48h 机构路径离散 `>= 250 km`：高不确定性。
- 强度跨度 `>= 8 m/s`：强度预报分歧。

### 9.5 登陆/省份压迫特征

输入：

- 当前点
- 未来路径
- 中国省份中心/沿海参考点
- 风圈半径

输出：

```ts
interface LandfallFeatures {
  nearestProvince: string | null;
  distanceToCoastKm: number | null;
  distanceToProvinceKm: Record<string, number>;
  provincesInR7Corridor: string[];
  isLandfallPressure: boolean;
}
```

第一版实现：

- 用现有省份中心和路径走廊先做近似。
- 后续可接海岸线 GeoJSON 做更准确的登陆距离。

### 9.6 环境水汽/降水特征

输入：

- Open-Meteo 环境网格。
- 中心、风圈边缘、未来路径走廊采样点。

输出：

```ts
interface MoistureRainFeatures {
  maxTcwvKgM2: number | null;
  meanTcwvKgM2: number | null;
  maxPrecipMm: number | null;
  meanHumidityPct: number | null;
  meanCloudCoverPct: number | null;
  maxCapeJkg: number | null;
  isMoistureLoaded: boolean;
  isRainThreat: boolean;
  isConvective: boolean;
}
```

第一版阈值建议：

- `TCWV >= 60 kg/m2`：水汽充沛。
- `TCWV >= 70 kg/m2` 且湿度高：水汽吞噬。
- 路径走廊降水明显 + HRP 可用：雨幕领域。
- `CAPE >= 1200 J/kg`：对流充能。

阈值需要在后续样本中校准，不应写死为永久标准。

### 9.7 卫星视觉特征

输入：

- Himawari `dnc/b13/b08/tre/hrp` 图层可用状态。
- 图层区域是否覆盖当前台风中心。

输出：

```ts
interface SatelliteFeatures {
  hasTrueColor: boolean;
  hasInfrared: boolean;
  hasWaterVapor: boolean;
  hasHeavyRainPotential: boolean;
  supportsVisualBossSkin: boolean;
  supportsRainHint: boolean;
}
```

第一版不做图像识别，只做产品可用性和图层覆盖判断。

## 10. Boss 原型规则

Boss 原型不是固定标签，而是从特征评分选出主导风险。

| 原型 | 触发条件 | UI 解释 |
|---|---|---|
| `wind-core` 风压核心型 | 风速高、气压低、10/12级风圈明显 | 核心强度高，主要威胁来自风压和近中心风圈 |
| `giant-radius` 巨型风圈型 | 7级风圈半径大、影响走廊广 | 范围型 Boss，外围风雨影响面大 |
| `rain-bulk` 水汽雨洪型 | TCWV、湿度、降水、HRP 共同偏高 | 风力未必最高，但雨带和水汽威胁突出 |
| `track-trickster` 路径诡诈型 | 多机构路径离散或转向明显 | 路径不确定性高，需关注后续预报调整 |
| `landfall-siege` 登陆压迫型 | 未来路径靠近陆地/省份防线 | 对沿海防御线形成压迫 |
| `weak-remnant` 残血雨带型 | 停编/减弱但环境降水仍强 | 主体减弱，残余环流或雨带仍需关注 |
| `balanced-threat` 综合威胁型 | 多项特征中等偏高但无单一主导 | 风、雨、路径均需关注 |

评分方式建议：

```text
archetypeScore = weighted sum of normalized feature scores
primary archetype = max(score)
secondary archetypes = score >= primary * 0.72
```

这可以避免手写大量组合分支。

## 11. Boss 阶段规则

| 阶段 | 数据条件 | 展示语义 |
|---|---|---|
| `forming` | 热带低压/热带风暴，风速较低 | 生成中 |
| `intensifying` | 6h/12h 风速上升或气压下降 | 增强中 |
| `mature` | 台风/强台风/超强台风且趋势稳定 | 成熟体 |
| `restructuring-hint` | 强度波动 + 卫星视觉产品可用 | 核心重构迹象 |
| `landfall-pressure` | 未来路径接近陆地或重点省份 | 登陆压迫 |
| `weakening` | 风速下降/气压上升/强度降级 | 减弱中 |
| `archived` | `isactive=0` | 停编归档 |

优先级：

```text
archived > landfall-pressure > intensifying > weakening > restructuring-hint > mature > forming
```

如果多个阶段同时触发，选择优先级最高，但 UI 可在事件时间轴显示次级状态。

## 12. 第一版技能池

技能池固定，技能触发由数据决定。每个技能必须有 `id`、触发条件、证据等级、严重度和解释文案。

| 技能 ID | 名称 | 类别 | 触发数据 | 证据等级 |
|---|---|---|---|---|
| `wind_pressure_core` | 风压核心 | wind | `speed`, `pressure`, `power` | confirmed |
| `outer_ring_suppression` | 外环压制 | wind | 7级风圈最大半径 | confirmed |
| `inner_wall` | 强风内核 | wind | 10/12级风圈 | confirmed |
| `burst_intensification` | 爆发强化 | wind | 6h/12h 风速上升、气压下降 | confirmed |
| `weakening_break` | 强度破防 | wind | 风速下降、气压上升 | confirmed |
| `moisture_devour` | 水汽吞噬 | rain | TCWV、湿度、云量、降水 | inferred |
| `rain_curtain_domain` | 雨幕领域 | rain | 降水、HRP 图层、路径走廊采样 | inferred |
| `convective_charge` | 对流充能 | environment | CAPE、湿度、云量 | inferred |
| `track_deception` | 轨迹欺诈 | track | 多机构预报离散度 | inferred |
| `sudden_dash` | 急行突袭 | track | 移速高、未来 24h 接近陆地 | confirmed |
| `stalling_drain` | 滞留消耗 | track | 移速低且水汽/降水高 | inferred |
| `coastal_siege` | 沿海压迫 | landfall | 预报路径与海岸/省份距离 | confirmed |
| `remnant_rainband` | 残血雨带 | rain | `isactive=0` 但环境降水仍强 | inferred |
| `core_restructure_hint` | 核心重构迹象 | structure | 强度波动 + Himawari 视觉提示 | visualHint |

技能生成规则：

- 每个 Boss 至少输出 3 个技能，最多输出 6 个主技能。
- `confirmed` 技能优先级高于 `inferred`。
- `visualHint` 技能只能作为辅助技能，不得成为唯一主技能。
- 同类技能过多时只保留最高严重度的 2 个。
- 技能文案必须包含事实解释，不只写游戏名。

文案模板：

```text
{技能名}｜{气象事实}，{影响解释}。证据：{证据等级}
```

示例：

```text
外环压制｜七级风圈最大半径约 500 km，外围风雨影响范围较大。证据：实况确认
水汽吞噬｜路径走廊整层水汽和湿度偏高，需关注强降雨风险。证据：模型推断
核心重构迹象｜强度出现波动，卫星红外/水汽图层支持继续观察核心结构。证据：卫星提示
```

## 13. 严重度与置信度

### 13.1 严重度

严重度是游戏化强度，范围 `1-9`。

```text
severity = clamp(weighted normalized feature score, 1, 9)
```

示例：

- 风速越高，`wind_pressure_core` 严重度越高。
- 7级风圈越大，`outer_ring_suppression` 严重度越高。
- 多机构路径越分散，`track_deception` 严重度越高。
- TCWV、降水、湿度共同偏高，`moisture_devour` 严重度越高。

### 13.2 置信度

置信度是数据可靠性，范围 `0-1`。

建议初始值：

| 来源组合 | 初始置信度 |
|---|---:|
| P0 单字段确定事实 | 0.90 |
| P0 多字段一致 | 0.95 |
| P0 历史差分 | 0.82 |
| 多机构预报离散度 | 0.72 |
| Open-Meteo 单模型推断 | 0.62 |
| Open-Meteo + Himawari HRP 同向 | 0.75 |
| Himawari 视觉提示 | 0.45 |

置信度不等于风险大小。UI 不应把低置信度高风险提示藏掉，而应明确标注。

## 14. UI 合同

UI 不应重新计算 Boss 规则，只消费 BossProfile。

### 14.1 右侧 Boss Intel

显示：

- Boss 名称和阶段。
- Boss 原型。
- 能量槽。
- 主风险摘要。
- 技能槽。
- 每个技能的证据等级。

技能槽建议视觉：

| 证据等级 | UI 标签 | 视觉语义 |
|---|---|---|
| `confirmed` | 实况确认 | 红/白高亮，最可信 |
| `inferred` | 模型推断 | Amber 或 cyan 辅助 |
| `visualHint` | 卫星提示 | 细边框/弱高亮 |

### 14.2 中央地图战场

显示：

- 当前 Boss 核心。
- 历史路径。
- 预报路径。
- 7/10/12 级风圈。
- 未来路径走廊。
- 影响省份。
- 可切换环境图层：卫星、风场、影响区、暴雨潜势。

地图上的游戏化表现必须绑定地理坐标，不得用任意屏幕百分比伪造台风位置。

### 14.3 左侧省份防线

省份防线应从 BossProfile 和路径走廊生成：

- 受哪些技能影响。
- 距离路径或中心多远。
- 是否在 7级风圈/未来路径走廊中。
- 防御状态：巡航、观察、外环影响、核心风圈、登陆压迫。

### 14.4 底部事件时间轴

事件来自历史点差分和预报变化：

- 强度增强。
- 强度减弱。
- 风圈扩张。
- 路径转向。
- 多机构分歧扩大。
- 登陆压迫增强。
- 停编归档。

事件可作为图鉴里的 Boss 战斗履历。

## 15. API 合同

建议新增接口：

```text
GET /api/boss/current
GET /api/boss/{stormId}
GET /api/boss/{stormId}/evidence
GET /api/environment/moisture-grid?stormId=
GET /api/environment/himawari-products?stormId=
```

`/api/boss/current` 响应示意：

```ts
interface CurrentBossResponse {
  source: {
    primary: string;
    environment: string[];
    updatedAt: string;
  };
  bosses: BossProfile[];
  degraded: boolean;
  warnings: string[];
}
```

缓存策略：

- P0 台风路径：`no-store`，前端 60 秒刷新。
- Open-Meteo 环境网格：可 5-10 分钟内存缓存，但响应必须标注 `updatedAt` 和模型来源。
- Himawari 图像：按 `HHmm` 时次缓存，寻找最近可用时次。
- BossProfile：可由请求实时生成，或在服务端以 stormId + sourceUpdatedAt + envUpdatedAt 做短缓存。

## 16. 降级策略

| 失败源 | 降级行为 |
|---|---|
| 浙江 P0 失败 | UI 进入待机/链路异常；不生成活动 Boss |
| `TyphoonInfo` 失败但 `TyhoonActivity` 可用 | 只显示活动简表，不显示完整技能 |
| Open-Meteo 失败 | 保留风压、风圈、路径技能；隐藏水汽/暴雨推断技能 |
| Himawari 失败 | 保留数值技能；隐藏卫星提示和图层 |
| 多机构预报为空 | 不触发路径诡诈；只用中国预报或历史路径 |
| 风圈为空 | 不触发外环/内核技能；保留强度和路径技能 |

降级后的 UI 必须明确显示数据缺口，不能用假数据补齐。

## 17. 实测记录

### 17.1 浙江省水利厅台风路径接口

测试时间：2026-07-08 晚间  
入口：

- `https://typhoon.slt.zj.gov.cn/Api/TyphoonList/2026`
- `https://typhoon.slt.zj.gov.cn/Api/TyphoonInfo/202609`
- `https://typhoon.slt.zj.gov.cn/Api/TyhoonActivity`
- `https://typhoon.slt.zj.gov.cn/Api/LeastCloud`

实测结果：

| 接口 | 状态 | 结果 |
|---|---:|---|
| `TyphoonList/2026` | 200 | 返回年度台风列表，含 `tfid/name/enname/starttime/endtime/warnlevel/isactive` |
| `TyphoonInfo/202609` | 200 | 返回完整路径详情，响应约 356 KB |
| `TyhoonActivity` | 200 | 返回当前活动台风简表，注意接口名拼写为 `TyhoonActivity` |
| `TyphoonActivity` | 404 | 不采用 |
| `LeastCloud` | 200 | 返回近期云图文件名与 base64 图像字段，响应很大 |
| `LeastRain` | 404 | 不采用 |

当前活动样本：`202609 巴威 / BAVI`

- 活动状态：`isactive=1`
- 最新点：`2026-07-08 20:00:00`
- 强度：`超强台风`
- 风力：`17`
- 风速：`58 m/s`
- 气压：`925 hPa`
- 移动：`西北西，16 km/h`
- 风圈：7级 `500|350|500|400`，10级 `300|280|300|280`，12级 `150|100|150|100`
- 历史点：53 个
- 预报组：5 组，包括中国、中国台湾、日本、中国香港、美国

### 17.2 Open-Meteo Forecast API

入口：

- `https://api.open-meteo.com/v1/forecast`
- `https://api.open-meteo.com/v1/cma`

标准 Forecast 实测请求变量：

```text
wind_speed_10m,
wind_direction_10m,
wind_gusts_10m,
precipitation,
relative_humidity_2m,
cloud_cover,
pressure_msl,
total_column_integrated_water_vapour,
cape
```

实测结果：`/v1/forecast` 返回 200，三个坐标均返回可用数值。样本：

| 坐标 | 风速 | 阵风 | 降水 | 湿度 | 云量 | 气压 | 整层水汽 | CAPE |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 17.33N, 131.88E | 14.39 m/s | 17.60 m/s | 1.00 mm | 91% | 84% | 942.0 hPa | 78.10 kg/m2 | 1110 J/kg |
| 22.18N, 125.57E | 10.64 m/s | 14.40 m/s | 0.00 mm | 74% | 99% | 1005.1 hPa | 50.60 kg/m2 | 1510 J/kg |
| 25.69N, 120.65E | 5.77 m/s | 7.60 m/s | 0.00 mm | 85% | 0% | 1007.4 hPa | 34.70 kg/m2 | 2070 J/kg |

`/v1/cma` 实测返回 200，但 `total_column_integrated_water_vapour` 在样本中为空。因此 CMA 端点只能作为模型对照，不作为默认环境源。

### 17.3 JMA Himawari realtime image

官方入口：

- `https://www.data.jma.go.jp/mscweb/data/himawari/`
- `https://registry.opendata.aws/noaa-himawari/`

当前项目已使用区域：

- `se2`，约覆盖东南亚/西北太平洋部分区域。
- URL 模式：`https://www.data.jma.go.jp/mscweb/data/himawari/img/{area}/{area}_{product}_{HHmm}.jpg`

实测 `se2` 当前时次 `1250 UTC`：

| 产品 | 状态 | 类型 | 说明 |
|---|---:|---|---|
| `dnc` | 200 | image/jpeg | true color/night composite，可作卫星底图 |
| `b13` | 200 | image/jpeg | 红外云顶温度相关视觉，适合云系强度辅助 |
| `b08` | 200 | image/jpeg | 水汽通道视觉，适合水汽表现辅助 |
| `tre` | 200 | image/jpeg | true color reproduction/enhanced visual |
| `hrp` | 200 | image/jpeg | heavy rainfall potential，适合作暴雨潜势图层 |

实测 `r2w`、`r5w` 区域当前时次：

- `hrp/b13/b08` 均返回 200。
- 大区域图像更适合作为未来“暴雨潜势/水汽层”的备用区域。

### 17.4 中国天气台风网

入口：`https://typhoon.weather.com.cn/`

实测结果：

- 页面 200。
- 页面可见 2026 年第 9 号巴威、第 10 号美莎克和台风关注新闻。
- 页面提供卫星云图、雷达拼图、全国 24 小时降水量预报等产品入口。

决策：

- 不作为自动 Boss 引擎接口。
- 原因：主要是页面/专题入口，不是稳定 JSON API 合同；抓取页面会增加维护成本和版权/反爬风险。
- 可作为人工校验来源或新闻/预警链接来源。

### 17.5 和风天气热带气旋 API

官方文档显示 Storm Forecast API 需要 JWT/Bearer 鉴权。实测无鉴权请求返回 403。

决策：

- 不进入默认公开实时链路。
- 若未来有正式 key，可作为商业增强源，但不能替代 P0 浙江路径接口。

## 18. 开发顺序

### 当前实现状态

截至 2026-07-08，已完成 Phase 1 的基础骨架：

- 新增 `lib/bossEngine/`，集中生成 BossProfile、Boss 原型、阶段、技能、事件和证据摘要。
- 新增 `lib/bossEngine/environmentSampler.ts`，按台风中心、7级风圈边界和未来路径走廊采样 Open-Meteo 环境场。
- 新增 `lib/bossEngine/satelliteProducts.ts`，探测 Himawari `dnc/b13/b08/tre/hrp` 产品状态，输出 `visualHint` 级卫星证据。
- 新增 `/api/boss/current`，返回当前活动台风的 BossProfile 列表。
- 新增 `/api/environment/himawari-products?stormId=`，返回当前台风对应 Himawari 区域的产品可用性。
- UI 已接入 BossProfile：右侧 Intel 显示 Boss 原型、阶段、风险摘要、Boss 技能槽、证据标签和权威/路径源边界。
- 顶部状态栏、地图遥测条、底部战况提示已改为优先使用 BossProfile。
- Boss 技能槽已从右侧 Intel 移到地图左侧战术栈，并与省份防线合并成一个纵向信息区，避免散落浮窗互相遮挡。
- 首屏展示 3 个 Boss 主技能，并覆盖 `confirmed` / `inferred` / `visualHint` 三类证据；完整技能池仍保留在 `/api/boss/current` 响应中。
- 右侧 Intel 已显示 Himawari 视觉提示链路状态；UI 不自行判断卫星图像内容。
- 底部已从“省份卡片重复展示”改为 `BOSS EVENT TRACE` 事件履历条；省份防线只保留在左侧战术栈。
- 当前 BossProfile 由 P0-B 浙江机器可读路径源 + P1 Open-Meteo 环境模型 + Himawari 产品状态共同生成；P0-A 中央气象台/国家气象中心适配器仍待补。

已验证：

- `npm.cmd run typecheck` 通过。
- `npm.cmd run build` 通过。
- 历史本地端口验证记录已废弃；当前项目雷达入口统一为 `http://127.0.0.1:3038/live`，以运维手册为准。
- `/api/boss/current` 返回 200。
- 浏览器 QA：右侧 Boss 类型显示为“风压核心型”，首屏可见 3 个主技能，无页面纵向滚动。
- Phase 2 完成后需重新验证：Open-Meteo 可用时 BossProfile 带 `environment` 摘要和 `open-meteo` 证据；Open-Meteo 失败时仍返回 P0 风压/路径技能。
- Phase 3 完成后需重新验证：BossProfile 带 `satellite` 摘要和 `jma-himawari` 视觉证据；Himawari 失败时不触发卫星提示技能。

### Phase 1：P0 Boss 引擎

目标：只用浙江路径接口生成可用 BossProfile。

交付：

- `NormalizedStormSeries`
- 强度、风圈、移动、路径、预报离散度特征。
- Boss 原型和阶段。
- `confirmed` 技能池。
- `/api/boss/current`。

验收：

- 当前活动台风能自动生成 3-6 个技能。
- 每个技能都有证据字段。
- 没有活动台风时不会生成假 Boss。

### Phase 2：环境推断

目标：接入 Open-Meteo，生成 `inferred` 环境技能。

交付：

- 环境采样器：`lib/bossEngine/environmentSampler.ts`。
- 采样点：台风中心、7级风圈四向边界、未来路径走廊前 4 个预报点，去重后最多 9 个点。
- 请求变量：`wind_speed_10m`、`wind_direction_10m`、`wind_gusts_10m`、`precipitation`、`relative_humidity_2m`、`cloud_cover`、`pressure_msl`、`total_column_integrated_water_vapour`、`cape`。
- 特征：最大/平均整层水汽、最大逐小时降水、平均湿度、平均云量、最大 CAPE、最大阵风。
- 技能：`moisture_devour` 水汽吞噬、`rain_curtain_domain` 雨幕领域、`stalling_drain` 滞留消耗、`convective_charge` 对流充能。
- 原型：`rain-bulk` 水汽雨洪型由整层水汽、降水、湿度和云量共同评分。
- 输出：BossProfile 增加 `environment` 摘要，`evidenceSummary` 增加 `open-meteo` 证据。

验收：

- Open-Meteo 失败不影响 P0 Boss。
- 环境技能明确标记“模型推断”。
- UI 不把 Open-Meteo 降水显示成官方预警，只显示为模型推断技能。

### Phase 3：Himawari 图层与视觉提示

目标：扩展卫星产品，不做图像识别。

交付：

- `dnc/b13/b08/tre/hrp` 产品状态探测：`lib/bossEngine/satelliteProducts.ts`。
- 区域选择：按台风位置优先选择 `se2`，必要时保留 `r2w/r5w` 作为后续备用区域。
- API：`GET /api/environment/himawari-products?stormId=`。
- BossProfile 增加 `satellite` 摘要：区域、时次、可用产品、产品用途和 warnings。
- `evidenceSummary` 增加 `jma-himawari` / `visualHint` 证据。
- `visualHint` 技能：`satellite_rain_potential_hint` 雨势卫星提示、`core_restructure_hint` 核心重构迹象。
- UI：右侧 Intel 增加 Himawari visual hint 状态块；技能槽可展示 `卫星提示` 标签。

验收：

- 图层失败时 UI 可降级。
- 不出现“眼壁置换已发生”的自动结论。
- `visualHint` 只描述“建议继续观察”，不得写成实况确认。

### Phase 4：Boss UI 重排

目标：把右侧 Intel、左侧防线、底部事件轴改为 BossProfile 驱动。

交付：

- 技能槽证据标签；技能槽位于左侧地图战术栈，和省份防线组成单一垂直信息区。
- Boss 原型/阶段视觉。
- 事件时间轴；底部 `BOSS EVENT TRACE` 直接消费 `BossProfile.events`，不再重复渲染整排省份防线。
- 省份防线受技能影响说明。

验收：

- UI 不直接调用规则函数。
- UI 文案能区分实况、推断、卫星提示。
- 窄屏或低高度下技能槽不得遮挡底部战况条。
- 主地图层最多保留一套左侧战术栈和一套右侧环境控制，避免多浮窗散落。

### Phase 5：图鉴归档

目标：把每个 Boss 的峰值特征、技能、阶段变化写入历史图鉴。

交付：

- 峰值风速、最低气压、最大风圈、最大水汽/雨幕推断。
- Boss 原型历史记录。
- 停编/残血状态。

验收：

- 活动 Boss 和历史 Boss 口径分离。
- 停编台风不被误写成当前活动台风。

## 19. 验收标准

功能验收：

- 任意活动台风生成 BossProfile。
- 每个 BossProfile 至少包含一个原型、一个阶段、一个能量值、三个技能。
- 每个技能有证据等级和来源字段。
- 数据源失败时有明确降级，不伪造数据。

专业边界验收：

- 不自动断言眼壁置换。
- 不把模型降水写成官方预警。
- 不把页面抓取作为稳定接口。
- 所有真实预警仍以中央气象台、海洋预报台和属地应急部门为准。

工程验收：

- Boss 规则集中在 `lib/bossEngine/rules`。
- UI 不重复写规则。
- 技能池通过配置/规则组合扩展，不手写大量台风个案。
- P0 接口保持 no-store。
- 文档中的接口失败策略在代码中有对应分支。

## 20. 引用来源

- 浙江省水利厅台风路径实时发布系统：`https://typhoon.slt.zj.gov.cn/`
- Open-Meteo Forecast API：`https://open-meteo.com/en/docs`
- Open-Meteo CMA API：`https://open-meteo.com/en/docs/cma-api`
- JMA Himawari Real-Time Image：`https://www.data.jma.go.jp/mscweb/data/himawari/`
- NOAA/JMA Himawari Open Data on AWS：`https://registry.opendata.aws/noaa-himawari/`
- 中国天气台风网：`https://typhoon.weather.com.cn/`
- QWeather Storm Forecast API：`https://dev.qweather.com/en/docs/api/tropical-cyclone/storm-forecast/`
