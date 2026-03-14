#!/usr/bin/env node
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const ISSUE_STATUSES = ['open', 'in_progress', 'blocked', 'done'];

function nowIso(now) {
  return now ?? new Date().toISOString();
}

function die(message) {
  console.error(`[issue-cli] ${message}`);
  process.exit(1);
}

function normalizeId(id) {
  return String(id ?? '').trim();
}

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = args[index + 1];
    if (next && !next.startsWith('--')) {
      options[key] = next;
      index += 1;
      continue;
    }
    options[key] = true;
  }
  return options;
}

function resolveIssueStatePath(input) {
  return input
    ? path.resolve(process.cwd(), String(input))
    : path.resolve(process.cwd(), 'docs/issues/state.json');
}

function resolveTodoPath(input) {
  return input
    ? path.resolve(process.cwd(), String(input))
    : path.resolve(process.cwd(), 'todo.md');
}

function parsePendingTodoItems(todoContent, source = 'todo.md') {
  const lines = String(todoContent ?? '').split(/\r?\n/);
  const items = [];
  for (const line of lines) {
    const match = line.match(/^\s*-\s*\[\s\]\s+([A-Za-z0-9_-]+)\s+(.*)$/);
    if (!match) continue;
    items.push({
      id: normalizeId(match[1]),
      title: match[2].trim(),
      source,
    });
  }
  return items;
}

function assertStatus(status) {
  if (!ISSUE_STATUSES.includes(status)) {
    throw new Error(`unsupported issue status: ${status}`);
  }
}

function assertAllowedTransition(from, to) {
  if (from === to) return;
  if (from === 'done' && to !== 'done') {
    throw new Error('cannot transition issue from done to non-done status');
  }
}

function createEmptyIssueState(now) {
  return {
    version: 1,
    updatedAt: nowIso(now),
    issues: [],
  };
}

async function loadIssueState(filePath) {
  try {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.issues)) {
      throw new Error('invalid issue state file');
    }
    return {
      version: 1,
      updatedAt: String(parsed.updatedAt ?? new Date(0).toISOString()),
      issues: parsed.issues,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return createEmptyIssueState();
    }
    throw error;
  }
}

async function saveIssueState(filePath, state) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
}

function syncIssueState(prev, pending, now) {
  const timestamp = nowIso(now);
  const byId = new Map(prev.issues.map((issue) => [issue.id, issue]));
  const activeIds = new Set(pending.map((item) => item.id));
  let added = 0;
  let reopened = 0;
  let autoClosed = 0;

  for (const item of pending) {
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, {
        id: item.id,
        title: item.title,
        source: item.source,
        status: 'open',
        notes: ['synced from todo pending item'],
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      added += 1;
      continue;
    }

    existing.title = item.title;
    existing.source = item.source;
    existing.updatedAt = timestamp;
    if (existing.status === 'done') {
      existing.status = 'open';
      existing.closedAt = undefined;
      existing.notes.push('reopened by todo pending item');
      reopened += 1;
    }
  }

  for (const issue of byId.values()) {
    if (issue.source !== 'todo.md') continue;
    if (activeIds.has(issue.id)) continue;
    if (issue.status === 'done') continue;
    issue.status = 'done';
    issue.updatedAt = timestamp;
    issue.closedAt = timestamp;
    issue.notes.push('auto-closed because todo item is no longer pending');
    autoClosed += 1;
  }

  return {
    state: {
      version: 1,
      updatedAt: timestamp,
      issues: Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id)),
    },
    added,
    reopened,
    autoClosed,
  };
}

function setIssueStatus(prev, input, now) {
  const issueId = normalizeId(input.id);
  const timestamp = nowIso(now);
  assertStatus(input.status);
  const issue = prev.issues.find((item) => item.id === issueId);
  if (!issue) throw new Error(`issue not found: ${issueId}`);

  assertAllowedTransition(issue.status, input.status);

  issue.status = input.status;
  issue.updatedAt = timestamp;
  if (input.status === 'done') issue.closedAt = timestamp;
  if (input.status !== 'done') issue.closedAt = undefined;
  if (input.note && input.note.trim()) issue.notes.push(input.note.trim());

  return {
    version: 1,
    updatedAt: timestamp,
    issues: prev.issues,
  };
}

function printUsage() {
  console.log([
    'Usage:',
    '  node scripts/issues/issue-cli.mjs sync [--todo-file <path>] [--state-file <path>]',
    '  node scripts/issues/issue-cli.mjs list [--state-file <path>] [--status <status>]',
    '  node scripts/issues/issue-cli.mjs set-status --id <id> --status <status> [--note <text>] [--state-file <path>]',
    '',
    `Status: ${ISSUE_STATUSES.join('|')}`,
  ].join('\n'));
}

async function runSync(args) {
  const options = parseOptions(args);
  if (options.help || options.h) {
    printUsage();
    return;
  }
  const todoFile = resolveTodoPath(options['todo-file']);
  const stateFile = resolveIssueStatePath(options['state-file']);
  const todoRaw = await readFile(todoFile, 'utf-8');
  const pending = parsePendingTodoItems(todoRaw, 'todo.md');
  const prev = await loadIssueState(stateFile);
  const result = syncIssueState(prev, pending);
  await saveIssueState(stateFile, result.state);
  console.log(JSON.stringify({
    stateFile,
    todoFile,
    pending: pending.length,
    added: result.added,
    reopened: result.reopened,
    autoClosed: result.autoClosed,
    total: result.state.issues.length,
  }, null, 2));
}

async function runList(args) {
  const options = parseOptions(args);
  if (options.help || options.h) {
    printUsage();
    return;
  }
  const stateFile = resolveIssueStatePath(options['state-file']);
  const state = await loadIssueState(stateFile);
  const statusFilter = options.status ? String(options.status).trim() : '';
  if (statusFilter) assertStatus(statusFilter);
  const rows = statusFilter
    ? state.issues.filter((item) => item.status === statusFilter)
    : state.issues;
  console.log(JSON.stringify({ stateFile, total: rows.length, issues: rows }, null, 2));
}

async function runSetStatus(args) {
  const options = parseOptions(args);
  if (options.help || options.h) {
    printUsage();
    return;
  }
  if (!options.id) die('missing required option: --id <id>');
  if (!options.status) die('missing required option: --status <status>');
  const stateFile = resolveIssueStatePath(options['state-file']);
  const prev = await loadIssueState(stateFile);
  const next = setIssueStatus(prev, {
    id: options.id,
    status: options.status,
    note: options.note,
  });
  await saveIssueState(stateFile, next);
  const issue = next.issues.find((item) => item.id === options.id);
  console.log(JSON.stringify({ stateFile, issue }, null, 2));
}

async function main() {
  const [command = 'help', ...args] = process.argv.slice(2);
  if (command === 'help' || command === '--help' || command === '-h') {
    printUsage();
    return;
  }
  if (command === 'sync') {
    await runSync(args);
    return;
  }
  if (command === 'list') {
    await runList(args);
    return;
  }
  if (command === 'set-status') {
    await runSetStatus(args);
    return;
  }
  die(`unsupported command: ${command}`);
}

main().catch((error) => {
  die(error instanceof Error ? error.message : String(error));
});
