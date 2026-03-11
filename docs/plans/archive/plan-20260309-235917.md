# Plan (2026-03-09) — Issues #3 + #1

## 目标
1. 完成 issue #3：为 `shell_command` 事件补齐结构化命令字段，提升可检索与聚合能力。
2. 在 #3 稳定后推进 issue #1：补齐 parent-child agent 链路字段（先实现可验证的最小可用版本）。

## 执行顺序
1. 先做 #3（解析逻辑 + 字段规范 + 单测）
2. 跑 #3 最小回归，确认无回归
3. 再实现 #1（父子链路推断/映射 + 字段规范 + 单测）
4. 跑 #1 最小回归
5. 全量关键回归后提交

## 受影响文件（预估）
- `packages/cli/src/runtime/shared/normalize.ts`
- `telemetry/field-spec.yaml`
- `packages/cli/test/unit/normalize.spec.ts`
- `packages/cli/src/runtime/*/adapter.ts`（#1 若需要）
- `packages/cli/test/unit/*`（#1 相关）

## 验收标准
- #3：`shell_command` 事件稳定产出
  - `agentic.command.name`
  - `agentic.command.args`
  - `agentic.command.pipe_count`
  - `agentic.command.raw`
- #1：可在子会话/事件上观察到父链路字段（或明确记录推断置信度）
- `npm run --workspace @bububuger/spanory check` 通过
- 相关 unit tests 通过
