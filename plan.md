# Plan (2026-03-14) — BUB-14 跨包/跨 adapter 重复原语收敛

## 目标
1. 将跨 `cli` / `openclaw-plugin` / `alipay-cli` 的重复原语收敛至 `@bububuger/core`。
2. 在不改变行为前提下，消除指定重复实现：`extractToolUses`、`toNumber`、`parseJsonObject`、`GATEWAY_INPUT_METADATA_BLOCK_RE`。

## 作用域
- `packages/core/src/index.ts`（新增共享原语导出）
- `packages/cli/src/runtime/shared/normalize.ts`
- `packages/cli/src/runtime/claude/adapter.ts`
- `packages/cli/src/runtime/openclaw/adapter.ts`
- `packages/cli/src/alert/evaluate.ts`
- `packages/cli/src/report/aggregate.ts`
- `packages/openclaw-plugin/src/index.ts`
- `packages/alipay-cli/openclaw-plugin/src/index.ts`
- `packages/opencode-plugin/src/index.ts`
- `packages/core/test/*.test.mjs`（新增原语测试）

## 设计决策
1. 共享原语统一落到 `@bububuger/core`，避免再引入新包。
2. 仅提取“纯函数/常量”，不改调用链业务结构，保证 diff 小而可审查。
3. `parseJsonObject` 统一为“仅返回非数组 JSON 对象或 `null`”。
4. `toNumber` 统一为“仅返回 finite number 或 `undefined`”。

## 执行顺序
1. 复现并记录重复代码基线（`rg` 命中与文件定位）。
2. 在 `core` 实现并导出共享原语。
3. 迁移 `cli`、两个 openclaw plugin 与 opencode plugin 到共享原语。
4. 补充 `core` 单测覆盖关键边界（类型、空值、非法 JSON）。
5. 运行受影响检查与测试，确认行为一致。

## 验收标准
- 指定 4 类原语在目标文件中不再出现多份等价实现。
- 受影响包 `check/test` 通过，无类型或构建回归。
- 复现前后证据齐全（扫描命令 + 结果摘要已记录）。
