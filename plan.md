# Spanory 计划：Codex Runtime 双轨接入（2026-03-03）

## Goal
实现 Codex runtime 的可观测接入：
1) 基于 `~/.codex/sessions` 的语义解析链路（export/backfill/hook notify）
2) 基于代理劫持的请求/响应采集链路（全量采集 + 强脱敏 + 本地落盘）
并确保字段丰富度与现有 runtime（claude/openclaw/opencode）基本一致。

## Scope
- In scope:
  - `packages/cli/src/runtime/codex/adapter.js`（新增）
  - `packages/cli/src/runtime/codex/proxy.js`（新增）
  - `packages/cli/src/index.js`（注册 codex runtime + proxy 命令 + notify hook 解析）
  - `packages/cli/src/runtime/shared/capabilities.js`（新增 codex 能力）
  - `packages/core/src/index.ts`（补充 HookPayload 字段）
  - `packages/cli/test/unit/*`、`packages/cli/test/bdd/*`、`packages/cli/test/fixtures/codex/*`
  - `docs/runtime-capability-matrix.md`、`README.md`、`docs/README_zh.md`
- Out of scope:
  - 替换 Codex 原生 OTel
  - 远端存储与可视化 UI

## Acceptance
- `runtime codex export/backfill/hook` 可运行并产出包含 `turn/tool/mcp/shell/agent_task/usage/model` 的 JSON。
- `runtime codex hook` 支持 notify payload（`thread_id/turn_id/cwd`）并可按 turn 增量导出。
- `runtime codex proxy` 能转发请求，落盘前完成强脱敏，异常时不阻塞转发。
- 新增单测与 BDD 覆盖关键场景；`npm run check`、`npm test`、`npm run test:bdd` 通过。
