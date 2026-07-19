# 气象 Boss 雷达

面向直播和值守场景的全国气象态势页。首页默认展示官方预警、雷达索引、环境信号、主事件与来源时效；活动台风通过独立指挥视角继续提供路径、风圈、预报、Boss 图鉴和 `/live` 导播能力。

数据口径：官方预警事实、实况/元数据观察和模式推断在统一快照中分层呈现。图像索引和产品目录不被改写为天气数值，来源失败也不表示“无风险”；城市预警只接受可由官方行政层级唯一确定的归属。

## 权威启动入口

双击 [Start-Typhoon-Live.cmd](Start-Typhoon-Live.cmd)。它会自动启动并验证雷达直播页和凌岚数字人：

- 雷达直播页：`http://127.0.0.1:3038/live`
- 凌岚数字人：通过 `http://127.0.0.1:3038/api/digital-host/health` 验证，默认上游为 `5173`。数字人本体不依赖 B 站房间号；如需仅启动雷达，可在 PowerShell 执行 `scripts/start_live_with_linglan.ps1 -NoLinglan`。

该入口当前以 Next 开发模式启动，适合本机直播和值守。不要同时再用 `npm run dev` 或 `npm run start` 占用 3038。

生产式手动验证仅在需要构建产物时使用：

```powershell
npm.cmd run build
npm.cmd run start -- -H 127.0.0.1 -p 3038
```

完整的运行、清理和故障边界见 [运维手册](docs/OPERATIONS.md)。

## 常用命令

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test
npm.cmd run agent:run
npm.cmd run clean:local
```

`agent:run` 是一次性的演进报告生成。手动启动的周期任务默认关闭；但 `Start-Typhoon-Live.cmd` 会在健康检查通过后显式开启后台演进调度。它可能调用已配置的文档模型并更新 `台风实时演进分析.md`。当没有活动台风时，报告会改用 JTWC 近时扰动公报与 NOAA CPC 第2/3周概率区生成“潜在台风胚胎研判”；定性等级与数值概率保持不同口径。

`clean:local` 会清除构建物和已知诊断遗留；需要在服务仍运行时只清理安全的运行诊断，可执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/clean_local_artifacts.ps1 -RuntimeOnly
```
