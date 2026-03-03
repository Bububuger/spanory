# Spanory 计划：修复 Codex notify 路径 ~ 不展开问题（2026-03-04）

## Goal
避免 Codex `notify` 配置使用 `~` 导致脚本不触发，确保 `setup apply` 统一写入可执行的绝对路径。

## Scope
- In scope:
  - `packages/cli/src/index.js`：`setup apply` 写入 Codex notify 绝对路径。
  - `packages/cli/test/bdd/setup.integration.spec.js`：补充绝对路径断言。
  - `README.md` / `docs/README_zh.md`：更新文档说明，明确 notify 使用绝对路径。
  - `plan.md` / `todo.md`：本阶段记录。
- Out of scope:
  - 调整 Codex proxy 模式行为。
  - 非 Codex runtime 的配置策略改动。

## Acceptance
- `spanory setup apply` 生成的 `~/.codex/config.toml` 中 `notify` 为绝对路径。
- 相关 BDD 断言覆盖绝对路径。
- 文档不再暗示 `notify` 使用 `~`。
- 回归通过：至少 `npm run --workspace @spanory/cli test -- test/bdd/setup.integration.spec.js`。
