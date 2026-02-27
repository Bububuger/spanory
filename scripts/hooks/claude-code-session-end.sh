#!/usr/bin/env bash
set -u

# macOS-first wrapper for Claude Code SessionEnd hook
# Reads hook payload from stdin and delegates to Spanory CLI.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [[ -f "$HOME/.env" ]]; then
  # shellcheck disable=SC1090
  set -a; source "$HOME/.env"; set +a
fi

mkdir -p "$HOME/.claude/state" 2>/dev/null || true
LOG_FILE="${SPANORY_HOOK_LOG_FILE:-$HOME/.claude/state/spanory-hook.log}"

# Preserve stdin payload for downstream parser
PAYLOAD="$(cat 2>/dev/null || true)"
if [[ -z "$PAYLOAD" ]]; then
  exit 0
fi

printf '%s\n' "$PAYLOAD" | node "$REPO_ROOT/packages/cli/src/index.js" runtime claude-code hook \
  --endpoint "${SPANORY_OTLP_ENDPOINT:-${OTEL_EXPORTER_OTLP_ENDPOINT:-}}" \
  --headers "${SPANORY_OTLP_HEADERS:-${OTEL_EXPORTER_OTLP_HEADERS:-}}" \
  --export-json-dir "${SPANORY_HOOK_EXPORT_JSON_DIR:-$HOME/.claude/state/spanory-json}" \
  >> "$LOG_FILE" 2>&1 || true

exit 0
