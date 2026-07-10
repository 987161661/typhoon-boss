# Boss 图鉴外部数据源版图

更新时间：2026-07-10。这个清单把“可自动接入的轨迹/风险模型”与“经核验的实际灾情”分开；两者都不能由名称相似就直接合并。

## 结论与接入顺序

1. 保留浙江省水利厅路径接口作为本项目中国近海的实时主链；它的台风编号是目前 UI 选择项的权威键。
2. 接入 NOAA/NCEI **IBTrACS** 为全球历史补全与跨盆地轨迹标准化层。它是全球 best-track 汇编，不是分钟级实时预警；最新数据也可能仍为 `PROVISIONAL`。
3. 对能按事件时间、名称和路径明确匹配的近现代风暴，接入 **GDACS** 的“潜在受影响”多边形、国家/地区和暴露人口。它是 EC-JRC 的模型结果，不能显示成“实际受灾范围”或“实际受灾人口”。
4. 经济损失采用 **EM-DAT** 的逐事件逐国家记录，且只能在获得正确的授权下载数据后导入到本地受审计快照。不能尝试抓取其登录数据，也不能用 GDACS 风险分数、新闻估计或多个国家记录中的一条来伪造“总直接损失”。
5. “出生原因”没有可供全球逐风暴自动引用的结构化权威 API。默认不显示因果断言；仅在指定气象机构的风暴复盘/年度报告明确说明时，以短摘录、出处和“机构归因”标签人工入库。

## 可编程轨迹与生命周期：NOAA/NCEI IBTrACS

官方入口：<https://www.ncei.noaa.gov/products/international-best-track-archive>。

IBTrACS 是 NOAA NCEI 与 WMO 区域专门气象中心等共同汇编的全球公开 best-track 档案；v04r01 通常每周多次更新。它适合“出生地点/时间、终止地点/时间、存续时长、路径、最大持续风、最低气压、中心登陆时段”，但不应被称为实况预警或灾害影响数据。

### 直接下载端点（免密钥）

建议后端定时下载并本地索引，浏览器不要加载超大 CSV：

| 用途 | URL |
| --- | --- |
| 最近 7 天活跃系统 | <https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/netcdf/IBTrACS.ACTIVE.v04r01.nc> |
| 西北太平洋历史/当前 | <https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/netcdf/IBTrACS.WP.v04r01.nc> |
| 近三年、体积较小的补全 | <https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/netcdf/IBTrACS.last3years.v04r01.nc> |
| CSV（便于一次性导入；不要在请求时解析） | <https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/csv/ibtracs.WP.list.v04r01.csv> |
| 官方 ID/名称映射 | <https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/csv/IBTrACS_SerialNumber_NameMapping_v04r01_20260709.txt> |

文件名版本后缀会随正式发布变化；更新任务先读取官方目录索引，再选择同一 `v04r01` 版本的一组文件：<https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/netcdf/>。

### 图鉴字段映射与规则

| 图鉴字段 | IBTrACS 字段/算法 | 展示限制 |
| --- | --- | --- |
| 出生地点、出生时间 | 主路径（`TRACK_TYPE=MAIN`）最早有效 `ISO_TIME` 的 `LAT`、`LON` | 标签为“档案首个记录点”，不是气旋生成物理机制。 |
| 存续与消亡 | 最早/最晚有效 `ISO_TIME`，时长为差值；末点坐标为终止点 | `NATURE`/状态变化可能早于或晚于业务定义的“台风”，需标出采样间隔。 |
| 路径 | 按 `SID`、主路径、`ISO_TIME` 排序的 `LAT`/`LON` | 反经线须拆线；不要把观测点线段画成风圈边界。 |
| 最大风、最低压 | `WMO_WIND`/`WMO_PRES` 的有效值极值；缺失时可回退具体机构字段并记录字段名 | 各机构持续风平均时段不同（例如 JMA 10 分钟、NHC 1 分钟），不得在未换算时与同一量纲的“等级”混排。 |
| 登陆/近陆影响节点 | `LANDFALL=0` 是 IBTrACS 算法识别的下一报告间隔内中心过海岸线；`DIST2LAND` 是距陆距离 | 仅能称“中心登陆/近陆节点”，不能替代地方风雨影响范围。 |
| 数据成熟度 | `TRACK_TYPE` 的 `MAIN`、`PROVISIONAL`、`spur` 等 | `PROVISIONAL` 必须在 UI 露出“暂定路径”；忽略 `spur`，除非人工确认是需要展示的相互作用支线。 |

