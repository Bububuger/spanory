# Plan (2026-03-09) — Issue 巡检与状态管理

## 背景
自动化目标是“巡检 spanory 项目，逐一处理 issue，并提交 PR”。当前仓库缺少可持续的 issue 状态台账与命令化流转，导致自动化轮询无法稳定续跑。

## 目标
- 增加本地 issue 状态管理（状态机 + 持久化）
- 支持从 `todo.md` 未完成项同步 issue 清单
- 支持 issue 列表与状态更新命令
- 用当前未完成项完成一次“逐项处理”闭环

## 变更范围
- 文档流程：`plan.md`、`todo.md`
- CLI 实现：`packages/cli/src/index.ts`
- issue 模块：`packages/cli/src/issue/state.ts`
- 单测：`packages/cli/test/unit/issue.state.spec.ts`
- 状态文件：`docs/issues/state.json`
- 说明文档：`docs/issues/README.md`

## 实施方案
1. 新增 issue 状态模块，定义 `open/in_progress/blocked/done` 与基本流转。
2. 在 CLI 增加 `spanory issue sync|list|set-status` 子命令。
3. 从 `todo.md` 同步未完成任务到状态文件，执行一次巡检并更新状态。
4. 补单测覆盖同步、状态更新、异常分支。
5. 运行最小验收并更新 todo 勾选。

## 验收标准
1. `spanory issue sync` 能从 `todo.md` 生成/更新 `docs/issues/state.json`。
2. `spanory issue list` 能输出 issue 与状态。
3. `spanory issue set-status --id <id> --status <status>` 生效并持久化。
4. 新增单测通过，相关命令执行通过。
