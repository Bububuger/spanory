# Spanory TODO：Codex Runtime 双轨接入（2026-03-03）

## T1 阶段初始化
- [x] 归档旧 `plan.md` / `todo.md`
- [x] 写入本阶段 `plan.md` / `todo.md`

验收：
- [x] `ls docs/plans/archive | rg "20260303-223334"`
- [x] `rg -n "Codex Runtime 双轨接入" plan.md todo.md`

## T2 RED：先写 Codex 解析链路测试（unit + bdd）
- [x] 新增 Codex fixture（session jsonl）
- [x] 新增 `codex adapter` 单测（分类、usage、notify context、projectId 派生）
- [x] 新增 `codex hook/backfill` BDD
- [x] 运行定向测试并确认失败（RED）

验收：
- [x] `npm run --workspace @spanory/cli test -- test/unit/codex.adapter.spec.js`
- [x] `npm run --workspace @spanory/cli test:bdd -- test/bdd/codex.hook.integration.spec.js test/bdd/codex.backfill.integration.spec.js`

## T3 GREEN：实现 Codex 解析链路
- [x] 新增 `packages/cli/src/runtime/codex/adapter.js`
- [x] `index.js` 注册 codex runtime（export/backfill/hook）
- [x] 扩展 hook payload 解析与 codex notify turn 选择
- [x] 扩展 backfill 会话发现（`~/.codex/sessions/**`）
- [x] 更新 capabilities + core HookPayload 类型
- [x] 定向测试转绿

验收：
- [x] T2 失败用例全部通过
- [x] `npm run --workspace @spanory/cli test -- test/unit/codex.adapter.spec.js`
- [x] `npm run --workspace @spanory/cli test:bdd -- test/bdd/codex.hook.integration.spec.js test/bdd/codex.backfill.integration.spec.js`

## T4 RED/GREEN：实现代理劫持链路（全量脱敏）
- [x] 新增 proxy 单测（脱敏、落盘、转发不阻塞）
- [x] 先运行失败测试（RED）
- [x] 新增 `packages/cli/src/runtime/codex/proxy.js`
- [x] `index.js` 增加 `runtime codex proxy` 命令
- [x] proxy 单测转绿

验收：
- [x] `npm run --workspace @spanory/cli test -- test/unit/codex.proxy.spec.js`

## T5 文档与全量回归
- [x] 更新 `README.md` / `docs/README_zh.md` / `docs/runtime-capability-matrix.md`
- [x] 全量验证 `check + unit + bdd`
- [x] 更新 todo 状态

验收：
- [x] `npm run check`
- [x] `npm test`
- [x] `npm run test:bdd`
