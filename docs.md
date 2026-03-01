# Spanory Roadmap (v0)

## Completed (MVP)

1. Claude Code local transcript parser
2. Unified event schema and classifier (`turn`, `agent_command`, `shell_command`, `mcp`, `agent_task`)
3. OTel payload compiler and OTLP HTTP sender
4. Hook entry for Claude `SessionEnd` (mac wrapper)
5. CLI replay for single session
6. OpenClaw runtime adapter (`export`, `hook`, `backfill`)
7. Runtime-neutral normalization pipeline (shared turn/tool/usage mapping)
8. Internal backend abstraction (`RuntimeAdapter -> canonical -> backend -> otlp-core`)
9. OpenClaw plugin ingestion path (`session/tool/model hooks`, zero cron)

## In Progress

1. Cross-OS wrapper hardening (Linux/Windows)
2. Langfuse naming and timeline alignment
3. Runtime capability matrix and parity maintenance
4. OpenClaw plugin operational hardening (doctor + status + spool observability)

## Planned

1. LangSmith backend adapter (currently deferred)
2. Runtime adapters for Codex/OpenCode (reusing shared normalize pipeline)
3. Multi-session range backfill command
4. Session and project level aggregation helpers
5. Packaging and release flow (`npm` executable install)
