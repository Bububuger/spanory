# Todo (2026-03-14) — BUB-13 normalize.ts 拆分治理

- [x] 归档上一阶段 `plan.md/todo.md`
  - 验收：`ls docs/plans/archive | tail -n 3 && ls docs/todos/archive | tail -n 3`

- [x] 新建 `usage.ts` 并迁移 usage 相关函数
  - 验收：`rg -n "export function pickUsage|function usageAttributes|function modelAttributes" packages/cli/src/runtime/shared/usage.ts`

- [x] 新建 `content.ts` 与 `gateway.ts` 并迁移消息解析/输入归一化函数
  - 验收：`rg -n "export function extractText|export function isPromptUserMessage|export function normalizeUserInput" packages/cli/src/runtime/shared/content.ts packages/cli/src/runtime/shared/gateway.ts`

- [x] 新建 `turn.ts` 并迁移 `createTurn` 及其辅助函数
  - 验收：`rg -n "export function createTurn" packages/cli/src/runtime/shared/turn.ts`

- [x] 精简 `normalize.ts`：保留 pipeline/context，改用模块导入并维持 `pickUsage` 导出
  - 验收：`wc -l packages/cli/src/runtime/shared/normalize.ts && rg -n "createTurn|export \{ pickUsage \}" packages/cli/src/runtime/shared/normalize.ts`

- [x] 运行测试与检查
  - 验收：`npm run --workspace @bububuger/spanory test -- normalize.spec.ts`、`npm run check`、`npm test`

- [x] 提交并推送
  - 验收：`git status --short`
