---
type: file
summary: "设计文档索引：权威契约、观测层/续航层设计、字段规范的验证状态"
created: 2026-03-13T22:00:00+08:00
modified: 2026-03-14T13:43:00+08:00
tags: [design, index, contract]
---

# 设计文档索引

## 权威设计（外部仓库 `spanory-all/design/`，当前仓库不内置）

| 文档标识 | 版本 | 验证状态 | 说明 | 访问说明 |
|------|------|---------|------|------|
| `design/contract.md` | v1.1 | ✅ 代码已对齐 | 共享契约 — 所有实现的 source of truth | 外部仓库引用。当前仓库不含该文件；参见 [docs/DESIGN.md](../DESIGN.md) 的 Contract-First 约束。 |
| `design/spanory.md` | — | ✅ 已审阅 | 观测层设计（token 估算、pollution score、boundary detection） | 外部仓库引用。当前仓库不含该文件；请在共享仓库 `spanory-all/design/` 查看。 |
| `design/relayloom.md` | — | 📋 计划中 | 续航层设计（ledger、memory、restore、sync） | 外部仓库引用。当前仓库不含该文件；请在共享仓库 `spanory-all/design/` 查看。 |
| `design/context-proxy.md` | — | 📋 计划中 | Context Proxy（API 层采集） | 外部仓库引用。当前仓库不含该文件；请在共享仓库 `spanory-all/design/` 查看。 |
| `design/retrieval.md` | — | 📋 计划中 | 检索注入策略 | 外部仓库引用。当前仓库不含该文件；请在共享仓库 `spanory-all/design/` 查看。 |

> 引用策略说明：外部权威文档以路径标识 + 访问说明表达；仓库内文档使用可解析本地链接。该策略与 [ARCHITECTURE.md](../../ARCHITECTURE.md)、[docs/DESIGN.md](../DESIGN.md) 一致。

## 仓库内设计文档

| 文档 | 说明 |
|------|------|
| [agentic-fields.md](../../agentic-fields.md) | agentic.* 34 字段设计说明 |
| [review.md](../../review.md) | 丞相代码审阅报告（2026-03-11） |
| [capture-multi-runtime-design](../plans/2026-03-03-capture-multi-runtime-design.md) | 多 runtime 采集设计 |

## 核心信念

见 [core-beliefs.md](./core-beliefs.md) — Agent-first 操作原则。
