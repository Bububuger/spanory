# Spanory Roadmap

> 更新: 2026-03-15

## 发展脉络

### Phase 0 — Bootstrap（2026-02-28）

从零搭建跨 runtime AI Agent 可观测性工具。

- npm workspace 多包架构（core / cli / otlp-core）
- Claude Code runtime adapter（transcript 解析 + 事件分类）
- OTLP span 编译器 + Langfuse 兼容上报
- 初始 replay/export CLI 工作流

**产出**: v0.1.0 — 可对单个 Claude Code session 生成可观测 trace。

### Phase 1 — MVP 强化（2026-03-01 ~ 03-04）

将原型推向可维护的工程产品。

- 项目治理文件（CHANGELOG / CONTRIBUTING / CI）
- Commander CLI 命令模型 + binary 分发（4 平台）
- Langfuse parity 契约 + gap 矩阵
- token/usage 提取与上报
- 单元测试 + BDD 集成测试 + CI 门禁
- 字段治理体系（field-spec.yaml + telemetry:check）

**产出**: v0.1.1 — 稳定的单 runtime CLI + 二进制 + CI 管道。

### Phase 2 — 全量 Taxonomy（2026-03-05 ~ 03-15）✅ 当前

多 runtime 支持 + 工程质量全面提升。

- 新增 3 个 runtime adapter（Codex watch / OpenClaw plugin / OpenCode plugin）
- setup 一键接入命令（detect / apply / doctor / teardown）
- agentic.* 34 字段命名空间设计与实现
- 告警规则引擎 + 报告聚合（report / alert）
- TS 迁移完成：strict 模式零错误，移除全部 @ts-nocheck
- cli/src/index.ts god file 拆分（83K → 13 模块）
- Husky + lint-staged + Prettier + commitlint 工程基线
- 字段治理 CI 强门禁（telemetry:check）

**产出**: v0.1.35 — 4 runtime 全覆盖，工程质量 A 级。

---

## 未来规划

### Phase 3 — Capture + Event Stream（📋 计划）

补齐 transcript 之外的请求/响应上下文。

- CaptureAdapter 架构（默认关闭、显式开启、可降级）
- Claude Code / OpenClaw 首期接入
- 脱敏管道（header/body/query 规则匹配）
- replay / boundary detection / event stream 实时输出
- 设计文档: [design/capture-multi-runtime.md](./design/capture-multi-runtime.md)

### Phase 4 — Relayloom 续航层（📋 规划）

Agent 会话的持久化与恢复能力。

- Ledger（会话账本）
- Memory（跨会话记忆）
- Restore（断点恢复）
- Sync（多端同步）
- 设计文档: `spanory-all/design/relayloom.md`（外部仓库）

### Phase 5 — Python SDK（📋 PRD）

Python Agent 生态一行接入。

- `spanory.init()` 一行初始化
- 自动检测 runtime 环境
- PRD: `spanory-sdk/spanory-python-sdk-PRD.md`（外部仓库）

---

## 技术债

当前无活跃债项。已清偿记录见 [operations/tech-debt-tracker.md](./operations/tech-debt-tracker.md)。

## 质量现状

见 [operations/quality-score.md](./operations/quality-score.md)。
