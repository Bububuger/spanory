# Spanory

Spanory is a cross-runtime observability toolkit for agent systems.

## MVP Status

- Current status: runnable MVP
- Supported runtimes:
  - `claude-code`
  - `openclaw`
  - `opencode` (plugin realtime)
- Ingestion target: OTLP HTTP (Langfuse-compatible endpoint)
- Backend status:
  - `langfuse`: implemented
  - `langsmith`: deferred to next phase
- Supported use patterns:
  - Realtime ingestion via OpenClaw plugin hooks (no cron)
  - Realtime ingestion via OpenCode plugin events
  - Realtime ingestion via runtime hook (`SessionEnd` style payload)
  - Manual replay/backfill per session via CLI

## Governance

- Changelog: `CHANGELOG.md`
- Contributing guide: `CONTRIBUTING.md`
- Ownership: `CODEOWNERS`
- Plan history: `docs/plans/history/`
- TODO history: `docs/todos/history/`

## Goal

- Unified runtime-neutral event model
- OTel-native transport
- Full compatibility with Langfuse ingestion and UX
- Local transcript parsing first

## Language and Platform

- Current implementation language: Node.js (ESM JavaScript), with TypeScript schema contracts in `@spanory/core`.
- Why this choice:
  - Fast iteration for parser and hook integration.
  - Good runtime coverage for `macOS`, `Linux`, and `Windows`.
- Cross-platform strategy:
  - Core abstraction (`RuntimeAdapter`) is runtime-agnostic.
  - Runtime parser is pluggable.
  - OS hook entry is split by wrapper scripts.

## Workspace

- `packages/core`: normalized schema, parser interfaces, mapping contracts
- `packages/otlp-core`: OTLP compile/send transport core
- `packages/backend-langfuse`: Langfuse backend adapter
- `packages/openclaw-plugin`: OpenClaw plugin runtime ingestion path
- `packages/opencode-plugin`: OpenCode plugin runtime ingestion path
- `packages/langfuse`: legacy langfuse package (kept for compatibility)
- `packages/cli`: local parser and export CLI
- `scripts/hooks`: OS-specific hook wrappers (mac first)

## Runtime Abstraction

`@spanory/core` defines:

- `SpanoryEvent`: unified event object (`turn`, `agent_command`, `shell_command`, `mcp`, `agent_task`, `tool`)
- `RuntimeCapabilities`: runtime capability matrix metadata
- `HookPayload`: normalized hook input payload
- `RuntimeAdapter`: `resolveContextFromHook` + `collectEvents`
- `BackendAdapter`: canonical events -> backend events mapping

Runtime implementations:

- `packages/cli/src/runtime/claude/adapter.js`
- `packages/cli/src/runtime/openclaw/adapter.js`

Current pipeline:

`RuntimeAdapter -> Canonical Events -> BackendAdapter(langfuse) -> OTLP Core -> OTLP HTTP`

## Claude Code 接入（Hook 实时上报）

### 1) 安装 `spanory` 命令

```bash
npm install -g packages/cli
spanory --help
```

### 2) 配置 OTLP 环境变量（建议放到 `~/.env`）

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:3000/api/public/otel/v1/traces"
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer <LANGFUSE_PUBLIC_KEY>:<LANGFUSE_SECRET_KEY>"
```

可选（保留本地 JSON 结果）：

```bash
export SPANORY_HOOK_EXPORT_JSON_DIR="$HOME/.claude/state/spanory-json"
```

### 3) 在 Claude Code 中绑定 `SessionEnd` Hook（极简）

在 Claude Code 的 Hook 配置中，将 `SessionEnd` command 直接设置为：

```bash
spanory hook
```

说明：
- `spanory hook` 会从 `stdin` 读取 Claude hook payload。
- 可通过 `--runtime` 切换 runtime（默认 `claude-code`）：
  - `spanory hook --runtime claude-code`
  - `spanory hook --runtime openclaw`
- CLI 会自动读取 `~/.env`（若变量未在当前进程定义）。
- 默认导出目录：`~/.claude/state/spanory-json`（可用 `SPANORY_HOOK_EXPORT_JSON_DIR` 覆盖）。

### 4) 验证 Hook 是否生效

查看 hook 日志：

```bash
tail -n 100 "$HOME/.claude/state/spanory-hook.log"
```

手动模拟一次 hook payload（排障用）：

```bash
echo '{"hook_event_name":"SessionEnd","session_id":"<SESSION_ID>","transcript_path":"<TRANSCRIPT_PATH>"}' | \
spanory runtime claude-code hook \
  --endpoint "$OTEL_EXPORTER_OTLP_ENDPOINT" \
  --headers "$OTEL_EXPORTER_OTLP_HEADERS"
