# Spanory Plan：移除废弃 workspace 并全仓清扫 (2026-03-05)

## Goal
移除未使用的 `packages/langfuse`，并完成一次工程级一致性扫描，确保工作目录与构建链路保持干净、可验证。

## Scope
- 删除：`packages/langfuse`
- 更新：`package-lock.json`
- 更新：`plan.md` / `todo.md`（含归档）
- 扫描：workspace 引用、入口路径、构建/测试链路

## Non-Goals
- 不改变运行时语义，不新增功能。
- 不修改历史归档文档（`docs/plans/archive/*`）。

## Tasks
### T1 删除废弃包
- 删除 `packages/langfuse` 目录。
- 确认仓库内无运行链路依赖该包。

### T2 锁文件与依赖图清理
- 重新生成 `package-lock.json`，移除 `@spanory/langfuse` 相关条目。
- 保证 npm workspace 解析正常。

### T3 全仓一致性扫描
- 扫描无效入口/引用（含 `src/index.js` 残留、已删包路径）。
- 校验 release/build 脚本仍可执行。

### T4 验收
- 执行全量门禁并记录结果。

## Acceptance
1. `packages/langfuse` 不再存在且无残留代码依赖。
2. `package-lock.json` 无 `@spanory/langfuse` / `packages/langfuse` 条目。
3. `npm run check && npm test && npm run test:bdd` 全通过。
4. 工作区无意外脏改动（仅本次清理相关改动）。
