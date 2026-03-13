---
type: file
summary: "设计总纲：设计原则、分层架构约束、设计模式索引"
created: 2026-03-13T22:00:00+08:00
modified: 2026-03-13T22:00:00+08:00
tags: [design, patterns, architecture]
---

# 设计总纲

## 设计原则

见 [design-docs/core-beliefs.md](./design-docs/core-beliefs.md)。

## 分层架构

见 [ARCHITECTURE.md](../ARCHITECTURE.md)。

核心约束：
- **依赖向上** — core ← otlp-core ← backend ← cli ← plugins
- **适配器隔离** — runtime 特有逻辑不穿透到 canonical events
- **Contract-First** — `../design/contract.md` 是所有实现的 source of truth

## 设计模式

| 模式 | 应用场景 |
|------|---------|
| Adapter Pattern | runtime transcript → canonical events |
| Builder Pattern | OTLP span 编译 |
| Strategy Pattern | token 估算三级方案 |
| Observer Pattern | plugin 实时注入 |

## 设计文档目录

完整索引见 [design-docs/index.md](./design-docs/index.md)。
