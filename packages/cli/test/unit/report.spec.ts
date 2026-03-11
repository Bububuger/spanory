import { describe, expect, it } from 'vitest';

import {
  summarizeCache,
  summarizeAgents,
  summarizeCommands,
  summarizeContext,
  summarizeMcp,
  summarizeSessions,
  summarizeTools,
  summarizeTurnDiff,
} from '../../src/report/aggregate.ts';

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
          'gen_ai.usage.cache_read.input_tokens': 2,
          'gen_ai.usage.cache_creation.input_tokens': 1,
          'gen_ai.usage.details.cache_hit_rate': 0.166667,
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
        name: 'Tool: Bash',
        attributes: { 'gen_ai.tool.name': 'Bash' },
      },
    ],
  };
}

function buildDiffSession() {
  return {
    context: { projectId: 'p1', sessionId: 's2' },
    events: [
      {
        runtime: 'claude-code',
        sessionId: 's2',
        projectId: 'p1',
        turnId: 'turn-1',
        category: 'turn',
        input: 'alpha',
        attributes: {
          'agentic.turn.input.hash': 'h1',
          'agentic.turn.input.prev_hash': '',
          'agentic.turn.diff.char_delta': 0,
          'agentic.turn.diff.line_delta': 0,
          'agentic.turn.diff.similarity': 1,
          'agentic.turn.diff.changed': false,
        },
      },
      {
        runtime: 'claude-code',
        sessionId: 's2',
        projectId: 'p1',
        turnId: 'turn-2',
        category: 'turn',
        input: 'alpha beta',
        attributes: {
          'agentic.turn.input.hash': 'h2',
          'agentic.turn.input.prev_hash': 'h1',
          'agentic.turn.diff.char_delta': 5,
          'agentic.turn.diff.line_delta': 0,
          'agentic.turn.diff.similarity': 0.5,
          'agentic.turn.diff.changed': true,
        },
      },
    ],
  };
}

function buildContextSession() {
  return {
    context: { projectId: 'p1', sessionId: 's3' },
    events: [
      {
        runtime: 'codex',
        sessionId: 's3',
        projectId: 'p1',
        turnId: 'turn-1',
        category: 'context',
        attributes: {
          'agentic.context.event_type': 'context_snapshot',
          'agentic.context.fill_ratio': 0.82,
          'agentic.context.delta_tokens': 22000,
          'agentic.context.composition': '{"unknown":20,"tool_output":80}',
          'agentic.context.top_sources': '["unknown","tool_output"]',
        },
      },
      {
        runtime: 'codex',
        sessionId: 's3',
        projectId: 'p1',
        turnId: 'turn-2',
        category: 'context',
        attributes: {
          'agentic.context.event_type': 'context_snapshot',
          'agentic.context.fill_ratio': 0.9,
          'agentic.context.delta_tokens': -5000,
          'agentic.context.composition': '{"unknown":15,"tool_output":85}',
          'agentic.context.top_sources': '["unknown","tool_output"]',
        },
      },
      {
        runtime: 'codex',
        sessionId: 's3',
        projectId: 'p1',
        turnId: 'turn-2',
        category: 'context',
        attributes: {
          'agentic.context.event_type': 'context_boundary',
          'agentic.context.boundary_kind': 'compact_after',
        },
      },
      {
        runtime: 'codex',
        sessionId: 's3',
        projectId: 'p1',
        turnId: 'turn-1',
        category: 'context',
        attributes: {
          'agentic.context.event_type': 'context_source_attribution',
          'agentic.context.source_kind': 'tool_output',
          'agentic.context.pollution_score': 86,
        },
      },
      {
        runtime: 'codex',
        sessionId: 's3',
        projectId: 'p1',
        turnId: 'turn-2',
        category: 'context',
        attributes: {
          'agentic.context.event_type': 'context_source_attribution',
          'agentic.context.source_kind': 'tool_output',
          'agentic.context.pollution_score': 84,
        },
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

  it('builds cache summary', () => {
    const rows = summarizeCache([buildSession()]);
    expect(rows[0].inputTokens).toBe(10);
    expect(rows[0].cacheReadInputTokens).toBe(2);
    expect(rows[0].cacheCreationInputTokens).toBe(1);
    expect(rows[0].cacheHitRate).toBeCloseTo(0.166667, 6);
  });

  it('builds tool summary', () => {
    const rows = summarizeTools([buildSession()]);
    const bash = rows.find((row) => row.category === 'shell_command' && row.tool === 'Bash');
    expect(bash).toBeTruthy();
    expect(bash.calls).toBe(1);
  });

  it('builds turn diff summary', () => {
    const rows = summarizeTurnDiff([buildDiffSession()]);
    expect(rows).toHaveLength(2);
    expect(rows[0].turnId).toBe('turn-1');
    expect(rows[1].turnId).toBe('turn-2');
    expect(rows[1].charDelta).toBe(5);
    expect(rows[1].similarity).toBe(0.5);
    expect(rows[1].changed).toBe(true);
  });

  it('builds context summary', () => {
    const rows = summarizeContext([buildContextSession()]);
    expect(rows[0].snapshots).toBe(2);
    expect(rows[0].compactCount).toBe(1);
    expect(rows[0].maxFillRatio).toBe(0.9);
    expect(rows[0].maxDeltaTokens).toBe(22000);
    expect(rows[0].unknownTopStreak).toBe(2);
    expect(rows[0].highPollutionSourceStreak).toBe(2);
  });
});
