# OpenCode Plugin 接入计划（Plugin-First）

## Goal
通过 **OpenCode Plugin** 实现 Spanory 的实时采集与上报，打通：

`OpenCode Plugin events/SDK -> Canonical Events -> backend-langfuse -> otlp-core`

并保持与现有 `openclaw plugin` 的可观测语义一致（turn/tool/mcp/usage/model）。

## Scope
- In scope:
  - 完成 `packages/opencode-plugin` 运行时实现（非骨架）
  - 新增 `spanory runtime opencode plugin install|uninstall|doctor`
  - 实现 plugin 路径的 spool/retry/status（最小耐久）
  - 补齐 unit + BDD + 文档（README/capability/parity）
- Out of scope:
  - `runtime opencode export/hook/backfill`（本阶段不做）
  - LangSmith backend
  - 非 plugin 的实时链路

## Constraints
- 不假设 OpenCode 私有 API；仅基于官方 plugin 事件与 SDK。
- 以最小可用闭环优先，避免先做大规模抽象重构。
- 所有任务需在对应验收通过后才标记 done。

## Architecture（推荐）
- 方案采用“先接入、后抽象”：
  - P1：先复用 `openclaw-plugin` 已验证模式，快速落地 `opencode-plugin`。
  - P2：稳定后再抽离 shared runtime queue（如有必要）。
- 插件主触发点：`session.idle`（主 flush）、`session.deleted`（兜底 flush）、`gateway stop`（flush spool）。
- 事件来源：优先使用 OpenCode plugin SDK 拉取会话/消息；必要时结合事件 payload。
- 语义映射：尽量复用 `packages/cli/src/runtime/shared/normalize.js`，减少 runtime 语义漂移。

## Tasks

### T0 基线与契约校准
- 明确 OpenCode plugin 事件/SDK 的最小可用集合，沉淀 fixture。
- 输出 OpenCode -> canonical 字段映射表（turn/tool/mcp/usage/model）。
- 验收：映射表与 fixture 可被单测消费。

### T1 实现 `packages/opencode-plugin` 运行时
- 完成插件入口、hook 注册、会话归一化、OTLP 上报。
- 生成 plugin status 文件（最近成功/失败、事件数、错误摘要）。
- 验收：无 endpoint 时不报错，状态文件正确写入。

### T2 实现耐久能力（spool/retry/flush）
- 发送失败写 spool；重试成功后清理 spool。
- 指数退避与最大重试次数可配置（env）。
- 验收：失败后落盘、恢复后可自动补发。

### T3 CLI 插件管理命令（opencode）
- 新增 `runtime opencode plugin install|uninstall|doctor`。
- `doctor` 产出结构化 JSON：installed/configured/endpoint/spool/status。
- 验收：缺失前置条件时非 0 退出并给出可操作 detail。

### T4 测试矩阵
- 单测：plugin runtime 映射、状态写入、spool/retry。
- BDD：`plugin doctor` 失败/成功路径。
- 回归：不破坏 `openclaw` 既有测试。

### T5 文档与能力矩阵
- README 增加 OpenCode plugin 安装、启用、诊断与环境变量说明。
- 更新 `docs/runtime-capability-matrix.md`、`docs/langfuse-parity.md`。
- 明确 OpenCode 在 `realtimeDelivery/deliveryDurability` 的状态。

### T6 质量门与收尾
- 执行最小到全量质量门并记录结果。
- 输出接入结果与已知风险。

## Acceptance Gates（按任务执行）
- T1 后：
  - `npm run --workspace @spanory/cli test -- test/unit/opencode.plugin.runtime.spec.js`
- T3 后：
  - `npm run --workspace @spanory/cli test:bdd -- test/bdd/opencode.plugin.integration.spec.js`
- T4/T5 后：
  - `npm run --workspace @spanory/cli test`
  - `npm run --workspace @spanory/cli test:bdd`
- T6 收尾：
  - `npm run check`
  - `npm test`

## Risks
- OpenCode 版本差异导致事件 payload 字段漂移。
- 本地插件安装路径/配置文件路径在不同系统不一致。
- 高频 session.idle 下重复上报风险（需指纹去重）。

## Mitigation
- 用 fixture 固化 payload 版本并在测试锁定。
- `doctor` 明确检查并输出“实际读取的配置路径”。
- 增加 session/turn 指纹去重状态文件。
