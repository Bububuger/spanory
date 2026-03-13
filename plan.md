# Plan (2026-03-14) — BUB-24 Proxy truncateText 性能优化

## 目标
1. 将 `packages/cli/src/runtime/codex/proxy.ts` 的 `truncateText` 从 O(n²) 逐字符回退优化为 O(log n) 截断查找。
2. 保持输出语义不变：未超限时原样返回，超限时返回 `...[truncated]` 后缀。
3. 对 ASCII 与多字节 UTF-8 文本都保证“最终字符串字节数不超过 `maxBytes`”。

## 执行顺序
1. 用二分查找重写 `truncateText`，在不破坏语义的前提下降低复杂度。
2. 在 `packages/cli/test/unit/codex.proxy.spec.ts` 增加/更新针对大文本与 UTF-8 文本的断言。
3. 运行目标单测验证，必要时补充包级检查。
4. 记录修复前后复现实验信号并更新 Linear workpad。

## 验收标准
- 128KB 级输入场景下，截断实现不再出现 10 万级逐字符循环。
- 截断结果字节数始终 `<= maxBytes + Buffer.byteLength('...[truncated]')` 且语义一致。
- 相关单测全部通过。
