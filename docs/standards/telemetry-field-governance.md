# Spanory 遥测字段治理规范

## 目标
将 runtime/backend/otlp 的字段定义统一收敛为可机器校验的 YAML 契约，并将字段增删漂移纳入 CI 强门禁。

## 规范文件（Source of Truth）
- `telemetry/field-spec.yaml`：字段总规范（字段元数据 + deprecated 策略）。
- `telemetry/runtime-mapping.yaml`：4 个 runtime 的映射/覆盖定义。
- `telemetry/platform-profiles.yaml`：平台私有字段映射（当前 langfuse 完整，其他模板化）。
- `telemetry/otel-semconv.lock.yaml`：OTel 官方 semconv 字段快照（版本、来源、哈希）。

## 门禁命令
```bash
npm run telemetry:check
```

`telemetry:check` 会执行：
1. 从代码提取当前字段集（`spanory-fields.current.yaml`）
2. 对比 field spec / OTel lock / 平台 profile
3. 输出机器报告与人工报告：
   - `telemetry/reports/field-diff.json`
   - `telemetry/reports/validate.json`
   - `telemetry/reports/telemetry-field-report.json`
   - `telemetry/reports/telemetry-field-report.md`

## 失败策略（阻断）
以下情况必须 fail：
- 使用被 `forbidden` 的 deprecated 字段（例如 `deployment.environment`）
- 代码中出现未登记到 `field-spec.yaml` 的字段
- runtime/platform 映射缺失导致字段无归属

## 变更流程（每次功能/修复都必须执行）
1. 修改代码前后，运行 `npm run telemetry:check`。
2. 如果报告出现 `added/removed/renamed/deprecated`：
   - 同步更新 `telemetry/*.yaml` 契约。
   - 在当期 `todo.md` 记录字段变化摘要与原因。
3. 若涉及 OTel 官方字段升级：
   - 运行 `npm run telemetry:sync-otel-semconv` 更新 lock。
   - 复跑 `npm run telemetry:check` 并提交报告变化。

## 设计原则
- 官方字段优先：优先采用 OTel semconv。
- 平台私有字段为 projection 层：不得反向侵入 runtime 核心语义。
- 对 deprecated 字段执行“发现即阻断”的严格策略。
