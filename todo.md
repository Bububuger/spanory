# Todo (2026-03-14) — BUB-17 工具调用内容 OTLP 脱敏

- [x] 归档上一阶段 `plan.md/todo.md`
- [x] 任务 1：编写失败测试复现泄露与未截断
  - [x] 验收检查：`cd packages/cli && npx vitest run test/unit/normalize.spec.ts -t "redacts file tool content before export"`
  - [x] 验收检查：`cd packages/cli && npx vitest run test/unit/normalize.spec.ts -t "truncates non-file tool payloads to configured max bytes"`
- [x] 任务 2：抽取共享 redaction 工具并接入 normalize
  - [x] 验收检查：两条 RED 用例转绿
- [x] 任务 3：回归关键单测
  - [x] 验收检查：`cd packages/cli && npx vitest run test/unit/normalize.spec.ts`
  - [x] 验收检查：`cd packages/cli && npx vitest run test/unit/codex.proxy.spec.ts`
- [x] 任务 4：静态检查
  - [x] 验收检查：`npm run check`
