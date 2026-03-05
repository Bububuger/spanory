# Plan (2026-03-06) — 遥测字段标准化与 OTel 门禁

## 背景
当前字段定义分散在 runtime normalize / backend / otlp 编译代码中，缺少统一可校验规范；工作流也没有“字段增删变化”强制门禁。

## 目标
- 建立 YAML 规范源：字段定义、runtime 映射、平台映射、OTel 官方快照。
- 新增字段对账工具链：提取 -> 对比 -> 校验 -> 报告。
- CI 强制执行字段门禁，检测破坏性变化与 deprecated 字段使用。
- 立即完成 resource 字段切换：`deployment.environment` -> `deployment.environment.name`。

## 变更范围
- 规范与文档：`telemetry/*.yaml`、`docs/standards/*`、`docs/langfuse-parity.md`
- 工具脚本：`scripts/telemetry/*.mjs`
- 构建门禁：`package.json`、`.github/workflows/ci.yml`
- 核心实现：`packages/otlp-core/src/index.ts`
- 测试与金标：`packages/cli/test/unit/*`、`packages/cli/test/fixtures/golden/otlp/*`、`packages/cli/test/fixtures/exported/session-a.json`

## 验收标准
1. `telemetry` 目录包含字段规范、runtime 映射、平台映射与 OTel lock 文件。
2. `npm run telemetry:check` 可生成 JSON + Markdown 对账报告，并在违规时返回非 0。
3. CI 新增 telemetry gate，字段破坏/使用 deprecated 字段会阻断。
4. OTLP payload resource 中仅出现 `deployment.environment.name`。
5. 全量门禁通过：`npm run check && npm run build && npm test && npm run test:bdd`。
