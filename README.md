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

- **One CLI, Multiple Runtimes** — Unified tracing for Claude Code, Codex, OpenClaw, OpenCode
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
| `@bububuger/core` | Normalized schema, parser interfaces, mapping contracts (TypeScript) |
| `@bububuger/otlp-core` | OTLP compile & send transport |
| `@bububuger/backend-langfuse` | Langfuse backend adapter |
| `@bububuger/spanory-openclaw-plugin` | OpenClaw plugin for realtime ingestion |
| `@bububuger/spanory-opencode-plugin` | OpenCode plugin for realtime ingestion |
| `@bububuger/spanory` | Local parser, export CLI, hook handler |

## Project Workflow (Team Style)

To keep implementation style and quality consistent across humans and agents, follow the standards workflow first:

- [Project Workflow](docs/standards/project-workflow.md)
- [Telemetry Field Governance](docs/standards/telemetry-field-governance.md)
- [Standards Index](docs/standards/README.md)

For new feature or bug fix work, this workflow defines:
- Required design updates
- Required test updates
- Required verification gates before merge

Telemetry field governance gate:

```bash
npm run telemetry:check
```

Issue status巡检（自动化任务建议每轮执行）:

```bash
npm run issue:status
```

## Quick Start

### Install

#### Option A: Download prebuilt binary from GitHub Releases

Releases page: [https://github.com/Bububuger/spanory/releases](https://github.com/Bububuger/spanory/releases)

Each release includes:

- `spanory-<version>-darwin-arm64.tar.gz` (macOS Apple Silicon)
- `spanory-<version>-darwin-x64.tar.gz` (macOS Intel)
- `spanory-<version>-linux-x64.tar.gz` (Linux x64)
- `spanory-<version>-windows-x64.zip` (Windows x64)
- `SHA256SUMS.txt`

macOS / Linux:

```bash
TAG=vX.Y.Z # replace with the target release tag
# macOS arch: arm64 => darwin-arm64, x86_64 => darwin-x64
# Linux (supported): x86_64 => linux-x64
OS_ARCH=darwin-arm64
# quick check on macOS: uname -m
curl -fL -o spanory.tar.gz \
  "https://github.com/Bububuger/spanory/releases/download/${TAG}/spanory-${TAG#v}-${OS_ARCH}.tar.gz"
tar -xzf spanory.tar.gz
chmod +x spanory
sudo mv spanory /usr/local/bin/spanory
spanory --help
```

Windows (PowerShell):

```powershell
$Tag = "vX.Y.Z" # replace with the target release tag
Invoke-WebRequest -Uri "https://github.com/Bububuger/spanory/releases/download/$Tag/spanory-$($Tag.TrimStart('v'))-windows-x64.zip" -OutFile "spanory.zip"
Expand-Archive -Path "spanory.zip" -DestinationPath ".\\spanory-bin" -Force
.\\spanory-bin\\spanory.exe --help
```

Optional integrity check:

```bash
curl -fL -o SHA256SUMS.txt \
  "https://github.com/Bububuger/spanory/releases/download/${TAG}/SHA256SUMS.txt"
shasum -a 256 -c SHA256SUMS.txt
```

#### Option B: Install via npm / npx

```bash
# Run directly (no global install)
npx @bububuger/spanory@latest --help

# Global install
npm i -g @bububuger/spanory
spanory --help
```

#### Option C: Install from source checkout

```bash
cd spanory
npm install
npm install -g ./packages/cli
spanory --help
```

### Configure OTLP (Langfuse)

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:3000/api/public/otel/v1/traces"
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic $(printf '%s' '<PUBLIC_KEY>:<SECRET_KEY>' | base64)"
```

`OTEL_EXPORTER_OTLP_HEADERS` expects `k=v` pairs (comma-separated if multiple).  
For Langfuse OTLP, use `Authorization=Basic <base64(public_key:secret_key)>`.

### Local Setup (Recommended: one command for 4 runtimes)

`setup apply` is idempotent and configures all supported runtimes (Codex defaults to non-proxy watch daemon mode):

```bash
spanory setup detect
spanory setup apply --runtimes claude-code,codex,openclaw,opencode
spanory setup doctor --runtimes claude-code,codex,openclaw,opencode
```

What `setup apply` does:

- Claude Code: writes/updates `Stop` + `SessionEnd` hook command to `spanory hook --last-turn-only`
- Codex: removes legacy `~/.codex/bin/spanory-codex-notify.sh` and `notify = [...]` from `~/.codex/config.toml`, then starts `spanory runtime codex watch --last-turn-only` in background (`~/.spanory/codex-watch.pid`, `~/.spanory/logs/codex-watch.log`)
- OpenClaw: installs/enables Spanory plugin (when `openclaw` is available in PATH)
- OpenCode: installs Spanory plugin loader into `~/.config/opencode/plugin`

Dry-run example:

```bash
spanory setup apply \
  --runtimes claude-code,codex,openclaw,opencode \
  --dry-run
```

### Copy To Your Agent (Self-install)

Paste this block to your coding agent in this repo, and let it finish setup automatically:

```text
Install and configure Spanory on this machine with one-command setup.
Requirements:
- Keep Codex in watch daemon mode (no proxy hijack, no notify injection).
- Configure all runtimes: claude-code,codex,openclaw,opencode.
- Verify and report any failed checks.

Run:
1) npm install
2) npm install -g ./packages/cli
3) spanory setup detect
4) spanory setup apply --runtimes claude-code,codex,openclaw,opencode
5) spanory setup doctor --runtimes claude-code,codex,openclaw,opencode

