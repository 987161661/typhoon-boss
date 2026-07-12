# 台风 BOSS 雷达运维手册

## 运行结构

| 模块 | 责任 | 位置 |
| --- | --- | --- |
| 主数据适配 | 读取浙江省水利厅公开台风接口并构造页面快照 | `lib/realTyphoonData.ts` |
| 主页面与图鉴 | 雷达、地图、Boss 图鉴、公开数据接口 | `app/`、`components/TyphoonMap.tsx` |
| 直播导播 | 双场景轮换、底部互动栏、左侧导播面板 | `components/LiveDirector.tsx` |
| 数字人窗口 | 凌岚 iframe、健康检查、聊天转发、可拖动缩放窗口 | `components/DigitalHostWindow.tsx` |
| 实时整理智能体 | 台风事实、城市风场、文档报告的周期整理 | `lib/typhoonEvolutionScheduler.ts`、`scripts/run_typhoon_evolution_agent.mjs` |

## 启动与验证

1. 生产构建：`npm.cmd run build`
2. 启动页面：`npm.cmd run start -- -H 127.0.0.1 -p 3038`
3. 打开 `http://127.0.0.1:3038/live`。
4. 在左侧“配置设置”确认页面轮换与实时整理智能体的状态。
5. 数字人标题栏可拖动窗口，右下角青色手柄可缩放；位置和尺寸保存在浏览器本地设置中。

## 直播设置

直播设置通过 `GET/PATCH /api/live-control-settings` 读写，保存位置为：

`D:\typhoon boss radar\.runtime\live-control-settings.json`

可配置项：

- 直播场景轮换开关。
- 态势页与数据页的停留秒数。
- 实时文档整理智能体开关。
- 整理更新频率（5 至 360 分钟）。

设置修改后会立即重新安排下一次任务。环境变量 `TYPHOON_EVOLUTION_AGENT_ENABLED=false` 是最高优先级总开关。

## 凌岚数字人

默认数字人地址为 `http://127.0.0.1:5173`，可用 `NEXT_PUBLIC_LINGLAN_HOST_URL` 覆盖。直播页会读取 `/api/digital-host/health`，聊天消息通过 `postMessage` 转交给凌岚页面。

数字人服务、TTS 和 B 站监听由 `D:\vtuber\aituber-onair-main` 维护；本项目只负责导播页嵌入和本地互动入口。

## 实时文档整理智能体

执行一次：

```powershell
npm.cmd run agent:run
```

运行状态与报告：

- `.runtime/typhoon-evolution-agent.json`：状态与历史快照。
- `台风实时演进分析.md`：可读报告。

需要在 `.env.local` 中配置 `MINIMAX_API_KEY`。不要提交 `.env.local`、`.runtime` 或任何调试日志。

## 本地清理

```powershell
npm.cmd run clean:local
```

该命令会删除：浏览器自动化配置目录、Codex/Next 调试日志、`tmp`、参考截图、`.next` 与 TypeScript 构建信息。它不会删除源代码、`public/ui-rebuild` 的正在使用纹理、`node_modules`、`.env.local` 或 `.runtime`。

## 维护原则

- 实时接口必须保持 `no-store`；不要用缓存模拟实时。
- 将事实采集、演进整理、直播风格渲染分开维护。
- 直播页修改后至少执行 `npm.cmd run build`，并检查 `/live` 的两种场景。
- 新生成的设计实验、截图和代理工作流不要写入项目根目录；放在临时目录，并在验收后运行本地清理。
