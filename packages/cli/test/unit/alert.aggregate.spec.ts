import { afterEach, describe, expect, it, vi } from 'vitest';

const sessions = [
  {
    context: { projectId: 'p1', sessionId: 's1' },
    events: [
      {
        runtime: 'claude-code',
        sessionId: 's1',
        projectId: 'p1',
        category: 'turn',
        turnId: 'turn-1',
        attributes: {
          'gen_ai.usage.input_tokens': 20,
          'gen_ai.usage.total_tokens': 30,
          'gen_ai.usage.cache_read.input_tokens': 6,
          'gen_ai.usage.cache_creation.input_tokens': 2,
          'agentic.turn.diff.char_delta': 0,
        },
      },
      {
        runtime: 'claude-code',
        sessionId: 's1',
        projectId: 'p1',
        category: 'turn',
        turnId: 'turn-2',
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
        category: 'agent_command',
        attributes: { 'agentic.command.name': 'npm test' },
      },
      {
        runtime: 'claude-code',
        sessionId: 's1',
        projectId: 'p1',
        category: 'context',
        turnId: 'turn-1',
        attributes: {
          'agentic.context.event_type': 'context_snapshot',
          'agentic.context.composition': '{"unknown":20,"tool_output":80}',
          'agentic.context.top_sources': '["unknown","tool_output"]',
          'agentic.context.fill_ratio': 0.81,
          'agentic.context.delta_tokens': 1000,
        },
      },
      {
        runtime: 'claude-code',
        sessionId: 's1',
        projectId: 'p1',
        category: 'context',
        turnId: 'turn-1',
        attributes: {
          'agentic.context.event_type': 'context_source_attribution',
          'agentic.context.source_kind': 'tool_output',
          'agentic.context.pollution_score': 90,
        },
      },
    ],
  },
];

describe('alert evaluator aggregation', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.doUnmock('../../src/report/aggregate.js');
  });

  it('runs summarize functions once per evaluateRules execution', async () => {
    const calls = {
      sessions: 0,
      cache: 0,
      agents: 0,
      turnDiff: 0,
      mcp: 0,
      commands: 0,
    };

    vi.doMock('../../src/report/aggregate.js', async () => {
      const actual = await vi.importActual<typeof import('../../src/report/aggregate.js')>(
        '../../src/report/aggregate.js',
      );
      return {
        ...actual,
        summarizeSessions: (...args: Parameters<typeof actual.summarizeSessions>) => {
          calls.sessions += 1;
          return actual.summarizeSessions(...args);
        },
        summarizeCache: (...args: Parameters<typeof actual.summarizeCache>) => {
          calls.cache += 1;
          return actual.summarizeCache(...args);
        },
        summarizeAgents: (...args: Parameters<typeof actual.summarizeAgents>) => {
          calls.agents += 1;
          return actual.summarizeAgents(...args);
        },
        summarizeTurnDiff: (...args: Parameters<typeof actual.summarizeTurnDiff>) => {
          calls.turnDiff += 1;
          return actual.summarizeTurnDiff(...args);
        },
        summarizeMcp: (...args: Parameters<typeof actual.summarizeMcp>) => {
          calls.mcp += 1;
          return actual.summarizeMcp(...args);
        },
        summarizeCommands: (...args: Parameters<typeof actual.summarizeCommands>) => {
          calls.commands += 1;
          return actual.summarizeCommands(...args);
        },
      };
    });

    const { evaluateRules } = await import('../../src/alert/evaluate.ts');

    evaluateRules(
      [
        { id: 's1', scope: 'session', metric: 'usage.total', op: 'gt', threshold: 0 },
        { id: 's2', scope: 'session', metric: 'events', op: 'gt', threshold: 0 },
        { id: 'a1', scope: 'agent', metric: 'shellCommands', op: 'gte', threshold: 0 },
        { id: 'a2', scope: 'agent', metric: 'agentTasks', op: 'gte', threshold: 0 },
        { id: 'm1', scope: 'mcp', metric: 'calls', op: 'gte', threshold: 0 },
        { id: 'c1', scope: 'command', metric: 'calls', op: 'gte', threshold: 0 },
      ],
      sessions,
    );

    expect(calls.sessions).toBe(1);
    expect(calls.cache).toBe(1);
    expect(calls.agents).toBe(1);
    expect(calls.turnDiff).toBe(1);
    expect(calls.mcp).toBe(1);
    expect(calls.commands).toBe(1);
  });
});
