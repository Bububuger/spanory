# Plan (2026-03-09) — Issue 巡检与状态管理

## 背景
自动化任务要求巡检 Spanory issue 并逐项处理。本轮环境无法连接 GitHub API，无法直接读取远端 issue；需先补齐仓内可执行的 issue 状态管理基线，确保后续每轮可追踪“发现/处理中/阻塞/完成”。

## 目标
- 建立仓内 issue 状态管理规范（状态机 + 字段约束 + 流转规则）
- 提供可执行脚本，支持状态汇总与状态更新
- 建立初始 tracker，记录本轮阻塞 issue（GitHub API 不可达）
- 更新阶段 `todo.md` 并完成最小验收

## 变更范围
- 计划执行：`plan.md`、`todo.md`
- 规范文档：`docs/standards/issue-status-workflow.md`、`docs/standards/README.md`
- issue 数据：`docs/issues/tracker.json`
- 工具脚本：`scripts/issues/status-report.mjs`
- 使用说明：`README.md`

## 实施方案
1. 归档上一阶段 `plan/todo`，切换到 issue 状态管理阶段。
2. 定义 issue 状态模型：`open`、`triaged`、`in_progress`、`blocked`、`ready_for_review`、`done`、`closed`。
3. 实现脚本：
   - `summary`：输出各状态计数 + 活跃 issue 列表
   - `set <id> <status> [note]`：更新 issue 状态并写回 tracker
4. 写入初始 tracker，登记本轮阻塞项并给出下一步动作。
5. 运行最小验收并回填 `todo.md`。

## 验收标准
1. `docs/standards` 中存在 issue 状态管理规范，且标准索引可达。
2. `node scripts/issues/status-report.mjs summary` 可输出状态统计。
3. `node scripts/issues/status-report.mjs set <id> <status>` 可更新 tracker 并持久化。
4. `todo.md` 验收项全部勾选。
