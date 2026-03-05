# Spanory TODO：纯 TS 收官（dist 运行形态）(2026-03-05)

- [x] T0 归档上一阶段 `plan/todo`
- [x] T1 统一各包 `tsconfig` 到 `rootDir=src,outDir=dist`，并对齐 build 清理策略
  - 验收：`npm run --workspaces build`
- [x] T2 切换 CLI 与核心包 `bin/main/exports` 到 `dist`
  - 验收：`rg -n "src/index\.js|src/.*\.js" packages/*/package.json`（仅 `packages/langfuse` 保留 JS 包，不在本次 TS 迁移范围）
  - 验收：`npm run --workspace @spanory/cli check`
- [x] T3 切换 openclaw/opencode 插件入口与清单到 `dist`
  - 验收：`npm run --workspace @spanory/cli test -- test/unit/openclaw.plugin.runtime.spec.js test/unit/opencode.plugin.runtime.spec.js`
- [x] T4 对齐 release 构建链路（bundle/bin/package assets）
  - 验收：`bash scripts/release/build-binaries.sh all`
  - 验收：`npm run package:release-assets -- v0.0.0-test`
- [x] T5 全量验收与金标一致性
  - 验收：`npm run check`
  - 验收：`npm test`
  - 验收：`npm run test:bdd`
  - 验收：`npm run --workspace @spanory/cli test -- test/unit/otlp.golden.spec.js test/unit/codex.adapter.golden.spec.js`

## 验证记录（2026-03-05）
- `npm run --workspaces build` ✅
- `npm run --workspace @spanory/cli check` ✅
- `npm run --workspace @spanory/cli test -- test/unit/openclaw.plugin.runtime.spec.js test/unit/opencode.plugin.runtime.spec.js` ✅
- `bash scripts/release/build-binaries.sh all` ✅
- `npm run package:release-assets -- v0.0.0-test` ✅
- `npm run check` ✅
- `npm test` ✅
- `npm run test:bdd` ✅
- `npm run --workspace @spanory/cli test -- test/unit/otlp.golden.spec.js test/unit/codex.adapter.golden.spec.js` ✅
