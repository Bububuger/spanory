# Spanory

Spanory is a cross-runtime observability toolkit for agent systems.

## MVP Status

- Current status: runnable MVP
- First runtime: Claude Code CLI
- Ingestion target: OTLP HTTP (Langfuse-compatible endpoint)
- Supported use patterns:
  - Realtime ingestion via Claude hook (`SessionEnd`)
  - Manual replay/backfill per session via CLI

## Governance

- Changelog: `/Users/javis/Documents/workspace/project/spanory/CHANGELOG.md`
- Contributing guide: `/Users/javis/Documents/workspace/project/spanory/CONTRIBUTING.md`
- Ownership: `/Users/javis/Documents/workspace/project/spanory/.github/CODEOWNERS`

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
  - Runtime parser is pluggable (Claude Code is the first adapter).
  - OS hook entry is split by wrapper scripts.

## Workspace

- `packages/core`: normalized schema, parser interfaces, mapping contracts
- `packages/langfuse`: Langfuse compatibility adapter
- `packages/cli`: local parser and export CLI
- `scripts/hooks`: OS-specific hook wrappers (mac first)

## Runtime Abstraction

`@spanory/core` defines:

- `SpanoryEvent`: unified event object (`turn`, `agent_command`, `shell_command`, `mcp`, `agent_task`)
- `HookPayload`: normalized hook input payload
- `RuntimeAdapter`: `resolveContextFromHook` + `collectEvents`

Claude Code implementation:

- `/Users/javis/Documents/workspace/project/spanory/packages/cli/src/runtime/claude/adapter.js`

## Claude Code 接入（Hook 实时上报）

### 1) 安装 `spanory` 命令

```bash
npm install -g /Users/javis/Documents/workspace/project/spanory/packages/cli
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

### 3) 在 Claude Code 中绑定 `SessionEnd` Hook

在 Claude Code 的 Hook 配置中，将 `SessionEnd` command 设置为：

```bash
/Users/javis/Documents/workspace/project/spanory/scripts/hooks/claude-code-session-end.sh
```

说明：
- 该脚本会从 `stdin` 读取 Claude 的 hook payload。
- 自动加载 `~/.env`。
- 内部调用 `spanory runtime claude-code hook` 完成上报。

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
  --project-id -Users-javis-Documents-claude-workspace-test \
  --session-id <SESSION_ID> \
  --endpoint "$OTEL_EXPORTER_OTLP_ENDPOINT" \
  --headers "$OTEL_EXPORTER_OTLP_HEADERS"
```

仅导出本地 JSON（不上报）：

```bash
spanory runtime claude-code export \
  --project-id -Users-javis-Documents-claude-workspace-test \
  --session-id <SESSION_ID> \
  --export-json /tmp/spanory-export.json
```

### 2) 批量回跑（backfill）

先预览将处理哪些 session（不发送）：

```bash
spanory runtime claude-code backfill \
  --project-id -Users-javis-Documents-claude-workspace-test \
  --since 2026-02-27T00:00:00Z \
  --limit 50 \
  --dry-run
```

正式回跑并上报：

```bash
spanory runtime claude-code backfill \
  --project-id -Users-javis-Documents-claude-workspace-test \
  --since 2026-02-27T00:00:00Z \
  --limit 50 \
  --endpoint "$OTEL_EXPORTER_OTLP_ENDPOINT" \
  --headers "$OTEL_EXPORTER_OTLP_HEADERS"
```

按指定 session 列表回跑：

```bash
spanory runtime claude-code backfill \
  --project-id -Users-javis-Documents-claude-workspace-test \
  --session-ids "session-a,session-b,session-c" \
  --endpoint "$OTEL_EXPORTER_OTLP_ENDPOINT" \
  --headers "$OTEL_EXPORTER_OTLP_HEADERS"
```

## 推荐使用方式

- 日常使用：依赖 Hook 自动实时上报。
- 缺失补数：使用 `export` 或 `backfill` 离线回跑。
- 先 `--dry-run`，确认范围后再正式发送。

Recognized event categories:

- `turn`
- `agent_command`
- `shell_command` (Claude tool `Bash`)
- `mcp`
- `agent_task`

## Install and Binary

Use as command without `node` prefix:

```bash
npm install -g /Users/javis/Documents/workspace/project/spanory/packages/cli
spanory --help
```

Build standalone executable:

```bash
cd /Users/javis/Documents/workspace/project/spanory
npm run build:bin
./dist/spanory-macos-arm64 --help
```

Build all platforms:

```bash
bash /Users/javis/Documents/workspace/project/spanory/scripts/release/build-binaries.sh all
```

## Other OS Wrappers

- Linux wrapper skeleton:
  - `/Users/javis/Documents/workspace/project/spanory/scripts/hooks/claude-code-session-end-linux.sh`
- Windows PowerShell wrapper skeleton:
  - `/Users/javis/Documents/workspace/project/spanory/scripts/hooks/claude-code-session-end.ps1`

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

- Add Codex/OpenCode adapters with the same runtime abstraction
- Stabilize Langfuse-friendly naming/timeline conventions
