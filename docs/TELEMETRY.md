# 字段治理规范

## Source of Truth

`telemetry/field-spec.yaml` 是所有 OTLP 字段的唯一注册表。

## 字段生命周期

```
提案 → 注册(field-spec.yaml) → 实现(代码) → CI验证(telemetry:check) → 发布
```

### 新增字段

1. 在 `telemetry/field-spec.yaml` 添加字段定义
2. 在 `design/agentic-fields.md` 添加设计说明（如属于 agentic.* 命名空间）
3. 在代码中实现
4. `npm run telemetry:check` 验证对齐
5. 更新 `design/langfuse-parity.md`（如影响 Langfuse 映射）

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

## 规范文件

| 文件 | 用途 |
|------|------|
| `telemetry/field-spec.yaml` | 字段总规范（字段元数据 + deprecated 策略） |
| `telemetry/runtime-mapping.yaml` | 4 个 runtime 的映射/覆盖定义 |
| `telemetry/platform-profiles.yaml` | 平台私有字段映射 |
| `telemetry/otel-semconv.lock.yaml` | OTel 官方 semconv 字段快照 |
| `telemetry/spanory-fields.current.yaml` | 当前实际使用字段（自动生成） |
| `design/agentic-fields.md` | agentic.* 字段设计说明 |
| `design/langfuse-parity.md` | Langfuse 映射对照表 |

## 工具链

| 命令 | 用途 |
|------|------|
| `npm run telemetry:extract` | 从代码提取实际使用的字段 |
| `npm run telemetry:diff` | 对比 spec 与实际使用 |
| `npm run telemetry:validate-mapping` | 验证 Langfuse 映射 |
| `npm run telemetry:report` | 生成字段覆盖报告 |
| `npm run telemetry:check` | CI 门禁（extract + diff + validate） |

## CI 门禁策略

以下情况必须 fail：
- 使用被 `forbidden` 的 deprecated 字段
- 代码中出现未登记到 `field-spec.yaml` 的字段
- runtime/platform 映射缺失导致字段无归属

## 变更流程

1. 修改代码前后，运行 `npm run telemetry:check`
2. 如果报告出现 `added/removed/renamed/deprecated`：
   - 同步更新 `telemetry/*.yaml` 契约
   - 在变更记录中记录字段变化摘要与原因
3. 若涉及 OTel 官方字段升级：
   - 运行 `npm run telemetry:sync-otel-semconv` 更新 lock
   - 复跑 `npm run telemetry:check` 并提交报告变化

## 设计原则

- 官方字段优先：优先采用 OTel semconv
- 平台私有字段为 projection 层：不得反向侵入 runtime 核心语义
- 对 deprecated 字段执行"发现即阻断"的严格策略
