# Plan (2026-03-06) — 固化排障记忆并发布新版本

## 背景
本轮已经完成 codex tool duration 修复，并在本地导出与 ClickHouse 中完成了端到端验证。为了避免上下文压缩后丢失关键排障与验收经验，需要把“ClickHouse 查询方法”和“本地真实对话验收闭环”沉淀进仓库现有标准文档，同时发布一个新版本承载该修复。

## 目标
- 将 ClickHouse / Langfuse 查询方法写入长期标准文档
- 将本地真实对话端到端验收流程写入 runtime 验收标准
- 补变更背景记录并发布一个新的 semver tag

## 变更范围
- 文档流程：`plan.md`、`todo.md`
- 长期记忆：`docs/standards/agent-onboarding.md`、`docs/standards/runtime-validation-matrix.md`
- 变更台账：`docs/standards/change-context-log.md`
- 发布：git tag / remote push

## 实施方案
1. 归档当前阶段 `plan.md/todo.md`，写入本阶段目标与验收标准。
2. 在 `agent-onboarding` 中补 ClickHouse 查询手册，覆盖 `session -> trace -> observation` 层级、`FINAL` 语义、典型查询模板。
3. 在 runtime 验收矩阵中补本地真实对话验收闭环，覆盖二进制重建、覆盖安装、本地导出、`jq` 验证、ClickHouse 验证。
4. 在变更背景记录台账中补本次长期记忆与发布背景。
5. 运行最小文档/仓库校验，提交并打新 tag 发布。

## 验收标准
1. 项目标准文档中已能找到 ClickHouse 查询方法与本地 E2E 验收流程。
2. 相关文档路径纳入新 agent 上手入口，避免记忆丢失。
3. 变更已提交并打出新 tag 推送远端。
