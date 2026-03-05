# BDD TS 化与 Plugin 入口收敛 Plan (2026-03-06)

## Goal
清理两类不一致：
1) `packages/cli/test/bdd` 目录中大量 `.js` 测试文件；
2) `packages/openclaw-plugin` 与 `packages/opencode-plugin` 根目录同时存在 `index.js` 与 `src/index.ts`。

## Scope
- `packages/cli/test/bdd/*.spec.js -> *.spec.ts`（文件重命名）
- 删除：
  - `packages/openclaw-plugin/index.js`
  - `packages/opencode-plugin/index.js`
- `plan.md` / `todo.md`

## Tasks
### T1 BDD 文件扩展名迁移
- 将全部 `*.spec.js` 重命名为 `*.spec.ts`。
- 不改测试逻辑与断言，仅做后缀迁移。

### T2 Plugin 入口收敛
- 删除 plugin 根目录桥接 `index.js`。
- 保持 `src/index.ts -> dist/index.js` 作为唯一实现链路（`package.json.main` 已指向 `dist/index.js`）。

### T3 回归验证
- 执行 `npm run --workspace @spanory/cli test:bdd`。
- 验证 BDD 全量可通过，且没有残留 `bdd/*.spec.js`。

## Acceptance
1. `rg --files packages/cli/test/bdd | rg '\\.spec\\.js$'` 无输出。
2. `test:bdd` 通过。
3. 两个 plugin 目录不再含根 `index.js`。
