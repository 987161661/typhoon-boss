# 城市卡世界观碎片框架

城市战况与世界观碎片是两条独立链路：天气卡只说可验证气象事实；碎片只负责建立可持续的后启示录悬念。

默认处于 `unresolved`：不确认历史、不命名阵营/人物/地点、不预言结局。首次主线定稿后，在 `.runtime/world-lore-framework.json` 写入如下结构，再重启服务：

```json
{
  "arcVersion": 1,
  "status": "canon",
  "canonFacts": ["只填写已经决定、允许公开的世界设定"],
  "allowedMotifs": ["封存", "回声", "边界", "维护"],
  "forbiddenTerms": ["尚未允许揭示的名词"],
  "maxRevealLevel": 1
}
```

服务在启动时异步补到 50 条；库存低于或等于 10 条时补 40 条。每条均持久化随机种子和已用记录，已展示文本不会回到库存。模型候选先按精确文本与二元词片段相似度过滤，才可入池。

系统提示词与 JSON 架构由 `lib/worldLoreFramework.ts` 统一生成。它要求模型输出 `text`、`semantic_key`、`motifs`、`reveal_level`，并拒绝直接向前端展示模型的原始输出。
