---
type: file
summary: "Spanory 字段收敛提案与落地状态（v2026-03-12）"
created: 2026-03-11T00:00:00+08:00
modified: 2026-03-12T00:45:00+08:00
tags: [telemetry, otel, semconv, governance, convergence]
owner: codex
---

# Spanory 字段收敛提案与落地状态（v2026-03-12）

> 本文档已从“提案”更新为“提案 + 实施现状”。
> 当前基线以 `telemetry/spanory-fields.current.yaml` 与 `telemetry/reports/field-diff.json` 为准。

## 1. 当前状态

- 当前字段总数：`77`
- `field-spec` 与当前产出一致：`spec_total=77`，`added/removed=0`
- 校验状态：`errors=0`，`warnings=0`

## 2. 收敛原则（已执行）

1. OTel 官方字段优先。
2. 平台字段（Langfuse）在投影层生成，不在 canonical 层重复建模。
3. `agentic.*` 保留 OTel 无法表达的 Agent 行为语义。
4. 已移除字段进入 `deprecated_fields` 且策略为 `forbidden`。

## 3. 本轮已落地收敛

### 3.1 直接移除的 legacy key（已禁用）

- `agentic.command.raw`（统一用 `process.command_line`）
- `agentic.agent_id`（统一用 `gen_ai.agent.id`）
- `gen_ai.usage.details.cache_creation_input_tokens`（统一用 `gen_ai.usage.cache_creation.input_tokens`）
- `gen_ai.usage.details.cache_read_input_tokens`（统一用 `gen_ai.usage.cache_read.input_tokens`）

以上 4 个字段已在 `telemetry/field-spec.yaml` 的 `deprecated_fields` 里标记为 `forbidden`。

### 3.2 命名对齐

cache 相关字段已对齐 OTel semconv：

- `gen_ai.usage.cache_creation.input_tokens`
- `gen_ai.usage.cache_read.input_tokens`

### 3.3 仍保留（自定义）

以下字段仍保留为 `custom`（当前 semconv lock 未命中或明确为自定义扩展）：

- `gen_ai.usage.details.cache_hit_rate`
- `gen_ai.usage.total_tokens`
- `mcp.request.id`

## 4. 不再兼容的策略说明

本轮采取“硬收敛”策略：旧 key 不再双写，不再回退读取。

- 对外查询和下游处理应全部切到新 key。
- 若未来运行时再次产出旧 key，将被治理规则拦截（forbidden）。

## 5. 后续建议

1. 评估是否收敛 `gen_ai.usage.total_tokens`（改为消费端计算字段）。
2. 评估 `mcp.request.id` 是否迁移到更稳定的官方命名（待 semconv 统一后再定）。
3. 持续用 `telemetry:extract + diff + validate + report` 做门禁。

## 6. 当前上报字段清单（用于验收）

基线来源：
- `telemetry/spanory-fields.current.yaml`
- `telemetry/reports/field-diff.json`（`coverage` 分类）

字段总数：`77`

### 6.1 OTel 官方语义字段（official_semconv，16）

- `deployment.environment.name`
- `gen_ai.agent.id`
- `gen_ai.operation.name`
- `gen_ai.request.model`
- `gen_ai.tool.call.id`
- `gen_ai.tool.name`
- `gen_ai.usage.cache_creation.input_tokens`
- `gen_ai.usage.cache_read.input_tokens`
- `gen_ai.usage.completion_tokens`
- `gen_ai.usage.input_tokens`
- `gen_ai.usage.output_tokens`
- `gen_ai.usage.prompt_tokens`
- `process.command_line`
- `service.name`
- `service.version`
- `session.id`

### 6.2 Agentic 命名空间字段（custom_agentic，44）

- 覆盖 `agentic.actor.*` / `agentic.command.*` / `agentic.context.*` / `agentic.event.*` / `agentic.input.*` / `agentic.mcp.*` / `agentic.parent.*` / `agentic.project.*` / `agentic.runtime.*` / `agentic.subagent.*` / `agentic.turn.*`
- 完整清单以 `telemetry/spanory-fields.current.yaml` 为准。

### 6.3 平台私有投影字段（platform_private，14）

- 覆盖 `langfuse.observation.*`、`langfuse.trace.*`、`langfuse.session.id`
- 这类字段为平台投影层，不作为 canonical 语义源。

### 6.4 其他扩展字段（custom_other，3）

- `gen_ai.usage.details.cache_hit_rate`
- `gen_ai.usage.total_tokens`
- `mcp.request.id`

### 6.5 已禁用旧 key（forbidden）

- `agentic.command.raw` -> `process.command_line`
- `agentic.agent_id` -> `gen_ai.agent.id`
- `gen_ai.usage.details.cache_creation_input_tokens` -> `gen_ai.usage.cache_creation.input_tokens`
- `gen_ai.usage.details.cache_read_input_tokens` -> `gen_ai.usage.cache_read.input_tokens`
