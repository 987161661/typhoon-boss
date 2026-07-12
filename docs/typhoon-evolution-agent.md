# 台风演进分析智能体

该任务是项目内置的后台智能体，由 `scripts/run_typhoon_evolution_agent.mjs` 执行，负责：

- 每次直接拉取浙江省水利厅公开台风路径接口，不复用上一轮实况数据；
- 对比本轮与上一轮的公开实况点，严格区分“上游新报文”与“只是重新轮询”；
- 调用 `MiniMax-M3` 生成中文演进分析；
- 采集全国 34 个省级行政区代表城市的 10 米风场，并确定性生成“当前风力等级”表格；
- 更新项目根目录的 `台风实时演进分析.md`，保留最近 24 小时（48 次）的运行记录；
- 将仅供比较使用的运行状态写入 `.runtime/typhoon-evolution-agent.json`。

## 本机配置

在项目根目录的 `.env.local` 中配置：

```dotenv
MINIMAX_API_KEY=你的_Token_Plan_Key
# 可选：为 MET Norway 城市风场接口提供部署方标识
WEATHER_API_USER_AGENT=TyphoonBossRadar/2.0 your-contact
```

`.env.local` 与 `.runtime/` 均被 Git 忽略，密钥不会写入分析文档或版本库。

## 手动执行

```powershell
node scripts/run_typhoon_evolution_agent.mjs
```

## 内置调度与部署

项目根目录的 `instrumentation.ts` 会在 Next.js 的 Node 服务实例启动时初始化调度器：

- 服务启动后立即执行一轮，确保文档不是空白；
- 之后在每小时第 0 和第 30 分钟执行；
- 同一进程内如果上一轮尚未完成，会跳过重叠触发；
- 调度器通过子进程运行脚本，完全不依赖 Codex、浏览器或人工会话。

部署到其他机器时，复制 `.env.local`（或以环境变量提供 `MINIMAX_API_KEY`）后，使用常驻 Node 进程启动即可：

```powershell
npm.cmd run build
npm.cmd run start
```

该机制要求一个常驻的 Node 进程；无状态 Serverless 实例无法保证定时器存活。多实例部署时，只应让一个实例设置 `TYHOON_EVOLUTION_AGENT_ENABLED=true`，其余实例设置为 `false`，以避免重复分析。

若 MiniMax 本轮没有返回可发布正文，脚本会使用只基于公开事实的规则化保底摘要，城市风力表仍会更新。城市风场暂时失败时会保留最后有效值并逐行标注“延迟保护”；台风路径主接口失败时任务仍会失败退出并保留原文档，避免伪造新的路径实况。
