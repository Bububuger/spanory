import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { openclawAdapter } from '../../src/runtime/openclaw/adapter.ts';

describe('openclawAdapter', () => {
  it('parses transcript into rich events with usage and tool categories', async () => {
    const transcriptPath = path.resolve('test/fixtures/openclaw/projects/test-project/session-a.jsonl');
    const events = await openclawAdapter.collectEvents({
      projectId: 'test-project',
      sessionId: 'session-a',
      transcriptPath,
    });

    const categories = new Set(events.map((e) => e.category));
    expect(categories.has('turn')).toBe(true);
    expect(categories.has('mcp')).toBe(true);
    expect(categories.has('shell_command')).toBe(true);
    expect(categories.has('agent_task')).toBe(true);
    expect(categories.has('tool')).toBe(true);

    const turn = events.find((e) => e.category === 'turn');
    expect(turn).toBeTruthy();
    expect(turn.attributes['langfuse.observation.model.name']).toBe('openclaw-pro');
    expect(turn.attributes['gen_ai.usage.input_tokens']).toBe(17);
    expect(turn.attributes['gen_ai.usage.output_tokens']).toBe(8);
    expect(turn.attributes['gen_ai.usage.total_tokens']).toBe(25);
  });

  it('resolves context from hook payload using .openclaw path marker', () => {
    const ctx = openclawAdapter.resolveContextFromHook({
      sessionId: 'abc',
      transcriptPath: '/Users/me/.openclaw/projects/test-project/abc.jsonl',
    });

    expect(ctx).toEqual({
      projectId: 'test-project',
      sessionId: 'abc',
      transcriptPath: '/Users/me/.openclaw/projects/test-project/abc.jsonl',
    });
  });

  it('resolves context from hook payload using .openclaw agents path marker', () => {
    const ctx = openclawAdapter.resolveContextFromHook({
      sessionId: 'abc',
      transcriptPath: '/Users/me/.openclaw/agents/main/sessions/abc.jsonl',
    });

    expect(ctx).toEqual({
      projectId: 'main',
      sessionId: 'abc',
      transcriptPath: '/Users/me/.openclaw/agents/main/sessions/abc.jsonl',
    });
  });

  it('deduplicates assistant snapshots by message id and keeps fallback toolUseResult output', async () => {
    const transcriptPath = path.resolve('test/fixtures/openclaw/projects/test-project/session-b.jsonl');
    const events = await openclawAdapter.collectEvents({
      projectId: 'test-project',
      sessionId: 'session-b',
      transcriptPath,
    });

    const shells = events.filter((e) => e.category === 'shell_command');
    expect(shells).toHaveLength(1);
    expect(shells[0].attributes['gen_ai.tool.call.id']).toBe('oc-call-1');
    expect(shells[0].output).toContain('README.md');

    const turns = events.filter((e) => e.category === 'turn');
    expect(turns).toHaveLength(1);
    expect(turns[0].attributes['gen_ai.usage.input_tokens']).toBe(9);
    expect(turns[0].attributes['gen_ai.usage.output_tokens']).toBe(3);
  });

  it('parses real openclaw message/toolCall/toolResult transcript shape', async () => {
    const transcriptPath = path.resolve('test/fixtures/openclaw/projects/test-project/session-real.jsonl');
    const events = await openclawAdapter.collectEvents({
      projectId: 'test-project',
      sessionId: 'session-real',
      transcriptPath,
    });

    const turns = events.filter((e) => e.category === 'turn');
    expect(turns).toHaveLength(1);
    expect(turns[0].attributes['langfuse.observation.model.name']).toBe('openclaw-pro');
    expect(turns[0].attributes['agentic.runtime.version']).toBe('3');
    expect(turns[0].attributes['gen_ai.usage.input_tokens']).toBe(15);
    expect(turns[0].attributes['gen_ai.usage.output_tokens']).toBe(6);
    expect(turns[0].attributes['gen_ai.usage.total_tokens']).toBe(24);

    const shells = events.filter((e) => e.category === 'shell_command');
    expect(shells).toHaveLength(1);
    expect(shells[0].output).toContain('README.md');

    const tools = events.filter((e) => e.category === 'tool');
    expect(tools).toHaveLength(1);
    expect(tools[0].attributes['gen_ai.tool.name']).toBe('WebSearch');
  });

  it('maps sidechain hints and marks turn actor as unknown', async () => {
    const transcriptPath = path.resolve('test/fixtures/openclaw/projects/test-project/session-sidechain.jsonl');
    const events = await openclawAdapter.collectEvents({
      projectId: 'test-project',
      sessionId: 'session-sidechain',
      transcriptPath,
    });

    const turn = events.find((e) => e.category === 'turn');
    expect(turn).toBeTruthy();
    expect(turn.attributes['agentic.actor.role']).toBe('unknown');
    expect(turn.attributes['agentic.actor.role_confidence']).toBe(0.6);
  });

  it('strips gateway metadata wrapper from input and keeps metadata in attributes', async () => {
    const transcriptPath = path.resolve('test/fixtures/openclaw/projects/test-project/session-metadata.jsonl');
    const events = await openclawAdapter.collectEvents({
      projectId: 'test-project',
      sessionId: 'session-metadata',
      transcriptPath,
    });

    const turns = events.filter((e) => e.category === 'turn');
    expect(turns).toHaveLength(1);
    expect(turns[0].input).toBe('[Tue 2026-03-03 04:29 GMT+8] 真实用户输入文本');
    expect(turns[0].attributes['agentic.input.message_id']).toBe('bdb36354-f616-480e-999f-eac0adff9729');
    expect(turns[0].attributes['agentic.input.sender']).toBe('gateway-client');
    expect(turns[0].attributes['agentic.runtime.version']).toBe('3');
  });
});

it('infers parent linkage from sibling sessions for sidechain child session', async () => {
  const transcriptPath = path.resolve('test/fixtures/openclaw/projects/test-project/session-parent-link-child.jsonl');
  const events = await openclawAdapter.collectEvents({
    projectId: 'test-project',
    sessionId: 'session-parent-link-child',
    transcriptPath,
  });

  const turn = events.find((e) => e.category === 'turn');
  expect(turn).toBeTruthy();
  expect(turn.attributes['agentic.agent_id']).toBe('oc-subagent-1');
  expect(turn.attributes['agentic.parent.session_id']).toBe('session-parent-link-parent');
  expect(turn.attributes['agentic.parent.turn_id']).toBe('turn-1');
  expect(turn.attributes['agentic.parent.tool_call_id']).toBe('oc-task-1');
  expect(turn.attributes['agentic.parent.link.confidence']).toBe('inferred');
});
