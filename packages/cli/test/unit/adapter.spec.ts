import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { claudeCodeAdapter } from '../../src/runtime/claude/adapter.ts';

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
    expect(turn.attributes['gen_ai.usage.input_tokens']).toBe(17);
    expect(turn.attributes['gen_ai.usage.output_tokens']).toBe(8);
    expect(turn.attributes['gen_ai.usage.total_tokens']).toBe(25);
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

  it('keeps tool_result within same turn and backfills bash output from toolUseResult', async () => {
    const transcriptPath = path.resolve('test/fixtures/claude/projects/test-project/session-c.jsonl');
    const events = await claudeCodeAdapter.collectEvents({
      projectId: 'test-project',
      sessionId: 'session-c',
      transcriptPath,
    });

    const turns = events.filter((e) => e.category === 'turn');
    expect(turns).toHaveLength(1);
    expect(turns[0].input).toContain('请帮我查一下仓库状态');
    expect(turns[0].input.trim().length).toBeGreaterThan(0);
    expect(turns[0].output).toContain('当前分支 main');

    const shells = events.filter((e) => e.category === 'shell_command');
    expect(shells).toHaveLength(2);
    expect(shells[0].output).toContain('M README.md');
    expect(shells[1].output).toContain('main');
  });

  it('deduplicates assistant snapshots by message.id to avoid inflated tool counts', async () => {
    const transcriptPath = path.resolve('test/fixtures/claude/projects/test-project/session-d.jsonl');
    const events = await claudeCodeAdapter.collectEvents({
      projectId: 'test-project',
      sessionId: 'session-d',
      transcriptPath,
    });

    const turns = events.filter((e) => e.category === 'turn');
    expect(turns).toHaveLength(1);
    expect(turns[0].attributes['gen_ai.usage.input_tokens']).toBe(15);
    expect(turns[0].attributes['gen_ai.usage.output_tokens']).toBe(5);

    const shells = events.filter((e) => e.category === 'shell_command');
    expect(shells).toHaveLength(1);
    expect(shells[0].attributes['gen_ai.tool.call.id']).toBe('call-1');
    expect(shells[0].output).toContain('M README.md');
  });

  it('captures non-bash tool_use as generic tool observation', async () => {
    const transcriptPath = path.resolve('test/fixtures/claude/projects/test-project/session-e.jsonl');
    const events = await claudeCodeAdapter.collectEvents({
      projectId: 'test-project',
      sessionId: 'session-e',
      transcriptPath,
    });

    const tools = events.filter((e) => e.category === 'tool');
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('Tool: WebSearch');
    expect(tools[0].attributes['gen_ai.tool.call.id']).toBe('call-web-1');
    expect(tools[0].output).toContain('Langfuse');
  });

  it('emits runtime version and generic model name attributes', async () => {
    const transcriptPath = path.resolve('test/fixtures/claude/projects/test-project/session-g.jsonl');
    const events = await claudeCodeAdapter.collectEvents({
      projectId: 'test-project',
      sessionId: 'session-g',
      transcriptPath,
    });

    const turn = events.find((e) => e.category === 'turn');
    expect(turn).toBeTruthy();
    expect(turn.attributes['agentic.runtime.version']).toBe('2.1.63');
    expect(turn.attributes['gen_ai.request.model']).toBe('claude-sonnet-4-6');
    expect(turn.attributes['langfuse.observation.model.name']).toBe('claude-sonnet-4-6');

    const bash = events.find((e) => e.category === 'shell_command');
    expect(bash).toBeTruthy();
    expect(bash.attributes['agentic.runtime.version']).toBe('2.1.63');
    expect(bash.attributes['gen_ai.request.model']).toBe('claude-sonnet-4-6');
    expect(bash.attributes['langfuse.observation.model.name']).toBe('claude-sonnet-4-6');
  });

  it('maps sidechain hints and marks turn actor as unknown', async () => {
    const transcriptPath = path.resolve('test/fixtures/claude/projects/test-project/session-h.jsonl');
    const events = await claudeCodeAdapter.collectEvents({
      projectId: 'test-project',
      sessionId: 'session-h',
      transcriptPath,
    });

    const turn = events.find((e) => e.category === 'turn');
    expect(turn).toBeTruthy();
    expect(turn.attributes['agentic.actor.role']).toBe('unknown');
    expect(turn.attributes['agentic.actor.role_confidence']).toBe(0.6);
    expect(turn.attributes['agentic.runtime.version']).toBe('2.1.70');
  });
});

