# Plan (2026-03-06) — unit 测试 JS 文件清理

## 背景
`packages/cli/test/unit` 目录仍有 `.js` 测试文件，和当前测试基线（TS 优先）不一致。

## 目标
- 将 unit 测试 `*.spec.js` 全量迁移为 `*.spec.ts`（仅重命名）。
- 保证测试行为不变，unit 回归通过。

## 变更范围
- `packages/cli/test/unit/*.spec.js -> *.spec.ts`
- `plan.md` / `todo.md`

## 验收标准
1. `rg --files packages/cli/test/unit | rg '\.spec\.js$'` 无输出。
2. `npm run --workspace @spanory/spanory test` 通过。
