# Spanory TODO：移除废弃 workspace 并全仓清扫 (2026-03-05)

- [x] T0 归档上一阶段 `plan/todo`
- [x] T1 删除 `packages/langfuse` 并确认无运行依赖
  - 验收：`test ! -d packages/langfuse`
  - 验收：`rg -n "@spanory/langfuse|packages/langfuse" packages package.json .github scripts`
- [x] T2 更新 lockfile，移除废弃 workspace 条目
  - 验收：`npm install`
  - 验收：`rg -n "@spanory/langfuse|packages/langfuse" package-lock.json`
- [x] T3 全仓一致性扫描
  - 验收：`rg -n "src/index\.js" packages/*/package.json scripts .github/workflows`
  - 验收：`npm run --workspace @spanory/cli build:bundle`
- [x] T4 全量验收
  - 验收：`npm run check`
  - 验收：`npm test`
  - 验收：`npm run test:bdd`

## 验证记录（2026-03-05）
- `test ! -d packages/langfuse` ✅
- `rg -n "@spanory/langfuse|packages/langfuse" packages package.json .github scripts` ✅（无结果）
- `npm install` ✅
- `rg -n "@spanory/langfuse|packages/langfuse" package-lock.json` ✅（无结果）
- `rg -n "src/index\.js" packages/*/package.json scripts .github/workflows` ✅（无结果）
- `npm run --workspace @spanory/cli build:bundle` ✅
- `npm run check` ✅
- `npm test` ✅
- `npm run test:bdd` ✅
