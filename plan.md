# Spanory TS 迁移 Plan（收官批次：CLI core + backend + plugins）(2026-03-04)

## Goal
完成剩余源码模块的 TypeScript 源迁移，形成“TS 源 + 生成 JS 运行文件”的统一工程形态。

## Scope
- `packages/cli/src/{index,env,otlp,alert/report}`
- `packages/backend-langfuse/src/index`
- `packages/openclaw-plugin/src/index`
- `packages/opencode-plugin/src/index`
- `packages/otlp-core` build 脚本对齐 TS
- 各包 tsconfig 与 scripts
- 全量门禁验证

## Tasks
### T1 基建与脚本对齐
- 为 backend/openclaw-plugin/opencode-plugin 增加 tsconfig 与 check/build 脚本。
- 对齐 otlp-core build 到 tsc。

### T2 剩余源码迁移
- 将上述剩余 `.js` 源迁移为 `.ts`。
- 使用 tsc 生成同路径 `.js` 运行文件，保持入口与 import 契约不变。

### T3 验收
- 分包 build/check。
- 全仓门禁：`npm run check && npm test && npm run test:bdd`。

## Acceptance
1. `npm run build`
2. `npm run check`
3. `npm test`
4. `npm run test:bdd`
