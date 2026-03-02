import { describe, expect, it } from 'vitest';

import { normalizeTranscriptMessages } from '../../src/runtime/shared/normalize.js';

describe('normalizeTranscriptMessages', () => {
  it('adds turn hash/diff/actor/subagent/cache attributes', () => {
    const messages = [
      {
        role: 'user',
        isMeta: false,
        content: 'alpha',
        timestamp: new Date('2026-03-03T00:00:00.000Z'),
      },
      {
        role: 'assistant',
        isMeta: false,
        content: [{ type: 'tool_use', id: 'task-1', name: 'Task', input: { task: 'research' } }],
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 10, cache_read_input_tokens: 5, output_tokens: 2, total_tokens: 12 },
        timestamp: new Date('2026-03-03T00:00:01.000Z'),
      },
      {
        role: 'user',
        isMeta: false,
        content: 'alpha beta\nline2',
        timestamp: new Date('2026-03-03T00:00:02.000Z'),
      },
      {
        role: 'assistant',
        isMeta: false,
        content: [{ type: 'text', text: 'ok' }],
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 8, cache_read_input_tokens: 2, output_tokens: 3, total_tokens: 11 },
        timestamp: new Date('2026-03-03T00:00:03.000Z'),
      },
    ];

    const events = normalizeTranscriptMessages({
      runtime: 'claude-code',
      projectId: 'p1',
      sessionId: 's1',
      messages,
    });

    const turns = events.filter((e) => e.category === 'turn');
    expect(turns).toHaveLength(2);

    const turn1 = turns[0];
    const turn2 = turns[1];

    expect(String(turn1.attributes['agentic.turn.input.hash']).length).toBeGreaterThan(0);
    expect(turn1.attributes['agentic.turn.input.prev_hash']).toBe('');
    expect(turn1.attributes['agentic.turn.diff.char_delta']).toBe(0);
    expect(turn1.attributes['agentic.turn.diff.line_delta']).toBe(0);
    expect(turn1.attributes['agentic.turn.diff.similarity']).toBe(1);
    expect(turn1.attributes['agentic.turn.diff.changed']).toBe(false);
    expect(turn1.attributes['agentic.actor.role']).toBe('main');
    expect(turn1.attributes['agentic.actor.role_confidence']).toBe(0.95);
    expect(turn1.attributes['agentic.subagent.calls']).toBe(1);
    expect(turn1.attributes['gen_ai.usage.details.cache_hit_rate']).toBeCloseTo(5 / 15, 6);

    expect(turn2.attributes['agentic.turn.input.prev_hash']).toBe(turn1.attributes['agentic.turn.input.hash']);
    expect(turn2.attributes['agentic.turn.diff.char_delta']).toBe(11);
    expect(turn2.attributes['agentic.turn.diff.line_delta']).toBe(1);
    expect(turn2.attributes['agentic.turn.diff.similarity']).toBeCloseTo(1 / 3, 6);
    expect(turn2.attributes['agentic.turn.diff.changed']).toBe(true);
  });

  it('marks actor role as unknown when sidechain/subagent hints exist', () => {
    const messages = [
      {
        role: 'user',
        isMeta: false,
        content: 'hello',
        timestamp: new Date('2026-03-03T01:00:00.000Z'),
      },
      {
        role: 'assistant',
        isMeta: false,
        isSidechain: true,
        agentId: 'agent-1',
        content: [{ type: 'text', text: 'from subagent' }],
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 2, output_tokens: 2, total_tokens: 4 },
        timestamp: new Date('2026-03-03T01:00:01.000Z'),
      },
    ];

    const events = normalizeTranscriptMessages({
      runtime: 'claude-code',
      projectId: 'p1',
      sessionId: 's1',
      messages,
    });

    const turn = events.find((e) => e.category === 'turn');
    expect(turn).toBeTruthy();
    expect(turn.attributes['agentic.actor.role']).toBe('unknown');
    expect(turn.attributes['agentic.actor.role_confidence']).toBe(0.6);
    expect(turn.attributes['agentic.subagent.calls']).toBe(0);
  });
});
