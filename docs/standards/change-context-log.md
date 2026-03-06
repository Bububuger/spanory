# Spanory 变更背景记录台账

## 目的
为每一批中大型改动沉淀可回溯上下文，确保后续 agent 能快速理解“为什么改、改了什么、影响什么、如何验证、如何回滚”。

## 记录规则
- 触发条件（满足任一即必须登记）：
  - 变更触及 2 个及以上文件；
  - 涉及构建/发布/入口路径；
  - 涉及运行时语义、兼容性、测试基线；
  - 为重构、架构调整、或历史包清理。
- 记录时机：代码验收通过后、提交前更新。
- 记录内容必须包含：背景、决策、影响范围、验证证据、回滚点。
- 同一阶段可追加多条记录，不覆盖旧条目。

## 建议模板
```md
## YYYY-MM-DD - <变更标题>
- 背景：
- 决策：
- 影响范围：
- 验证：
- 回滚方案：
```

## 记录

## 2026-03-05 - 运行入口切换到 dist（TS 唯一源码）
- 背景：仓库同时存在 `src/*.ts` 与 `src/*.js`，运行链路实际仍依赖 `src/*.js`，导致双真相源和维护成本上升。
- 决策：统一采用 `TS 源码 -> dist JS 产物`，切换 CLI/核心包/插件入口到 `dist`，并移除迁移范围内 `src/*.js`。
- 影响范围：`packages/cli`、`packages/core`、`packages/otlp-core`、`packages/backend-langfuse`、`packages/openclaw-plugin`、`packages/opencode-plugin`、release 构建链路。
- 验证：`npm run --workspaces build`、`npm run check`、`npm test`、`npm run test:bdd`、`bash scripts/release/build-binaries.sh all`、`npm run package:release-assets -- v0.0.0-test` 全通过。
- 回滚方案：回滚到提交 `1564e38`（切换前稳定基线），恢复 `src/*.js` 入口。

## 2026-03-05 - 清理废弃 workspace：packages/langfuse
- 背景：`packages/langfuse` 已不在运行链路中，仅保留历史占位，且入口配置与实际文件不一致，增加认知噪音。
- 决策：删除 `packages/langfuse` 目录并清理 lockfile 残留条目，保持仓库干净。
- 影响范围：`packages/langfuse`、`package-lock.json`、阶段计划文档。
- 验证：`test ! -d packages/langfuse`，并确认 `package-lock.json` 无 `@spanory/langfuse|packages/langfuse`；全量门禁通过。
- 回滚方案：从历史提交恢复 `packages/langfuse` 目录并重新生成 lockfile。

## 2026-03-06 - 遥测字段规范化与 OTel 门禁
- 背景：runtime/backend/otlp 字段定义分散在代码内，缺少统一字段契约与自动化漂移检测；OTLP resource 仍使用旧键 `deployment.environment`。
- 决策：新增 `telemetry/*.yaml` 作为字段 source of truth，落地 `extract/sync/diff/validate/report/check` 工具链，CI/release 引入 `telemetry:check` 强门禁；resource 字段切换为 `deployment.environment.name`。
- 影响范围：`telemetry/*`、`scripts/telemetry/*`、`package.json`、`.github/workflows/{ci,release}.yml`、`packages/otlp-core/src/index.ts`、`docs/standards/*`、`docs/langfuse-parity.md`、测试与 golden fixtures。
- 验证：`npm run telemetry:extract/diff/validate-mapping/report/check`、`npm run check`、`npm run build`、`npm test`、`npm run test:bdd` 全通过。
- 回滚方案：回滚本次提交并恢复旧 resource 键；删除 telemetry gate 步骤与 `scripts/telemetry` 新增脚本，恢复原 CI 流程。

## 2026-03-06 - 固化 ClickHouse 排障与本地 E2E 验收记忆
- 背景：近期多次排查 Langfuse/ClickHouse 中的 trace、observation、runtime 实时上报问题，关键经验主要存在于会话上下文中，压缩后容易丢失。
- 决策：不新增散落记忆文件，直接将 ClickHouse 查询模板沉淀到 `agent-onboarding`，将“重建本机二进制 -> 触发真实对话 -> 本地导出 -> ClickHouse 复核”的端到端验收闭环沉淀到 `runtime-validation-matrix`。
- 影响范围：`docs/standards/agent-onboarding.md`、`docs/standards/runtime-validation-matrix.md`、阶段计划文档与 release 发布步骤。
- 验证：文档中已包含 `FINAL` 查询原则、`session_id -> trace_id -> observations` 查询模板，以及本地真实对话验收命令；本次修复已通过本地导出与 ClickHouse 双重验证。
- 回滚方案：回滚本次文档提交；若流程需要重写，以 `change-context-log` 中本条记录为基线重新整理。