describe('claudeCodeAdapter parent-child linkage inference', () => {
  it('infers parent linkage for a single sidechain child session', async () => {
    const transcriptPath = path.resolve('test/fixtures/claude/projects/test-project/session-child-single.jsonl');
    const events = await claudeCodeAdapter.collectEvents({
      projectId: 'test-project',
      sessionId: 'session-child-single',
      transcriptPath,
    });

    const turn = events.find((e) => e.category === 'turn');
    expect(turn).toBeTruthy();
    expect(turn.attributes['agentic.agent_id']).toBe('subagent-single');
    expect(turn.attributes['agentic.parent.session_id']).toBe('session-parent-single');
    expect(turn.attributes['agentic.parent.turn_id']).toBe('turn-1');
    expect(turn.attributes['agentic.parent.tool_call_id']).toBe('task-single-1');
    expect(turn.attributes['agentic.parent.link.confidence']).toBe('inferred');
  });

  it('infers the nearest parent task window for concurrent subagents', async () => {
    const childAPath = path.resolve('test/fixtures/claude/projects/test-project/session-child-concurrent-a.jsonl');
    const childBPath = path.resolve('test/fixtures/claude/projects/test-project/session-child-concurrent-b.jsonl');

    const eventsA = await claudeCodeAdapter.collectEvents({
      projectId: 'test-project',
      sessionId: 'session-child-concurrent-a',
      transcriptPath: childAPath,
    });
    const eventsB = await claudeCodeAdapter.collectEvents({
      projectId: 'test-project',
      sessionId: 'session-child-concurrent-b',
      transcriptPath: childBPath,
    });

    const turnA = eventsA.find((e) => e.category === 'turn');
    const turnB = eventsB.find((e) => e.category === 'turn');

    expect(turnA.attributes['agentic.parent.session_id']).toBe('session-parent-concurrent');
    expect(turnA.attributes['agentic.parent.turn_id']).toBe('turn-1');
    expect(turnA.attributes['agentic.parent.tool_call_id']).toBe('task-con-a');
    expect(turnA.attributes['agentic.parent.link.confidence']).toBe('inferred');

    expect(turnB.attributes['agentic.parent.session_id']).toBe('session-parent-concurrent');
    expect(turnB.attributes['agentic.parent.turn_id']).toBe('turn-2');
    expect(turnB.attributes['agentic.parent.tool_call_id']).toBe('task-con-b');
    expect(turnB.attributes['agentic.parent.link.confidence']).toBe('inferred');
  });

  it('keeps parent linkage empty when no candidate task window exists', async () => {
    const transcriptPath = path.resolve('test/fixtures/claude/projects/test-project/session-child-nomatch.jsonl');
    const events = await claudeCodeAdapter.collectEvents({
      projectId: 'test-project',
      sessionId: 'session-child-nomatch',
      transcriptPath,
    });

    const turn = events.find((e) => e.category === 'turn');
    expect(turn).toBeTruthy();
    expect(turn.attributes['agentic.agent_id']).toBe('subagent-nomatch');
    expect(turn.attributes['agentic.parent.session_id']).toBeUndefined();
    expect(turn.attributes['agentic.parent.turn_id']).toBeUndefined();
    expect(turn.attributes['agentic.parent.tool_call_id']).toBeUndefined();
    expect(turn.attributes['agentic.parent.link.confidence']).toBe('unknown');
  });
});

it('prefers exact parent metadata when present and does not override with inferred linkage', async () => {
  const transcriptPath = path.resolve('test/fixtures/claude/projects/test-project/session-child-explicit.jsonl');
  const events = await claudeCodeAdapter.collectEvents({
    projectId: 'test-project',
    sessionId: 'session-child-explicit',
    transcriptPath,
  });

  const turn = events.find((e) => e.category === 'turn');
  expect(turn).toBeTruthy();
  expect(turn.attributes['agentic.agent_id']).toBe('subagent-explicit');
  expect(turn.attributes['agentic.parent.session_id']).toBe('session-parent-explicit');
  expect(turn.attributes['agentic.parent.turn_id']).toBe('turn-77');
  expect(turn.attributes['agentic.parent.tool_call_id']).toBe('task-explicit-1');
  expect(turn.attributes['agentic.parent.link.confidence']).toBe('exact');
});
