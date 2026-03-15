---
type: file
summary: "架构全景：领域模型、包分层与依赖方向、runtime 适配器、关键设计决策"
created: 2026-03-13T22:00:00+08:00
modified: 2026-03-13T22:00:00+08:00
tags: [architecture, packages, layers, runtime-adapters]
---

# Spanory 架构

## 领域模型

```
Runtime (Claude Code / Codex / OpenClaw / OpenCode)
  │ transcript + hook payload
  ▼
Canonical Events ──────────────────────────────
  │ context_snapshot         [estimated_total_tokens, fill_ratio, estimation_method]
  │ context_boundary         [compact_before/after, detection_method]
  │ context_source_attribution [source_kind, pollution_score_v1]
  ▼
OTLP Core ── span compile + HTTP ──▶ Langfuse / Custom Backend
```

## 包分层与依赖方向

```
@bububuger/core              类型定义 · token 估算 · pollution score
    ▲
@bububuger/otlp-core         OTLP span 编译 · HTTP 发送
    ▲
@bububuger/backend-langfuse  Langfuse 字段映射
    ▲
@bububuger/spanory (cli)     主 CLI · runtime adapters · reports · alerts
    ▲                  ▲
openclaw-plugin     opencode-plugin    实时注入插件
```

依赖只能向上（箭头方向）。禁止反向依赖或跨层直接调用。

## 包职责

| 包 | 路径 | 职责 | 行数量级 |
|----|------|------|---------|
| core | `packages/core/` | 类型、估算、评分 | ~400 |
| otlp-core | `packages/otlp-core/` | OTLP 编译与发送 | ~300 |
| backend-langfuse | `packages/backend-langfuse/` | Langfuse 映射 | ~50 |
| cli | `packages/cli/` | 主 CLI 入口 | ~83K |
| openclaw-plugin | `packages/openclaw-plugin/` | OpenClaw 实时插件 | ~800 |
| opencode-plugin | `packages/opencode-plugin/` | OpenCode 实时插件 | ~600 |
| alipay-cli | `packages/alipay-cli/` | 内部发布适配 | — |

## Runtime 适配器

每个 runtime 有独立 adapter，负责解析该 runtime 的 transcript/hook 格式并转为 canonical events。

| Runtime | 模式 | 入口机制 |
|---------|------|---------|
| Claude Code | realtime | Stop + SessionEnd hook |
| Codex | notify + watch | notify 脚本 + 轮询 backfill |
| OpenClaw | realtime | plugin 插装 |
| OpenCode | realtime | plugin loader |

## 关键设计决策

1. **Token 估算三级方案** — Usage anchor (1.0) → Content heuristic (0.3-0.5) → EMA calibrated (0.7-0.9)
2. **Pollution Score 四因子** — deltaRatio(0.50) + shareRatio(0.30) + repeatRatio(0.20) + unknownPenalty(0.15)
3. **Inferred Compact Detection** — 无 PreCompact hook，靠 token 骤降 >40% 推断
4. **agentic.* 命名空间** — 34 字段填补 OTel gen_ai.* 行为空白

## 外部依赖

| 依赖 | 用途 |
|------|------|
| Langfuse | 可观测性后端 |
| OpenTelemetry | 传输协议 |
| esbuild | 插件打包 |
| pkg (binary) | 多平台二进制 |

## 相关设计文档

- 设计文档索引: `docs/design/README.md`
- 采集设计: `docs/design/capture-multi-runtime.md`
- 字段设计: `docs/design/agentic-fields.md`
- 字段定义: `telemetry/field-spec.yaml`
