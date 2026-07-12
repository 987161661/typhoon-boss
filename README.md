# 台风 BOSS 雷达

面向直播与值守场景的本地台风态势页面。项目同时提供：主雷达页、Boss 图鉴、直播导播页、凌岚数字人窗口，以及台风实时演进整理任务。

## 页面与入口

- `/`：主雷达页。
- `/dex`：台风 Boss 图鉴。
- `/live`：双场景直播导播页；左侧为控制面板，底栏可向凌岚发送消息。

## 启动

```powershell
cd "D:\typhoon boss radar"
npm.cmd run build
npm.cmd run start -- -H 127.0.0.1 -p 3038
```

若需同时检查凌岚服务与本项目的直播入口：

```powershell
npm.cmd run live:with-host
```

完整的运行、配置和故障处理说明见 [运维手册](docs/OPERATIONS.md)。

## 常用命令

```powershell
npm.cmd run typecheck
npm.cmd run build
npm.cmd run agent:run
npm.cmd run clean:local
```

控制台无需管理员登录。网页进程启动时会自动调用 MiniMax 完成一次演进整理，并按直播设置中的间隔持续运行。

`clean:local` 只删除本地调试缓存、日志、浏览器自动化配置和构建中间物；不删除 `.runtime` 里的直播设置与演进状态。
