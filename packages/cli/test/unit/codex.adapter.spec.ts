import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';

import { describe, expect, it } from 'vitest';

import { codexAdapter } from '../../src/runtime/codex/adapter.ts';

describe('codexAdapter', () => {
  it('parses codex session into rich categories with usage/model/runtime attrs', async () => {
    const transcriptPath = path.resolve('test/fixtures/codex/sessions/session-a.jsonl');
    const events = await codexAdapter.collectEvents({
      projectId: 'codex-test',
      sessionId: 'session-a',
      transcriptPath,
    });

    const categories = new Set(events.map((e) => e.category));
    expect(categories.has('turn')).toBe(true);
    expect(categories.has('shell_command')).toBe(true);
    expect(categories.has('mcp')).toBe(true);
    expect(categories.has('agent_task')).toBe(true);
    expect(categories.has('tool')).toBe(true);
    expect(categories.has('agent_command')).toBe(true);

    const turn1 = events.find((e) => e.category === 'turn' && e.turnId === 'turn-codex-1');
    expect(turn1).toBeTruthy();
    expect(turn1.attributes['langfuse.observation.model.name']).toBe('gpt-5.3-codex');
    expect(turn1.attributes['agentic.runtime.version']).toBe('0.107.0-alpha.5');
    expect(turn1.attributes['gen_ai.usage.input_tokens']).toBe(20);
    expect(turn1.attributes['gen_ai.usage.output_tokens']).toBe(10);
    expect(turn1.attributes['gen_ai.usage.total_tokens']).toBe(30);
    expect(turn1.attributes['agentic.project.cwd']).toBe('demo-3278db');

    const bash = events.find((e) => e.category === 'shell_command');
    expect(bash).toBeTruthy();
    expect(bash.attributes['gen_ai.tool.name']).toBe('Bash');
    expect(bash.output).toContain('/Users/me/workspace/demo');

    const mcp = events.find((e) => e.category === 'mcp');
    expect(mcp).toBeTruthy();
    expect(mcp.attributes['agentic.mcp.server.name']).toBe('playwright');

    const agentTask = events.find((e) => e.category === 'agent_task');
    expect(agentTask).toBeTruthy();
    expect(agentTask.attributes['gen_ai.tool.name']).toBe('Task');
  });

  it('derives project id from cwd when projectId is empty', async () => {
    const transcriptPath = path.resolve('test/fixtures/codex/sessions/session-a.jsonl');
    const events = await codexAdapter.collectEvents({
      projectId: '',
      sessionId: 'session-a',
      transcriptPath,
    });

    const turn = events.find((e) => e.category === 'turn');
    expect(turn).toBeTruthy();
    expect(turn.projectId.startsWith('demo-')).toBe(true);
  });

  it('resolves context from codex notify payload (thread_id + cwd)', () => {
    const ctx = codexAdapter.resolveContextFromHook({
      sessionId: 'session-a',
      turnId: 'turn-codex-2',
      cwd: '/Users/me/workspace/demo',
    });

    expect(ctx).toEqual({
      projectId: expect.stringMatching(/^demo-[a-f0-9]{6}$/),
      sessionId: 'session-a',
    });
  });

  it('marks turn completion state for finished and in-progress turns', async () => {
    const completedTranscriptPath = path.resolve('test/fixtures/codex/sessions/session-a.jsonl');
    const completedEvents = await codexAdapter.collectEvents({
      projectId: 'codex-test',
      sessionId: 'session-a',
      transcriptPath: completedTranscriptPath,
    });
    const completedTurn = completedEvents.find((event) => event.category === 'turn' && event.turnId === 'turn-codex-1');
    expect(completedTurn).toBeTruthy();
    expect(completedTurn.attributes['agentic.turn.completed']).toBe(true);

    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'spanory-codex-open-turn-'));
    try {
      const openTranscriptPath = path.join(tempRoot, 'session-open.jsonl');
      await writeFile(
        openTranscriptPath,
        `${JSON.stringify({
          timestamp: '2026-03-04T14:30:00.000Z',
          type: 'session_meta',
          payload: {
            id: 'session-open',
            timestamp: '2026-03-04T14:30:00.000Z',
            cwd: '/Users/me/workspace/demo',
            cli_version: '0.110.0',
          },
        })}\n${JSON.stringify({
          timestamp: '2026-03-04T14:30:01.000Z',
          type: 'event_msg',
          payload: { type: 'task_started', turn_id: 'turn-open-1' },
        })}\n${JSON.stringify({
          timestamp: '2026-03-04T14:30:02.000Z',
          type: 'event_msg',
          payload: { type: 'user_message', message: 'run ls' },
        })}\n`,
        'utf-8',
      );

      const openEvents = await codexAdapter.collectEvents({
        projectId: 'codex-test',
        sessionId: 'session-open',
        transcriptPath: openTranscriptPath,
      });
      const openTurn = openEvents.find((event) => event.category === 'turn');
      expect(openTurn).toBeTruthy();
      expect(openTurn.attributes['agentic.turn.completed']).toBe(false);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('extends PTY bash duration across exec_command and write_stdin polls', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'spanory-codex-pty-turn-'));
    try {
      const transcriptPath = path.join(tempRoot, 'session-pty.jsonl');
      await writeFile(
        transcriptPath,
        `${JSON.stringify({
          timestamp: '2026-03-07T01:00:00.000Z',
          type: 'session_meta',
          payload: {
            id: 'session-pty',
            timestamp: '2026-03-07T01:00:00.000Z',
            cwd: '/Users/me/workspace/demo',
            cli_version: '0.110.0',
          },
        })}\n${JSON.stringify({
          timestamp: '2026-03-07T01:00:00.100Z',
          type: 'event_msg',
          payload: { type: 'task_started', turn_id: 'turn-pty-1' },
        })}\n${JSON.stringify({
          timestamp: '2026-03-07T01:00:00.200Z',
          type: 'event_msg',
          payload: { type: 'user_message', message: 'run a long command' },
        })}\n${JSON.stringify({
          timestamp: '2026-03-07T01:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'function_call',
            name: 'exec_command',
            arguments: '{"cmd":"sleep 5 && echo done"}',
            call_id: 'call-exec-1',
          },
        })}\n${JSON.stringify({
          timestamp: '2026-03-07T01:00:01.001Z',
          type: 'response_item',
          payload: {
            type: 'function_call_output',
            call_id: 'call-exec-1',
            output: 'Process running with session ID 3279\\nOutput:\\n',
          },
        })}\n${JSON.stringify({
          timestamp: '2026-03-07T01:00:03.000Z',
          type: 'response_item',
          payload: {
            type: 'function_call',
            name: 'write_stdin',
            arguments: '{"session_id":3279,"chars":""}',
            call_id: 'call-poll-1',
          },
        })}\n${JSON.stringify({
          timestamp: '2026-03-07T01:00:03.050Z',
          type: 'response_item',
          payload: {
            type: 'function_call_output',
            call_id: 'call-poll-1',
            output: 'still running\\n',
          },
        })}\n${JSON.stringify({
          timestamp: '2026-03-07T01:00:06.000Z',
          type: 'response_item',
          payload: {
            type: 'function_call',
            name: 'write_stdin',
            arguments: '{"session_id":3279,"chars":""}',
            call_id: 'call-poll-2',
          },
        })}\n${JSON.stringify({
          timestamp: '2026-03-07T01:00:06.100Z',
          type: 'response_item',
          payload: {
            type: 'function_call_output',
            call_id: 'call-poll-2',
            output: 'done\\n',
          },
        })}\n${JSON.stringify({
          timestamp: '2026-03-07T01:00:06.300Z',
          type: 'event_msg',
          payload: { type: 'task_complete', turn_id: 'turn-pty-1', last_agent_message: 'done' },
        })}\n`,
        'utf-8',
      );

      const events = await codexAdapter.collectEvents({
        projectId: 'codex-test',
        sessionId: 'session-pty',
        transcriptPath,
      });

      const bashEvents = events.filter((event) => event.category === 'shell_command');
      expect(bashEvents).toHaveLength(1);
      expect(bashEvents[0].input).toBe('sleep 5 && echo done');
      expect(bashEvents[0].startedAt).toBe('2026-03-07T01:00:01.000Z');
      expect(bashEvents[0].endedAt).toBe('2026-03-07T01:00:06.100Z');
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('derives bash duration from tool output wall time when transcript timestamps are too close', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'spanory-codex-wall-time-'));
    try {
      const transcriptPath = path.join(tempRoot, 'session-wall-time.jsonl');
      await writeFile(
        transcriptPath,
        `${JSON.stringify({
          timestamp: '2026-03-07T02:00:00.000Z',
          type: 'session_meta',
          payload: {
            id: 'session-wall-time',
            timestamp: '2026-03-07T02:00:00.000Z',
            cwd: '/Users/me/workspace/demo',
            cli_version: '0.110.0',
          },
        })}\n${JSON.stringify({
          timestamp: '2026-03-07T02:00:00.100Z',
          type: 'event_msg',
          payload: { type: 'task_started', turn_id: 'turn-wall-time-1' },
        })}\n${JSON.stringify({
          timestamp: '2026-03-07T02:00:00.200Z',
          type: 'event_msg',
          payload: { type: 'user_message', message: 'pwd' },
        })}\n${JSON.stringify({
          timestamp: '2026-03-07T02:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'function_call',
            name: 'exec_command',
            arguments: '{"cmd":"pwd"}',
            call_id: 'call-wall-time-1',
          },
        })}\n${JSON.stringify({
          timestamp: '2026-03-07T02:00:01.001Z',
          type: 'response_item',
          payload: {
            type: 'function_call_output',
            call_id: 'call-wall-time-1',
            output: 'Chunk ID: abc123\\nWall time: 0.4213 seconds\\nProcess exited with code 0\\nOutput:\\n/Users/me/workspace/demo\\n',
          },
        })}\n${JSON.stringify({
          timestamp: '2026-03-07T02:00:01.200Z',
          type: 'event_msg',
          payload: { type: 'task_complete', turn_id: 'turn-wall-time-1', last_agent_message: 'done' },
        })}\n`,
        'utf-8',
      );

      const events = await codexAdapter.collectEvents({
        projectId: 'codex-test',
        sessionId: 'session-wall-time',
        transcriptPath,
      });

      const bashEvent = events.find((event) => event.category === 'shell_command');
      expect(bashEvent).toBeTruthy();
      expect(bashEvent.startedAt).toBe('2026-03-07T02:00:01.000Z');
      expect(bashEvent.endedAt).toBe('2026-03-07T02:00:01.421Z');
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
