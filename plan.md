# Spanory 计划：修复 OpenCode 插件不触发上报并默认每轮触发（2026-03-04）

## Goal
提升 OpenCode 插件事件兼容性，默认按每轮事件触发上报；并提供参数切换为 session 触发模式。

## Scope
- In scope:
  - `packages/opencode-plugin/src/index.js`：扩展 flush 触发条件、默认 turn 模式、`onGatewayStop` 会话兜底 flush。
  - `packages/cli/test/unit/opencode.plugin.runtime.spec.js`：新增 turn 触发与模式参数测试。
  - `README.md` / `docs/README_zh.md`：补充 `SPANORY_OPENCODE_FLUSH_MODE` 说明。
  - `plan.md` / `todo.md`：阶段记录。
- Out of scope:
  - 新增 opencode transcript 离线 adapter。
  - 调整 OTLP payload schema。

## Acceptance
- 默认模式下 turn 完成事件可触发 flush。
- 参数 `SPANORY_OPENCODE_FLUSH_MODE=session` 可切换为 session 模式。
- gateway stop 时至少尝试 flush 已观测 session。
- `npm run --workspace @spanory/cli test -- test/unit/opencode.plugin.runtime.spec.js` 通过。
