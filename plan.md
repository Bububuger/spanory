# Plan (2026-03-14) — 全仓 ESLint/Prettier/Husky 基线

## 目标
1. 在仓库根建立统一的 ESLint 与 Prettier 机制，覆盖 `packages/*` 主要源码与脚本文件。
2. 在提交前通过 Husky + lint-staged 自动执行可增量的 lint/format 门禁。
3. 保持改动最小，不引入大规模格式化噪音；新增命令可直接在根目录执行。

## 文件范围（最小集）
- `package.json`（根）
- `eslint.config.js`
- `.prettierrc.json`
- `.prettierignore`
- `.husky/pre-commit`

## 实施步骤
1. 设计并落地 ESLint/Prettier 配置：
   - ESLint 使用 JS + TS 基础规则（避免类型依赖过重导致性能回归）。
   - Prettier 对齐现有风格（`singleQuote: true`）。
2. 在根 `package.json` 新增脚本与开发依赖：
   - `lint`、`format`、`format:check`、`prepare`。
   - 增加 `lint-staged` 配置，仅检查暂存文件。
3. 接入 Husky pre-commit：
   - 提交前执行 `lint-staged`。
4. 逐项验收：
   - 先验证新增命令可运行。
   - 再验证 `lint-staged` 触发链路。
   - 最后回归 `npm run check`。

## 验收标准
- 根目录存在可执行且可复用的 `lint` 与 `format:check` 命令。
- 提交前 hook 生效，`pre-commit` 可触发 `lint-staged`。
- 至少一条“修复前失败 / 修复后通过”证据在工作记录中可追溯。
- 不引入与任务无关的大面积代码重排。
