# BDD TS 化与 Plugin 入口收敛 TODO (2026-03-06)

- [x] T1 重命名 `packages/cli/test/bdd/*.spec.js` -> `*.spec.ts`
- [x] T1 验收：`rg --files packages/cli/test/bdd | rg '\\.spec\\.js$'`
- [x] T2 删除 `packages/openclaw-plugin/index.js`
- [x] T2 删除 `packages/opencode-plugin/index.js`
- [x] T3 验收：`npm run --workspace @spanory/cli test:bdd`
- [x] T4 汇总结果
