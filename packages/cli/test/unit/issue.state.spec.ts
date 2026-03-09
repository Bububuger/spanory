import { describe, expect, it } from 'vitest';

import {
  createEmptyIssueState,
  parsePendingTodoItems,
  setIssueStatus,
  syncIssueState,
} from '../../src/issue/state.ts';

describe('issue state management', () => {
  it('parses unchecked todo items as issues', () => {
    const pending = parsePendingTodoItems([
      '- [x] T1 done',
      '- [ ] T2 implement state',
      '- [ ] TASK_3 add tests',
    ].join('\n'));

    expect(pending).toEqual([
      { id: 'T2', title: 'implement state', source: 'todo.md' },
      { id: 'TASK_3', title: 'add tests', source: 'todo.md' },
    ]);
  });

  it('syncs new/open and auto-closes missing todo issues', () => {
    const prev = {
      version: 1 as const,
      updatedAt: '2026-03-09T00:00:00.000Z',
      issues: [
        {
          id: 'T2',
          title: 'old title',
          source: 'todo.md',
          status: 'open' as const,
          notes: [],
          createdAt: '2026-03-09T00:00:00.000Z',
          updatedAt: '2026-03-09T00:00:00.000Z',
        },
        {
          id: 'T9',
          title: 'stale',
          source: 'todo.md',
          status: 'in_progress' as const,
          notes: [],
          createdAt: '2026-03-09T00:00:00.000Z',
          updatedAt: '2026-03-09T00:00:00.000Z',
        },
      ],
    };

    const pending = parsePendingTodoItems('- [ ] T2 refreshed title\n- [ ] T3 new issue');
    const result = syncIssueState(prev, pending, '2026-03-09T01:00:00.000Z');

    expect(result.added).toBe(1);
    expect(result.autoClosed).toBe(1);
    expect(result.state.issues.find((item) => item.id === 'T2')?.title).toBe('refreshed title');
    expect(result.state.issues.find((item) => item.id === 'T9')?.status).toBe('done');
  });

  it('blocks done -> in_progress transition', () => {
    const state = createEmptyIssueState('2026-03-09T00:00:00.000Z');
    state.issues.push({
      id: 'T2',
      title: 'done item',
      source: 'todo.md',
      status: 'done',
      notes: [],
      createdAt: '2026-03-09T00:00:00.000Z',
      updatedAt: '2026-03-09T00:00:00.000Z',
      closedAt: '2026-03-09T00:00:00.000Z',
    });

    expect(() => setIssueStatus(state, { id: 'T2', status: 'in_progress' })).toThrow(
      'cannot transition issue from done to non-done status',
    );
  });
});
