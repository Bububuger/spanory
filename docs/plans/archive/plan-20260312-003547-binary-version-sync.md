# Plan (2026-03-11) — 清除 legacy telemetry keys

## 目标
1. 停止产出所有已标记 legacy key（不再双写兼容）。
2. 在 `field-spec` 中将这些 key 标记为 `forbidden`，并从 active fields 清单移除。
3. 保持 telemetry 治理与测试全绿。

## 变更范围
- `packages/cli/src/runtime/shared/normalize.ts`
- `packages/otlp-core/src/index.ts`
- `packages/cli/src/report/aggregate.ts`
- `telemetry/field-spec.yaml`
- 对应 unit/golden fixtures

## 执行顺序
1. 实现层移除旧 key 产出与回退读取。
2. 规范层移除旧 key 并升级 deprecated policy 为 forbidden。
3. 刷新 fixtures，执行 telemetry + unit 验收。

## 验收标准
- `npm run telemetry:extract`
- `node scripts/telemetry/diff-fields.mjs`
- `node scripts/telemetry/validate-mapping.mjs`
- `node scripts/telemetry/report.mjs`
- `npm run --workspace @bububuger/spanory test -- test/unit/normalize.spec.ts test/unit/adapter.spec.ts test/unit/openclaw.adapter.spec.ts test/unit/otlp.golden.spec.ts test/unit/telemetry.governance.spec.ts test/unit/codex.adapter.golden.spec.ts`
