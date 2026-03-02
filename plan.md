# Spanory 计划：可观测增强（解析增强 + 抓包设计）(2026-03-03)

## 摘要
本阶段目标是：在不破坏现有主链路（transcript/hook/plugin）的前提下，提升可观测深度与可分析能力。  
策略分两条线：
1. 先落地可直接基于现有解析模式实现的增强（turn diff、主/子 Agent 启发式、统计增强）。
2. 同步产出多 runtime 抓包能力的决策完备设计（默认关闭、可选开启），为下一阶段实现提供直接施工蓝图。

## 目标与成功标准

### 目标
- 增强现有 `SpanoryEvent` 的属性语义密度，支持更细粒度排障与分析。
- 扩展 CLI report/alert 能力，覆盖 cache、tool/skill 频次、turn 变化强度。
- 产出抓包链路设计（Claude Code + OpenClaw）与接口契约，不在本阶段实现抓包代码。

### 成功标准
- report 新增视图可用：`cache`、`tool`、`turn-diff`。
- alert 支持新增 session 指标，旧规则无回归。
- OTLP/export JSON 可看到新增属性。
- 抓包设计文档达到“下一阶段无需再拍板”的决策完备度。
- 回归门禁全部通过：`check`/`test`/`test:bdd`（必要时 `build:bin`）。

## 范围

### In Scope
- `packages/cli/src/runtime/shared/normalize.js`
- `packages/cli/src/report/aggregate.js`
- `packages/cli/src/alert/evaluate.js`
- `packages/cli/src/index.js`（report 子命令接线）
- `packages/core/src/index.ts`（capture 相关类型定义）
- 文档：`README.md`、`CHANGELOG.md`、`docs/plans/2026-03-03-capture-multi-runtime-design.md`
- 测试：unit + bdd

### Out of Scope
- 真正的 fetch/proxy/shell hook 抓包实现
- 默认开启抓包
- 新 runtime（如 Codex）抓包适配实现

## 公共接口与类型变更（已定）

### 1) 事件属性新增（保持 `SpanoryEvent` 结构不变）
新增可选 `attributes`：
- `agentic.turn.input.hash`
- `agentic.turn.input.prev_hash`
- `agentic.turn.diff.char_delta`
- `agentic.turn.diff.line_delta`
- `agentic.turn.diff.similarity`
- `agentic.turn.diff.changed`
- `agentic.actor.role`（`main|unknown`）
- `agentic.actor.role_confidence`
- `agentic.subagent.calls`
- `gen_ai.usage.details.cache_hit_rate`

### 2) CLI 命令新增
- `spanory report cache --input-json <path>`
- `spanory report tool --input-json <path>`
- `spanory report turn-diff --input-json <path>`

### 3) Alert 指标扩展（session scope）
新增支持：
- `cache.read`
- `cache.creation`
- `cache.hit_rate`
- `subagent.calls`
- `diff.char_delta.max`

### 4) Capture 设计类型（仅定义）
在 `packages/core/src/index.ts` 增加：
- `CaptureAdapter`
- `CaptureRecord`
- `CaptureRedactionPolicy`

## 实施方案（决策完备）

### 阶段 0：流程准备（强制）
- 归档现有 `plan.md`/`todo.md` 到 `docs/plans/archive/`（带时间戳）。
- 新建本阶段 `plan.md` 与 `todo.md`。
- todo 项必须一一映射本计划任务，且每项有验收命令。

### 阶段 1：解析增强（normalize）
- 在 turn 级计算输入 hash 与相邻 turn diff 摘要。
- 写入 actor/subagent 启发式字段：
  - 默认 `agentic.actor.role=main`
  - `agent_task` 数量写入 `agentic.subagent.calls`
  - 置信度写入 `agentic.actor.role_confidence`
- 从 usage 衍生 `gen_ai.usage.details.cache_hit_rate`（分母 0 处理为 0）。

### 阶段 2：report 扩展
- 新增 `summarizeCache`、`summarizeTools`、`summarizeTurnDiff`。
- 在 CLI 注册 `report cache/tool/turn-diff`。
- 保持现有 `session/mcp/command/agent` 输出契约不变。

### 阶段 3：alert 扩展
- 扩展 session metric resolver，支持新增指标。
- 规则文件结构不改，旧规则继续可用。

### 阶段 4：抓包设计产出（不实现）
- 产出 `docs/plans/2026-03-03-capture-multi-runtime-design.md`，包含：
  - 架构/时序图
  - `CaptureAdapter` 接口与生命周期
  - 脱敏与安全边界
  - 默认关闭开关与回退策略
  - Claude/OpenClaw 首期接入路径
  - 失败模式与监控信号

### 阶段 5：文档与变更记录
- README 增加新 report/alert 用法。
- CHANGELOG 记录新增能力、兼容性和后续抓包阶段计划。

## 测试策略

### Unit
- normalize：diff/hash/actor/cache_hit_rate 正确性
- aggregate：cache/tool/turn-diff 聚合正确性
- alert：新增 metric 告警行为正确性

### BDD
- report 三个新子命令端到端
- alert 使用新 metric 的端到端行为

### 回归门禁
- `npm run check`
- `npm test`
- `npm run test:bdd`
- 必要时 `npm run build:bin`

## 假设与默认值
- 抓包策略：默认关闭，仅显式启用。
- 抓包首期 runtime：Claude Code + OpenClaw。
- 本阶段优先增量兼容，不做破坏性 category/命令改造。
- 不引入重型新依赖，优先复用现有代码结构与测试框架。
