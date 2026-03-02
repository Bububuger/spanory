# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning for the public CLI contract.

## [Unreleased]

### Added
- Turn observability attributes: input hash/prev-hash, char/line delta, similarity, and changed flag.
- Actor and subagent metadata: `agentic.actor.role`, `agentic.actor.role_confidence`, `agentic.subagent.calls`.
- Cache observability: `gen_ai.usage.details.cache_hit_rate`.
- New report views: `report cache`, `report tool`, `report turn-diff`.
- New alert session metrics: `cache.read`, `cache.creation`, `cache.hit_rate`, `subagent.calls`, `diff.char_delta.max`.
- Capture phase design doc for `Claude Code` and `OpenClaw`, plus core type contracts:
  `CaptureAdapter`, `CaptureRecord`, `CaptureRedactionPolicy`.

### Compatibility
- Backward compatible: no mandatory migration for existing `hook/export/backfill` workflows.

## [0.1.1] - 2026-03-01

### Fixed
- Hook export idempotency: skip unchanged session payloads to prevent duplicate trace uploads.
- Claude transcript parsing: better turn grouping and tool result output backfilling.
- OTLP IDs: deterministic trace/span identifiers and Langfuse observation/trace ID attributes.
- Export quality: reduced empty turn traces in complex multi-tool sessions.

## [0.1.0] - 2026-02-28

### Added
- Workspace bootstrap for `@spanory/core`, `@spanory/cli`, and `@spanory/langfuse`.
- Claude Code runtime adapter (transcript parsing and category mapping).
- OTLP payload compiler and sender for Langfuse-compatible ingestion.
- SessionEnd hook wrappers for macOS and starter wrappers for Linux/Windows.
- Initial replay/export CLI workflow.
