# Spanory TS 迁移测试矩阵（2026-03-04）

## 目标
把当前行为保障映射成“模块 -> 测试 -> 风险”矩阵，作为 TypeScript 重构期间的验证清单。

## 模块覆盖矩阵

| 模块 | 关键能力 | Unit 覆盖 | BDD 覆盖 | 风险级别 | 备注 |
|---|---|---|---|---|---|
| core | schema/类型契约 | 间接覆盖（cli/otlp） | 间接覆盖 | 中 | 当前缺少 core 独立单测，存在缺口 |
| cli runtime adapters | transcript 解析、normalize | `adapter.spec.js` `openclaw.adapter.spec.js` `codex.adapter.spec.js` `normalize.spec.js` | `hook.integration.spec.js` `openclaw.hook.integration.spec.js` `codex.hook.integration.spec.js` | 高 | 迁移时优先保护 turn/tool 分类 |
| cli command | hook/export/backfill/setup/watch | `env.spec.js` `report.spec.js` `alert.spec.js` | `hook`/`export`/`backfill`/`setup`/`codex.watch` 相关 bdd | 高 | 用户可见命令面，必须保持一致 |
| otlp | compile/send/header parse | `otlp.spec.js` | 间接覆盖（所有上报链路） | 高 | trace/span/attributes 漂移风险高 |
| backend-langfuse | 属性映射 | `backend.langfuse.spec.js` | 间接覆盖 | 中 | 与 Langfuse UI 对齐风险 |
| openclaw plugin | spool/retry/status/flush | `openclaw.plugin.runtime.spec.js` | `openclaw.plugin.integration.spec.js` | 高 | side-effect 多，需重点回归 |
| opencode plugin | env/spool/retry/status | `opencode.plugin.runtime.spec.js` | `opencode.plugin.integration.spec.js` | 高 | 新增链路，稳定性优先 |
| report | session/mcp/command/agent/cache/tool/turn-diff | `report.spec.js` | `report.integration.spec.js` | 中 | 输出 schema 不可破坏 |
| alert | rule eval + metrics | `alert.spec.js` | `alert.integration.spec.js` | 中 | 阈值行为要保持 |

## 能力到路径映射（关键字）
- hook：`test/bdd/hook.integration.spec.js`、`test/bdd/openclaw.hook.integration.spec.js`、`test/bdd/codex.hook.integration.spec.js`
- export：`test/bdd/replay.integration.spec.js`、`test/bdd/openclaw.replay.integration.spec.js`
- backfill：`test/bdd/backfill.integration.spec.js`、`test/bdd/openclaw.backfill.integration.spec.js`、`test/bdd/codex.backfill.integration.spec.js`
- report：`test/bdd/report.integration.spec.js`
- alert：`test/bdd/alert.integration.spec.js`
- setup：`test/bdd/setup.integration.spec.js`
- opencode：`test/bdd/opencode.plugin.integration.spec.js`
- runtime 验收：见 `docs/standards/runtime-validation-matrix.md`（注意 opencode 走 plugin 验证而非 export）

## 覆盖缺口
1. `packages/core` 缺少直接单测（目前依赖上层间接覆盖）。
2. `packages/otlp-core` 的异常路径覆盖仍偏少（网络失败/异常值边界）。
3. plugin 并发边界场景（多 session 并发 flush）缺口。

## 补测优先级
- P0：core 独立契约测试 + otlp 异常路径。
- P1：plugin 并发/竞态场景。
- P2：report/alert 边界数据（空会话、异常属性类型）。
