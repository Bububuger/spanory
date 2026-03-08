# TODO (2026-03-09) — Issue 巡检与状态管理

- [x] T1 归档上一阶段 `plan.md` / `todo.md`
- [x] T2 新增 issue 状态管理规范文档并接入 standards 索引
- [x] T3 新增 issue tracker 与状态汇总/更新脚本
- [x] T4 在 README 增加 issue 状态巡检命令
- [x] T5 执行最小验收并回填结果
- [ ] T6 提交改动并准备 PR

## 验收记录
- [x] 已归档上一阶段 `plan.md` / `todo.md`
- [x] `node scripts/issues/status-report.mjs summary`
- [x] `node scripts/issues/status-report.mjs set AUTO-20260309-GHAPI blocked "network unreachable"`
- [x] `rg -n "Issue Status Workflow|issue-status-workflow" docs/standards/README.md README.md`
- [ ] `rg -n "\- \[ \]" todo.md`（待 T6 完成后执行）