Output:
- setup detect/apply/doctor JSON results
- final pass/fail summary and next-step troubleshooting for failed checks
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

The plugin auto-loads `~/.spanory/.env` at runtime (only fills missing env vars), so GUI-launched OpenCode can still pick up:

- `OTEL_EXPORTER_OTLP_ENDPOINT`
- `OTEL_EXPORTER_OTLP_HEADERS`

Trigger mode (recommended realtime by turn):

```bash
# default: flush on turn/message completion events (realtime)
export SPANORY_OPENCODE_FLUSH_MODE="turn"

# optional: only flush on session lifecycle end events
# export SPANORY_OPENCODE_FLUSH_MODE="session"
```

Diagnostics (when "triggered but not reported"):

```bash
# latest plugin status
cat ~/.spanory/opencode/plugin-status.json

# detailed plugin runtime logs
tail -n 120 ~/.spanory/opencode/plugin.log

# structured doctor checks (includes endpointConfigured hint)
spanory runtime opencode plugin doctor
```

### Codex — Session Parse + Notify Hook

Codex runtime supports `export/backfill/hook/watch` based on `~/.codex/sessions/**/*.jsonl`.

```bash
# Export one codex session
spanory runtime codex export \
  --session-id <SESSION_ID> \
  --endpoint "$OTEL_EXPORTER_OTLP_ENDPOINT" \
  --headers "$OTEL_EXPORTER_OTLP_HEADERS"

# Batch backfill codex sessions by mtime
spanory runtime codex backfill \
  --since 2026-03-01T00:00:00Z \
  --limit 50 \
  --endpoint "$OTEL_EXPORTER_OTLP_ENDPOINT" \
  --headers "$OTEL_EXPORTER_OTLP_HEADERS"
```

Codex notify payload can be consumed for near realtime turn-level export:

```bash
echo '{"event":"agent-turn-complete","thread_id":"<SESSION_ID>","turn_id":"<TURN_ID>","cwd":"<PROJECT_CWD>"}' | \
spanory runtime codex hook --last-turn-only
```

When Codex `notify` is not firing (or missed intermittently), use watcher fallback for near-realtime polling export:

```bash
# long-running watcher, only handles newly updated sessions after startup
spanory runtime codex watch --last-turn-only

# one-shot scan for existing sessions (useful for quick verification)
spanory runtime codex watch --include-existing --once --settle-ms 0
```

### Codex — Optional Proxy Hijack Capture (Full Redacted)

Use an OpenAI-compatible local proxy to capture full request/response bodies with strong redaction.

