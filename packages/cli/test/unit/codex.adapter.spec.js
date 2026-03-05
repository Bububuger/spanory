import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';

import { describe, expect, it } from 'vitest';

import { codexAdapter } from '../../src/runtime/codex/adapter.js';

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
    expect(turn1.attributes['agentic.project.cwd']).toBe('/Users/me/workspace/demo');

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
});
