import { describe, expect, it } from 'vitest';

import { evaluateRules } from '../../src/alert/evaluate.js';

const sessions = [
  {
    context: { projectId: 'p1', sessionId: 's1' },
    events: [
      {
        runtime: 'claude-code',
        sessionId: 's1',
        projectId: 'p1',
        category: 'turn',
        attributes: {
          'gen_ai.usage.total_tokens': 30,
        },
      },
      {
        runtime: 'claude-code',
        sessionId: 's1',
        projectId: 'p1',
        category: 'shell_command',
        attributes: {},
      },
      {
        runtime: 'claude-code',
        sessionId: 's1',
        projectId: 'p1',
        category: 'mcp',
        attributes: { 'agentic.mcp.server.name': 'context7' },
      },
    ],
  },
];

describe('alert evaluator', () => {
  it('triggers session and agent rules', () => {
    const alerts = evaluateRules(
      [
        { id: 'r1', scope: 'session', metric: 'usage.total', op: 'gt', threshold: 20 },
        { id: 'r2', scope: 'agent', metric: 'shellCommands', op: 'gte', threshold: 1 },
      ],
      sessions,
    );

    expect(alerts.map((a) => a.ruleId)).toEqual(['r1', 'r2']);
  });

  it('returns empty when threshold not hit', () => {
    const alerts = evaluateRules(
      [{ id: 'r1', scope: 'session', metric: 'usage.total', op: 'gt', threshold: 999 }],
      sessions,
    );
    expect(alerts).toEqual([]);
  });
});
