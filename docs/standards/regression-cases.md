# Spanory 缺陷回归台账

## 目的
持续沉淀“bug -> 测试 case”映射，确保同类问题不重复出现。

## 维护规则
- 每次 bug fix 合并前必须新增或更新至少一条记录。
- 记录中的测试路径必须是仓库内可执行的真实用例。
- 若 bug 影响输出语义，必须包含对应金标 case。

## 台账
| 日期 | 缺陷标识 | 根因摘要 | 测试类型 | 测试文件 | Case 名称/关键断言 | 备注 |
|---|---|---|---|---|---|---|
| 2026-03-04 | codex 重复 observation 节点 | 增量导出时 span identity 包含易变字段导致 id 漂移 | unit | `packages/cli/test/unit/otlp.spec.js` | `keeps observation ids stable across incremental snapshots of the same turn` | 已修复 |
| 2026-03-04 | codex turn 完成态属性漂移风险 | 解析 transcript 时未显式区分已完成与进行中 turn，易导致上报语义回归 | unit + golden | `packages/cli/test/unit/codex.adapter.spec.js` / `packages/cli/test/unit/codex.adapter.golden.spec.js` | `marks turn completion state for finished and in-progress turns` + codex golden fixtures | 已补长期金标 |
