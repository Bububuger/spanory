# Plan (2026-03-09) — Issue #2 CWD 脱敏

## 目标
修复 `agentic.project.cwd` 直接上报绝对路径导致隐私泄露的问题，改为稳定脱敏值，并同步测试与字段说明。

## 方案
1. 在 Codex adapter 中将 `agentic.project.cwd` 从原始路径改为稳定脱敏值（复用 `deriveProjectIdFromCwd`）。
2. 更新 unit/golden 断言，确保不再出现原始绝对路径。
3. 更新 `telemetry/field-spec.yaml` 的示例值与语义描述。
4. 运行最小校验并记录结果。

## 验收
- `agentic.project.cwd` 不再包含绝对路径。
- 同一路径输出稳定一致。
- `codex.adapter` 相关单测通过。
