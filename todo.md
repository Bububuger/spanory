# Todo (2026-03-14) — BUB-27 teardown 清理 codex config.toml 改动

- [x] 归档上一阶段 `plan.md/todo.md`
- [x] 在 `packages/cli/src/index.ts` 增加 codex notify 备份逻辑
- [x] 在 `packages/cli/src/index.ts` 实现 teardown 读取备份并恢复 notify
- [x] 更新 `packages/cli/test/bdd/setup.integration.spec.ts` 覆盖恢复场景
- [x] 运行 `npm run --workspace @bububuger/spanory test:bdd -- test/bdd/setup.integration.spec.ts`
