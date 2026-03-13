# Todo (2026-03-14) — BUB-14 跨包/跨 adapter 重复原语收敛

- [x] 归档上一阶段 `plan.md/todo.md`
- [x] T1 复现：扫描并确认重复实现位置
  - 验收检查：`rg -n "extractToolUses|toNumber|parseJsonObject|GATEWAY_INPUT_METADATA_BLOCK_RE" packages`
- [x] T2 在 `@bububuger/core` 实现并导出共享原语
  - 验收检查：`npm run --workspace @bububuger/core check`
- [x] T3 迁移 `cli`/`adapter`/`plugin` 调用到共享原语并移除本地重复实现
  - 验收检查：`npm run --workspace @bububuger/spanory check`
- [x] T4 增加 `core` 单测覆盖共享原语
  - 验收检查：`npm run --workspace @bububuger/core test`
- [x] T5 全量回归与收口
  - 验收检查：`npm run check && npm test`
