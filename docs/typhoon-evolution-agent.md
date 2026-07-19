# 台风演进分析智能体

该任务由 `scripts/run_typhoon_evolution_agent.mjs` 执行：读取公开台风实况、对比上一轮快照、整理城市风场，并生成中文演进报告。它还读取 `.runtime/national-situation.json`，通过 `lib/agent/nationalSituationBroadcast.mjs` 建立有限事实目录，生成带 `factRefs` 的结构化全国态势播报。任务会更新根目录的 `台风实时演进分析.md` 和 `.runtime/typhoon-evolution-agent.json`。

当活动台风列表为空时，任务不再只写“无活动台风”，而是切换到 `lib/agent/tropicalDisturbanceOutlook.mjs`：

- JTWC `ABPW10` 西北太平洋显著天气公报：提取未来约 24 小时的 Invest/扰动位置、LOW/MEDIUM/HIGH 发展潜势、风速、气压及可结构化环境信号。
- NOAA CPC Week-2 / Week-3 热带气旋生成概率 KML：提取落入西北太平洋的 20%、40%、60% 区域、有效期、几何中心及覆盖范围。
- 两类概率严格分开：JTWC 等级是定性结论，不擅自换算百分比；CPC 百分比是一个区域在一个星期内的生成概率，不是单个胚胎的定点概率或路径概率。
- 若两个来源均未识别候选，只能写“当前未识别到可信候选”，不能写“零概率”或让语言模型补造一个位置。

全国播报合同把内容分为 `official_fact`、`observation` 和 `model`。每段必须引用同类别的输入事实；越权归因、无引用灾情、把雷达/卫星/GFS 元数据升级为天气结论、把来源失败写成无风险，都会被确定性校验器拒绝并切换到规则化保底播报。已有台风的专属 Markdown 演进分析继续由 MiniMax 在有限事实内汇总；无活动台风时的胚胎研判由确定性解析模块生成，避免模型把气象知识或全国预警误写成实时胚胎事实。

## 数据充分性

当前接入后的数据足以发布两层官方研判：未来约 24 小时的 JTWC 扰动等级，以及第 2/3 周的 CPC 区域概率。它仍不足以生成本项目自有、逐 6 小时更新的精确百分比。若要建设自有概率，需要增加并校准：

1. GEFS/ECMWF 集合成员中的预生成涡旋轨迹或可复算的海平面气压、850 hPa 涡度、850/200 hPa 风切变、中层湿度等场；
2. 实时海温/海洋热含量及有地理标定的 Himawari 深对流证据；
3. 历史 Invest 到热带风暴的样本、统一生成定义和可靠性校准，不能把“集合成员占比”未经校准直接当成真实概率；
4. 多源时次、空间匹配、来源健康和回测评分。

MiniMax M3 通过 OpenAI 兼容聊天接口调用，不能直接安装 Codex 的本地 skill。项目应把“气象专家能力”实现为受版本控制的数据合同、规则、结构化提示和校验器；实时事实必须来自上述适配器，而不是来自模型参数记忆。本轮没有给 M3 注入可自由推断概率的提示词。

## 运行方式

手动运行一次：

```powershell
npm.cmd run agent:run
```

手动启动的 Next 进程默认不运行周期任务。`Start-Typhoon-Live.cmd` 会在服务健康检查通过后显式开启“自动整理与更新”，并立即触发首轮整理；之后按所选间隔运行。该行为会写入运行状态，并在配置了 Key 时调用文档模型。

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
