# Spanory 计划：一键 setup 四 runtime + README Agent 自安装提示（2026-03-03）

## Goal
将 Claude Code / Codex / OpenClaw / OpenCode 的本地集成配置收敛到 Spanory CLI 内置命令，降低手工配置成本；并在 README 增加可直接复制给 Agent 的安装提示。

## Scope
- In scope:
  - `packages/cli/src/index.js`：新增 `setup detect/apply/doctor` 命令。
  - `packages/cli/test/bdd/*.spec.js`：新增 setup 命令 BDD 覆盖。
  - `README.md`：新增 Agent 可复制的一键安装/配置指令。
  - `docs/README_zh.md`：同步中文说明。
  - `plan.md` / `todo.md`：本阶段执行记录。
- Out of scope:
  - 自动修改 Codex/Claude 的复杂高级策略配置（仅处理 Spanory 相关最小集）。
  - 远程发布流程改造。

## Acceptance
- CLI 支持：
  - `spanory setup detect`
  - `spanory setup apply`
  - `spanory setup doctor`
- `setup apply` 能幂等配置：
  - Claude `Stop/SessionEnd` hook
  - Codex `notify` + `~/.codex/bin/spanory-codex-notify.sh`
  - OpenClaw/OpenCode plugin 安装链路
- README（中英文）包含可复制给 Agent 的“自安装/自配置”命令块。
- 回归通过：`npm run check`、`npm test`、`npm run test:bdd`。
