# Plan (2026-03-14) — BUB-5 移除业务逻辑 `@ts-nocheck`

## 目标
1. 按工单优先级移除业务逻辑文件中的 `@ts-nocheck`，恢复 TypeScript 编译期约束。
2. 让 `core` 暴露的类型契约（如 `SpanoryEvent`、`RuntimeAdapter`）在消费侧重新生效。
3. 保持现有行为不变，仅做类型安全修复与必要最小重构。

## 范围
- `packages/cli/src/env.ts`
- `packages/cli/src/otlp.ts`
- `packages/cli/src/runtime/shared/capabilities.ts`
- `packages/cli/src/runtime/**`（含 adapters 与 `normalize.ts`）
- `packages/cli/src/alert/evaluate.ts`
- `packages/cli/src/report/aggregate.ts`
- `packages/cli/src/index.ts`
- `packages/openclaw-plugin/src/index.ts`
- `packages/opencode-plugin/src/index.ts`
- `packages/backend-langfuse/src/index.ts`
- `packages/alipay-cli/openclaw-plugin/src/index.ts`

## 非目标
- 不引入新功能或行为变更。
- 不重写 adapter/plugin 架构。
- 不扩展 telemetry 字段。

## 实施步骤
1. 建立类型基线与分组清单：确认所有 `@ts-nocheck` 文件与当前类型报错分布。
2. 第一批（核心入口）清理：`env.ts`、`otlp.ts`、`capabilities.ts`。
3. 第二批（runtime/adapter/alert/report）清理：逐文件移除并修正显式类型。
4. 第三批（plugin/backend）清理：`openclaw-plugin`、`opencode-plugin`、`alipay-cli/openclaw-plugin`、`backend-langfuse`。
5. 第四批（高耦合入口）清理：`normalize.ts`、`index.ts`。
6. 全量验证与交付：执行 `npm run check`、`npm test`、`npm run telemetry:check`，准备提交与 PR。

## 验收标准
- 目标范围内文件不再包含 `// @ts-nocheck`。
- `npm run check` 通过。
- `npm test` 通过。
- `npm run telemetry:check` 通过。
- 无临时验证改动残留在最终提交中。
