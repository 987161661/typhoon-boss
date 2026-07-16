# 城市卡世界观碎片框架

城市战况与世界观碎片是两条独立链路：天气卡只说可验证气象事实；碎片只负责建立可持续的后启示录悬念。

内置版本当前处于 `canon`，主线依据 `docs/world-lore-chronicle.md`，生成方法依据 `docs/world-fragment-minimax-prompt-design.md`。如需在部署时覆盖章节，可在 `.runtime/world-lore-framework.json` 写入如下结构，再重启服务：

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

服务在启动时异步补到 50 条；库存低于或等于 10 条时补 40 条。空池补齐会把任务卡拆成每批 10 条，最多 5 个 MiniMax 请求并行执行；单批失败不会抛弃其他成功批次，后续轮次只补缺额，连续两轮无进展则停止，避免无限付费重试。

正式短句使用 8—48 个汉字硬边界。首轮优选长句最多 20%；只在补缺阶段允许放宽到 26%，因此完整 50 条库存仍至少有 74% 不超过 30 字。每条均持久化随机种子、语义键、母题、说话者、修辞、长度档位、揭示等级和已用记录，已展示文本不会回到库存。模型候选先经过禁词、揭示等级、精确文本、语义键和二元词片段相似度过滤，才可入池。

系统提示词与 JSON 架构由 `lib/worldLoreFramework.ts` 统一生成；任务卡、并发器、双格式 JSON 解析与本地质量门由 `lib/worldFragmentGeneration.ts` 统一负责。它要求模型输出 `brief_id`、`text`、`semantic_key`、`motifs`、`speaker`、`thesis`、`rhetoric`、`length_tier`、`reveal_level`，并拒绝直接向前端展示模型的原始输出。
