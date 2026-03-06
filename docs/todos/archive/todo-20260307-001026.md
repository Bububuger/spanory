# TODO (2026-03-06) — 统一 npm Scope 为 @bububuger

- [x] T1 归档当前计划文件并建立本阶段 plan/todo
- [x] T2 统一活跃包名与 workspace 引用到 `@bububuger/*`
- [x] T3 修正文档与 release publish 说明
- [x] T4 更新 lockfile 并执行最小发布链路验证
- [x] T5 运行 `check/test/test:bdd`
- [ ] T6 提交并视情况准备新 tag

## 验收记录
- [x] 已归档上一阶段 `plan.md` / `todo.md`
- [x] 业务文件已无旧 `@spanory/*` 活跃 npm scope 残留
- [x] `npm pack --workspace @bububuger/spanory --dry-run`
- [x] `npm run check`
- [x] `npm test`
- [x] `npm run test:bdd`
