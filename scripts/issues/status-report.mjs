#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';

const VALID_STATUSES = new Set([
  'open',
  'triaged',
  'in_progress',
  'blocked',
  'ready_for_review',
  'done',
  'closed'
]);

const [, , command = 'summary', ...args] = process.argv;
const TRACKER = process.env.SPANORY_ISSUE_TRACKER ?? 'docs/issues/tracker.json';

function nowIso() {
  return new Date().toISOString();
}

function die(message) {
  console.error(`[issue-status] ${message}`);
  process.exit(1);
}

async function loadTracker() {
  const raw = await readFile(TRACKER, 'utf-8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data.issues)) die(`invalid tracker format: issues[] missing in ${TRACKER}`);
  return data;
}

async function saveTracker(data) {
  data.updatedAt = nowIso();
  await writeFile(TRACKER, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}

function renderSummary(data) {
  const counts = {};
  for (const status of VALID_STATUSES) counts[status] = 0;

  for (const issue of data.issues) {
    if (!VALID_STATUSES.has(issue.status)) {
      die(`invalid status on issue ${issue.id ?? '<unknown>'}: ${issue.status}`);
    }
    counts[issue.status] += 1;
  }

  console.log(`tracker: ${TRACKER}`);
  console.log(`updatedAt: ${data.updatedAt ?? '<unknown>'}`);
  console.log('status-counts:');
  for (const status of VALID_STATUSES) {
    console.log(`  ${status}: ${counts[status]}`);
  }

  const active = data.issues.filter((it) => !['done', 'closed'].includes(it.status));
  console.log(`active-issues: ${active.length}`);
  for (const issue of active) {
    console.log(`- ${issue.id} [${issue.status}] ${issue.title}`);
    if (issue.nextAction) console.log(`  next: ${issue.nextAction}`);
  }
}

async function runSet(id, status, note) {
  if (!id) die('usage: set <id> <status> [note]');
  if (!VALID_STATUSES.has(status)) die(`invalid status: ${status}`);

  const data = await loadTracker();
  const issue = data.issues.find((it) => it.id === id);
  if (!issue) die(`issue not found: ${id}`);

  issue.status = status;
  issue.updatedAt = nowIso();
  if (note) {
    const stamp = nowIso().slice(0, 10);
    issue.notes = Array.isArray(issue.notes) ? issue.notes : [];
    issue.notes.push(`${stamp}: ${note}`);
  }

  await saveTracker(data);
  console.log(`updated: ${id} -> ${status}`);
}

try {
  if (command === 'summary') {
    const data = await loadTracker();
    renderSummary(data);
  } else if (command === 'set') {
    const [id, status, ...noteParts] = args;
    await runSet(id, status, noteParts.join(' ').trim());
  } else {
    die(`unsupported command: ${command}; use summary | set`);
  }
} catch (error) {
  die(error instanceof Error ? error.message : String(error));
}
