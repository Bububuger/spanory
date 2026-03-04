# Codex 重复节点去重修复 TODO (2026-03-04)

- [x] T1 实现 OTLP 稳定 observation identity（turn/tool 优先主键）
- [x] T1 验收：`npm run --workspace @spanory/cli test -- test/unit/otlp.spec.js`
- [x] T2 实现 Codex turn 完成态属性 `agentic.turn.completed`
- [x] T2 验收：`npm run --workspace @spanory/cli test -- test/unit/codex.adapter.spec.js`
- [x] T3 复核目标 session 增量切片 observation id 稳定性
- [x] T3 验收：汇总证据并回复用户
