# 台风 BOSS 雷达

面向直播和值守场景的本地台风态势页，提供主雷达、Boss 图鉴、`/live` 导播页和凌岚数字人窗口。

## 权威启动入口

双击 [Start-Typhoon-Live.cmd](Start-Typhoon-Live.cmd)。它会验证以下两条真实链路后才返回成功：

- 雷达直播页：`http://127.0.0.1:3038/live`
- 凌岚数字人：通过 `http://127.0.0.1:3038/api/digital-host/health` 验证，默认上游为 `5173`

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

`agent:run` 是一次性的演进报告生成。手动启动的周期任务默认关闭；但 `Start-Typhoon-Live.cmd` 会在健康检查通过后显式开启后台演进调度。它可能调用已配置的文档模型并更新 `台风实时演进分析.md`。

`clean:local` 会清除构建物和已知诊断遗留；需要在服务仍运行时只清理安全的运行诊断，可执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/clean_local_artifacts.ps1 -RuntimeOnly
```
