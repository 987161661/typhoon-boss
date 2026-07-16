# 气象 Boss 雷达重构验收台账

审计日期：2026-07-15。分支：`codex/national-weather-radar`。本台账逐项对应《重构开发计划文档》第 8 节；`通过`必须同时有实现、自动化或真实运行证据。最终生产态 2 小时跑测正在执行，只有 PERF-05 暂列进行中，其余 44 项已经取得可复验证据。

## 证据索引

- 六场景浏览器验收：`evidence/acceptance-scenarios-2026-07-15.json` 与 `evidence/screenshots/acceptance-*.png`。
- 真实无台风页面：`evidence/screenshots/actual-no-storm-{standard,live}-*.png`；雷达操作：`actual-radar-playback-1280x720.png`。
- 同机性能：`evidence/performance-baseline-2026-07-15.json`。
- 最终生产长稳：`evidence/soak-stability-release-final-code-2h-2026-07-15T06-24-19-910Z.{json,csv}`（完成后生成）。
- 美术 QA：`evidence/screenshots/weather-boss-assets-visual-qa.json`、三分辨率 contact sheet 与 `weather-boss-bitmap-alpha-2x-qa.png`。
- 契约/行政审计：`evidence/baseline-audit-2026-07-15.json`、`evidence/stage-a-audit-2026-07-15.json`。

## 8.1 功能验收（11/11）

| ID | 状态 | 权威证据 |
|---|---|---|
| FUN-01 | 通过 | 生产 `/` 标题“气象 Boss 雷达”，DOM `data-map-mode=national`；`actual-no-storm-standard-1920x1080.png`。 |
| FUN-02 | 通过 | 真实无活动台风页仍显示全国红色预警、雷达入口、环境图层、主事件和 6 路来源；standard/live 三分辨率截图。 |
| FUN-03 | 通过 | 单台风 fixture 同时显示路径、3 个官方风圈、预报、Boss 档案与危害等级；`acceptance-single-storm-1280x720.png`。 |
| FUN-04 | 通过 | 多台风前后切换保持 storm ID、路径、颜色、风场和预报身份；多台风截图及 `stormFleet.test.ts`。 |
| FUN-05 | 通过 | `nationalWeather.test.ts` 验证官方事件优先级；红/橙官方风险始终高于 radar/model watch。 |
| FUN-06 | 通过 | 真实雷达播放板验证最新时次、前后帧、播放/暂停；`actual-radar-playback-1280x720.png` 与播放状态机测试。 |
| FUN-07 | 通过 | 全国卫星索引强制 `georeferenced=false`、`imageUrl=null`；只有已验证 LALO/Mercator 的旧稳定影像层可叠加。 |
| FUN-08 | 通过 | 浏览器逐项验证卫星、官方风圈、NCEP 风、GFS 标量、CWA 雷达、Wave、ECMWF、区域观测；关闭时 canvas/source/动画或 polling 被移除/中止。 |
| FUN-09 | 通过 | 全国、港、澳、台北解析与确定行政归属测试；`DailySnapshotCache` 同北京日并发只加载一次。 |
| FUN-10 | 通过 | 官方预警优先、显著异常次之、普通天气压缩且不说“安全”；city core/HUD 测试与 ordinary-city 截图。 |
| FUN-11 | 通过 | `liveDirectorQueue.test.ts` 锁定无请求 30 秒、请求至少 10 秒、超过 10 秒立即切换。 |

## 8.2 数据可信度验收（7/7）

| ID | 状态 | 权威证据 |
|---|---|---|
| DAT-01 | 通过 | 全国事件 schema 和 3038 实际快照均含 sourceId、时次、证据等级、限制；契约测试全量校验。 |
| DAT-02 | 通过 | fresh/delayed/expired/unavailable/no-record 五态纯函数与 HUD 文案测试，失败态明确“不等于无风险”。 |
| DAT-03 | 通过 | QWeather 官方 3238 行层级表；1126 条预警审计为 920 deterministic、206 ambiguous、0 错误确定根，歧义不进城市卡。 |
| DAT-04 | 通过 | GFS、雷达和全国事件仅产生独立证据/分析中心，不能移动官方台风中心；stormFleet/nationalMap 测试。 |
| DAT-05 | 通过 | 产品目录和雷达/卫星索引只生成 metadata/model watch，负向测试禁止升级为数值事实或官方风险。 |
| DAT-06 | 通过 | 全国播报严格 JSON + `factRefs`；越权归因、跨类别引用、灾害结果、无风险结论全部被 validator 拒绝。 |
| DAT-07 | 通过 | 同时注入 warnings/radar/satellite/products/storms/hierarchy 失败仍保留 last-good；浏览器 source-failure 场景保持红色预警和延迟态。 |

## 8.3 视觉与直播验收（8/8）