参考：IBTrACS 官方说明与列定义：

- <https://www.ncei.noaa.gov/products/international-best-track-archive>
- <https://www.ncei.noaa.gov/sites/g/files/anmtlf171/files/2025-02/IBTrACS_v04r01_column_documentation.pdf>

## 影响范围、国家和预警：GDACS（EC-JRC / UN）

GDACS 是联合国、欧盟委员会和灾害管理机构的合作框架；台风影响等级由风速、暴露人口和脆弱性模型计算。它最合适填充“遭遇威胁区”“潜在影响国家”“潜在暴露人口”“GDACS 预警级别”，而不是实际损失。

### API（免费，需来源署名；无 API key）

| 目的 | 端点/调用 |
| --- | --- |
| 检索时间窗内的台风事件（GeoJSON） | `https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC&fromdate=YYYY-MM-DD&todate=YYYY-MM-DD&alertlevel=green;orange;red` |
| 读取事件与各期 episode | `https://www.gdacs.org/gdacsapi/api/events/geteventdata?eventtype=TC&eventid={eventId}` |
| 读取某次 episode 的模拟影响几何 | `https://www.gdacs.org/gdacsapi/api/polygons/getgeometry?eventtype=TC&eventid={eventId}&episodeid={episodeId}` |
| 近期轻量发现 | <https://www.gdacs.org/xml/rss_tc_7d.xml>（最近 7 天）或 <https://www.gdacs.org/xml/rss_tc_3m.xml>（最近 3 个月） |

搜索 API 单次最多 100 条，按日期分页（`pagenumber`、可选 `pagesize`）；官方建议通过记录 `datetime` 判断集合是否更新。官方 Swagger：<https://www.gdacs.org/gdacsapi/swagger/index.html>；快速入门：<https://gdacs.org/Documents/2025/GDACS_API_quickstart_v1.pdf>。

### 使用规则

- 以 `eventId + episodeId + sourceId` 保存版本；同一台风每次公告的多边形可能不同。选用最终 episode 做“全程回顾”，选最近 episode 做“未来 72 小时风险”，两者不能混成一张“实际影响范围”。
- 图例必须写清“GDACS 模拟的热带风暴级及以上潜在影响区”，不能用“红色受灾区”。
- “影响国家”来自该 episode 的模型暴露国家；加字段 `impact_kind: modeled_exposure`，并可显示 `population_ts`、`population_cat1`、预警颜色。地图范围可直接 fit 到此 GeoJSON 的 bbox，满足大图自适应缩放，而不是从世界底图固定缩放。
- 不以 GDACS 多边形代替 IBTrACS/浙江接口的官方中心路径；前者是风险足迹，后者是 best-track/业务路径。
- 来源署名为 `Global Disaster Alert and Coordination System, GDACS`，并遵循其 Terms of Use。GDACS 机制说明：<https://www.gdacs.org/knowledge/models_tc.aspx>。

## 实际影响与经济损失：EM-DAT（CRED / UCLouvain）

EM-DAT 是 CRED/UCLouvain 维护的全球灾害数据库。公共表的每一行是“一个灾害在一个受影响国家”的记录，可提供 `Event Name`、`Country`/`ISO`、起止日期、`Origin`、`Location`、人类影响及 `Total Damage ('000 US$)` 等字段。

### 获取方式与许可边界

- 公共数据：在 <https://public.emdat.be> 注册、登录后下载 XLSX；非商业用途免费但受 Terms of Use 约束，商业用途需要年度许可。
- EM-DAT 没有对未登录网页前端开放的逐台风无密钥实时 REST API。因此本项目应在服务端**人工/受控下载**后做版本化导入（原始文件校验值、下载时间、查询条件、许可证状态），而非把账号凭证写入应用。
- HDX 上的是国家年度聚合，不能回答“某一台风造成的直接经济损失”，不得拿来反推到某风暴。

