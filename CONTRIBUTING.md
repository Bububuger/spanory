# Contributing

## Development Flow

1. Create a branch from `main` using prefix `codex/` or `feat/`.
2. Keep changes small and reviewable. Avoid unrelated refactors.
3. Run verification locally before commit:
   - `npm run check`
   - `npm run telemetry:check`
   - `npm test`

## Commit and Review

- Use conventional commit style (`feat:`, `fix:`, `docs:`, `test:`, `chore:`); non-conforming prefixes (for example `codex:`) are blocked by commit hooks.
- Include test evidence in PR description.
- For medium/large changes (multi-file, refactor, build/release path updates), add a record in `docs/standards/change-context-log.md`.
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
  - telemetry spec/profile update (`telemetry/*.yaml`) when fields changed
  - tests for any new/changed fields

## Release Flow

1. Ensure local gates pass:
   - `npm run check`
   - `npm run telemetry:check`
   - `npm test`
   - `npm run test:bdd`
2. Create a semver tag from `main`:
   - `git tag vX.Y.Z`
3. Sync version and build:
   - `npm run version:sync` (reads tag, updates all package.json)
   - `npm run build`
4. Publish:
   - **GitHub (public)**: `git push origin vX.Y.Z`, GitHub Actions runs `.github/workflows/release.yml` to build binaries and publish GitHub Release.
   - **Internal registry**: `cd packages/alipay-cli && tnpm publish`
5. Update global install to verify:
   - `tnpm install -g @alipay/spanory@latest`
