# Plan (2026-03-14) — BUB-32 隐藏内部 issue 命令

## 目标
1. 公开 CLI `spanory --help` 不再显示内部 `issue` 命令。
2. 内部 issue 状态管理能力迁移到非公开入口（`npm run issue:*`）。
3. 增加回归验证，防止后续再次将内部命令暴露到公开 help。

## 执行顺序
1. 设计并实现独立 issue 脚本入口（`scripts/issues/issue-cli.mjs`），承接 `sync/list/set-status`。
2. 在 `package.json` 增加 `issue:sync`/`issue:list`/`issue:set-status`，并保留现有 `issue:status`。
3. 从 `packages/cli/src/index.ts` 移除公开 `issue` 子命令注册与相关导入。
4. 更新文档示例（`docs/issues/README.md`）到新入口。
5. 增加最小测试覆盖公开 help 不暴露 `issue` 命令，并运行最小相关验证。

## 验收标准
- `node packages/cli/dist/index.js --help` 输出中不包含 `issue` 命令。
- `npm run issue:sync|issue:list|issue:set-status -- ...` 可正常工作。
- 新增/更新测试通过，且不影响现有 CLI 观测性命令。