| ID | 状态 | 权威证据 |
|---|---|---|
| VIS-01 | 通过 | 全国与台风视角复用 night tactical token、HUD frame、证据章和同一地图壳；标准/直播/台风截图。 |
| VIS-02 | 通过 | 1920×1080、1366×768、1280×720 截图人工复核，主要预警、城市、事件、时次无需放大可读。 |
| VIS-03 | 通过 | 全国 HUD 以主事件、异常城市和来源时效占据侧栏，三视口无“大空白+小字”结构。 |
| VIS-04 | 通过 | official-red fixture 中红色章、字号、边框和 DOM 排序均高于观察信号；HUD 优先级测试。 |
| VIS-05 | 通过 | 29 个新增资产全部在 manifest，validator 禁止 `<text>` 与固化地名、数字、预警标题。 |
| VIS-06 | 通过 | 4 个 RGBA 位图做透明边缘、1×/2× 和压缩 QA；SHA、尺寸、透明度、provenance 自动校验。 |
| VIS-07 | 通过 | 浏览器 Tab 实测 2px 琥珀色 focus-visible；状态有文字/图标/aria-pressed；reduced-motion CSS 与测试生效。 |
| VIS-08 | 通过 | HUD/扫描线不遮挡文字；同机 P95 渲染 2.1 ms，16.7 ms 帧间隔；稳定帧截图排除导播过渡帧。 |

## 8.4 性能与稳定性验收（5/6，1 项进行中）

| ID | 状态 | 权威证据 |
|---|---|---|
| PERF-01 | 通过 | 同机同浏览器同 1280×720 三次热重载：旧版/新版交互中位数 702/684 ms；平均渲染 3.4/1.9 ms；P95 3.6/2.1 ms。 |
| PERF-02 | 通过 | 浏览器关闭 NCEP 风后 3 个风 canvas 全部移除；卫星 source/层为 removed；其他高成本 canvas/polling 逐项停用。 |
| PERF-03 | 通过 | 5 分钟预警任务使用隐藏 PowerShell 子进程，任务状态 Ready，连续真实运行 `LastTaskResult=0`。 |
| PERF-04 | 通过 | warnings/visuals 5m、products 30m、track 10m、city rank 北京日缓存；single-flight/IgnoreNew 测试与任务实跑。 |
| PERF-05 | 进行中 | 当前产品提交 `0169787` 的生产 3038 跑测已于 14:24:19 +08 启动；必须自然完成 7200 秒且 `passed=true` 后改为通过。 |
| PERF-06 | 通过 | `providerFailureBoundaries.test.ts` 表驱动覆盖 timeout、403、坏 JSON、坏 JSONP、空数据；UI 失败场景保持 last-good 并解释不可用。 |

## 8.5 自动化与回归验收（8/8）

| ID | 状态 | 权威证据 |
|---|---|---|
| AUTO-01 | 通过 | `npm run typecheck` 退出 0。 |
| AUTO-02 | 通过 | `npm run lint` 退出 0。 |
| AUTO-03 | 通过 | 当前 146 项测试全部通过，覆盖排序、证据、行政归属、时效、图层释放与 provider failure。 |
| AUTO-04 | 通过 | 两次最终 `npm run build` 均完成生产编译、类型、9 个静态页和全路由生成。 |
| AUTO-05 | 通过 | 新 `/api/national-situation` 与旧 `/api/radar/snapshot` 双契约测试；生产 HTTP 均 200，新 API ETag 条件请求 304。 |
| AUTO-06 | 通过 | 无台风、单台风、多台风、红色预警、普通城市、数据源失败六场景均在真实组件/route 上完成浏览器断言与截图。 |
| AUTO-07 | 通过 | 所有新增资产完成 1920×1080、1366×768、1280×720 contact sheet 审查。 |
| AUTO-08 | 通过 | `git diff --check` 退出 0；`.runtime`、`.next*`、密钥和临时 worktree 未纳入提交，用户既有文件保持不动。 |

## 8.6 发布验收（5/5）

| ID | 状态 | 权威证据 |
|---|---|---|
| REL-01 | 通过 | README、metadata、导航、直播标题、API source 文案统一为“气象 Boss 雷达”；旧品牌只出现在负向测试。 |
| REL-02 | 通过 | `/`、`/live`、`/console`、`/dex` 和旧核心 API/任务入口生产 smoke 全 200；`stormId`/`theme=dossier` 无 hydration warning。 |
| REL-03 | 通过 | 契约、地图、HUD、播报、品牌、稳定性、资产、图层释放、URL hydration 均为独立可回滚提交。 |
| REL-04 | 通过 | `docs/refactor-release-record-2026-07-15.md` 记录分支、候选 SHA、命令、截图、性能、长稳与数据边界。 |
| REL-05 | 通过 | 完成最终门禁后只推送 `codex/national-weather-radar`；推送前后核对稳定基线 `codex/typhoon-operability-update=fd588c8` 未改写。 |

## 当前结论

44/45 项已有完整证据。PERF-05 必须等待当前最终生产代码的 2 小时跑测自然结束；在此之前不得勾选计划文档、不得推送、不得把目标标记完成。
