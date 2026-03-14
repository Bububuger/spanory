import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const ISSUE_STATUSES = ['open', 'in_progress', 'blocked', 'done'] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export interface IssueItem {
  id: string;
  title: string;
  source: string;
  status: IssueStatus;
  notes: string[];
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
}

export interface IssueState {
  version: 1;
  updatedAt: string;
  issues: IssueItem[];
}

export interface PendingTodoItem {
  id: string;
  title: string;
  source: string;
}

function nowIso(now?: string) {
  return now ?? new Date().toISOString();
}

function normalizeId(id: string) {
  return String(id ?? '').trim();
}

function assertStatus(status: string): asserts status is IssueStatus {
  if (!ISSUE_STATUSES.includes(status as IssueStatus)) {
    throw new Error(`unsupported issue status: ${status}`);
  }
}

function assertAllowedTransition(from: IssueStatus, to: IssueStatus) {
  if (from === to) return;
  if (from === 'done' && to !== 'done') {
    throw new Error('cannot transition issue from done to non-done status');
  }
}

export function parsePendingTodoItems(todoContent: string, source = 'todo.md'): PendingTodoItem[] {
  const lines = String(todoContent ?? '').split(/\r?\n/);
  const items: PendingTodoItem[] = [];
  for (const line of lines) {
    const m = line.match(/^\s*-\s*\[\s\]\s+([A-Za-z0-9_-]+)\s+(.*)$/);
    if (!m) continue;
    items.push({
      id: normalizeId(m[1]),
      title: m[2].trim(),
      source,
    });
  }
  return items;
}

export function syncIssueState(
  prev: IssueState,
  pending: PendingTodoItem[],
  now?: string,
): { state: IssueState; added: number; reopened: number; autoClosed: number } {
  const timestamp = nowIso(now);
  const byId = new Map(
    prev.issues.map((issue) => [
      issue.id,
      {
        ...issue,
        notes: [...issue.notes],
      },
    ]),
  );
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

    let next = {
      ...existing,
      title: item.title,
      source: item.source,
      updatedAt: timestamp,
    };
    if (existing.status === 'done') {
      next = {
        ...next,
        status: 'open',
        closedAt: undefined,
        notes: [...next.notes, 'reopened by todo pending item'],
      };
      reopened += 1;
    }
    byId.set(item.id, next);
  }

  for (const [issueId, issue] of byId.entries()) {
    if (issue.source !== 'todo.md') continue;
    if (activeIds.has(issue.id)) continue;
    if (issue.status === 'done') continue;
    byId.set(issueId, {
      ...issue,
      status: 'done',
      updatedAt: timestamp,
      closedAt: timestamp,
      notes: [...issue.notes, 'auto-closed because todo item is no longer pending'],
    });
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

export function setIssueStatus(
  prev: IssueState,
  input: { id: string; status: string; note?: string },
  now?: string,
): IssueState {
  const issueId = normalizeId(input.id);
  const timestamp = nowIso(now);
  assertStatus(input.status);
  const nextStatus: IssueStatus = input.status;
  const issue = prev.issues.find((item) => item.id === issueId);
  if (!issue) throw new Error(`issue not found: ${issueId}`);

  assertAllowedTransition(issue.status, nextStatus);

  const note = input.note?.trim();
  const issues = prev.issues.map((item) => {
    if (item.id !== issueId) return item;
    return {
      ...item,
      status: nextStatus,
      updatedAt: timestamp,
      closedAt: nextStatus === 'done' ? timestamp : undefined,
      notes: note ? [...item.notes, note] : [...item.notes],
    };
  });

  return {
    version: 1,
    updatedAt: timestamp,
    issues,
  };
}

export function createEmptyIssueState(now?: string): IssueState {
  return {
    version: 1,
    updatedAt: nowIso(now),
    issues: [],
  };
}

export async function loadIssueState(filePath: string): Promise<IssueState> {
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
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return createEmptyIssueState();
    }
    throw error;
  }
}

export async function saveIssueState(filePath: string, state: IssueState): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
}

export function resolveIssueStatePath(input?: string): string {
  return input ? path.resolve(process.cwd(), input) : path.resolve(process.cwd(), 'docs/issues/state.json');
}

export function resolveTodoPath(input?: string): string {
  return input ? path.resolve(process.cwd(), input) : path.resolve(process.cwd(), 'todo.md');
}
