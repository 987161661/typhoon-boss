# 气象 Boss 雷达重构发布记录

## 发布身份

- 日期：2026-07-15（Asia/Shanghai）
- 分支：`codex/national-weather-radar`
- 最终产品候选提交（证据文档提交之前）：`0169787ca849df48160bee2b7585a2b4068815aa`
- 稳定基线：`origin/codex/typhoon-operability-update` = `fd588c83e07a3d35f8a125eaab93b3eedefa227d`
- 远端目标：`origin/codex/national-weather-radar`

## 发布门禁

| 门禁 | 结果 |
|---|---|
| `npm.cmd run typecheck` | 通过 |
| `npm.cmd run lint` | 通过 |
| `npm.cmd test` | 通过；最终应为 146/146 |
| `npm.cmd run build` | 通过；Next 生产编译、类型、9 个静态页、动态 API 路由生成完成 |
| `git diff --check` | 通过 |
| 新/旧 API | `/api/national-situation` 与 `/api/radar/snapshot` 均 200；全国快照 ETag 条件请求 304 |
| 生产页面 | `/`、`/live`、`/console`、`/dex` 均 200；全新浏览器标签 error/warn 为 0 |
| fixture 隔离 | production 查询 `acceptanceScenario=single-storm` 被拒绝，未出现 acceptance storm |
| 计划任务 | 5 分钟预警任务与全国城市榜任务实际 `LastTaskResult=0` |
| 最终生产长稳 | 进行中：`soak-stability-release-final-code-2h-2026-07-15T06-24-19-910Z` |

## 同机性能

协议：同一 Windows 主机、同一 Codex 内置浏览器、同一标签页、1280×720；各自预热后连续三次 reload，以 `data-ready=true` 和 wind canvas 都出现的较晚时点作为首次可交互，再稳定 8 秒读取 canvas 诊断。

| 指标 | 旧版 `a6e9478` | 候选 `5453de9` | 变化 |
|---|---:|---:|---:|
| 首次可交互中位数 | 702 ms | 684 ms | -2.56% |
| 平均帧间隔 | 16.7 ms | 16.7 ms | 0% |
| 平均风场渲染 | 3.4 ms | 1.9 ms | -44.12% |
| P95 风场渲染 | 3.6 ms | 2.1 ms | -41.67% |

完整原始值：`evidence/performance-baseline-2026-07-15.json`。候选实际使用 NOAA/NCEP 格点，历史基线当时回退到 Open-Meteo，因此这是两提交真实运行行为的同机比较，不是同一上游 payload 的实验室基准。

## 浏览器证据

- 六确定性场景：`evidence/acceptance-scenarios-2026-07-15.json`。
- 真实生产首页：`evidence/screenshots/actual-no-storm-standard-1920x1080.png`。
- 真实生产直播：`evidence/screenshots/actual-no-storm-live-1920x1080.png`；仅保留 `data-ready=true`、启动遮罩消失后的稳定帧。
- 单台风官方风圈：`evidence/screenshots/acceptance-single-storm-1280x720.png`；浏览器诊断开启 3、关闭 0/hidden、重开 3/visible。
- 雷达播放：`evidence/screenshots/actual-radar-playback-1280x720.png`。
- 资产三分辨率与透明边缘：`evidence/screenshots/weather-boss-assets-*.png`、`weather-boss-bitmap-alpha-2x-qa.png`。

## 数据边界

- 全国卫星索引仍是 metadata：`georeferenced=false`、无可叠加 image URL；没有把未标定索引伪装成地图图层。
- 旧环境卫星层只使用已验证的 LALO/Mercator bounds；关闭时删除 raster layer 和 source，重开时重建。
- 雷达/产品目录/model 信号不升级为官方事实；智能体灾害、预警和归因必须有合法 `factRefs`。
- 官方预警行政归属只接受官方层级表的确定映射；ambiguous 记录不进入城市卡。
- 来源失败保留 last-good；unavailable/no-record 都不表示“安全”或“无风险”。
- 当前实况无活动台风；浏览器单/多台风证据来自仅在非 production 且显式开关下可用的验收 fixture。
- 2 小时跑测采样 API/进程/内存/句柄/线程和请求节奏，不等于对所有外部上游做 2 小时压力测试。

## 变更与工作区边界

未提交且不属于本次发布：用户的 `next-env.d.ts`、`台风实时演进分析.md`、`scripts/experiment_city_broadcasts.mjs`。`.runtime`、`.next*`、环境文件、密钥和临时 worktree 均排除。

## 推送核对（最终门禁完成后填写）

- 最终发布提交：待证据提交生成。
- 远端分支 SHA：待推送。
- 稳定基线远端 SHA：必须仍为 `fd588c83e07a3d35f8a125eaab93b3eedefa227d`。
