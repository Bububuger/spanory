# Plan (2026-03-06) — 修复 Codex Tool Duration

## 背景
ClickHouse 已确认 `codex` 的 `AGENT` turn 节点具备耗时与 token，但其下 `TOOL` 节点被上报为 `0ms`。根因在归一化层：tool 事件的 `startedAt` 与 `endedAt` 当前都直接取 assistant 发出 `tool_use` 的同一时间戳。

## 目标
- 为 codex/共享 transcript 归一化建立 `tool_use_id -> tool_result timestamp` 映射
- 让 `Bash` / `MCP` / `Task` / 通用 tool 节点使用真实的完成时间
- 用单元测试锁定该行为，避免回归

## 变更范围
- 文档流程：`plan.md`、`todo.md`
- 代码：`packages/cli/src/runtime/shared/normalize.ts`
- 测试：`packages/cli/test/unit/normalize.spec.ts`

## 实施方案
1. 在归一化阶段先扫描消息，收集每个 `tool_use_id` 对应的结果文本与最早结果时间。
2. 生成 tool 事件时，`startedAt` 继续使用 assistant 中 `tool_use` 所在时间，`endedAt` 优先使用匹配到的结果时间；无结果时回退到原时间。
3. 先写失败单测验证 duration，再做最小实现并跑相关单测。

## 验收标准
1. `normalizeTranscriptMessages` 对带 `tool_result` 的 transcript 产出非零 tool duration。
2. 无 `tool_result` 的场景保持兼容，`endedAt` 仍可回退到 `startedAt`。
3. 相关 unit tests 通过。
