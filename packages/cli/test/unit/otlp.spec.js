import { describe, expect, it } from 'vitest';

import { compileOtlp, parseHeaders } from '../../src/otlp.js';

describe('otlp compiler', () => {
  it('creates parent-child spans and langfuse parity attrs', () => {
    const payload = compileOtlp(
      [
        {
          runtime: 'claude-code',
          sessionId: 's1',
          projectId: 'p1',
          turnId: 'turn-1',
          category: 'turn',
          name: 'Turn 1',
          startedAt: '2026-02-27T00:00:00.000Z',
          endedAt: '2026-02-27T00:00:01.000Z',
          input: 'hi',
          output: 'hello',
          attributes: {},
        },
        {
          runtime: 'claude-code',
          sessionId: 's1',
          projectId: 'p1',
          turnId: 'turn-1',
          category: 'shell_command',
          name: 'Tool: Bash',
          startedAt: '2026-02-27T00:00:00.500Z',
          endedAt: '2026-02-27T00:00:00.600Z',
          input: 'pwd',
          output: '/tmp',
          attributes: {},
        },
      ],
      { serviceName: 'spanory', serviceVersion: '0.1.0', environment: 'test' },
    );

    const spans = payload.resourceSpans[0].scopeSpans[0].spans;
    expect(spans).toHaveLength(2);
    expect(spans[1].parentSpanId).toBe(spans[0].spanId);

    const attrs = Object.fromEntries(spans[0].attributes.map((a) => [a.key, a.value.stringValue ?? a.value.doubleValue]));
    expect(attrs['langfuse.trace.name']).toBeTruthy();
    expect(attrs['langfuse.trace.input']).toBe('hi');
    expect(attrs['langfuse.trace.output']).toBe('hello');
    expect(attrs['langfuse.observation.type']).toBe('agent');
    expect(attrs['session.id']).toBe('s1');
  });

  it('parses header list', () => {
    expect(parseHeaders('a=1,b=2')).toEqual({ a: '1', b: '2' });
    expect(parseHeaders('')).toBeUndefined();
  });
});
