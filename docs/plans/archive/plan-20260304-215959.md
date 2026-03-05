# Spanory 计划：增加 Codex watcher 兜底实时上报（2026-03-04）

## Goal
在 Codex notify 未触发时，提供文件变更 watcher 兜底链路，尽可能保证对话轮次实时上报。

## Scope
- In scope:
  - `packages/cli/src/index.js`：新增 `runtime codex watch` 命令。
  - `packages/cli/src/index.js`：抽取 hook 处理内核，供 watch 与 stdin hook 复用。
  - `packages/cli/test/bdd/*.spec.js`：新增 codex watch BDD（`--once`）。
  - `README.md` / `docs/README_zh.md`：补充 watcher 用法与场景。
  - `plan.md` / `todo.md`：阶段记录。
- Out of scope:
  - 改造 Codex 本身 notify 机制。
  - 增加 daemon/service 管理。

## Acceptance
- 可执行 `spanory runtime codex watch --once` 扫描并处理更新会话。
- watcher 复用 `--last-turn-only` 去重逻辑，不重复上报同一 turn。
- BDD 通过：`npm run --workspace @spanory/cli test -- test/bdd/codex.watch.integration.spec.js`。
