# Plan (2026-03-13) — 统一 service.version 为发布版本

## 目标
1. 让 CLI 与各 runtime 插件上报的 `service.version` 与实际发布版本一致。
2. 升级后可通过 `service.version` 明确判断是否生效。

## 执行顺序
1. 在 openclaw/opencode 插件新增统一版本解析逻辑（优先 spanory 包版本）。
2. 在插件 OTLP resource 构建时显式传入 `serviceVersion`。
3. 运行构建与回归，验证 payload 中 `service.version`。

## 验收标准
- `service.version` 不再落到 `0.1.1` 默认值。
- 本地导出/插件链路可见 `service.version=0.1.20`（或当前发布版）。
