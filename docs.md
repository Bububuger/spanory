# Spanory Roadmap (v0)

## Completed (MVP)

1. Claude Code local transcript parser
2. Unified event schema and classifier (`turn`, `agent_command`, `shell_command`, `mcp`, `agent_task`)
3. OTel payload compiler and OTLP HTTP sender
4. Hook entry for Claude `SessionEnd` (mac wrapper)
5. CLI replay for single session

## In Progress

1. Cross-OS wrapper hardening (Linux/Windows)
2. Langfuse naming and timeline alignment

## Planned

1. Runtime adapters for Codex/OpenCode
2. Multi-session range backfill command
3. Session and project level aggregation helpers
4. Packaging and release flow (`npm` executable install)
