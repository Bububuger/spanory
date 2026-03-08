# TODO (2026-03-09) — Issue 巡检与状态管理

- [x] T1 归档上一阶段 `plan.md/todo.md` 并创建本阶段计划
- [x] T2 实现 issue 状态管理模块与 CLI 子命令
- [x] T3 补充 issue 状态管理单测
- [x] T4 同步并巡检当前 issue，逐项更新状态
- [x] T5 运行最小验收并记录证据
- [ ] T6 提交改动并准备 PR

## 验收记录
- [x] 已归档上一阶段 `plan.md` / `todo.md`
- [x] `npm run --workspace @bububuger/spanory check` 通过
- [x] `cd packages/cli && npx vitest run test/unit/issue.state.spec.ts` 通过（3/3）
- [x] `npm run build` 通过（全部 workspace 构建）
- [x] `node packages/cli/dist/index.js issue sync` 成功生成状态文件
- [x] `node packages/cli/dist/index.js issue list` 可正确列出 issue
