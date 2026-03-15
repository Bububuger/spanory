---
type: file
summary: "计划索引：活跃计划、产品路线图、Symphony 工作计划入口"
created: 2026-03-13T22:00:00+08:00
modified: 2026-03-13T22:00:00+08:00
tags: [plans, roadmap, index]
---

# 计划索引

## 活跃计划

| 计划 | 状态 | 说明 |
|------|------|------|
| — | — | 当前无活跃执行计划 |

新增计划请放入 `docs/exec-plans/active/`，完成后移至 `docs/exec-plans/completed/`。

## 路线图

| 阶段 | 内容 | 状态 |
|------|------|------|
| MVP-A1 | schema + token 估算 + basic attribution | ✅ 完成 |
| MVP-A2 | full taxonomy + alerts + reports | 🔄 进行中 |
| MVP-A3 | replay + boundary + event stream | 📋 计划 |
| Relayloom | 续航层（ledger → memory → restore → sync） | 📋 规划 |
| Python SDK | Python Agent 一行 init() | 📋 PRD |

## 技术债

详见 [exec-plans/tech-debt-tracker.md](./exec-plans/tech-debt-tracker.md)。

## 过程文件

Agent 会话产生的 plan/todo 存档保留在本地，不纳入版本控制（已加入 .gitignore）。
活跃执行计划放入 `docs/exec-plans/`。
