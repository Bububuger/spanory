# Spanory 计划：need_fix 问题修复与 README 可走通性增强（2026-03-03）

## Goal
修复 `need_fix.md` 提到的高优先级问题，确保用户按 README 能走通主流程；若环境差异导致失败，提供可执行排查建议。

## Scope
- In scope:
  - `packages/cli/src/index.js`：复用 env 加载模块。
  - `packages/cli/src/env.js`（新增）：增强 `~/.env` 解析与加载。
  - `packages/cli/test/unit/env.spec.js`（新增）：覆盖 env 解析/加载回归。
  - `README.md`：修正 Langfuse 认证示例、补充排查步骤。
  - `docs/README_zh.md`：同步修正认证示例与排查建议。
- Out of scope:
  - 新增 doctor 命令
  - 抓包链路改造

## Acceptance
- `.env` 支持 `export KEY=...` 格式并保持向后兼容。
- README 与中文文档中的 OTLP Header 示例正确（Basic Auth）。
- 文档包含最小可执行排查路径（401/env/hook 三类）。
- `npm run check`、`npm test`、`npm run test:bdd` 全通过。
