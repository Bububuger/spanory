import { describe, expect, it } from 'vitest';

import { normalizeTranscriptMessages } from '../../src/runtime/shared/normalize.ts';

describe('normalizeTranscriptMessages', () => {
  it('uses tool_result timestamp as tool end time when available', () => {
    const messages = [
      {
        role: 'user',
        isMeta: false,
        content: 'run command',
        timestamp: new Date('2026-03-03T03:00:00.000Z'),
      },
      {
        role: 'assistant',
        isMeta: false,
        content: [{ type: 'tool_use', id: 'bash-1', name: 'Bash', input: { command: 'pwd' } }],
        model: 'gpt-5.3-codex',
        usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 },
        timestamp: new Date('2026-03-03T03:00:01.000Z'),
      },
      {
        role: 'user',
        isMeta: false,
        content: [{ type: 'tool_result', tool_use_id: 'bash-1', content: '/tmp' }],
        timestamp: new Date('2026-03-03T03:00:04.500Z'),
      },
      {
        role: 'assistant',
        isMeta: false,
        content: [{ type: 'text', text: 'done' }],
        model: 'gpt-5.3-codex',
        usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 },
        timestamp: new Date('2026-03-03T03:00:05.000Z'),
      },
    ];

    const events = normalizeTranscriptMessages({
      runtime: 'codex',
      projectId: 'p-codex',
      sessionId: 's-codex',
      messages,
    });

    const bash = events.find((event) => event.category === 'shell_command');
    expect(bash).toBeTruthy();
    expect(bash.startedAt).toBe('2026-03-03T03:00:01.000Z');
    expect(bash.endedAt).toBe('2026-03-03T03:00:04.500Z');
  });

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

  it('separates reasoning from final assistant output', () => {
    const messages = [
      {
        role: 'user',
        isMeta: false,
        content: '请回答',
        timestamp: new Date('2026-03-03T02:00:00.000Z'),
      },
      {
        role: 'assistant',
        isMeta: false,
        content: [
          {
            type: 'reasoning',
            text: '先分析问题，再给结论。',
            timestamp: new Date('2026-03-03T02:00:00.500Z'),
          },
          { type: 'text', text: '这是最终回复。' },
        ],
        model: 'opencode/big-pickle',
        usage: { input_tokens: 5, output_tokens: 4, total_tokens: 9 },
        timestamp: new Date('2026-03-03T02:00:01.000Z'),
      },
    ];

    const events = normalizeTranscriptMessages({
      runtime: 'opencode',
      projectId: 'p-op',
      sessionId: 's-op',
      messages,
    });

    const turn = events.find((e) => e.category === 'turn');
    const reasoning = events.find((e) => e.category === 'reasoning');
    expect(turn).toBeTruthy();
    expect(reasoning).toBeTruthy();
    expect(turn.output).toBe('这是最终回复。');
    expect(turn.output).not.toContain('先分析问题');
    expect(reasoning.output).toBe('先分析问题，再给结论。');
    expect(reasoning.startedAt).toBe('2026-03-03T02:00:00.500Z');
    expect(reasoning.attributes['langfuse.observation.type']).toBe('span');
  });

  it('emits parent-child linkage attributes when metadata is present', () => {
    const messages = [
      {
        role: 'user',
        isMeta: false,
        content: 'hello',
        timestamp: new Date('2026-03-03T05:00:00.000Z'),
      },
      {
        role: 'assistant',
        isMeta: false,
        isSidechain: true,
        agentId: 'subagent-1',
        parentSessionId: 'sess-parent',
        parentTurnId: 'turn-parent-3',
        parentToolCallId: 'call-task-xyz',
        content: [{ type: 'text', text: 'from subagent' }],
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
        timestamp: new Date('2026-03-03T05:00:01.000Z'),
      },
    ];

    const events = normalizeTranscriptMessages({
      runtime: 'claude-code',
      projectId: 'p-parent',
      sessionId: 's-child',
      messages,
    });

    for (const event of events) {
      expect(event.attributes['agentic.agent_id']).toBe('subagent-1');
      expect(event.attributes['agentic.parent.session_id']).toBe('sess-parent');
      expect(event.attributes['agentic.parent.turn_id']).toBe('turn-parent-3');
      expect(event.attributes['agentic.parent.tool_call_id']).toBe('call-task-xyz');
      expect(event.attributes['agentic.parent.link.confidence']).toBe('exact');
    }
  });

  it('extracts structured shell command attributes', () => {
    const scenarios = [
      { command: 'ls -la', expectName: 'ls', expectArgs: '-la', expectPipeCount: 0, expectRaw: 'ls -la' },
      {
        command: 'find . -name "*.ts" | xargs grep TODO | wc -l',
        expectName: 'find',
        expectArgs: '. -name "*.ts"',
        expectPipeCount: 2,
        expectRaw: 'find . -name "*.ts" | xargs grep TODO | wc -l',
      },
      { command: '', expectName: '', expectArgs: '', expectPipeCount: 0, expectRaw: '' },
      {
        command: 'npm run build && npm test',
        expectName: 'npm',
        expectArgs: 'run build && npm test',
        expectPipeCount: 0,
        expectRaw: 'npm run build && npm test',
      },
    ];

    for (let i = 0; i < scenarios.length; i += 1) {
      const scenario = scenarios[i];
      const events = normalizeTranscriptMessages({
        runtime: 'codex',
        projectId: 'p-cmd',
        sessionId: 's-cmd-' + i,
        messages: [
          {
            role: 'user',
            isMeta: false,
            content: 'run command',
            timestamp: new Date('2026-03-03T04:00:00.000Z'),
          },
          {
            role: 'assistant',
            isMeta: false,
            content: [{ type: 'tool_use', id: 'bash-1', name: 'Bash', input: { command: scenario.command } }],
            model: 'gpt-5.3-codex',
            usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 },
            timestamp: new Date('2026-03-03T04:00:01.000Z'),
          },
          {
            role: 'user',
            isMeta: false,
            content: [{ type: 'tool_result', tool_use_id: 'bash-1', content: 'ok' }],
            timestamp: new Date('2026-03-03T04:00:02.000Z'),
          },
        ],
      });

      const bash = events.find((event) => event.category === 'shell_command');
      expect(bash).toBeTruthy();
      expect(bash.attributes['process.command_line']).toBe(scenario.command);
      expect(bash.attributes['agentic.command.name']).toBe(scenario.expectName);
      expect(bash.attributes['agentic.command.args']).toBe(scenario.expectArgs);
      expect(bash.attributes['agentic.command.pipe_count']).toBe(scenario.expectPipeCount);
      expect(bash.attributes['agentic.command.raw']).toBe(scenario.expectRaw);
    }
  });

});