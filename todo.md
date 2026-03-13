# Todo (2026-03-14) — BUB-5 移除业务逻辑 `@ts-nocheck`

- [x] 任务 1：完成 `@ts-nocheck` 基线盘点并记录文件清单
  - 验收检查：`rg -n "^//\\s*@ts-nocheck" --glob "*.ts"`（已检出 15 个文件）

- [x] 任务 2：清理第一批文件（`env.ts`、`otlp.ts`、`capabilities.ts`）
  - 验收检查：`npx tsc -p packages/cli/tsconfig.runtime.json --noEmit`

- [x] 任务 3：清理 adapters、`alert/evaluate.ts`、`report/aggregate.ts` 并修复类型
  - 验收检查：`npx tsc -p packages/cli/tsconfig.runtime.json --noEmit`

- [x] 任务 4：清理 plugins/backend（`openclaw-plugin`、`opencode-plugin`、`alipay-cli/openclaw-plugin`、`backend-langfuse`）
  - 验收检查：`npx tsc -p packages/backend-langfuse/tsconfig.json --noEmit` + `npx tsc -p packages/openclaw-plugin/tsconfig.json --noEmit` + `npx tsc -p packages/opencode-plugin/tsconfig.json --noEmit` + `npx tsc -p packages/alipay-cli/openclaw-plugin/tsconfig.json --noEmit`

- [x] 任务 5：清理 `normalize.ts` 与 `index.ts` 并完成全量验证
  - 验收检查：`npm run check`、`npm test`、`npm run telemetry:check`

- [ ] 任务 6：整理提交与 PR 元数据（含 `symphony` 标签）并更新 workpad
  - 验收检查：workpad 清单全部勾选且验证结果完整
