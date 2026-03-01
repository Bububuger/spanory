# Spanory Runtime Version and Model Key Plan (2026-03-01)

## Goal
补齐 runtime/version 与通用模型字段：确保区分 instrumentation 版本（service.version）与 runtime 版本，并增加通用模型键。

## Scope
- `packages/cli/src/runtime/claude/adapter.js`
- `packages/cli/test/unit/adapter.spec.js`
- `packages/cli/test/fixtures/claude/projects/test-project/session-g.jsonl`（新增）
- `docs/langfuse-parity.md`

## Tasks
### T1 失败用例（TDD Red）
- 新增 fixture（带 transcript 顶层 `version`）。
- 单测断言存在：`agentic.runtime.version` 与 `gen_ai.request.model`。

### T2 实现（Green）
- transcript 解析提取 runtime version。
- turn/tool 事件统一补 `agentic.runtime.version`。
- 有模型的事件补 `gen_ai.request.model`（同时保留 `langfuse.observation.model.name`）。

### T3 文档与回归
- parity 文档补字段说明。
- 跑指定单测 + 全量测试。

## Acceptance
1. `npm run --workspace @spanory/cli test -- test/unit/adapter.spec.js`
2. `npm test`
