import { describe, expect, it } from 'vitest';

import { evaluateRules } from '../../src/alert/evaluate.ts';

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
          'gen_ai.usage.input_tokens': 20,
          'gen_ai.usage.total_tokens': 30,
          'gen_ai.usage.details.cache_read_input_tokens': 6,
          'gen_ai.usage.details.cache_creation_input_tokens': 2,
          'gen_ai.usage.details.cache_hit_rate': 0.230769,
          'agentic.turn.diff.char_delta': 0,
        },
      },
      {
        runtime: 'claude-code',
        sessionId: 's1',
        projectId: 'p1',
        category: 'turn',
        attributes: {
          'gen_ai.usage.input_tokens': 10,
          'gen_ai.usage.total_tokens': 10,
          'agentic.turn.diff.char_delta': 12,
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
      {
        runtime: 'claude-code',
        sessionId: 's1',
        projectId: 'p1',
        category: 'agent_task',
        attributes: {},
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

  it('supports cache/subagent/diff session metrics', () => {
    const alerts = evaluateRules(
      [
        { id: 'cache-read', scope: 'session', metric: 'cache.read', op: 'gte', threshold: 6 },
        { id: 'cache-creation', scope: 'session', metric: 'cache.creation', op: 'gte', threshold: 2 },
        { id: 'cache-hit-rate', scope: 'session', metric: 'cache.hit_rate', op: 'gt', threshold: 0.2 },
        { id: 'subagent-calls', scope: 'session', metric: 'subagent.calls', op: 'gte', threshold: 1 },
        { id: 'diff-char-max', scope: 'session', metric: 'diff.char_delta.max', op: 'gte', threshold: 12 },
      ],
      sessions,
    );

    expect(alerts.map((a) => a.ruleId)).toEqual([
      'cache-read',
      'cache-creation',
      'cache-hit-rate',
      'subagent-calls',
      'diff-char-max',
    ]);
  });
});
