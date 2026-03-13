# Plan (2026-03-14) — BUB-13 normalize.ts 拆分治理

## 目标
1. 将 `packages/cli/src/runtime/shared/normalize.ts` 中混合职责按建议拆分为 `usage.ts`、`content.ts`、`gateway.ts`、`turn.ts`。
2. 保持 `normalizeTranscriptMessages`、`pickUsage`、`parseProjectIdFromTranscriptPath` 等现有对外契约不变。
3. 在不改变行为的前提下显著缩小 `normalize.ts` 体积，去除超长 `createTurn` 私有函数。

## 拆分边界（Contract-First）
1. `usage.ts`
   - 承载 usage 聚合与属性映射：`pickUsage`、`addUsage`、`usageAttributes`、`modelAttributes`。
2. `content.ts`
   - 承载消息内容解析与命令判定：`extractText`、`extractToolUses`、`extractToolResults`、`extractReasoningBlocks`、`isPromptUserMessage`、`parseSlashCommand`、`parseBashCommandAttributes`、`isMcpToolName`、`extractToolResultText`、`isoFromUnknownTimestamp`。
3. `gateway.ts`
   - 承载 gateway 输入归一化：`runtimeVersionAttributes`、`extractGatewayInputMetadata`、`normalizeUserInput`。
4. `turn.ts`
   - 承载 turn 级事件编译：`createTurn` 及其私有辅助（actor、parent-link 推断）。
5. `normalize.ts`
   - 保留主 pipeline：`groupByTurns`、`normalizeTranscriptMessages`、context 估算与 attribution 逻辑、`parseProjectIdFromTranscriptPath`。
   - 通过导入/再导出维持既有调用方契约。

## 风险与防护
1. 行为漂移风险：tool/result 时间戳、reasoning 分离、context 事件字段。
   - 防护：保持函数签名和字段字面量不变；跑现有 `normalize.spec.ts`。
2. 导出兼容风险：`pickUsage` 仍被多个 adapter 依赖。
   - 防护：`normalize.ts` 显式 re-export `pickUsage`。
3. 结构性风险：拆分后导入循环或遗漏。
   - 防护：单向依赖（`turn.ts` 依赖 usage/content/gateway，`normalize.ts` 依赖 `turn.ts` + `content.ts`）。

## 执行顺序
1. 建立四个新模块并迁移对应函数，保持实现一致。
2. 回填 `normalize.ts` 的 import/export，移除重复实现。
3. 运行定向结构验证（行数、createTurn 位置）。
4. 运行单测与项目检查，确认无行为回归。

## 验收标准
- `normalize.ts` 不再包含超长 `createTurn` 实现，体积显著下降。
- `usage.ts` / `content.ts` / `gateway.ts` / `turn.ts` 落地且职责清晰。
- `npm test` 与 `npm run check` 通过。
