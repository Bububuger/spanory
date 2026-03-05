# CI Dist 依赖缺失修复 Plan (2026-03-05)

## Goal
修复 CI `Unit Tests` 阶段因找不到 `../../otlp-core/dist/index.js` / `../../backend-langfuse/dist/index.js` 导致的失败，恢复主线流水线稳定通过。

## Root Cause (已验证)
- `packages/cli/src/otlp.ts`、`packages/openclaw-plugin/src/index.ts`、`packages/opencode-plugin/src/index.ts` 依赖 sibling package 的 `dist` 产物。
- CI 当前执行顺序是 `npm ci -> npm run check -> npm test`，在 `npm test` 前未构建 workspace `dist`。
- 本地之所以偶发不复现，是因为本机已有历史 `dist` 文件。

## Scope
- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `plan.md` / `todo.md`

## Tasks
### T1 在 CI 主流程补构建前置
- 在 `ci.yml` 的 `quality-gates` job 中，`Check` 后增加 `Build`（`npm run build`）。
- 保持原有 `Unit Tests` / `BDD Tests` 顺序不变。

### T2 在 Release 验证流程补构建前置
- 在 `release.yml` 的 `verify` job 中，`Check` 后增加 `Build`（`npm run build`）。
- 保持 release 其他行为不变。

### T3 回归验证
- 本地执行与 CI 等价顺序：`npm run check && npm run build && npm test`。
- 提交并推送后观察最新 CI run。

## Acceptance
1. 本地 `npm run check && npm run build && npm test` 通过。
2. 推送后最新 CI run 不再出现 `Cannot find module ../../*-core/dist/index.js` 类错误。
