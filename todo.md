# Todo (2026-03-11) — 清除 legacy telemetry keys

- [x] T1 移除 normalize 旧 key
  - [x] 移除 `agentic.command.raw`
  - [x] 移除 `agentic.agent_id`（仅保留 `gen_ai.agent.id`）
  - [x] 移除 `gen_ai.usage.details.cache_creation_input_tokens`
  - [x] 移除 `gen_ai.usage.details.cache_read_input_tokens`
  - [x] 验收：`npm run --workspace @bububuger/spanory test -- test/unit/normalize.spec.ts test/unit/adapter.spec.ts test/unit/openclaw.adapter.spec.ts`

- [x] T2 移除消费侧旧 key 回退
  - [x] `otlp-core` usage_details 聚合只读新 key
  - [x] `report/aggregate` 只读新 key
  - [x] 验收：`npm run --workspace @bububuger/spanory test -- test/unit/otlp.golden.spec.ts`

- [x] T3 更新 telemetry 规范
  - [x] 从 fields 清单删除上述 legacy key
  - [x] 在 `deprecated_fields` 将 legacy key policy 调整为 `forbidden`
  - [x] 验收：`node scripts/telemetry/validate-mapping.mjs`

- [x] T4 回归与产物
  - [x] 刷新 codex golden
  - [x] 刷新 telemetry reports
  - [x] 验收：
    - [x] `npm run telemetry:extract`
    - [x] `node scripts/telemetry/diff-fields.mjs`
    - [x] `node scripts/telemetry/validate-mapping.mjs`
    - [x] `node scripts/telemetry/report.mjs`
    - [x] `npm run --workspace @bububuger/spanory test -- test/unit/normalize.spec.ts test/unit/adapter.spec.ts test/unit/openclaw.adapter.spec.ts test/unit/otlp.golden.spec.ts test/unit/telemetry.governance.spec.ts test/unit/codex.adapter.golden.spec.ts`
