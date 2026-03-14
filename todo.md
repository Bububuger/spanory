# Todo (2026-03-14) — 全仓 ESLint/Prettier/Husky 基线

- [x] 1. 归档旧版 `plan.md/todo.md`（已完成）
  - 验收：`ls docs/plans/archive docs/todos/archive | tail`
- [x] 2. 新增 ESLint 与 Prettier 配置文件
  - 验收：`npm run lint -- --help` 与 `npm run format:check -- --help`
- [x] 3. 更新根 `package.json` 脚本、依赖与 `lint-staged`
  - 验收：`npm run lint`（首次通过）
- [x] 4. 新增 Husky `pre-commit` 并验证可执行
  - 验收：`npx lint-staged --allow-empty`
- [x] 5. 全量回归本任务要求的检查
  - 验收：`npm run format:check && npm run check`
