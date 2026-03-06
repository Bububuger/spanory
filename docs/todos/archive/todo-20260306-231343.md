# TODO (2026-03-06) — 修复 Codex Tool Duration

- [x] T1 归档当前计划文件并建立本阶段 plan/todo
- [x] T2 在 `normalize.spec.ts` 编写失败测试，覆盖 `tool_use -> tool_result` duration
- [x] T3 运行最小单测并确认失败原因正确
- [x] T4 在 `normalize.ts` 实现 tool 结果时间映射与 duration 修复
- [x] T5 运行相关 unit tests 验证修复

## 验收记录
- [x] 已归档上一阶段 `plan.md` / `todo.md`
- [x] 新增 duration 单测已先红后绿
- [x] `npm run --workspace @spanory/spanory test -- packages/cli/test/unit/normalize.spec.ts`
- [x] `npm run --workspace @spanory/spanory test -- packages/cli/test/unit/codex.adapter.spec.ts packages/cli/test/unit/codex.adapter.golden.spec.ts`
