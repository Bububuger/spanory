# Plan (2026-03-14) — BUB-17 工具调用内容 OTLP 脱敏

## 目标
1. 修复 Write/Edit/Read（以及同类工具事件）在导出 OTLP 前未脱敏的问题，避免敏感内容明文进入 `langfuse.observation.input/output`。
2. 复用 Codex proxy 的 `redactBody + maxBodyBytes` 逻辑，统一敏感键替换与内容截断行为。
3. 补齐自动化测试，覆盖“当前泄露信号 -> 修复后行为”。

## 范围
- `packages/cli/src/runtime/shared/normalize.ts`
- `packages/cli/src/runtime/codex/proxy.ts`
- `packages/cli/src/runtime/shared/redaction.ts`（新建）
- `packages/cli/test/unit/normalize.spec.ts`

## 实施方案
1. 抽取共享 redaction 工具：将 proxy 中通用的 `truncateText`、`redactBody`、敏感键识别迁移到 `runtime/shared`。
2. 在 `normalize.ts` 工具事件路径（Bash/MCP/Task/通用 Tool）中对 input/output 执行统一内容清洗：
   - 对对象输入先 `redactBody` 再字符串化。
   - 对字符串输出按 JSON 字符串语义走 `redactBody` 并截断。
3. 保持 `otlp-core` 行为不变（仍映射 event.input/output），由上游保证内容已清洗。
4. 测试采用 TDD：先新增失败用例证明当前泄露，再实现修复至通过。

## 验收标准
- 工具 input/output 不再含敏感键原值（如 `token/password/secret/api_key`）。
- 超长工具内容按统一 `maxBodyBytes` 被截断，且行为可预测。
- 相关单测通过，且不破坏现有 normalize 行为。
