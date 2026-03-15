# 设计文档

## 设计原则

见 [core-beliefs.md](./core-beliefs.md) — Agent-First 操作原则。

## 架构约束

- **依赖向上** — core ← otlp-core ← backend ← cli ← plugins
- **适配器隔离** — runtime 特有逻辑不穿透到 canonical events
- **Contract-First** — `spanory-all/design/contract.md` 是所有实现的 source of truth

详见 [ARCHITECTURE.md](../../ARCHITECTURE.md)。

## 设计模式

| 模式 | 应用场景 |
|------|---------|
| Adapter | runtime transcript → canonical events |
| Builder | OTLP span 编译 |
| Strategy | token 估算三级方案 |
| Observer | plugin 实时注入 |

## 仓库内设计文档

| 文档 | 说明 |
|------|------|
| [agentic-fields.md](./agentic-fields.md) | agentic.* 34 字段设计 |
| [langfuse-parity.md](./langfuse-parity.md) | Langfuse 映射对照表 |
| [runtime-capability-matrix.md](./runtime-capability-matrix.md) | 各 runtime 支持情况 |
| [capture-multi-runtime.md](./capture-multi-runtime.md) | Phase 3 多 runtime 采集设计 |

## 权威设计（外部仓库 `spanory-all/design/`）

| 文档 | 状态 | 说明 |
|------|------|------|
| `design/contract.md` | ✅ 已对齐 | 共享契约 — 所有实现的 source of truth |
| `design/spanory.md` | ✅ 已审阅 | 观测层设计 |
| `design/relayloom.md` | 📋 计划中 | 续航层设计 |
| `design/context-proxy.md` | 📋 计划中 | Context Proxy（API 层采集） |
| `design/retrieval.md` | 📋 计划中 | 检索注入策略 |
