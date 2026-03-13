# Plan (2026-03-14) — BUB-25 alert 评估器逐规则重复聚合

## 背景
`evaluateRules` 当前在规则循环中多次调用 `evaluateSessionRule/evaluateAgentRule`，而这两个函数内部会重复执行 `summarizeSessions/summarizeAgents/summarizeCache/summarizeTurnDiff` 等聚合；当规则数增大时产生 N 倍重复计算。

## 目标
1. 将会话/代理聚合提升到 `evaluateRules` 外层，仅计算一次并复用。
2. 保持现有告警语义不变（同输入输出一致）。
3. 增加回归测试，锁定“聚合只执行一次”的行为。

## 执行顺序
1. 复现：先写一个失败测试，证明多条同 scope 规则会触发重复聚合调用。
2. 实现：在 `evaluate.ts` 引入预聚合上下文，并让规则评估函数读取上下文而非重复聚合。
3. 回归：运行目标单测确认红绿转换，并执行 `npm run check`。
4. 收尾：更新 `todo.md`、Linear workpad、提交并推送。

## 验收标准
- 单次 `evaluateRules` 执行中，会话/代理聚合各自只运行一次。
- 现有 `alert.spec.ts` 语义测试全部通过。
- 新增调用次数回归测试通过。
