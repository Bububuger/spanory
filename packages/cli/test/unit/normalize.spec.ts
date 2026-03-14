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

  it('reuses previous turn token set when computing similarity across turns', () => {
    const OriginalSet = globalThis.Set;
    let setConstructionCount = 0;

    class CountingSet<T> extends OriginalSet<T> {
      constructor(iterable?: Iterable<T> | null) {
        super(iterable ?? undefined);
        setConstructionCount += 1;
      }
    }

    try {
      globalThis.Set = CountingSet as unknown as SetConstructor;

      normalizeTranscriptMessages({
        runtime: 'benchmark-runtime',
        projectId: 'p-cache',
        sessionId: 's-cache',
        messages: [
          {
            role: 'user',
            isMeta: false,
            content: 'alpha',
            timestamp: new Date('2026-03-14T07:00:00.000Z'),
          },
          {
            role: 'assistant',
            isMeta: false,
            content: [{ type: 'text', text: 'ok-1' }],
            model: 'gpt-5.3-codex',
            usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
            timestamp: new Date('2026-03-14T07:00:01.000Z'),
          },
          {
            role: 'user',
            isMeta: false,
            content: 'alpha beta',
            timestamp: new Date('2026-03-14T07:00:02.000Z'),
          },
          {
            role: 'assistant',
            isMeta: false,
            content: [{ type: 'text', text: 'ok-2' }],
            model: 'gpt-5.3-codex',
            usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
            timestamp: new Date('2026-03-14T07:00:03.000Z'),
          },
          {
            role: 'user',
            isMeta: false,
            content: 'alpha beta gamma',
            timestamp: new Date('2026-03-14T07:00:04.000Z'),
          },
          {
            role: 'assistant',
            isMeta: false,
            content: [{ type: 'text', text: 'ok-3' }],
            model: 'gpt-5.3-codex',
            usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
            timestamp: new Date('2026-03-14T07:00:05.000Z'),
          },
        ],
      });
    } finally {
      globalThis.Set = OriginalSet;
    }

    // 3 user turns -> only build one token set per turn after caching.
    expect(setConstructionCount).toBe(3);
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
      expect(event.attributes['gen_ai.agent.id']).toBe('subagent-1');
      expect(event.attributes['agentic.parent.session_id']).toBe('sess-parent');
      expect(event.attributes['agentic.parent.turn_id']).toBe('turn-parent-3');
      expect(event.attributes['agentic.parent.tool_call_id']).toBe('call-task-xyz');
      expect(event.attributes['agentic.parent.link.confidence']).toBe('exact');
    }
  });

  it('extracts structured shell command attributes', () => {
    const scenarios = [
      { command: 'ls -la', expectName: 'ls', expectArgs: '-la', expectPipeCount: 0 },
      {
        command: 'find . -name "*.ts" | xargs grep TODO | wc -l',
        expectName: 'find',
        expectArgs: '. -name "*.ts"',
        expectPipeCount: 2,
      },
      { command: '', expectName: '', expectArgs: '', expectPipeCount: 0 },
      {
        command: 'npm run build && npm test',
        expectName: 'npm',
        expectArgs: 'run build && npm test',
        expectPipeCount: 0,
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
    }
  });

  it('redacts file tool content before export', () => {
    const events = normalizeTranscriptMessages({
      runtime: 'claude-code',
      projectId: 'p-redact',
      sessionId: 's-redact',
      messages: [
        {
          role: 'user',
          isMeta: false,
          content: '请写入文件',
          timestamp: new Date('2026-03-10T00:00:00.000Z'),
        },
        {
          role: 'assistant',
          isMeta: false,
          content: [
            {
              type: 'tool_use',
              id: 'write-1',
              name: 'Write',
              input: {
                file_path: '/tmp/.env',
                content: 'OPENAI_API_KEY=sk-live-123',
                token: 'inline-secret-token',
              },
            },
          ],
          model: 'claude-sonnet-4-6',
          usage: { input_tokens: 20, output_tokens: 6, total_tokens: 26 },
          timestamp: new Date('2026-03-10T00:00:01.000Z'),
        },
        {
          role: 'user',
          isMeta: false,
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'write-1',
              content: 'OPENAI_API_KEY=sk-live-123\nPRIVATE_KEY=should-not-leak',
            },
          ],
          timestamp: new Date('2026-03-10T00:00:02.000Z'),
        },
      ],
    });

    const write = events.find((event) => event.category === 'tool' && event.attributes['gen_ai.tool.name'] === 'Write');
    expect(write).toBeTruthy();
    expect(write.input).not.toContain('sk-live-123');
    expect(write.input).toContain('[REDACTED]');
    expect(write.output).toBe('[REDACTED]');
  });

  it('truncates non-file tool payloads to configured max bytes', () => {
    const previous = process.env.SPANORY_TOOL_CONTENT_MAX_BYTES;
    process.env.SPANORY_TOOL_CONTENT_MAX_BYTES = '48';

    try {
      const events = normalizeTranscriptMessages({
        runtime: 'claude-code',
        projectId: 'p-truncate',
        sessionId: 's-truncate',
        messages: [
          {
            role: 'user',
            isMeta: false,
            content: '执行搜索',
            timestamp: new Date('2026-03-10T01:00:00.000Z'),
          },
          {
            role: 'assistant',
            isMeta: false,
            content: [
              {
                type: 'tool_use',
                id: 'web-1',
                name: 'WebSearch',
                input: {
                  query: 'x'.repeat(300),
                },
              },
            ],
            model: 'claude-sonnet-4-6',
            usage: { input_tokens: 20, output_tokens: 6, total_tokens: 26 },
            timestamp: new Date('2026-03-10T01:00:01.000Z'),
          },
          {
            role: 'user',
            isMeta: false,
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'web-1',
                content: 'y'.repeat(300),
              },
            ],
            timestamp: new Date('2026-03-10T01:00:02.000Z'),
          },
        ],
      });

      const web = events.find(
        (event) => event.category === 'tool' && event.attributes['gen_ai.tool.name'] === 'WebSearch',
      );
      expect(web).toBeTruthy();
      expect(web.input).toContain('"__truncated__":true');
      expect(web.output).toContain('...[truncated]');
    } finally {
      if (previous === undefined) {
        delete process.env.SPANORY_TOOL_CONTENT_MAX_BYTES;
      } else {
        process.env.SPANORY_TOOL_CONTENT_MAX_BYTES = previous;
      }
    }
  });

  it('emits context snapshot, boundary, and source attribution events for enabled runtimes', () => {
    const runtimes = ['claude-code', 'codex', 'openclaw', 'opencode'];

    for (const runtime of runtimes) {
      const events = normalizeTranscriptMessages({
        runtime,
        projectId: 'p-context',
        sessionId: `s-context-${runtime}`,
        messages: [
          {
            role: 'user',
            isMeta: false,
            content: '请读取 /tmp/CLAUDE.md 并总结',
            timestamp: new Date('2026-03-09T00:00:00.000Z'),
          },
          {
            role: 'assistant',
            isMeta: false,
            content: [
              { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: '/tmp/CLAUDE.md' } },
              { type: 'text', text: '已读取。' },
            ],
            model: 'claude-sonnet-4-6',
            usage: { input_tokens: 120, output_tokens: 20, total_tokens: 140 },
            timestamp: new Date('2026-03-09T00:00:01.000Z'),
          },
          {
            role: 'user',
            isMeta: false,
            content: [{ type: 'tool_result', tool_use_id: 'read-1', content: 'file-content' }],
            timestamp: new Date('2026-03-09T00:00:02.000Z'),
          },
          {
            role: 'user',
            isMeta: false,
            content: '/compact 请压缩上下文',
            timestamp: new Date('2026-03-09T00:00:03.000Z'),
          },
          {
            role: 'assistant',
            isMeta: false,
            content: [{ type: 'text', text: '已压缩。' }],
            model: 'claude-sonnet-4-6',
            usage: { input_tokens: 40, output_tokens: 10, total_tokens: 50 },
            timestamp: new Date('2026-03-09T00:00:04.000Z'),
          },
        ],
      });

      const contextEvents = events.filter((event) => event.category === 'context');
      expect(contextEvents.length).toBeGreaterThan(0);
      expect(contextEvents.every((event) => event.attributes['agentic.event.category'] === 'context')).toBe(true);

      const snapshots = contextEvents.filter(
        (event) => event.attributes['agentic.context.event_type'] === 'context_snapshot',
      );
      expect(snapshots).toHaveLength(2);

      const firstSnapshot = snapshots[0];
      const firstComposition = JSON.parse(String(firstSnapshot.attributes['agentic.context.composition'] ?? '{}'));
      const firstTopSources = JSON.parse(String(firstSnapshot.attributes['agentic.context.top_sources'] ?? '[]'));
      expect(firstSnapshot.attributes['agentic.context.estimated_total_tokens']).toBe(120);
      expect(firstSnapshot.attributes['agentic.context.delta_tokens']).toBe(0);
      expect(firstSnapshot.attributes['agentic.context.fill_ratio']).toBeCloseTo(0.0006, 6);
      expect(firstSnapshot.attributes['agentic.context.estimation_method']).toBe('usage');
      expect(firstSnapshot.attributes['agentic.context.estimation_confidence']).toBe(1);
      expect(firstComposition.claude_md).toBeGreaterThan(0);
      expect(Array.isArray(firstTopSources)).toBe(true);

      const secondSnapshot = snapshots[1];
      expect(secondSnapshot.attributes['agentic.context.estimated_total_tokens']).toBe(40);
      expect(secondSnapshot.attributes['agentic.context.delta_tokens']).toBe(-80);

      const boundaries = contextEvents.filter(
        (event) => event.attributes['agentic.context.event_type'] === 'context_boundary',
      );
      const boundaryKinds = boundaries.map((event) => event.attributes['agentic.context.boundary_kind']);
      expect(boundaryKinds).toContain('compact_before');
      expect(boundaryKinds).toContain('compact_after');
      const compactBefore = boundaries.find(
        (event) => event.attributes['agentic.context.boundary_kind'] === 'compact_before',
      );
      const compactAfter = boundaries.find(
        (event) => event.attributes['agentic.context.boundary_kind'] === 'compact_after',
      );
      expect(compactBefore?.attributes['agentic.context.detection_method']).toBe('hook');
      expect(compactAfter?.attributes['agentic.context.detection_method']).toBe('inferred');

      const attributions = contextEvents.filter(
        (event) => event.attributes['agentic.context.event_type'] === 'context_source_attribution',
      );
      expect(attributions.length).toBeGreaterThan(0);
      const attribution = attributions[0];
      expect(String(attribution.attributes['agentic.context.source_kind']).length).toBeGreaterThan(0);
      expect(String(attribution.attributes['agentic.context.source_name']).length).toBeGreaterThan(0);
      expect(Number(attribution.attributes['agentic.context.token_delta'])).toBeGreaterThan(0);
      expect(Number(attribution.attributes['agentic.context.source_share'])).toBeGreaterThan(0);
      expect(Number(attribution.attributes['agentic.context.repeat_count_recent'])).toBeGreaterThanOrEqual(1);
      expect(Number(attribution.attributes['agentic.context.pollution_score'])).toBeGreaterThanOrEqual(0);
      expect(Number(attribution.attributes['agentic.context.pollution_score'])).toBeLessThanOrEqual(100);
      expect(attribution.attributes['agentic.context.score_version']).toBe('pollution_score_v1');
    }
  });

  it('uses calibrated estimation when usage anchors already exist in session', () => {
    const events = normalizeTranscriptMessages({
      runtime: 'codex',
      projectId: 'p-calibrated',
      sessionId: 's-calibrated',
      messages: [
        {
          role: 'user',
          isMeta: false,
          content: 'turn1',
          timestamp: new Date('2026-03-09T01:00:00.000Z'),
        },
        {
          role: 'assistant',
          isMeta: false,
          content: [{ type: 'text', text: 'ack-1' }],
          usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 },
          timestamp: new Date('2026-03-09T01:00:01.000Z'),
        },
        {
          role: 'user',
          isMeta: false,
          content: 'turn2',
          timestamp: new Date('2026-03-09T01:00:02.000Z'),
        },
        {
          role: 'assistant',
          isMeta: false,
          content: [{ type: 'text', text: 'ack-2' }],
          usage: { input_tokens: 90, output_tokens: 10, total_tokens: 100 },
          timestamp: new Date('2026-03-09T01:00:03.000Z'),
        },
        {
          role: 'user',
          isMeta: false,
          content: 'turn3',
          timestamp: new Date('2026-03-09T01:00:04.000Z'),
        },
        {
          role: 'assistant',
          isMeta: false,
          content: [{ type: 'text', text: 'no usage in this turn but should be calibrated' }],
          timestamp: new Date('2026-03-09T01:00:05.000Z'),
        },
      ],
    });

    const snapshots = events.filter(
      (event) => event.category === 'context' && event.attributes['agentic.context.event_type'] === 'context_snapshot',
    );
    expect(snapshots).toHaveLength(3);
    expect(snapshots[0].attributes['agentic.context.estimation_method']).toBe('usage');
    expect(snapshots[1].attributes['agentic.context.estimation_method']).toBe('usage');
    expect(snapshots[2].attributes['agentic.context.estimation_method']).toBe('calibrated');
    expect(Number(snapshots[2].attributes['agentic.context.estimation_confidence'])).toBeGreaterThanOrEqual(0.7);
  });

  it('does not emit compact_after boundary for minor token drops', () => {
    const events = normalizeTranscriptMessages({
      runtime: 'codex',
      projectId: 'p-compact-threshold',
      sessionId: 's-compact-threshold',
      messages: [
        {
          role: 'user',
          isMeta: false,
          content: 'turn1',
          timestamp: new Date('2026-03-09T02:00:00.000Z'),
        },
        {
          role: 'assistant',
          isMeta: false,
          content: [{ type: 'text', text: 'a' }],
          usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 },
          timestamp: new Date('2026-03-09T02:00:01.000Z'),
        },
        {
          role: 'user',
          isMeta: false,
          content: 'turn2',
          timestamp: new Date('2026-03-09T02:00:02.000Z'),
        },
        {
          role: 'assistant',
          isMeta: false,
          content: [{ type: 'text', text: 'b' }],
          usage: { input_tokens: 80, output_tokens: 10, total_tokens: 90 },
          timestamp: new Date('2026-03-09T02:00:03.000Z'),
        },
      ],
    });

    const compactAfter = events.filter(
      (event) =>
        event.category === 'context' &&
        event.attributes['agentic.context.event_type'] === 'context_boundary' &&
        event.attributes['agentic.context.boundary_kind'] === 'compact_after',
    );
    expect(compactAfter).toHaveLength(0);
  });
});
