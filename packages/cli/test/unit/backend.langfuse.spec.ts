import { describe, expect, it } from 'vitest';

import { toLangfuseEvents } from '../../../backend-langfuse/src/index.ts';

describe('langfuse backend adapter', () => {
  it('fills missing observation/category attrs without changing event shape', () => {
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
    expect(mapped).toHaveLength(1);
    expect(mapped[0].attributes['agentic.event.category']).toBe('tool');
    expect(mapped[0].attributes['langfuse.observation.type']).toBe('tool');
    expect(mapped[0].name).toBe(events[0].name);
    expect(mapped[0].sessionId).toBe(events[0].sessionId);
  });
});

