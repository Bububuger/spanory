# Plan (2026-03-14) — BUB-23 JSONL 流式解析降内存峰值

## 目标
1. 消除运行时 adapter 对 JSONL 的整文件 `readFile + split` 读取路径，避免双份内存拷贝峰值。
2. 在 `claude/openclaw/codex` 三个 adapter 统一采用 `createReadStream + readline` 逐行解析。
3. 在保持行为兼容（空行/坏行忽略）的前提下补齐测试证据。

## 执行顺序
1. 新增共享的 JSONL 流式读取工具（异步逐行、可复用、可测试）。
2. 将 `packages/cli/src/runtime/claude/adapter.ts` 改为调用流式读取工具。
3. 将 `packages/cli/src/runtime/openclaw/adapter.ts` 改为调用流式读取工具。
4. 将 `packages/cli/src/runtime/codex/adapter.ts` 改为调用流式读取工具。
5. 更新/新增单测，覆盖三 adapter 读取路径行为一致性。
6. 运行针对性测试与 `npm run check`，完成提交与 PR 元数据更新。

## 风险与约束
- 读取顺序必须稳定，不能改变后续 `messages.sort` 与 parent-link 推断行为。
- 解析容错行为必须维持：空行忽略、坏 JSON 行忽略。
- 仅做最小差异改造，不扩展到非 JSONL 读取逻辑。

## 验收标准
- `packages/cli/src/runtime/{claude,openclaw,codex}/adapter.ts` 不再出现 `const raw = await readFile(...); raw.split('\n')` 组合。
- 三个 adapter 均通过流式逐行解析并维持既有容错行为。
- 相关 unit tests 通过，且覆盖改造路径。
- `npm run check` 通过。
