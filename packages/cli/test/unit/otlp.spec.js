import { describe, expect, it } from 'vitest';

import { compileOtlp, parseHeaders } from '../../src/otlp.js';

describe('otlp compiler', () => {
  it('creates parent-child spans and langfuse parity attrs', () => {
    const events = [
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
    ];
    const resource = { serviceName: 'spanory', serviceVersion: '0.1.0', environment: 'test' };
    const payload = compileOtlp(events, resource);
    const payload2 = compileOtlp(events, resource);
    const spans = payload.resourceSpans[0].scopeSpans[0].spans;
    const spans2 = payload2.resourceSpans[0].scopeSpans[0].spans;
    expect(spans).toHaveLength(2);
    expect(spans[1].parentSpanId).toBe(spans[0].spanId);
    expect(spans[0].traceId).toBe(spans2[0].traceId);
    expect(spans[0].spanId).toBe(spans2[0].spanId);
    expect(spans[1].spanId).toBe(spans2[1].spanId);

    const attrs = Object.fromEntries(spans[0].attributes.map((a) => [a.key, a.value.stringValue ?? a.value.doubleValue]));
    expect(attrs['langfuse.trace.name']).toBeTruthy();
    expect(attrs['langfuse.trace.input']).toBe('hi');
    expect(attrs['langfuse.trace.output']).toBe('hello');
    expect(attrs['langfuse.trace.id']).toBe(spans[0].traceId);
    expect(attrs['langfuse.observation.id']).toBe(spans[0].spanId);
    expect(attrs['langfuse.observation.type']).toBe('agent');
    expect(attrs['session.id']).toBe('s1');
    expect(attrs['agentic.session.id']).toBeUndefined();
    expect(attrs['agentic.project.id']).toBeUndefined();
  });

  it('parses header list', () => {
    expect(parseHeaders('a=1,b=2')).toEqual({ a: '1', b: '2' });
    expect(parseHeaders('')).toBeUndefined();
  });

  it('keeps parity attrs for openclaw runtime events', () => {
    const events = [
      {
        runtime: 'openclaw',
        sessionId: 'oc-s1',
        projectId: 'oc-p1',
        turnId: 'turn-1',
        category: 'turn',
        name: 'Turn 1',
        startedAt: '2026-03-01T00:00:00.000Z',
        endedAt: '2026-03-01T00:00:01.000Z',
        input: 'hi',
        output: 'hello',
        attributes: {
          'langfuse.observation.model.name': 'openclaw-pro',
          'gen_ai.usage.input_tokens': 10,
          'gen_ai.usage.output_tokens': 5,
        },
      },
      {
        runtime: 'openclaw',
        sessionId: 'oc-s1',
        projectId: 'oc-p1',
        turnId: 'turn-1',
        category: 'tool',
        name: 'Tool: WebSearch',
        startedAt: '2026-03-01T00:00:00.200Z',
        endedAt: '2026-03-01T00:00:00.300Z',
        input: '{\"query\":\"langfuse\"}',
        output: 'ok',
        attributes: {
          'gen_ai.tool.name': 'WebSearch',
          'gen_ai.tool.call.id': 'call-web-1',
        },
      },
    ];
    const payload = compileOtlp(events, { serviceName: 'spanory', serviceVersion: '0.1.0', environment: 'test' });
    const spans = payload.resourceSpans[0].scopeSpans[0].spans;
    expect(spans).toHaveLength(2);
    expect(spans[1].parentSpanId).toBe(spans[0].spanId);

    const rootAttrs = Object.fromEntries(spans[0].attributes.map((a) => [a.key, a.value.stringValue ?? a.value.doubleValue]));
    const toolAttrs = Object.fromEntries(spans[1].attributes.map((a) => [a.key, a.value.stringValue ?? a.value.doubleValue]));

    expect(rootAttrs['agentic.runtime.name']).toBe('openclaw');
    expect(rootAttrs['langfuse.session.id']).toBe('oc-s1');
    expect(rootAttrs['langfuse.trace.input']).toBe('hi');
    expect(rootAttrs['langfuse.trace.output']).toBe('hello');
    expect(toolAttrs['langfuse.observation.type']).toBe('tool');
    expect(toolAttrs['gen_ai.tool.name']).toBe('WebSearch');
    expect(toolAttrs['gen_ai.tool.call.id']).toBe('call-web-1');
  });

  it('keeps trace input/output stable on child tool spans', () => {
    const events = [
      {
        runtime: 'openclaw',
        sessionId: 'oc-s2',
        projectId: 'oc-p2',
        turnId: 'turn-1',
        category: 'turn',
        name: 'Turn 1',
        startedAt: '2026-03-01T00:00:00.000Z',
        endedAt: '2026-03-01T00:00:01.000Z',
        input: 'plugin smoke input 2',
        output: 'plugin smoke output 2',
        attributes: {
          'langfuse.observation.model.name': 'openclaw-pro',
        },
      },
      {
        runtime: 'openclaw',
        sessionId: 'oc-s2',
        projectId: 'oc-p2',
        turnId: 'turn-1',
        category: 'shell_command',
        name: 'Tool: Bash',
        startedAt: '2026-03-01T00:00:00.200Z',
        endedAt: '2026-03-01T00:00:00.300Z',
        input: '{"command":"echo smoke2"}',
        output: '{"stdout":"smoke2"}',
        attributes: {
          'gen_ai.tool.name': 'Bash',
          'gen_ai.tool.call.id': 'call-bash-1',
        },
      },
    ];

    const payload = compileOtlp(events, { serviceName: 'spanory', serviceVersion: '0.1.0', environment: 'test' });
    const spans = payload.resourceSpans[0].scopeSpans[0].spans;
    expect(spans).toHaveLength(2);

    const rootAttrs = Object.fromEntries(spans[0].attributes.map((a) => [a.key, a.value.stringValue ?? a.value.doubleValue]));
    const toolAttrs = Object.fromEntries(spans[1].attributes.map((a) => [a.key, a.value.stringValue ?? a.value.doubleValue]));

    expect(rootAttrs['langfuse.trace.input']).toBe('plugin smoke input 2');
    expect(rootAttrs['langfuse.trace.output']).toBe('plugin smoke output 2');
    expect(toolAttrs['langfuse.trace.input']).toBe('plugin smoke input 2');
    expect(toolAttrs['langfuse.trace.output']).toBe('plugin smoke output 2');
    expect(toolAttrs['langfuse.observation.input']).toBe('{"command":"echo smoke2"}');
  });
});
