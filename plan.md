# Spanory P1 Alert+Report Implementation Plan (2026-02-28)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement P1-in-scope capabilities for Spanory infrastructure layer: alert evaluation engine and report views, without building a hosted dashboard or log platform.

**Architecture:** Keep Spanory as telemetry infrastructure. Add local query/report aggregation over normalized events and a rule-based alert evaluator that can consume exported session JSON. Provide output adapters (stdout/webhook) instead of UI.

**Tech Stack:** Node.js (ESM), Commander.js CLI, Vitest (unit + BDD integration), existing runtime adapters.

---

### Task 1: Historical plan/todo management policy

**Files:**
- Create: `docs/plans/history/README.md`
- Create: `docs/todos/history/README.md`
- Modify: `README.md`

**Steps:**
1. Document that each stage archives old `plan.md` and `todo.md` before creating new ones.
2. Add README pointers for where plan/todo history lives.

**Acceptance:** Historical files discoverable and policy documented.

### Task 2: Build report aggregation module

**Files:**
- Create: `packages/cli/src/report/aggregate.js`
- Modify: `packages/cli/src/index.js`

**Steps:**
1. Implement event-based aggregation helpers:
   - `session-summary`
   - `mcp-summary`
   - `command-summary`
   - `agent-summary`
2. Support input from exported session JSON file(s).
3. Add CLI command group `spanory report ...`.

**Acceptance:** Report commands output deterministic JSON summaries.

### Task 3: Build alert evaluator module

**Files:**
- Create: `packages/cli/src/alert/evaluate.js`
- Modify: `packages/cli/src/index.js`

**Steps:**
1. Define alert rule format (JSON): thresholds over summary metrics.
2. Implement evaluator command `spanory alert eval`.
3. Support sinks:
   - stdout JSON
   - optional webhook POST
4. Include non-zero exit when alerts fire (optional flag-controlled).

**Acceptance:** Rules trigger expected alerts on fixture data.

### Task 4: Add tests (unit + BDD)

**Files:**
- Create: `packages/cli/test/unit/report.spec.js`
- Create: `packages/cli/test/unit/alert.spec.js`
- Create: `packages/cli/test/bdd/report.integration.spec.js`
- Create: `packages/cli/test/bdd/alert.integration.spec.js`
- Create: `packages/cli/test/fixtures/exported/*.json`

**Steps:**
1. Unit test aggregation math and grouping.
2. Unit test rule evaluator semantics.
3. BDD test CLI commands and failure behavior.

**Acceptance:** `npm test` and `npm run test:bdd` pass.

### Task 5: Documentation and final verification

**Files:**
- Modify: `README.md`
- Modify: `todo.md`

**Steps:**
1. Document new commands with examples.
2. Run full verification:
   - `npm run check`
   - `npm test`
   - `npm run test:bdd`
3. Mark all todo items done with evidence.

**Acceptance:** All checks pass; todo fully completed.
