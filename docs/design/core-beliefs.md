---
type: file
summary: "Agent-First 8条操作原则：Contract-First、不可变、字段注册制、仓库即真相"
created: 2026-03-13T22:00:00+08:00
modified: 2026-03-13T22:00:00+08:00
tags: [principles, core-beliefs, agent-first]
---

# Core Beliefs — Agent-First 操作原则

## 1. Contract-First

代码实现严格对标 `design/contract.md`。Schema 先于代码存在，代码是 schema 的投影。

## 2. 不可变设计

所有状态管理与事件生成遵循函数式范式。新建对象，不修改已有。

## 3. 字段注册制

`telemetry/field-spec.yaml` 是字段的 source of truth。新增字段须先注册、后实现、CI 强验。

## 4. 适配器隔离

Runtime 特有逻辑封装在 adapter 边界内。Canonical events 对 runtime 无感知。

## 5. 仓库即真相

设计决策、架构约定、发布流程均版本化存于仓库。Slack 讨论或口头共识不作为依据。

## 6. 渐进式披露

Agent 从 AGENTS.md 出发，按需深入。不在入口堆砌所有信息。

## 7. 机械化执行

能用 CI/lint 强制的规则，不靠人记。taste 编码为 linter，不留口头约定。

## 8. 偏好无聊技术

选择可组合、API 稳定、训练集充分的技术。Agent 能推理的技术 > 人觉得酷的技术。
