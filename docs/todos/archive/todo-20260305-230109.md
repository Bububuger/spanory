# Spanory TS 迁移 TODO（收官批次：CLI core + backend + plugins）(2026-03-04)

- [x] T0 归档上一阶段 `plan/todo` 并切换收官计划
- [x] T1 新增/更新各包 tsconfig 与 check/build 脚本
- [x] T2 剩余源码 `.js -> .ts` 迁移并生成 `.js` 运行文件
- [x] T3 验收：`npm run build`
- [x] T3 验收：`npm run check`
- [x] T3 验收：`npm test`
- [x] T3 验收：`npm run test:bdd`

## 验证记录（2026-03-04）
- `npm run build` ✅
- `npm run check` ✅
- `npm test` ✅（unit 66 passed）
- `npm run test:bdd` ✅（bdd 29 passed）
- 收官核对：`src/*.js` 均已存在对应 `.ts` 源（missing ts pair: 0）✅
