# OpenCode Reasoning 与 Final Output 分离计划

## Goal
在 OpenCode 插件链路中将 `reasoning` 与最终回复 `text` 分离上报：
- `turn` 事件的 `output` 仅保留最终用户可见回复
- `reasoning` 作为独立 observation/span 上报（可在 Langfuse 单独检索）

## Scope
- In scope:
  - 修改 `packages/opencode-plugin` 的消息归一化，保留 reasoning 分块信息与时间戳
  - 修改 `packages/cli/src/runtime/shared/normalize.js` 生成独立 `reasoning` 事件
  - 补充单测，验证「reasoning 独立」与「turn output 不含 reasoning」
- Out of scope:
  - 修改 OpenCode 原始导出结构
  - 调整 Langfuse UI 展示逻辑

## Design
- 在 opencode plugin 的 assistant `content` 中引入 `{ type: 'reasoning', text, timestamp }` 块。
- `normalizeTranscriptMessages` 中：
  - `turn.output` 仅拼接 `type: 'text'` 内容
  - 为每个 reasoning 块追加 `category: 'reasoning'` 事件，设置 `langfuse.observation.type: 'span'`
  - `reasoning` 事件关联同一 `turnId/sessionId/model/usage`

## Tasks
### T1 更新 opencode plugin 归一化
- 文件：`packages/opencode-plugin/src/index.js`
- 目标：reasoning 不再伪装成 text；保留分块时间
- 验收：`npm run --workspace @spanory/cli test -- test/unit/opencode.plugin.runtime.spec.js`

### T2 更新共享 normalize 语义
- 文件：`packages/cli/src/runtime/shared/normalize.js`
- 目标：turn output 仅 final text，并生成 reasoning 独立事件
- 验收：`npm run --workspace @spanory/cli test -- test/unit/normalize.spec.js`

### T3 补测试并回归
- 文件：
  - `packages/cli/test/unit/normalize.spec.js`
  - `packages/cli/test/unit/opencode.plugin.runtime.spec.js`
- 目标：覆盖 reasoning/output 分离语义
- 验收：
  - `npm run --workspace @spanory/cli test -- test/unit/normalize.spec.js`
  - `npm run --workspace @spanory/cli test -- test/unit/opencode.plugin.runtime.spec.js`

### T4 质量门
- 目标：确保无回归
- 验收：
  - `npm run --workspace @spanory/cli test`
