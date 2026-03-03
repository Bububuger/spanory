# Spanory 修复计划：OpenClaw trace.input 被 tool/hook 覆盖（2026-03-01）

## Goal
修复 OpenClaw 上报到 Langfuse/ClickHouse 后，`default.traces.input` 偶发被 tool/hook 输入覆盖的问题，确保 trace 级 input/output 始终与该 turn 的用户输入/助手输出一致。

## Root Cause
当前 OTLP 编译仅在 `category=turn` span 上写入 `langfuse.trace.input/output`。在下游聚合时，child span（tool/hook）可能影响 trace 级 input 展示，导致 trace.input 与根 AGENT observation.input 不一致。

## Scope
- In scope:
  - `packages/otlp-core/src/index.js`：为同一 turn 的所有 spans 写一致的 trace 级字段（来源优先取 turn 事件）。
  - `packages/cli/test/unit/otlp.spec.js`：新增回归测试，覆盖“tool 输入不应覆盖 trace 输入”。
- Out of scope:
  - OpenClaw runtime hook 事件结构调整
  - ClickHouse/Langfuse 表结构变更

## Tasks

### T1 复现并锁定失败场景（测试先行）
- 在 OTLP 单测中加入覆盖案例：同一 turn 含 turn + tool 事件，断言 tool span 也携带与 turn 一致的 `langfuse.trace.input/output`。
- 先运行该测试并确认失败（RED）。

### T2 最小修复 OTLP 编译逻辑
- 在 `compileOtlpSpans` 中先聚合 turn 级 trace context（input/output），再写入每个 span。
- 保持 trace id/span id 稳定性与现有 parent-child 逻辑不变。

### T3 验证与回归
- 运行新增单测（GREEN）。
- 运行 OTLP 相关单测集，确认无回归。

## Acceptance
- 同一 trace 下，不论 tool/hook 事件是否存在，trace 级 input/output 与 turn 事件一致。
- `packages/cli/test/unit/otlp.spec.js` 全通过。
