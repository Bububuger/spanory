# Spanory 计划：修复 Codex notify 脚本仅支持参数 payload 问题（2026-03-04）

## Goal
让 `setup apply` 生成的 Codex notify 脚本同时支持 `$1` 与 `stdin` payload，避免新对话事件未上报。

## Scope
- In scope:
  - `packages/cli/src/index.js`：更新 `codexNotifyScriptContent`。
  - `packages/cli/test/bdd/setup.integration.spec.js`：补充脚本内容断言。
  - `plan.md` / `todo.md`：阶段记录。
- Out of scope:
  - 改动 Codex runtime 解析器。
  - 修改非 Codex runtime 行为。

## Acceptance
- 生成脚本包含 stdin fallback 逻辑。
- payload 为空时写入 skip 日志而非静默退出。
- BDD 通过：`npm run --workspace @spanory/cli test -- test/bdd/setup.integration.spec.js`。
