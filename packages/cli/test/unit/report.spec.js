import { describe, expect, it } from 'vitest';

import {
  summarizeAgents,
  summarizeCommands,
  summarizeMcp,
  summarizeSessions,
} from '../../src/report/aggregate.js';

function buildSession() {
  return {
    context: { projectId: 'p1', sessionId: 's1' },
    events: [
      {
        runtime: 'claude-code',
        sessionId: 's1',
        projectId: 'p1',
        category: 'turn',
        attributes: {
          'gen_ai.usage.input_tokens': 10,
          'gen_ai.usage.output_tokens': 5,
          'gen_ai.usage.total_tokens': 15,
        },
      },
      {
        runtime: 'claude-code',
        sessionId: 's1',
        projectId: 'p1',
        category: 'mcp',
        name: 'Tool: mcp__context7__resolve',
        attributes: { 'agentic.mcp.server.name': 'context7' },
      },
      {
        runtime: 'claude-code',
        sessionId: 's1',
        projectId: 'p1',
        category: 'agent_command',
        attributes: { 'agentic.command.name': 'review' },
      },
      {
        runtime: 'claude-code',
        sessionId: 's1',
        projectId: 'p1',
        category: 'agent_task',
        attributes: {},
      },
      {
        runtime: 'claude-code',
        sessionId: 's1',
        projectId: 'p1',
        category: 'shell_command',
        attributes: {},
      },
    ],
  };
}

describe('report aggregations', () => {
  it('builds session summary', () => {
    const rows = summarizeSessions([buildSession()]);
    expect(rows[0].sessionId).toBe('s1');
    expect(rows[0].turns).toBe(1);
    expect(rows[0].events).toBe(5);
    expect(rows[0].usage.total).toBe(15);
  });

  it('builds mcp summary', () => {
    const rows = summarizeMcp([buildSession()]);
    expect(rows).toEqual([{ server: 'context7', calls: 1, sessions: 1 }]);
  });

  it('builds command summary', () => {
    const rows = summarizeCommands([buildSession()]);
    expect(rows).toEqual([{ command: 'review', calls: 1, sessions: 1 }]);
  });

  it('builds agent summary', () => {
    const rows = summarizeAgents([buildSession()]);
    expect(rows[0].agentTasks).toBe(1);
    expect(rows[0].shellCommands).toBe(1);
    expect(rows[0].mcpCalls).toBe(1);
    expect(rows[0].usage.total).toBe(15);
  });
});
