# Spanory Agent 上手与交接规范

## 目标
让新 agent 在 30分钟 内完成环境理解、基线验证、并能按标准流程执行一次变更交付。

## 30分钟上手流程

### 0-10 分钟：读文档
按顺序阅读：
1. `README.md`
2. `docs/standards/feature-design-spec.md`
3. `docs/standards/test-baseline-spec.md`
4. `docs/standards/runtime-validation-matrix.md`
5. `docs/standards/regression-cases.md`
6. `docs/standards/change-context-log.md`
7. 当前阶段 `plan.md` / `todo.md`

### 10-20 分钟：跑基线
执行：
```bash
npm run check
npm test
npm run test:bdd
```
记录是否全绿。

### 20-30 分钟：理解任务并起草执行
- 明确任务范围（涉及模块、风险等级、是否影响契约）。
- 先更新 `plan.md/todo.md`，再开始改动。
- 先确认受影响功能是否已有金标 case；无则先补测试再改逻辑。

## 标准流程（需求 -> 实现 -> 验证 -> 交付）
1. 需求澄清：明确目标/非目标。
2. 方案设计：写功能设计项（契约、兼容性、风险、验收）。
3. 实现变更：小步提交、避免跨模块无关改动。
4. 验证执行：最小相关测试 + 全量门禁。
5. 文档同步：README/标准文档/变更记录。
6. 交付说明：给出文件清单、行为变化、测试证据。

## 提交前检查（强制）
- 是否满足功能设计规范。
- 是否满足测试基线规范。
- 是否满足“全功能金标测试 + bug 回归沉淀”要求。
- 是否完成 runtime 验收矩阵（含 opencode plugin 路径）。
- `check/test/test:bdd` 是否通过。
- 是否包含必要文档更新。

## 交付输出模板
- 变更摘要（1-3 句）
- 文件清单（按模块）
- 验证证据（命令 + 结果）
- 风险与后续事项

## ClickHouse / Trace 排障记忆

### 1. 基本事实
- Spanory 当前后端落到 Langfuse 本地栈时，ClickHouse 容器名通常是 `langfuse-clickhouse-1`。
- 关键表：
  - `default.traces`：trace 级记录，含 `id/name/session_id/timestamp`
  - `default.observations`：observation/span 级记录，含 `id/trace_id/type/name/start_time/end_time`
- `session_id` 往往只是 UI 分组根，不一定对应 `name=session_id` 的真实 trace / observation。
- 真实树关系通常是：`session_id -> trace(name=runtime turn/session) -> AGENT observation(turn) -> TOOL observations`

### 2. 查询原则
- 这两张表都是 `ReplacingMergeTree`，排查重复/最新值时优先加 `FINAL`。
- 先查 `session_id` 下有哪些 trace，再查具体 `trace_id` 下有哪些 observation，不要直接假设 UI 节点名就是库里的 `name`。
- 查 duration 时直接用：

```bash
docker exec langfuse-clickhouse-1 clickhouse-client --query "
SELECT id, name, start_time, end_time,
       dateDiff('millisecond', start_time, end_time) AS duration_ms
FROM default.observations FINAL
WHERE trace_id = '<trace_id>'
ORDER BY start_time
FORMAT Vertical"
```

### 3. 常用查询模板

**按 session 查 trace**
```bash
docker exec langfuse-clickhouse-1 clickhouse-client --query "
SELECT id, name, session_id, timestamp
FROM default.traces FINAL
WHERE session_id = '<session_id>'
ORDER BY timestamp DESC
FORMAT Vertical"
```

**按 trace 查 observations**
```bash
docker exec langfuse-clickhouse-1 clickhouse-client --query "
SELECT trace_id, id, parent_observation_id, type, name, start_time, end_time
FROM default.observations FINAL
WHERE trace_id = '<trace_id>'
ORDER BY start_time
FORMAT Vertical"
```

**检查某个 session 下是否已有非零 tool duration**
```bash
docker exec langfuse-clickhouse-1 clickhouse-client --query "
SELECT count() AS non_zero_tools
FROM default.observations FINAL
WHERE trace_id IN (
  SELECT id FROM default.traces FINAL WHERE session_id = '<session_id>'
)
AND type = 'TOOL'
AND end_time > start_time
FORMAT Vertical"
```

### 4. 典型判读
- UI 里看到 `rollout-...` 这类 session 名，先视为会话分组容器，不要当成真实 observation。
- `codex - Turn <turnId>` / `claude-code - Turn <turnId>` 一般对应 turn 级 `AGENT` observation。
- `Bash` / `apply_patch` / `mcp__*` 一般对应子级 `TOOL` observation。
- 若看到“重复节点”，先用 `FINAL` 复查，再判断是否真是重复上报。
