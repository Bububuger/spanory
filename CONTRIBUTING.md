# Contributing

## Development Flow

1. Create a branch from `main` using prefix `codex/` or `feat/`.
2. Keep changes small and reviewable. Avoid unrelated refactors.
3. Run verification locally before commit:
   - `npm run check`
   - `npm test`

## Commit and Review

- Use conventional commit style where possible (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).
- Include test evidence in PR description.
- PRs should explain:
  - What changed
  - Why it changed
  - How it was verified

## CLI Contract

- `spanory` command behavior and flags are treated as public contract.
- Breaking flag/command changes require:
  - changelog entry
  - migration notes in `README.md`

## Runtime and Parity

- Runtime-specific logic must stay behind adapter boundaries.
- OTLP/Langfuse compatibility changes must include:
  - parity matrix update (`docs/langfuse-parity.md`)
  - tests for any new/changed fields
