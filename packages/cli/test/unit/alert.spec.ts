import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { evaluateRules, loadAlertRules } from '../../src/alert/evaluate.ts';

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
          'gen_ai.usage.cache_read.input_tokens': 6,
          'gen_ai.usage.cache_creation.input_tokens': 2,
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
        turnId: 'turn-2',
        attributes: {
          'agentic.context.event_type': 'context_snapshot',
          'agentic.context.composition': '{"unknown":30,"tool_output":70}',
          'agentic.context.top_sources': '["unknown","tool_output"]',
          'agentic.context.fill_ratio': 0.79,
          'agentic.context.delta_tokens': 25000,
        },
      },
      {
        runtime: 'claude-code',
        sessionId: 's1',
        projectId: 'p1',
        category: 'context',
        turnId: 'turn-3',
        attributes: {
          'agentic.context.event_type': 'context_snapshot',
          'agentic.context.composition': '{"unknown":40,"tool_output":60}',
          'agentic.context.top_sources': '["unknown","tool_output"]',
          'agentic.context.fill_ratio': 0.74,
          'agentic.context.delta_tokens': -5000,
        },
      },
      {
        runtime: 'claude-code',
        sessionId: 's1',
        projectId: 'p1',
        category: 'context',
        turnId: 'turn-3',
        attributes: {
          'agentic.context.event_type': 'context_boundary',
          'agentic.context.boundary_kind': 'compact_after',
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
      {
        runtime: 'claude-code',
        sessionId: 's1',
        projectId: 'p1',
        category: 'context',
        turnId: 'turn-2',
        attributes: {
          'agentic.context.event_type': 'context_source_attribution',
          'agentic.context.source_kind': 'tool_output',
          'agentic.context.pollution_score': 88,
        },
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

  it('supports context unknown/pollution session metrics', () => {
    const alerts = evaluateRules(
      [
        { id: 'unknown-share', scope: 'session', metric: 'context.unknown_delta_share.window5', op: 'gt', threshold: 0.15 },
        { id: 'unknown-top-streak', scope: 'session', metric: 'context.unknown_top_streak', op: 'gte', threshold: 3 },
        { id: 'high-pollution-streak', scope: 'session', metric: 'context.high_pollution_source_streak', op: 'gte', threshold: 2 },
      ],
      sessions,
    );

    expect(alerts.map((a) => a.ruleId)).toEqual([
      'unknown-share',
      'unknown-top-streak',
      'high-pollution-streak',
    ]);
  });

  it('supports context fill/delta/compact session metrics', () => {
    const alerts = evaluateRules(
      [
        { id: 'fill-ratio-max', scope: 'session', metric: 'context.fill_ratio.max', op: 'gte', threshold: 0.8 },
        { id: 'delta-ratio-max', scope: 'session', metric: 'context.delta_ratio.max', op: 'gte', threshold: 0.1 },
        { id: 'compact-count', scope: 'session', metric: 'context.compact.count', op: 'gte', threshold: 1 },
      ],
      sessions,
    );

    expect(alerts.map((a) => a.ruleId)).toEqual([
      'fill-ratio-max',
      'delta-ratio-max',
      'compact-count',
    ]);
  });
});

describe('loadAlertRules', () => {
  it('rejects malformed rule field types without leaking raw JSON', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'spanory-alert-rules-'));
    const rulesPath = path.join(tempRoot, 'rules.json');
    const baseRule = {
      id: 'r1',
      scope: 'session',
      metric: 'usage.total',
      op: 'gt',
      threshold: 20,
    };
    const invalidRules = [
      {
        rule: { ...baseRule, id: { secret: 'TOP_SECRET_ID' } },
        expectedMessage: '"id" must be a non-empty string',
      },
      {
        rule: { ...baseRule, scope: 1 },
        expectedMessage: '"scope" must be a non-empty string',
      },
      {
        rule: { ...baseRule, metric: false },
        expectedMessage: '"metric" must be a non-empty string',
      },
      {
        rule: { ...baseRule, op: [] },
        expectedMessage: '"op" must be a non-empty string',
      },
      {
        rule: { ...baseRule, threshold: '20' },
        expectedMessage: '"threshold" must be a finite number',
      },
    ];

    try {
      for (const testCase of invalidRules) {
        await writeFile(
          rulesPath,
          JSON.stringify({
            rules: [testCase.rule],
          }),
          'utf-8',
        );

        let error;
        try {
          await loadAlertRules(rulesPath);
        } catch (caught) {
          error = caught;
        }

        expect(error).toBeInstanceOf(Error);
        expect(error.message).toContain('invalid rule at index 0');
        expect(error.message).toContain(testCase.expectedMessage);
        expect(error.message).not.toContain('TOP_SECRET_ID');
      }
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
