# Spanory TODO：可观测增强（2026-03-03）

> 执行规则：严格按顺序；每项必须“实现 + 验收通过”后再打勾。

## T0 归档与阶段初始化
- [x] 归档当前 `plan.md`/`todo.md` 到 `docs/plans/archive/`（时间戳命名）
- [x] 写入新 `plan.md`（本阶段版本）
- [x] 从 `plan.md` 派生新 `todo.md`

验收：
- [x] `ls docs/plans/archive | tail -n 5`
- [x] `rg -n "可观测增强|2026-03-03" plan.md todo.md`

---

## T1 解析增强（turn diff + actor/subagent + cache hit rate）
- [ ] 在 `normalize.js` 为每个 turn 计算 `input.hash` 与 `prev_hash`
- [ ] 计算并写入 `diff.char_delta` / `diff.line_delta` / `diff.similarity` / `diff.changed`
- [ ] 写入 `agentic.actor.role` 与 `agentic.actor.role_confidence`
- [ ] 聚合并写入 `agentic.subagent.calls`
- [ ] 计算并写入 `gen_ai.usage.details.cache_hit_rate`

验收：
- [ ] 新增/更新 unit 测试（normalize 相关）通过
- [ ] `npm run --workspace @spanory/cli test -- --runInBand` 或等效命令通过

---

## T2 Report 扩展（cache/tool/turn-diff）
- [ ] 在 `aggregate.js` 实现 `summarizeCache`
- [ ] 在 `aggregate.js` 实现 `summarizeTools`
- [ ] 在 `aggregate.js` 实现 `summarizeTurnDiff`
- [ ] 在 `index.js` 注册 `report cache/tool/turn-diff` 子命令
- [ ] 补充帮助文案与输出 schema 说明（必要时 README）

验收：
- [ ] `spanory report cache --help`
- [ ] `spanory report tool --help`
- [ ] `spanory report turn-diff --help`
- [ ] report unit + bdd 通过

---

## T3 Alert 扩展（新增 session metrics）
- [ ] 在 `alert/evaluate.js` 增加 `cache.read`
- [ ] 增加 `cache.creation`
- [ ] 增加 `cache.hit_rate`
- [ ] 增加 `subagent.calls`
- [ ] 增加 `diff.char_delta.max`
- [ ] 保持旧 metric 行为与规则格式兼容

验收：
- [ ] alert unit 测试新增场景通过
- [ ] `npm run --workspace @spanory/cli test:bdd` 中 alert 集成测试通过

---

## T4 抓包设计文档 + 类型契约（不实现）
- [ ] 新建 `docs/plans/2026-03-03-capture-multi-runtime-design.md`
- [ ] 在文档中给出 Claude/OpenClaw 首期接入方案与回退机制
- [ ] 在 `packages/core/src/index.ts` 增加 `CaptureAdapter/CaptureRecord/CaptureRedactionPolicy` 类型定义
- [ ] 文档明确“默认关闭，显式开启”

验收：
- [ ] `rg -n "CaptureAdapter|CaptureRecord|CaptureRedactionPolicy" packages/core/src/index.ts`
- [ ] `rg -n "默认关闭|Claude Code|OpenClaw|脱敏|回退" docs/plans/2026-03-03-capture-multi-runtime-design.md`
- [ ] `npm run check` 通过

---

## T5 文档与变更记录
- [ ] README 增加新 report/alert 用法与示例
- [ ] CHANGELOG 记录本阶段能力
- [ ] 如有公共契约变化，补充迁移说明

验收：
- [ ] `rg -n "report cache|report tool|report turn-diff|cache.hit_rate" README.md CHANGELOG.md`
- [ ] 文档命令与 `--help` 一致

---

## T6 全量回归
- [ ] `npm run check`
- [ ] `npm test`
- [ ] `npm run test:bdd`
- [ ] 必要时 `npm run build:bin`

验收：
- [ ] 所有命令退出码为 0
- [ ] 记录关键结果摘要（测试文件数、用例数、失败数=0）

---

## T7 收尾
- [ ] 整理变更清单（文件级）
- [ ] 整理新增能力清单（用户可见）
- [ ] 输出后续 Phase 2（抓包实现）入口任务列表

验收：
- [ ] 变更说明与测试证据齐全，可直接进入 CR/PR
