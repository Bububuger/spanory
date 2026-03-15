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
| 路线图与全局规划 | [docs/ROADMAP.md](./docs/ROADMAP.md) |
| 设计决策与契约 | [docs/design/](./docs/design/) |
| 权威共享契约 | [../design/contract.md](../design/contract.md) |
| 接入指南 | [docs/guides/](./docs/guides/) |
| 工程规范 | [docs/standards/](./docs/standards/) |
| 发布流程 | [docs/RELEASE.md](./docs/RELEASE.md) |
| 字段治理 | [docs/TELEMETRY.md](./docs/TELEMETRY.md) |
| 可靠性 | [docs/RELIABILITY.md](./docs/RELIABILITY.md) |
| 安全策略 | [docs/SECURITY.md](./docs/SECURITY.md) |
| 质量评分 | [docs/operations/quality-score.md](./docs/operations/quality-score.md) |
| 技术债追踪 | [docs/operations/tech-debt-tracker.md](./docs/operations/tech-debt-tracker.md) |
| 历史归档 | [docs/archive/](./docs/archive/) |

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