```

## CLI 离线回跑（历史补数）

### 1) 回跑单个 session

```bash
spanory runtime claude-code export \
  --project-id claude-workspace-test \
  --session-id <SESSION_ID> \
  --endpoint "$OTEL_EXPORTER_OTLP_ENDPOINT" \
  --headers "$OTEL_EXPORTER_OTLP_HEADERS"
```

仅导出本地 JSON（不上报）：

```bash
spanory runtime claude-code export \
  --project-id claude-workspace-test \
  --session-id <SESSION_ID> \
  --export-json /tmp/spanory-export.json
```

### 2) 批量回跑（backfill）

先预览将处理哪些 session（不发送）：

```bash
spanory runtime claude-code backfill \
  --project-id claude-workspace-test \
  --since 2026-02-27T00:00:00Z \
  --limit 50 \
  --dry-run
```

正式回跑并上报：

```bash
spanory runtime claude-code backfill \
  --project-id claude-workspace-test \
  --since 2026-02-27T00:00:00Z \
  --limit 50 \
  --endpoint "$OTEL_EXPORTER_OTLP_ENDPOINT" \
  --headers "$OTEL_EXPORTER_OTLP_HEADERS"
```

按指定 session 列表回跑：

```bash
spanory runtime claude-code backfill \
  --project-id claude-workspace-test \
  --session-ids "session-a,session-b,session-c" \
  --endpoint "$OTEL_EXPORTER_OTLP_ENDPOINT" \
  --headers "$OTEL_EXPORTER_OTLP_HEADERS"
```

## OpenClaw 接入（Plugin 主链路，零 cron）

### 1) 安装 Spanory OpenClaw Plugin（推荐）

```bash
spanory runtime openclaw plugin install
spanory runtime openclaw plugin enable
spanory runtime openclaw plugin doctor
```

可选参数：

- `--plugin-dir`：覆盖插件目录（默认 `packages/openclaw-plugin`）
- `--runtime-home`：覆盖 OpenClaw home

### 2) 配置 OTLP 环境变量

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:3000/api/public/otel/v1/traces"
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer <LANGFUSE_PUBLIC_KEY>:<LANGFUSE_SECRET_KEY>"
```

插件可靠性相关（可选）：

```bash
export SPANORY_OPENCLAW_SPOOL_DIR="$HOME/.openclaw/state/spanory/spool"
export SPANORY_OPENCLAW_RETRY_MAX="6"
```

### 3) Plugin 运行状态检查

```bash
spanory runtime openclaw plugin doctor
```

`doctor` 会检查：
- 插件安装状态
- 启用状态
- OTLP endpoint 配置
- spool 可写
- 最近发送状态文件

## OpenCode 接入（Plugin 主链路）

OpenCode 本阶段使用 plugin realtime 路径，不依赖 cron。

### 1) 安装 Spanory OpenCode Plugin

```bash
spanory runtime opencode plugin install
spanory runtime opencode plugin doctor
```

可选参数：

- `--plugin-dir`：覆盖插件目录（默认 `packages/opencode-plugin`）
- `--runtime-home`：覆盖 OpenCode home（默认 `~/.config/opencode`）

说明：

- `install` 会写入 loader 文件到 `~/.config/opencode/plugin/spanory-opencode-plugin.js`。
- OpenCode 会自动加载该目录下插件文件。

