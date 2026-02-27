# Spanory

Spanory is a cross-runtime observability toolkit for agent systems.

## MVP Status

- Current status: runnable MVP
- First runtime: Claude Code CLI
- Ingestion target: OTLP HTTP (Langfuse-compatible endpoint)
- Supported use patterns:
  - Realtime ingestion via Claude hook (`SessionEnd`)
  - Manual replay/backfill per session via CLI

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

## Claude Code Hook (macOS)

1. Ensure env is available (recommended in `~/.env`):

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:3000/api/public/otel/v1/traces"
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer <LANGFUSE_PUBLIC_KEY>:<LANGFUSE_SECRET_KEY>"
```

2. Configure Claude Code `SessionEnd` hook command:

```bash
/Users/javis/Documents/workspace/project/spanory/scripts/hooks/claude-code-session-end.sh
```

3. Optional local JSON export:

```bash
export SPANORY_HOOK_EXPORT_JSON_DIR="$HOME/.claude/state/spanory-json"
```

4. Inspect hook log:

```bash
tail -n 100 "$HOME/.claude/state/spanory-hook.log"
```

## CLI Usage

Show help:

```bash
node /Users/javis/Documents/workspace/project/spanory/packages/cli/src/index.js --help
```

Replay/backfill one session:

```bash
node /Users/javis/Documents/workspace/project/spanory/packages/cli/src/index.js runtime claude-code export \
  --project-id -Users-javis-Documents-claude-workspace-test \
  --session-id <SESSION_ID> \
  --endpoint "$OTEL_EXPORTER_OTLP_ENDPOINT" \
  --headers "$OTEL_EXPORTER_OTLP_HEADERS"
```

Replay one session and export compiled JSON locally:

```bash
node /Users/javis/Documents/workspace/project/spanory/packages/cli/src/index.js runtime claude-code export \
  --project-id -Users-javis-Documents-claude-workspace-test \
  --session-id <SESSION_ID> \
  --export-json /tmp/spanory-export.json
```

Hook mode manual simulation:

```bash
echo '{"hook_event_name":"SessionEnd","session_id":"<SESSION_ID>","transcript_path":"<TRANSCRIPT_PATH>"}' | \
node /Users/javis/Documents/workspace/project/spanory/packages/cli/src/index.js runtime claude-code hook \
  --endpoint "$OTEL_EXPORTER_OTLP_ENDPOINT" \
  --headers "$OTEL_EXPORTER_OTLP_HEADERS"
```

Recognized event categories:

- `turn`
- `agent_command`
- `shell_command` (Claude tool `Bash`)
- `mcp`
- `agent_task`

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

## Next

- Add multi-session range backfill command (`runtime claude-code backfill`)
- Add Codex/OpenCode adapters with the same runtime abstraction
- Stabilize Langfuse-friendly naming/timeline conventions
