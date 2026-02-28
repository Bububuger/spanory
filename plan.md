# Spanory Hook Export Dir Resilience Plan (2026-03-01)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `spanory hook` resilient when the default or provided export directory does not exist by automatically creating parent directories before writing JSON snapshots.

**Architecture:** Keep current CLI contract unchanged. Add directory-creation guard in the centralized export write path so all commands (`hook`, `export`, `backfill`) benefit consistently.

**Tech Stack:** Node.js (ESM), existing CLI command framework, Vitest BDD tests.

---

### Task 1: Implement directory auto-create before JSON writes

**Files:**
- Modify: `packages/cli/src/index.js`

**Steps:**
1. Import `mkdir` from `node:fs/promises`.
2. Before writing `exportJsonPath`, ensure `dirname(exportJsonPath)` exists with recursive create.
3. Keep behavior backward-compatible for existing commands.

**Acceptance:** CLI no longer fails with ENOENT when export path parent directories are missing.

### Task 2: Add regression test for missing export directory

**Files:**
- Modify: `packages/cli/test/bdd/hook.integration.spec.js`

**Steps:**
1. Add scenario where `--export-json-dir` points to a non-existing nested path.
2. Verify command succeeds and output file is created.

**Acceptance:** BDD passes and proves missing directory is auto-created.

### Task 3: Verify and update task status

**Files:**
- Modify: `todo.md`

**Steps:**
1. Run `npm run check`.
2. Run `npm test`.
3. Run `npm run test:bdd`.
4. Mark todo items done.

**Acceptance:** All verification commands pass; todo fully completed.
