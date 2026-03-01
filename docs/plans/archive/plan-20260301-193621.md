# OpenClaw Runtime 适配与 Langfuse 等价 Trace Plan (2026-03-01)

## Goal
新增 `openclaw` runtime，做到与 `claude-code` 同等级 trace 丰富度，并上报 Langfuse 兼容 OTLP。

## Scope
- `packages/core/src/index.ts`
- `packages/cli/src/runtime/shared/*`
- `packages/cli/src/runtime/claude/adapter.js`
- `packages/cli/src/runtime/openclaw/adapter.js`
- `packages/cli/src/index.js`
- `packages/cli/test/{unit,bdd}` 与 `test/fixtures/openclaw`
- `docs/runtime-capability-matrix.md`
- `docs/langfuse-parity.md`
- `README.md`
- `docs.md`

## Tasks
### T0 计划资产管理
- 归档当前阶段 `plan.md/todo.md`
- 生成新阶段 `plan.md/todo.md`

### T1 抽取 runtime-neutral normalize 层
- 新增共享 normalize + capability 常量
- Claude adapter 改造为 parse -> normalize
- core 类型补齐 `tool` 分类与可选 runtime 元数据

### T2 OpenClaw adapter
- 新增 OpenClaw transcript parser + adapter
- 支持 Hook + transcript_path 与默认目录回退

### T3 CLI runtime 路由抽象
- 注册 openclaw runtime
- 生成 runtime 子命令族 export/hook/backfill
- 顶层 `spanory hook` 增加 `--runtime`

### T4 文档与能力矩阵
- 新增 runtime capability matrix
- 更新 parity/README/roadmap

### T5 测试矩阵
- 新增 openclaw unit + bdd
- 回归现有 claude/otlp/report/alert

### T6 最终验收
- `npm run check`
- `npm test`
- `npm run test:bdd`
- `npm run build:bin`