### 2) 配置 OTLP 环境变量

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:3000/api/public/otel/v1/traces"
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer <LANGFUSE_PUBLIC_KEY>:<LANGFUSE_SECRET_KEY>"
```

插件可靠性相关（可选）：

```bash
export SPANORY_OPENCODE_SPOOL_DIR="$HOME/.config/opencode/state/spanory/spool"
export SPANORY_OPENCODE_RETRY_MAX="6"
```

### 3) Plugin 运行状态检查

```bash
spanory runtime opencode plugin doctor
```

`doctor` 会检查：

- 插件安装状态
- OTLP endpoint 配置
- spool 可写
- 最近发送状态文件

## OpenClaw 补数链路（export/backfill）

OpenClaw transcript 默认支持两种目录：

- `~/.openclaw/projects/<project-id>/<session-id>.jsonl`
- `~/.openclaw/agents/<agent-id>/sessions/<session-id>.jsonl`

可覆盖 OpenClaw runtime home：

```bash
export SPANORY_OPENCLOW_HOME="$HOME/.openclaw"
```

实时 hook（补数/排障场景）：

```bash
echo '{"session_id":"<SESSION_ID>","transcript_path":"<TRANSCRIPT_PATH>"}' | \
spanory runtime openclaw hook \
  --endpoint "$OTEL_EXPORTER_OTLP_ENDPOINT" \
  --headers "$OTEL_EXPORTER_OTLP_HEADERS"
```

离线导出：

```bash
spanory runtime openclaw export \
  --project-id openclaw-workspace-test \
  --session-id <SESSION_ID> \
  --endpoint "$OTEL_EXPORTER_OTLP_ENDPOINT" \
  --headers "$OTEL_EXPORTER_OTLP_HEADERS"
```

批量回跑：

```bash
spanory runtime openclaw backfill \
  --project-id main \
  --since 2026-02-27T00:00:00Z \
  --limit 50 \
  --dry-run
```

## 推荐使用方式

- 日常使用：OpenClaw 使用 plugin 自动实时上报（零 cron）。
- 日常使用：OpenCode 使用 plugin 自动实时上报。
- Claude Code 使用 `spanory hook` 实时上报。
- 缺失补数：使用 `export` 或 `backfill` 离线回跑。
- 先 `--dry-run`，确认范围后再正式发送。

## Report 视图（CLI）

基于 `export` 产出的 JSON（单文件或目录）做聚合视图：

```bash
spanory report session --input-json /path/to/exported.json
spanory report mcp --input-json /path/to/exported-or-dir
spanory report command --input-json /path/to/exported-or-dir
spanory report agent --input-json /path/to/exported-or-dir
```

输出为 JSON，便于后续接入你自己的可视化或任务系统。

## Alert 规则评估（CLI）

规则文件格式（JSON）：

```json
{
  "rules": [
    {"id":"session-token-high","scope":"session","metric":"usage.total","op":"gt","threshold":10000},
    {"id":"mcp-spike","scope":"mcp","metric":"calls","op":"gte","threshold":50}
  ]
}
```

执行规则评估：

```bash
spanory alert eval \
  --input-json /path/to/exported-or-dir \
  --rules /path/to/rules.json
```

有告警时返回非零退出码（用于 CI/自动化）：

```bash
spanory alert eval \
  --input-json /path/to/exported-or-dir \
  --rules /path/to/rules.json \
  --fail-on-alert
```

可选 webhook 通知：

```bash
spanory alert eval \
  --input-json /path/to/exported-or-dir \
  --rules /path/to/rules.json \
  --webhook-url https://example.com/hook \
  --webhook-headers "Authorization=Bearer x-token"
```

Recognized event categories:

- `turn`
- `agent_command`
- `shell_command` (Claude tool `Bash`)
- `mcp`
- `agent_task`
- `tool`

## Install and Binary

Use as command without `node` prefix:

```bash
npm install -g packages/cli
spanory --help
```

Build standalone executable:

```bash
npm run build:bin
./dist/spanory-macos-arm64 --help
```

Build all platforms:

```bash
bash scripts/release/build-binaries.sh all
```

## Other OS Wrappers

- Linux wrapper skeleton:
  - `scripts/hooks/claude-code-session-end-linux.sh`
- Windows PowerShell wrapper skeleton:
  - `scripts/hooks/claude-code-session-end.ps1`

These wrappers call the same CLI, so event semantics stay consistent across OSes.

## Development

```bash
npm install
npm run check
```

## Quality Gates

Before merge, required verification commands are:

```bash
npm run check
npm test
npm run test:bdd
npm run build:bin
```

CI executes the same gates in `.github/workflows/ci.yml`.

## Next

- Add Codex adapter with the same runtime abstraction
- Stabilize Langfuse-friendly naming/timeline conventions
