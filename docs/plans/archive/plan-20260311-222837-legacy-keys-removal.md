# Plan (2026-03-11) — telemetry 字段收敛落地

## 目标
1. 按 `telemetry/field-convergence-proposal.md` 落地最新字段收敛（以 P0 + 核心 P1 为主）。
2. 保持 telemetry 治理脚本与 OTLP golden 一致通过。
3. 在不破坏现有行为观测能力前提下减少冗余字段与命名偏差。

## 执行顺序
1. 更新规范层：`telemetry/field-spec.yaml`（新增 deprecated、修正 cache 字段命名与稳定性）。
2. 更新实现层：`normalize.ts` 与 `otlp-core`（agent_id 收敛、cache key 重命名、Langfuse 投影下沉）。
3. 更新测试与金标，跑分步验收。

## 验收标准
- `npm run telemetry:extract`
- `node scripts/telemetry/diff-fields.mjs`
- `node scripts/telemetry/validate-mapping.mjs`
- `node scripts/telemetry/report.mjs`
- `npm run --workspace @bububuger/spanory test -- test/unit/otlp.golden.spec.ts test/unit/telemetry.governance.spec.ts test/unit/normalize.spec.ts`
