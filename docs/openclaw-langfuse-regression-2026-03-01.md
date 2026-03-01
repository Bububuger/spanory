# OpenClaw -> Langfuse 回归对账（2026-03-01）

## 验证范围

- 回放来源：本地 OpenClaw 存量 sessions（`~/.openclaw/agents/main/sessions`）
- 上报路径：
  - CLI backfill（补数）
  - OpenClaw plugin runtime（实时主链路 smoke）
- 存储核对：Langfuse ClickHouse（`default.traces` / `default.observations`）

## 执行记录

1. 回放本地存量 session（limit=2）：

```bash
node packages/cli/src/index.js runtime openclaw backfill \
  --project-id main \
  --runtime-home ~/.openclaw \
  --limit 2 \
  --export-json-dir /tmp/spanory-openclaw-regression
```

结果：`otlp=sent`，两个 session 均上报成功。

2. OpenClaw plugin 安装与启用：

```bash
node packages/cli/src/index.js runtime openclaw plugin install --plugin-dir <repo>/packages/openclaw-plugin --runtime-home ~/.openclaw
node packages/cli/src/index.js runtime openclaw plugin enable --runtime-home ~/.openclaw
node packages/cli/src/index.js runtime openclaw plugin doctor --runtime-home ~/.openclaw
```

结果：`doctor.ok=true`。

3. Plugin 主链路 smoke（无 cron）：

- 触发 `llm_input -> llm_output -> after_tool_call -> session_end`
- ClickHouse 可查到 `session_id='spanory-smoke-3'`

## ClickHouse 核对结果

1. Spanory 回放 session 已入库：

- `session_id=2959b5c1-8730-4be8-a279-7ddbbeb96e39` -> `trace_cnt=10`
- `session_id=81cd0dcd-2285-4dc7-bcc9-dab0834c6bcb` -> `trace_cnt=1`

2. Plugin smoke session 已入库：

- `session_id=spanory-smoke-3` -> trace 存在

3. 字段与拓扑核对（`spanory-smoke-3`）：

- Turn observation：`provided_model_name=openclaw-pro`
- Turn usage：`usage_details={'input':4,'output':3,'total':7}`
- Tool observation：`name=Bash`
- 父子关系：`Bash.parent_observation_id IS NOT NULL`（tool 正确挂到 turn 下）

4. 与 Langfuse 非 Spanory trace 的对照：

- 非 Spanory 最近 trace（示例 `Claude Code - Turn 2`）同样具备 input/output、model、usage 信息
- Spanory OpenClaw 输出在 turn/tool/model/usage 维度满足同等级可观测目标

## 结论

- 回归结果：通过。
- 差异说明：
  - 历史 session 可能因重复回放出现多次 trace（预期现象，不是数据丢失）。
  - 成本字段仍属于已知 gap（与 `docs/langfuse-parity.md` 一致）。
