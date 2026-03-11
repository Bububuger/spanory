# Todo (2026-03-11) — telemetry 字段收敛落地

- [x] T1 规范更新：`telemetry/field-spec.yaml`
  - [x] 添加/更新 deprecated 策略（`agentic.command.raw`、`agentic.agent_id` 等）
  - [x] 修正 cache 字段命名：`gen_ai.usage.cache_creation.input_tokens`、`gen_ai.usage.cache_read.input_tokens`
  - [x] 调整 5 个 lock 未命中字段稳定性（official -> custom）
  - [x] 验收：`node scripts/telemetry/validate-mapping.mjs`

- [x] T2 实现更新：`packages/cli/src/runtime/shared/normalize.ts`
  - [x] 产出 `gen_ai.agent.id`（兼容保留 `agentic.agent_id`）
  - [x] cache 属性改为官方路径，同时兼容旧 key 一版
  - [x] `langfuse.observation.usage_details` 改为下游投影来源（不在 normalize 构建）
  - [x] 验收：`npm run --workspace @bububuger/spanory test -- test/unit/normalize.spec.ts`

- [x] T3 OTLP 投影收敛：`packages/otlp-core/src/index.ts`
  - [x] `input.value/output.value` 保持投影层生成（不在 normalize 生成）
  - [x] `langfuse.session.id` 保持由 `session.id` 同源派生（单点生成）
  - [x] 验收：`npm run --workspace @bububuger/spanory test -- test/unit/otlp.golden.spec.ts`

- [x] T4 治理与回归
  - [x] 刷新 telemetry 字段产物与报告
  - [x] 修正受影响测试/fixtures
  - [x] 验收：
    - [x] `npm run telemetry:extract`
    - [x] `node scripts/telemetry/diff-fields.mjs`
    - [x] `node scripts/telemetry/validate-mapping.mjs`
    - [x] `node scripts/telemetry/report.mjs`
    - [x] `npm run --workspace @bububuger/spanory test -- test/unit/otlp.golden.spec.ts test/unit/telemetry.governance.spec.ts test/unit/normalize.spec.ts`
