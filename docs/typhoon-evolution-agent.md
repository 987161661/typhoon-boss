# 台风演进分析智能体

该任务由 `scripts/run_typhoon_evolution_agent.mjs` 执行：读取公开台风实况、对比上一轮快照、整理城市风场，并生成中文演进报告。它会更新根目录的 `台风实时演进分析.md` 和 `.runtime/typhoon-evolution-agent.json`。

## 运行方式

手动运行一次：

```powershell
npm.cmd run agent:run
```

周期运行默认关闭。只有在直播页运行设置中明确开启“自动整理与更新”后，Next 进程才会在所选间隔调度任务。该行为会写入运行状态，并在配置了 Key 时调用文档模型，因此不是普通页面启动的隐式副作用。

环境变量 `TYPHOON_EVOLUTION_AGENT_ENABLED=false` 是总禁用开关，可用于临时维护或多实例部署；多实例时只允许一个实例在页面设置中启用调度。

## 配置

在 `.env.local` 中配置：

```dotenv
MINIMAX_API_KEY=你的_Token_Plan_Key
# 可选：用于 MET Norway 城市风场请求的部署方标识
WEATHER_API_USER_AGENT=TyphoonBossRadar/2.0 your-contact
```

若文档模型本轮失败，任务只会基于公开事实生成规则化保底摘要；路径主接口失败则保留原报告，不会伪造新的台风实况。

`.env.local`、`.runtime/` 和 `runtime/` 都不提交到版本库。详细启动与清理边界见 [运维手册](OPERATIONS.md)。
