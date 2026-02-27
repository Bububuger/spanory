import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { claudeCodeAdapter } from '../../src/runtime/claude/adapter.js';

describe('claudeCodeAdapter', () => {
  it('parses transcript into categorized events with usage attributes', async () => {
    const transcriptPath = path.resolve('test/fixtures/claude/projects/test-project/session-a.jsonl');

    const events = await claudeCodeAdapter.collectEvents({
      projectId: 'test-project',
      sessionId: 'session-a',
      transcriptPath,
    });

    const categories = new Set(events.map((e) => e.category));
    expect(categories.has('turn')).toBe(true);
    expect(categories.has('mcp')).toBe(true);
    expect(categories.has('shell_command')).toBe(true);
    expect(categories.has('agent_task')).toBe(true);

    const turn = events.find((e) => e.category === 'turn');
    expect(turn).toBeTruthy();
    expect(turn.attributes['langfuse.observation.model.name']).toBe('claude-opus-4-6');
    expect(turn.attributes['gen_ai.usage.input_tokens']).toBe(10);
    expect(turn.attributes['gen_ai.usage.output_tokens']).toBe(5);
    expect(turn.attributes['gen_ai.usage.total_tokens']).toBe(15);
  });

  it('resolves context from hook payload and transcript path', () => {
    const ctx = claudeCodeAdapter.resolveContextFromHook({
      sessionId: 'abc',
      transcriptPath: '/Users/me/.claude/projects/test-project/abc.jsonl',
    });

    expect(ctx).toEqual({
      projectId: 'test-project',
      sessionId: 'abc',
      transcriptPath: '/Users/me/.claude/projects/test-project/abc.jsonl',
    });
  });
});