```bash
# Start proxy
spanory runtime codex proxy \
  --listen 127.0.0.1:8787 \
  --upstream https://api.openai.com

# Route Codex traffic to proxy
export OPENAI_BASE_URL="http://127.0.0.1:8787"
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
spanory alert \
  --input-json /path/to/exported-or-dir \
  --rules /path/to/rules.json \
  --fail-on-alert
```

Supports webhook notifications and CI integration with non-zero exit codes on alert.

### Exit Codes

| Code | Meaning |
| --- | --- |
| `0` | Command succeeded. |
| `1` | Unexpected runtime error (crash / unhandled rejection). |
| `2` | Command completed with failed checks or alerts (for example: `spanory alert eval --fail-on-alert`). |

## Troubleshooting

### 1) `ERR_MODULE_NOT_FOUND` after local linking

```bash
cd /path/to/spanory
npm install
npm link -w packages/cli
spanory --help
```

### 2) Hook gets OTLP 401

1. Verify env is loaded:
```bash
spanory --help >/dev/null
echo "$OTEL_EXPORTER_OTLP_ENDPOINT"
echo "$OTEL_EXPORTER_OTLP_HEADERS"
```
2. Verify header format is Basic auth (not Bearer):  
`Authorization=Basic <base64(public_key:secret_key)>`
3. Run a dry local export to inspect parsed output:
```bash
spanory runtime claude-code export \
  --project-id <PROJECT_ID> \
  --session-id <SESSION_ID> \
  --export-json /tmp/spanory-export.json
```

### 3) Hook runs but no data

- Ensure Claude Code hook command is exactly `spanory hook --last-turn-only`.
- Prefer binding both `Stop` and `SessionEnd`.
- Check local hook log:
```bash
tail -n 100 "$HOME/.claude/state/spanory-hook.log"
```

## Build Binary From Source

```bash
npm run build:bin
./dist/spanory-macos-arm64 --help

# Build all platforms
bash scripts/release/build-binaries.sh all

# Package release archives locally
npm run package:release-assets -- vX.Y.Z
```

## Development

```bash
npm install
npm run check
npm test
npm run test:bdd
```

CI runs the same gates via `.github/workflows/ci.yml`.

## CI/CD

- CI: `.github/workflows/ci.yml`
  - Runs on `push` (main/codex/**/feat/**) and `pull_request`
  - Enforces quality gates: `check` + `test` + `test:bdd`
  - Builds Linux binary and runs smoke check (`--help`)
- CD: `.github/workflows/release.yml`
  - Triggered by tag push: `v*` (for example `v0.2.0`)
  - Verifies quality gates before release
  - Publishes `@bububuger/spanory` to npm when `NPM_TOKEN` is configured in the `release` environment
  - `NPM_TOKEN` path: `GitHub Settings > Environments > release`
  - Builds release binaries on Linux/macOS/Windows
  - macOS artifacts include both Apple Silicon (`darwin-arm64`) and Intel (`darwin-x64`)
  - Packages archives (`tar.gz` / `zip`) and `SHA256SUMS.txt`
  - Publishes GitHub Release with downloadable assets

## Release (Internal)

Internal package `@alipay/spanory` is published to `registry.antgroup-inc.cn`.

```bash
# 1. Commit your changes
git add -A && git commit -m "fix: describe your change"

# 2. Tag new version (sync-version.mjs reads from git tag)
git tag v0.1.XX

# 3. Build + publish (sync-version → build → tnpm publish, one command)
bash scripts/publish-internal.sh

# 4. Commit version bump generated by sync-version
git add package.json packages/cli/package.json packages/alipay-cli/package.json
git commit -m "chore: bump version to 0.1.XX"

# 5. Push
git push origin main && git push origin v0.1.XX
```

Key points:
- **Do NOT manually edit version in package.json** — `scripts/release/sync-version.mjs` derives it from the latest git tag.
- `publish-internal.sh` calls `sync-version.mjs` → builds `@alipay/spanory` → runs `tnpm publish`.
- Public npm release (`@bububuger/spanory`) is handled by GitHub Actions CD on tag push (`v*`).

## Roadmap

- [x] Codex runtime adapter + proxy capture
- [ ] LangSmith backend adapter
- [ ] Langfuse-friendly naming/timeline conventions
- [ ] Local UI for viewing session summaries and reports

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE)
