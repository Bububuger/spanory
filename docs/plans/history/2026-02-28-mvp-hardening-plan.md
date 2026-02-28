# Spanory MVP Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver a production-maintainable Spanory MVP with standalone `spanory` binary UX, concise/helpful CLI, Langfuse payload compatibility parity, and verified BDD integration before push.

**Architecture:** Keep a runtime-agnostic core event model and adapter interface, implement Claude Code as first runtime adapter, and route all outputs through a single OTLP compiler that supports Langfuse-native attributes plus Spanory-specific extensions. Add a command framework for strict/clear CLI UX and implement replay/backfill paths as first-class commands. Validate with fixture-based unit tests and BDD integration tests against local transcripts.

**Tech Stack:** Node.js (ESM), TypeScript (type contracts), Commander.js (CLI), Vitest (unit + BDD style integration), npm workspaces, GitHub Actions.

---

### Task 1: Baseline project governance files

**Files:**
- Create: `CHANGELOG.md`
- Create: `CONTRIBUTING.md`
- Create: `.github/CODEOWNERS`
- Modify: `README.md`

**Steps:**
1. Add `CHANGELOG.md` with Keep a Changelog format and `0.1.0` bootstrap section.
2. Add `CONTRIBUTING.md` with branch, commit, test, and review requirements.
3. Add `.github/CODEOWNERS` with repository owner mapping.
4. Add governance and release policy summary to `README.md`.
5. Verify docs render and links are valid.

**Acceptance:** Governance docs exist, are coherent, and referenced from README.

### Task 2: Stabilize CLI command model and help UX

**Files:**
- Modify: `packages/cli/src/index.js`
- Modify: `packages/cli/package.json`
- Create: `packages/cli/src/commands/` (if needed for split)
- Create: `packages/cli/README.md` (optional command reference)

**Steps:**
1. Introduce Commander-based CLI parser and strict command tree.
2. Implement commands:
   - `spanory runtime claude-code hook`
   - `spanory runtime claude-code export`
   - `spanory runtime claude-code backfill`
3. Ensure each command has complete help text, examples, and required/optional flags.
4. Keep compatibility with current env var fallback for endpoint/headers.
5. Add validation errors with actionable messages.

**Acceptance:** `spanory --help` and subcommand `--help` pages are complete, concise, and executable.

### Task 3: Provide executable `spanory` binary distribution flow

**Files:**
- Modify: `packages/cli/package.json`
- Create: `scripts/release/build-binaries.sh`
- Create: `scripts/release/build-binaries.ps1` (skeleton allowed)
- Modify: `README.md`

**Steps:**
1. Keep npm `bin` command for local/global usage (`npm i -g` / `npx`).
2. Add standalone binary build pipeline using `pkg` and define output names:
   - `dist/spanory-macos-arm64`
   - `dist/spanory-linux-x64`
   - `dist/spanory-win-x64.exe`
3. Add one-step command to generate binaries.
4. Document install/run methods for both npm and standalone binaries.

**Acceptance:** Local build can output at least current host executable and run `--help` without `node` prefix.

### Task 4: Define Langfuse parity contract and gap matrix

**Files:**
- Create: `docs/langfuse-parity.md`
- Modify: `packages/cli/src/otlp.js`
- Modify: `packages/cli/src/runtime/claude/adapter.js`

**Steps:**
1. Define canonical field matrix: resource attributes, span core fields, known Langfuse attributes, and Spanory extension attributes.
2. Compare current Spanory payload vs Langfuse native payload (trace/observation naming, input/output keys, metadata, model usage/token fields, status, type).
3. Implement missing parity fields where source data exists.
4. Mark unsupported fields explicitly with reason (data absent in transcript/runtime) and future plan.
5. Ensure no parity regression for existing fields.

**Acceptance:** Parity doc includes “Langfuse has / Spanory has / gap status / action” table; OTLP output includes parity-required fields where derivable.

### Task 5: Add explicit token/usage extraction and reporting

**Files:**
- Modify: `packages/cli/src/runtime/claude/adapter.js`
- Modify: `packages/cli/src/otlp.js`
- Create: `packages/cli/src/runtime/claude/fixtures/` (sample transcripts)

**Steps:**
1. Parse available token/usage values from Claude transcript (if present in message metadata).
2. Propagate usage attributes to turn spans and relevant child spans.
3. Add normalized attributes for counts and cost-ready fields.
4. Preserve parity attributes expected by Langfuse.

**Acceptance:** For fixture containing usage metadata, exported spans include token usage attributes and values are numerically correct.

### Task 6: Unit tests for parser and OTLP compiler

**Files:**
- Create: `packages/cli/test/adapter.spec.js`
- Create: `packages/cli/test/otlp.spec.js`
- Modify: `packages/cli/package.json`

**Steps:**
1. Add Vitest config and test scripts.
2. Add adapter tests for category classification and timestamp mapping.
3. Add otlp tests for trace/span linking, attribute serialization, and header parsing.
4. Add parity assertions for Langfuse-required fields.

**Acceptance:** Unit tests run green locally and in CI.

### Task 7: BDD integration tests for realtime hook and replay/backfill

**Files:**
- Create: `packages/cli/test/bdd/replay.integration.spec.js`
- Create: `packages/cli/test/bdd/hook.integration.spec.js`
- Create: `packages/cli/test/bdd/backfill.integration.spec.js`

**Steps:**
1. Define scenarios in Given/When/Then style in test titles.
2. Use fixture transcripts to validate end-to-end command behavior.
3. Assert JSON payload contains expected span topology and key parity fields.
4. Include failure-path scenarios (missing session, malformed payload, missing endpoint).

**Acceptance:** BDD suite passes and proves real command workflows.

### Task 8: CI pipeline and quality gates

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `package.json`
- Modify: `README.md`

**Steps:**
1. Add CI jobs: install, check, test, binary smoke help run.
2. Enforce non-interactive verification commands.
3. Document CI badge/status policy.

**Acceptance:** CI config validates locally (syntax) and covers check+test commands.

### Task 9: Execute verification checklist and publish

**Files:**
- Modify: `todo.md`
- Modify: `README.md` (if final command examples changed)

**Steps:**
1. Run `npm run check`, `npm test`, and BDD-specific command.
2. Run binary smoke: built artifact `--help`.
3. Run representative export/hook/backfill against local transcript fixture.
4. Update `todo.md` statuses to completed.
5. Commit and push branch.

**Acceptance:** All checks pass with captured output evidence, then push to remote.
