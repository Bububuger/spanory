import { createHash } from 'node:crypto';

function stableHexId(parts, targetLength) {
  const h = createHash('sha256');
  for (const p of parts) {
    h.update(String(p ?? ''));
    h.update('\u001f');
  }
  return h.digest('hex').slice(0, targetLength);
}

function toUnixNano(dateString) {
  return `${BigInt(new Date(dateString).getTime()) * 1000000n}`;
}

function toAnyValue(value) {
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') return { doubleValue: value };
  if (typeof value === 'boolean') return { boolValue: value };
  return { stringValue: JSON.stringify(value) };
}

function observationTypeForCategory(category) {
  switch (category) {
    case 'turn':
      return 'agent';
    case 'shell_command':
      return 'tool';
    case 'mcp':
      return 'tool';
    case 'agent_task':
      return 'agent';
    case 'agent_command':
      return 'event';
    default:
      return 'span';
  }
}

export function parseHeaders(input) {
  if (!input || !input.trim()) return undefined;
  const pairs = input
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const idx = part.indexOf('=');
      if (idx <= 0) return null;
      const key = part.slice(0, idx).trim();
      const value = part.slice(idx + 1).trim();
      if (!key || !value) return null;
      return [key, value];
    })
    .filter(Boolean);
  if (!pairs.length) return undefined;
  return Object.fromEntries(pairs);
}

export function compileOtlp(events, resource) {
  const traceByTurn = new Map();
  const rootByTurn = new Map();
  const spans = [];
  const spanIdSet = new Set();

  for (let idx = 0; idx < events.length; idx += 1) {
    const event = events[idx];
    const turnKey = event.turnId || `${event.sessionId}:root`;
    if (!traceByTurn.has(turnKey)) {
      traceByTurn.set(
        turnKey,
        stableHexId(
          ['trace', event.runtime, event.projectId, event.sessionId, turnKey],
          32,
        ),
      );
    }
    const traceId = traceByTurn.get(turnKey);

    const eventStableKey = [
      'span',
      event.runtime,
      event.projectId,
      event.sessionId,
      event.turnId ?? '',
      event.category,
      event.name,
      event.startedAt,
      event.endedAt ?? '',
      event.attributes?.['gen_ai.tool.call.id'] ?? event.attributes?.['mcp.request.id'] ?? '',
      event.input ?? '',
      event.output ?? '',
      idx,
    ];
    let spanId = stableHexId(eventStableKey, 16);
    if (spanIdSet.has(spanId)) {
      spanId = stableHexId([...eventStableKey, 'collision'], 16);
    }
    spanIdSet.add(spanId);

    let parentSpanId;
    if (event.category !== 'turn') {
      parentSpanId = rootByTurn.get(turnKey);
    }

    if (event.category === 'turn') {
      rootByTurn.set(turnKey, spanId);
    }

    const attrs = {
      'agentic.runtime.name': event.runtime,
      'agentic.session.id': event.sessionId,
      'agentic.project.id': event.projectId,
      'langfuse.trace.id': traceId,
      'langfuse.session.id': event.sessionId,
      'session.id': event.sessionId,
      'langfuse.trace.name': `Spanory ${event.runtime} ${event.turnId ?? event.sessionId}`,
      'langfuse.trace.metadata': JSON.stringify({
        runtime: event.runtime,
        projectId: event.projectId,
        sessionId: event.sessionId,
        turnId: event.turnId ?? null,
      }),
      ...(event.turnId ? { 'agentic.turn.id': event.turnId } : {}),
      ...(event.attributes ?? {}),
      ...(event.category === 'turn'
        ? {
            'langfuse.trace.input': event.input ?? '',
            'langfuse.trace.output': event.output ?? '',
          }
        : {}),
      ...(!event.attributes?.['langfuse.observation.type']
        ? { 'langfuse.observation.type': observationTypeForCategory(event.category) }
        : {}),
      'langfuse.observation.id': spanId,
      ...(event.input ? { 'langfuse.observation.input': event.input, 'input.value': event.input } : {}),
      ...(event.output ? { 'langfuse.observation.output': event.output, 'output.value': event.output } : {}),
    };

    spans.push({
      traceId,
      spanId,
      parentSpanId,
      name: event.name,
      startTimeUnixNano: toUnixNano(event.startedAt),
      endTimeUnixNano: toUnixNano(event.endedAt ?? event.startedAt),
      attributes: Object.entries(attrs).map(([key, value]) => ({ key, value: toAnyValue(value) })),
    });
  }

  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: resource.serviceName } },
            ...(resource.serviceVersion
              ? [{ key: 'service.version', value: { stringValue: resource.serviceVersion } }]
              : []),
            ...(resource.environment
              ? [{ key: 'deployment.environment', value: { stringValue: resource.environment } }]
              : []),
          ],
        },
        scopeSpans: [
          {
            scope: { name: 'spanory' },
            spans,
          },
        ],
      },
    ],
  };
}

export async function sendOtlp(endpoint, payload, headers = {}) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`OTLP HTTP ${response.status}`);
  }
}
