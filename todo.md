# Spanory 紧急数据质量修复 TODO (2026-03-01)

## 执行规则
- 严格按顺序执行。
- 每完成一项必须先跑该项验收，未通过不得勾选。
- 所有项完成后执行全量终验。

## 任务列表
- [x] T1 修复 turn 切分与 tool_result I/O 回填（adapter）
- [x] T1 验收：`npm run --workspace @spanory/cli test -- test/unit/adapter.spec.js`

- [x] T2 修复 OTLP 稳定 trace/span id + 幂等属性（otlp）
- [x] T2 验收：`npm run --workspace @spanory/cli test -- test/unit/otlp.spec.js`

- [x] T3 增加 hook 重放防护状态（index/hook）
- [x] T3 验收：`npm run --workspace @spanory/cli test -- test/bdd/hook.integration.spec.js`

- [x] T4 补充回归用例（unit+bdd）并通过
- [x] T4 验收：`npm run --workspace @spanory/cli test`

- [x] T5 全量终验与状态收敛
- [x] T5 验收：`npm run check && npm test && npm run test:bdd`
