# Spanory

### Cross-runtime observability toolkit for AI agent systems

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-ESM-green.svg)](https://nodejs.org/)
[![OpenTelemetry](https://img.shields.io/badge/OpenTelemetry-OTLP-blueviolet.svg)](https://opentelemetry.io/)

English | [中文](docs/README_zh.md)

---

## Why Spanory?

AI coding agents like **Claude Code**, **OpenClaw**, and **OpenCode** generate rich session transcripts — turns, tool calls, MCP interactions, shell commands — but there is no unified way to collect, trace, and observe these events across different runtimes.

**Spanory** gives you a single CLI and plugin system to parse agent transcripts into a unified event model, then ship them as OpenTelemetry traces to backends like **Langfuse** — with zero cron, realtime hooks, and offline backfill.

## Features

- **One CLI, Multiple Runtimes** — Unified tracing for Claude Code, OpenClaw, OpenCode, and more to come (Codex)
- **OTel-Native Transport** — OTLP HTTP export compatible with Langfuse, with extensible backend adapters
- **Realtime + Offline** — Hook-based live ingestion and CLI-driven session replay/backfill
- **Report & Alert** — Built-in aggregation views (session, MCP, tool, cache, turn-diff) and rule-based alerting with webhook + CI support
- **Cross-Platform** — macOS, Linux, Windows with OS-specific hook wrappers
- **Pluggable Architecture** — Runtime adapters and backend adapters are fully decoupled

## Architecture

```
RuntimeAdapter → Canonical Events → BackendAdapter → OTLP Core → OTLP HTTP
```

**Unified Event Model** (`SpanoryEvent`):

`turn` · `agent_command` · `shell_command` · `mcp` · `agent_task` · `tool`

## Packages

| Package | Description |
|---------|-------------|
| `@spanory/core` | Normalized schema, parser interfaces, mapping contracts (TypeScript) |
| `@spanory/otlp-core` | OTLP compile & send transport |
| `@spanory/backend-langfuse` | Langfuse backend adapter |
| `@spanory/openclaw-plugin` | OpenClaw plugin for realtime ingestion |
| `@spanory/opencode-plugin` | OpenCode plugin for realtime ingestion |
| `@spanory/cli` | Local parser, export CLI, hook handler |

## Quick Start

### Install

```bash
npm install -g packages/cli
spanory --help
```

### Configure OTLP (Langfuse)

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:3000/api/public/otel/v1/traces"
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer <PUBLIC_KEY>:<SECRET_KEY>"
```

### Claude Code — Realtime Hook

Set hook command in Claude Code config for `SessionEnd` and/or `Stop` events:

```bash
spanory hook
```

The CLI reads the hook payload from stdin, parses the session transcript, and ships traces via OTLP automatically.

> **Recommended:** Bind the `Stop` event in addition to `SessionEnd`. `Stop` fires on every assistant turn completion, enabling near real-time trace reporting instead of waiting for the session to end.

### OpenClaw — Plugin (Zero Cron)

```bash
spanory runtime openclaw plugin install
spanory runtime openclaw plugin enable
spanory runtime openclaw plugin doctor
```

### OpenCode — Plugin

```bash
spanory runtime opencode plugin install
spanory runtime opencode plugin doctor
```

### Offline Backfill

```bash
# Preview sessions to process
spanory runtime claude-code backfill \
  --project-id my-project \
  --since 2026-02-27T00:00:00Z \
  --dry-run

# Run backfill with OTLP export
spanory runtime claude-code backfill \
  --project-id my-project \
  --since 2026-02-27T00:00:00Z \
  --endpoint "$OTEL_EXPORTER_OTLP_ENDPOINT" \
  --headers "$OTEL_EXPORTER_OTLP_HEADERS"
```

## Report & Alert

### Aggregation Reports

```bash
spanory report session --input-json /path/to/exported.json
spanory report mcp --input-json /path/to/exported-or-dir
spanory report tool --input-json /path/to/exported-or-dir
spanory report cache --input-json /path/to/exported-or-dir
spanory report turn-diff --input-json /path/to/exported-or-dir
```

### Rule-Based Alerts

```bash
spanory alert eval \
  --input-json /path/to/exported-or-dir \
  --rules /path/to/rules.json \
  --fail-on-alert
```

Supports webhook notifications and CI integration with non-zero exit codes on alert.

## Standalone Binary

```bash
npm run build:bin
./dist/spanory-macos-arm64 --help

# Build all platforms
bash scripts/release/build-binaries.sh all
```

## Development

```bash
npm install
npm run check
npm test
npm run test:bdd
```

CI runs the same gates via `.github/workflows/ci.yml`.

## Roadmap

- [ ] Codex runtime adapter
- [ ] LangSmith backend adapter
- [ ] Langfuse-friendly naming/timeline conventions
- [ ] Local UI for viewing session summaries and reports

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE)
