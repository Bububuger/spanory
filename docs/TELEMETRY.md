---
type: file
summary: "OTLP 字段治理：生命周期、命名空间、工具链、相关文件索引"
created: 2026-03-13T22:00:00+08:00
modified: 2026-03-13T22:00:00+08:00
tags: [telemetry, fields, governance, otlp]
---

# 字段治理规范

## Source of Truth

`telemetry/field-spec.yaml` 是所有 OTLP 字段的唯一注册表。

## 字段生命周期

```
提案 → 注册(field-spec.yaml) → 实现(代码) → CI验证(telemetry:check) → 发布
```

### 新增字段

1. 在 `telemetry/field-spec.yaml` 添加字段定义
2. 在 `agentic-fields.md` 添加设计说明（如属于 agentic.* 命名空间）
3. 在代码中实现
4. `npm run telemetry:check` 验证对齐
5. 更新 `docs/langfuse-parity.md`（如影响 Langfuse 映射）

### 修改/废弃字段

1. 更新 `field-spec.yaml` 中的定义
2. 更新所有引用该字段的代码
3. 在 CHANGELOG 中记录 breaking change
4. `telemetry:check` 验证一致性

## 命名空间

| 命名空间 | 来源 | 用途 |
|---------|------|------|
| `gen_ai.*` | OTel 官方 | 模型调用层（token、模型名） |
| `agentic.*` | Spanory 自定义 | Agent 行为层（34 字段） |
| Langfuse 属性 | backend-langfuse | 平台投影 |

## 工具链

| 命令 | 用途 |
|------|------|
| `npm run telemetry:extract` | 从代码提取实际使用的字段 |
| `npm run telemetry:diff` | 对比 spec 与实际使用 |
| `npm run telemetry:validate-mapping` | 验证 Langfuse 映射 |
| `npm run telemetry:report` | 生成字段覆盖报告 |
| `npm run telemetry:check` | CI 门禁（extract + diff + validate） |

## 相关文件

- `telemetry/field-spec.yaml` — 全量字段定义
- `telemetry/otel-semconv.lock.yaml` — OTel 语义约定锁定
- `telemetry/spanory-fields.current.yaml` — 当前实际使用字段
- `agentic-fields.md` — agentic.* 字段设计说明
- `docs/langfuse-parity.md` — Langfuse 映射对照表
- `docs/standards/telemetry-field-governance.md` — 详细治理流程
