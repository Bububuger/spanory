import assert from 'node:assert/strict';
import test from 'node:test';

import { langfuseBackendAdapter, toLangfuseEvents } from '../dist/index.js';

test('toLangfuseEvents fills missing category and observation type attrs', () => {
  const events = [
    {
      runtime: 'openclaw',
      projectId: 'p1',
      sessionId: 's1',
      turnId: 'turn-1',
      category: 'tool',
      name: 'Tool: WebSearch',
      startedAt: '2026-03-01T00:00:00.000Z',
      endedAt: '2026-03-01T00:00:00.100Z',
      input: '{}',
      output: 'ok',
    },
  ];

  const mapped = toLangfuseEvents(events);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0].attributes['agentic.event.category'], 'tool');
  assert.equal(mapped[0].attributes['langfuse.observation.type'], 'tool');
  assert.equal(mapped[0].name, events[0].name);
  assert.equal(mapped[0].sessionId, events[0].sessionId);
});

test('langfuse backend adapter preserves prefilled attrs', () => {
  const events = [
    {
      runtime: 'codex',
      projectId: 'p2',
      sessionId: 's2',
      category: 'agent_command',
      name: 'message',
      startedAt: '2026-03-01T00:00:00.000Z',
      attributes: {
        'agentic.event.category': 'custom',
        'langfuse.observation.type': 'event',
      },
    },
  ];

  const mapped = langfuseBackendAdapter.mapEvents(events);
  assert.equal(mapped[0].attributes['agentic.event.category'], 'custom');
  assert.equal(mapped[0].attributes['langfuse.observation.type'], 'event');
});
