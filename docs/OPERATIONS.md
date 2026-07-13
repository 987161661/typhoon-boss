# 台风 BOSS 雷达运维手册

## 运行边界

| 链路 | 地址 | 责任 |
| --- | --- | --- |
| 雷达与直播页 | `http://127.0.0.1:3038` | 本项目 Next 服务 |
| 数字人上游 | 默认 `http://127.0.0.1:5173` | 外部凌岚运行时 |

3038 是本项目唯一约定端口。历史端口不应再出现在启动命令、日志名或排障结论中。

## 启动与验收

权威本机入口是项目根目录的 `Start-Typhoon-Live.cmd`。它会：

1. 启动或复用凌岚运行时；
2. 如 3038 未监听，使用 Next 开发模式启动本项目；
3. 验证 `/live`、`/api/health` 和 `/api/digital-host/health`；
4. 仅在发现至少一个活动台风且数字人健康接口可达时成功退出。

不要在该入口运行期间再手动启动第二个 3038 进程。若需要生产式构建验证，停止开发进程后执行：

```powershell
npm.cmd run build
npm.cmd run start -- -H 127.0.0.1 -p 3038
```

## 演进报告任务

`scripts/run_typhoon_evolution_agent.mjs` 会读取公开实况、生成分析，并写入：

- `.runtime/typhoon-evolution-agent.json`：任务状态和历史快照；
- `台风实时演进分析.md`：面向阅读的报告。

手动执行：

```powershell
npm.cmd run agent:run
```

周期调度默认关闭。需要周期写入或调用文档模型时，前往直播页运行设置，显式打开“自动整理与更新”并选择频率。`TYPHOON_EVOLUTION_AGENT_ENABLED=false` 可作为环境级总禁用开关；它优先于页面设置。多实例部署只允许一个实例启用调度。

## 运行数据与清理

`.runtime` 的内容分三类：

| 类别 | 示例 | 清理规则 |
| --- | --- | --- |
| 状态 | `live-control-settings.json`、`track-snapshot.json`、`storm-structure-ledger.json` | 保留，不能作为普通缓存删除 |
| 运行依赖与缓存 | `tools/wgrib2`、`python-packages`、`wind-field`、`satellite-images` | 保留；按功能失效或容量策略另行处理 |
| 诊断遗留 | ECMWF 测试抓包、旧预览日志、旧端口日志 | 可由清理脚本安全删除 |

执行完整清理：

```powershell
npm.cmd run clean:local
```

它会移除 `.next`，因此应在停止本项目 Web 服务后执行。服务仍在运行时，只清理第三类诊断遗留：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/clean_local_artifacts.ps1 -RuntimeOnly
```

当前启动日志固定写入 `runtime/logs/live-3038.current.*.log`；历史 `live-dev-*` 日志会被清理。数字人服务日志由其独立文件保留。

## 配置原则

- 控制台只展示当前实际被读取的设置；卫星源、环境预报源和“审计开关”等未接通选项已移除。
- 台风路径入口、官方预警和 Boss 解释层保持分离；不要把任何单一来源误标为全国权威预警。
- 实时接口必须使用 `no-store`；上游失败时展示最后有效状态及其时间，不能伪造新实况。
