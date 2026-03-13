---
type: file
summary: "Agent 入口地图 — 知识库导航、关键约束、开发/发布命令"
created: 2026-03-13T22:00:00+08:00
modified: 2026-03-13T22:00:00+08:00
tags: [agents, navigation, entry-point]
---

# Spanory — Agent 导航

跨 runtime 的 AI Agent 可观测性工具包。一套 canonical schema 适配 Claude Code、Codex、OpenClaw、OpenCode。

## 架构速览

见 [ARCHITECTURE.md](./ARCHITECTURE.md)。核心分层：

```
Core(类型+估算) → OTLP(span编译) → Backend(Langfuse映射)
                → CLI(适配器+报告+告警) → Plugins(实时注入)
```

六包：`core` · `cli` · `otlp-core` · `backend-langfuse` · `openclaw-plugin` · `opencode-plugin`

## 知识库导航

| 需要什么 | 去哪里找 |
|---------|---------|
| 设计决策与契约 | [docs/design-docs/index.md](./docs/design-docs/index.md) |
| 权威共享契约 | [../design/contract.md](../design/contract.md)（代码实现必须对齐） |
| 当前执行计划 | [docs/exec-plans/active/](./docs/exec-plans/active/) |
| 已完成计划归档 | [docs/exec-plans/completed/](./docs/exec-plans/completed/) |
| 技术债追踪 | [docs/exec-plans/tech-debt-tracker.md](./docs/exec-plans/tech-debt-tracker.md) |
| 产品规格 | [docs/product-specs/index.md](./docs/product-specs/index.md) |
| 质量评分 | [docs/QUALITY_SCORE.md](./docs/QUALITY_SCORE.md) |
| 发布流程 | [docs/RELEASE.md](./docs/RELEASE.md) |
| 字段治理 | [docs/TELEMETRY.md](./docs/TELEMETRY.md) |
| 可靠性 | [docs/RELIABILITY.md](./docs/RELIABILITY.md) |
| 安全策略 | [docs/SECURITY.md](./docs/SECURITY.md) |
| 工程规范 | [docs/standards/README.md](./docs/standards/README.md) |
| 外部参考 | [docs/references/](./docs/references/) |

## 关键约束

1. **Contract-First** — 所有实现严格对标 `../design/contract.md`
2. **不可变设计** — 新建对象，不修改已有
3. **字段注册制** — 新增 `agentic.*` 字段须先注册 `telemetry/field-spec.yaml`
4. **CI 门禁** — `telemetry:check` 强制字段对齐，不通过不合并
5. **适配器隔离** — runtime 逻辑留在 adapter 边界内

## 开发命令

```bash
npm run check           # 类型检查 + lint
npm run telemetry:check # 字段对齐门禁
npm run build           # 全量构建
npm test                # 单元测试
npm run test:bdd        # BDD 测试
```

## 发布命令

```bash
git tag vX.Y.Z && git push origin vX.Y.Z   # 触发 GHA 发布
npm run version:sync                        # 本地版本同步
```

## Symphony 工作流

Linear issue 驱动，详见 [WORKFLOW.md](./WORKFLOW.md)。
Symphony 计划/任务归档在 `docs/plans/archive/` 和 `docs/todos/archive/`。
