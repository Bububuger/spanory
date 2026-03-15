# Spanory Runtime 验收矩阵（发布前强制）

## 目的
避免只覆盖部分 runtime，确保每次发布前都完成 `claude-code/codex/openclaw/opencode` 的可执行验收。

## 总体要求
- 发布前必须执行一次全量 runtime 验收。
- 所有 runtime 都要有“可上报证据”。
- 验收结论必须记录到变更记录（命令 + 结果摘要）。

## Runtime 验收清单

### 1) 通用配置验证
```bash
spanory status
spanory install --runtimes claude-code,codex,openclaw,opencode
spanory doctor --runtimes claude-code,codex,openclaw,opencode
```

通过标准：
- `doctor` 返回 `ok: true`。
- 每个 runtime 的关键 check 为 `ok: true`。

### 2) CLI Export 型 runtime（claude-code/openclaw/codex）
```bash
spanory runtime claude-code export ...
spanory runtime openclaw export ...
spanory runtime codex export ...
```

通过标准：
- 命令成功退出（exit code 0）。
- 输出包含 `otlp=sent`（或明确记录本次为何跳过 endpoint）。
- 导出 JSON 文件存在且可解析。

### 3) Plugin 型 runtime（opencode）
说明：当前 `opencode` 无 `runtime opencode export` 子命令，验收走 plugin 路径。

```bash
spanory runtime opencode plugin install
spanory runtime opencode plugin doctor
cat ~/.config/opencode/state/spanory/plugin-status.json
tail -n 120 ~/.config/opencode/state/spanory/plugin.log
```

通过标准：
- `plugin doctor` 返回 `ok: true`。
- `plugin-status.json` 中 `endpointConfigured=true`。
- 日志中存在 `otlp_sent` 记录（必要时先触发一轮 opencode 会话再检查）。

### 4) 本地真实对话端到端验收（发布前推荐，热修复后强烈建议）
适用场景：修复“上报到了但展示不对”“某 runtime 本地已生效但后端表现异常”“需要确认 release 前本机二进制确实包含修复”。

#### 步骤 A：重建并覆盖本机二进制
```bash
bash scripts/release/build-binaries.sh host
cp dist/spanory-macos-arm64 ~/.local/bin/spanory
chmod +x ~/.local/bin/spanory
~/.local/bin/spanory --version
```

说明：
- Apple Silicon 主机产物为 `dist/spanory-macos-arm64`；Intel Mac 对应 `dist/spanory-macos-x64`。
- 只要 runtime 配置引用的是固定路径 `~/.local/bin/spanory`，覆盖安装后一般无需重写配置。
- 若修复涉及 plugin 安装路径或 hook 脚本内容，再补跑：

```bash
spanory install --runtimes claude-code,codex,openclaw,opencode
spanory doctor --runtimes claude-code,codex,openclaw,opencode
```

#### 步骤 B：触发真实对话
- 在目标 runtime 中手动发起一轮真实对话，确保产生新的 turn。
- 记录本轮 `session_id` 与 `turn_id`，便于后续导出与 ClickHouse 对账。

#### 步骤 C：本地导出 JSON 验证
以 codex 为例：

```bash
mkdir -p /tmp/spanory-codex-check
~/.local/bin/spanory runtime codex export \
  --session-id <session_id> \
  --runtime-home ~/.codex \
  --export-json /tmp/spanory-codex-check/session.json
```

最常用的本地核验：
```bash
jq '.events[] | select(.turnId=="<turn_id>") | {category,name,startedAt,endedAt,input}' \
  /tmp/spanory-codex-check/session.json

jq '[.events[] | select(.category=="shell_command" and .endedAt != .startedAt)] | {count:length, sample:.[0]}' \
  /tmp/spanory-codex-check/session.json
```

通过标准：
- 导出命令成功，输出包含 `otlp=sent` 或明确写出本次跳过原因。
- 导出的 JSON 文件存在且可解析。
- 目标 turn 的关键事件字段符合预期（例如 `name`、`startedAt/endedAt`、`usage`）。

#### 步骤 D：ClickHouse / Langfuse 验证

按 `session_id -> trace_id -> observations` 逐层核验。关键表：
- `default.traces`：trace 级（`id/name/session_id/timestamp`）
- `default.observations`：span 级（`id/trace_id/type/name/start_time/end_time`）

常用查询（ClickHouse 容器名通常为 `langfuse-clickhouse-1`）：

```bash
# 按 session 查 trace
docker exec langfuse-clickhouse-1 clickhouse-client --query "
SELECT id, name, session_id, timestamp
FROM default.traces FINAL
WHERE session_id = '<session_id>'
ORDER BY timestamp DESC
FORMAT Vertical"

# 按 trace 查 observations
docker exec langfuse-clickhouse-1 clickhouse-client --query "
SELECT trace_id, id, parent_observation_id, type, name, start_time, end_time
FROM default.observations FINAL
WHERE trace_id = '<trace_id>'
ORDER BY start_time
FORMAT Vertical"

# 查 duration
docker exec langfuse-clickhouse-1 clickhouse-client --query "
SELECT id, name, start_time, end_time,
       dateDiff('millisecond', start_time, end_time) AS duration_ms
FROM default.observations FINAL
WHERE trace_id = '<trace_id>'
ORDER BY start_time
FORMAT Vertical"
```

推荐至少确认：
- turn 级 `AGENT` observation 存在
- 目标 `TOOL` observation 存在
- 修复目标字段已生效（例如 `end_time > start_time`）

> 注：两张表都是 `ReplacingMergeTree`，排查重复时加 `FINAL`。

#### 步骤 E：证据落盘
- 将导出 JSON 放到 `/tmp/spanory-<runtime>-check/` 或其它临时证据目录。
- 在变更记录中记录：
  - 构建命令
  - 本地导出命令
  - `jq` 摘要结果
  - ClickHouse 查询与结果摘要

## 一致性对比（重构/大改时）
- 至少选择 `claude/openclaw/codex` 各 1 个固定输入样本，比较重构前后导出 JSON。
- 允许的差异必须显式列出（例如：新增属性、稳定 id 策略调整）。
- 若存在 runtime 特有路径（如 opencode plugin），需补 status/log 证据。