### 经济字段的严格口径

1. 仅将 `Total Damage ('000 US$)` 展示为“EM-DAT 记录的总经济损失（发生年美元）”；它包括与灾害直接或间接有关的经济损失，因此**不等同于“直接经济损失”**。
2. 如产品必须写“直接经济损失”，只接受对应国家政府/灾后评估的逐事件原始报告，并保存报告机构、发布日期、币种、原始口径、链接和是否为初报/终报；不要把 EM-DAT 的 `Total Damage` 改名。
3. 每个 `DisNo.` 可能有多个国家行。跨国汇总仅在这些行确实对应同一 `DisNo.` 时求和；展示 `countries_covered`、`record_updated_at`，并且明确“覆盖的国家记录”，不能宣称全球总计。
4. 空值必须显示“未报告/未知”，绝不可显示为 0。EM-DAT 明确说明空经济影响字段既可能代表无影响，也可能代表未知或未报告，并提示经济损失有明显漏报偏差。

参考：

- <https://doc.emdat.be/docs/data-accessibility/>
- <https://doc.emdat.be/docs/data-structure-and-content/emdat-public-table/>
- <https://doc.emdat.be/docs/data-structure-and-content/impact-variables/economic/>

## 人道通报补充：UN OCHA ReliefWeb（不是损失数据库）

ReliefWeb 是 OCHA 提供的公开、只读 JSON API，适合给图鉴提供“机构通报/公告时间线”及来源链接。只能将其作为可追溯文本证据索引；报告内容来自合作机构，OCHA 不保证准确性，不能自动提取一个数字后标为官方总损失。

端点模式：`https://api.reliefweb.int/v2/reports?appname={pre-approved-appname}`。从 2025-11-01 起，`appname` 必须预先获批；有每日 1000 次请求、单次最多 1000 条的限制。使用 `disaster.name`、`country.name`、全文关键词和日期过滤，保存 `report.id`、来源组织、发布日期、URL 和引用文本。

文档：<https://apidoc.reliefweb.int/index.html>。

## “出生原因”的诚实数据策略

气旋“生成于某海域某时”可由路径首点精确描述；“因何生成/增强”是气象归因，不能仅凭海温、纬度或 LLM 推断补写。字段应拆成：

- `genesis_record`: 来自 IBTrACS/浙江接口的首个记录点、时间、来源；可自动生成。
- `genesis_explanation`: 仅接受 RSMC/TCWC、国家气象机构、WMO 或同行评审复盘的明确表述；保存原文短摘、文献 URL、发布日期和 `source_type`。无来源则显示“尚无可核验的逐风暴成因说明”。
- `game_lore`: 可以游戏化改写，但必须由 `genesis_record`、强度和路径等已有事实驱动，且标注“图鉴叙事”，不能伪装为气象结论。

## 跨源匹配与审计键

不要只用中文/英文名称匹配：名称复用、编号体系和盆地命名均会产生误配。建立可审计的 `storm_identity`：

```text
canonical_id: IBTrACS SID (首选) 或 浙江接口 tfid
aliases: { name, season, basin, agency ids }
source_links: { zhejiang_tfid, ibtracs_sid, gdacs_event_id, gdacs_episode_id, emdat_disno[] }
match_basis: { season, name_normalized, first_time_delta, track_overlap_score, reviewer }
```

自动匹配只有在同季、名称规范化一致、首个记录时间与路径重叠均在阈值内才可标记为 `candidate`；涉及 EM-DAT 损失或“受影响国家”的发布须人工升级为 `verified`。无法匹配时保留字段为空并显示来源缺口。

## 页面文案建议

- 红色地图层：`GDACS 风暴级风力潜在影响区（模型）`，不是“受灾范围”。
- 国家清单：`模型识别的潜在暴露国家`，同时给出公告/episode UTC 时间。
- 损失卡：`EM-DAT 记录的总经济损失（发生年美元）` 或 `官方报告的直接经济损失（报告口径）`；两种口径不可合并。
- 没有可核验数据：`档案尚未接入可核验的灾情报告`，不要写 0 或通过模型估算伪造金额。
