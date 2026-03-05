# Plan (2026-03-06) — 去掉上报 name 的 Spanory 前缀

## 背景
当前上报的 turn/trace name 带有 `Spanory` 前缀，导致名称冗长。

## 目标
- 去掉上报 name 的 `Spanory` 前缀。
- 保持 runtime 信息与 turn/session 可识别性。
- 同步更新测试与 golden 期望。

## 变更范围
- 命名生成：`packages/cli/src/runtime/shared/normalize.ts`
- codex 特化：`packages/cli/src/runtime/codex/adapter.ts`
- openclaw plugin：`packages/openclaw-plugin/src/index.ts`
- trace 名：`packages/otlp-core/src/index.ts`
- 相关 unit/golden 测试文件

## 验收标准
1. 关键源码中不再出现 `Spanory <runtime> - Turn` 和 `Spanory <runtime> <id>` 模板。
2. `npm run --workspace @spanory/spanory test:golden:update` 成功。
3. `npm run --workspace @spanory/spanory test` 成功。
