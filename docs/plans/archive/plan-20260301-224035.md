# Spanory 阶段计划（Langfuse 优先，LangSmith 延后）

## Goal
在不破坏现有 `claude-code` / `openclaw` 行为的前提下，补齐内部架构分层：

`RuntimeAdapter -> Canonical Events -> BackendAdapter(langfuse) -> OTLP Core -> OTLP Sender`

并完成 OpenClaw plugin 事件驱动主链路（零 cron）。

## Scope
- In scope:
  - `langfuse` 作为唯一 backend
  - runtime: `claude-code` + `openclaw`
  - OpenClaw plugin 主链路 + CLI 补数链路
- Out of scope:
  - `langsmith` adapter 与参数开放
  - 外部队列基础设施

## Tasks

### T0 计划资产管理
- 归档上阶段 `plan.md/todo.md`
- 生成本阶段 `plan.md/todo.md`

### T1 核心抽象补齐（不改行为）
- `@spanory/core` 增加 `BackendAdapter` 与编译上下文类型
- runtime adapter 仅输出 canonical events

### T2 抽离 OTLP Core
- 新增 `packages/otlp-core`
- 迁移 `compile/send/headers/resource` 逻辑

### T3 Langfuse BackendAdapter
- 新增 `packages/backend-langfuse`
- 完成 canonical -> langfuse 语义映射
- CLI 内部改为 runtime -> backend -> otlp-core

### T4 OpenClaw Plugin 主链路（零 cron）
- 新增 `packages/openclaw-plugin`
- 注册 hooks：`session_start/session_end/llm_input/llm_output/before_tool_call/after_tool_call/tool_result_persist/gateway_stop`
- 内置 spool + retry + flush

### T5 CLI OpenClaw 插件管理
- 新增命令：`plugin install|enable|disable|doctor|uninstall`

### T6 回归与对账
- 本地 OpenClaw 存量 session 回跑 + 实时触发验证
- Langfuse ClickHouse 明细与 native trace 对比

### T7 文档更新
- README、parity、capability、roadmap 同步更新

### T8 质量门
- `npm run check`
- `npm test`
- `npm run test:bdd`
- `npm run build:bin`
