# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning for the public CLI contract.

## [0.1.17] - 2026-03-12

### Fixed
- opencode-plugin: bundle all dependencies with esbuild into a single file, fixing import failures when installed via npm (relative path `../../backend-langfuse/...` etc. could not resolve outside monorepo).

### Added
- `spanory doctor`: new `plugin_loadable` check that dynamically imports the opencode plugin module to verify all dependencies resolve correctly.

## [0.1.19] - 2026-03-13

### Fixed
- npm global installation now works for end users (`npm i -g @bububuger/spanory`) without requiring local monorepo sources.
- CLI publish artifact is now self-contained and no longer relies on private workspace packages at runtime.

### Changed
- `@bububuger/spanory` publish payload narrowed to runtime entry files only (`dist/index.js`, `dist/index.d.ts`).
- Added package-level install regression check: `npm run --workspace @bububuger/spanory pack:test-install`.

## [0.1.33] - 2026-03-13

### Fixed
- openclaw plugin is bundled and included in the published package to prevent missing plugin artifacts at runtime.

## [0.1.32] - 2026-03-13

### Fixed
- bundled package plugin directory resolution now correctly locates both opencode and openclaw plugin payloads.

## [0.1.31] - 2026-03-13

### Fixed
- opencode setup now registers the plugin in `opencode.json` during installation.

## [0.1.30] - 2026-03-13

### Fixed
- opencode setup now writes a plugin-local `package.json` with `type: module` to keep module loading compatible.

## [0.1.29] - 2026-03-13

### Fixed
- setup flow now imports `openSync` correctly for codex watch configuration updates.

## [0.1.28] - 2026-03-13

### Changed
- removed all remaining codex notify mode setup artifacts.

## [0.1.27] - 2026-03-13

### Added
- setup apply flow now auto-starts the codex watch process.

## [0.1.26] - 2026-03-13

### Fixed
- restored codex notify configuration helper functions in setup flow.

## [0.1.25] - 2026-03-13

### Fixed
- openclaw plugin now waits for environment loading to finish before sending OTLP data.

## [0.1.24] - 2026-03-13

### Fixed
- openclaw plugin now loads user environment variables during register.

## [0.1.23] - 2026-03-13

### Changed
- setup flow removed codex notify mode.

## [0.1.22] - 2026-03-13

### Added
- setup command now supports teardown to remove runtime integrations.

### Fixed
- alipay CLI now includes the missing `commander` runtime dependency.

## [0.1.21] - 2026-03-13

### Added
- setup now defaults to codex watch mode and normalizes openclaw plugin paths.

## [0.1.20] - 2026-03-13

### Changed
- CI GitHub Actions baseline upgraded to Node 24 compatible action majors.
- JavaScript Actions runtime is pinned to Node 24.

### Fixed
- CI test execution now uses a stable core test glob on bash runners.
- alipay workspace now defines missing check/test scripts required by CI.

## [Unreleased]

### Added
- Turn observability attributes: input hash/prev-hash, char/line delta, similarity, and changed flag.
- Actor and subagent metadata: `agentic.actor.role`, `agentic.actor.role_confidence`, `agentic.subagent.calls`.
- Cache observability: `gen_ai.usage.details.cache_hit_rate`.
- New report views: `report cache`, `report tool`, `report turn-diff`.
- New alert session metrics: `cache.read`, `cache.creation`, `cache.hit_rate`, `subagent.calls`, `diff.char_delta.max`.
- Capture phase design doc for `Claude Code` and `OpenClaw`, plus core type contracts:
  `CaptureAdapter`, `CaptureRecord`, `CaptureRedactionPolicy`.
- Engineering governance: added `docs/standards/change-context-log.md` and required medium/large changes to record background/decision/impact/verification.

### Changed
- Runtime/build shape migrated to `TS source + dist runtime artifacts` for active packages; runtime entrypoints now resolve from `dist`.

### Removed
- Removed unused workspace package `@bububuger/langfuse` (`packages/langfuse`) to keep repository and dependency graph clean.

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
- Workspace bootstrap for `@bububuger/core`, `@bububuger/spanory`, and `@bububuger/langfuse`.
- Claude Code runtime adapter (transcript parsing and category mapping).
- OTLP payload compiler and sender for Langfuse-compatible ingestion.
- SessionEnd hook wrappers for macOS and starter wrappers for Linux/Windows.
- Initial replay/export CLI workflow.
