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
- [x] 在 `normalize.js` 为每个 turn 计算 `input.hash` 与 `prev_hash`
- [x] 计算并写入 `diff.char_delta` / `diff.line_delta` / `diff.similarity` / `diff.changed`
- [x] 写入 `agentic.actor.role` 与 `agentic.actor.role_confidence`
- [x] 聚合并写入 `agentic.subagent.calls`
- [x] 计算并写入 `gen_ai.usage.details.cache_hit_rate`

验收：
- [x] 新增/更新 unit 测试（normalize 相关）通过
- [x] `npm run --workspace @spanory/cli test -- --runInBand` 或等效命令通过

---

## T2 Report 扩展（cache/tool/turn-diff）
- [x] 在 `aggregate.js` 实现 `summarizeCache`
- [x] 在 `aggregate.js` 实现 `summarizeTools`
- [x] 在 `aggregate.js` 实现 `summarizeTurnDiff`
- [x] 在 `index.js` 注册 `report cache/tool/turn-diff` 子命令
- [x] 补充帮助文案与输出 schema 说明（必要时 README）

验收：
- [x] `spanory report cache --help`
- [x] `spanory report tool --help`
- [x] `spanory report turn-diff --help`
- [x] report unit + bdd 通过

---

## T3 Alert 扩展（新增 session metrics）
- [x] 在 `alert/evaluate.js` 增加 `cache.read`
- [x] 增加 `cache.creation`
- [x] 增加 `cache.hit_rate`
- [x] 增加 `subagent.calls`
- [x] 增加 `diff.char_delta.max`
- [x] 保持旧 metric 行为与规则格式兼容

验收：
- [x] alert unit 测试新增场景通过
- [x] `npm run --workspace @spanory/cli test:bdd` 中 alert 集成测试通过

---

## T4 抓包设计文档 + 类型契约（不实现）
- [x] 新建 `docs/plans/2026-03-03-capture-multi-runtime-design.md`
- [x] 在文档中给出 Claude/OpenClaw 首期接入方案与回退机制
- [x] 在 `packages/core/src/index.ts` 增加 `CaptureAdapter/CaptureRecord/CaptureRedactionPolicy` 类型定义
- [x] 文档明确“默认关闭，显式开启”

验收：
- [x] `rg -n "CaptureAdapter|CaptureRecord|CaptureRedactionPolicy" packages/core/src/index.ts`
- [x] `rg -n "默认关闭|Claude Code|OpenClaw|脱敏|回退" docs/plans/2026-03-03-capture-multi-runtime-design.md`
- [x] `npm run check` 通过

---

## T5 文档与变更记录
- [x] README 增加新 report/alert 用法与示例
- [x] CHANGELOG 记录本阶段能力
- [x] 如有公共契约变化，补充迁移说明

验收：
- [x] `rg -n "report cache|report tool|report turn-diff|cache.hit_rate" README.md CHANGELOG.md`
- [x] 文档命令与 `--help` 一致

---

## T6 全量回归
- [x] `npm run check`
- [x] `npm test`
- [x] `npm run test:bdd`
- [x] 必要时 `npm run build:bin`（本次无需执行）

验收：
- [x] 所有命令退出码为 0
- [x] 记录关键结果摘要（测试文件数、用例数、失败数=0）

---

## T7 收尾
- [x] 整理变更清单（文件级）
- [x] 整理新增能力清单（用户可见）
- [x] 输出后续 Phase 2（抓包实现）入口任务列表

验收：
- [x] 变更说明与测试证据齐全，可直接进入 CR/PR
