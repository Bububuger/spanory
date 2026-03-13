# Plan (2026-03-14) — BUB-19 backfill 逐会话错误隔离

## 目标
1. 修复 `runtime <name> backfill` 在单会话异常时中断全流程的问题。
2. 对齐 `runCodexWatch` 的逐会话隔离语义：记录错误并继续处理后续会话。
3. 以 BDD 场景覆盖“坏会话 + 好会话”顺序，确保行为可回归验证。

## 执行顺序
1. 在 `packages/cli/src/index.ts` 的 backfill 循环引入逐会话 `try/catch`。
2. 统一错误日志格式，至少包含 `sessionId` 与简化错误信息。
3. 在 `packages/cli/test/bdd/codex.backfill.integration.spec.ts` 增加失败隔离测试。
4. 运行目标 BDD 与 `check` 验证。

## 验收标准
- 单个会话 `collectEvents`/`emitSession` 失败不会中断剩余会话处理。
- 控制台输出包含 `backfill=error sessionId=<id> error=<message>`。
- 新增 BDD 用例通过，且 `check` 通过。
