# Spanory 紧急数据质量修复计划 (2026-03-01)

> 目标：立即修复“trace 脏数据、重复上报、input/output 缺失”三类高优问题，保证 Langfuse 侧可读性和可查询性。

## 问题摘要
- 同一 session/turn 存在重复 trace（重复上报无幂等）。
- 大量 turn/shell span 缺失 input 或 output（解析分组与 tool_result 关联不稳定）。
- SessionEnd 重复触发会重复发送历史数据，放大脏数据。

## 修复范围
- `packages/cli/src/runtime/claude/adapter.js`
- `packages/cli/src/otlp.js`
- `packages/cli/src/index.js`
- `packages/cli/test/unit/*.spec.js`
- `packages/cli/test/bdd/*.spec.js`

## 任务拆解

### T1 解析层修复：turn 切分与 I/O 补全
1. 将 `groupByTurns` 改为“仅真实用户输入消息开启新 turn”，排除纯 `tool_result` 回包。
2. 回填 tool output 时优先 `tool_result.content`，并兼容 `toolUseResult.stdout/stderr`。
3. 过滤无效 turn（input/output 均空且无有效语义内容）避免脏 trace。

**验收标准**
- 复杂 transcript 不再生成大量空 input turn。
- Bash/MCP/Task observation 的 output 在有回包时可见。

### T2 OTLP 幂等修复：稳定 trace/span 标识
1. 用稳定哈希生成 `traceId`（session+turn）和 `spanId`（事件稳定键），替代随机 UUID。
2. 增加 `langfuse.observation.id` 与 `langfuse.trace.id`，保证重复上报可幂等覆盖/去重。
3. 保持父子关系不变，时间线结构不回退。

**验收标准**
- 相同 events 多次编译 OTLP 得到相同 trace/span id。
- 子 span 仍挂载到对应 turn root span。

### T3 Hook 重放防护：会话指纹状态
1. 为 `spanory hook` 增加本地状态（session fingerprint）记录。
2. 当同 session 内容未变化时跳过发送（输出 `skip=unchanged`）。
3. 首次或 transcript 更新后正常发送并更新状态。

**验收标准**
- 连续触发同一 SessionEnd 不会重复上报。
- transcript 更新后可再次上报。

### T4 回归与终验
1. 新增/更新 unit + bdd 覆盖上述三类问题。
2. 依次执行：`npm run check`、`npm test`、`npm run test:bdd`。
3. 通过后更新 `todo.md` 全部状态。

**验收标准**
- 三条验证命令全部通过。
- 关键场景（重复触发、复杂 tool 回包）均有自动化用例。
