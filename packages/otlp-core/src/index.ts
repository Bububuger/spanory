import { createHash } from 'node:crypto';

export interface SpanoryEvent {
  runtime: string;
  sessionId: string;
  projectId: string;
  turnId?: string;
  category: string;
  name: string;
  startedAt: string;
  endedAt?: string;
  input?: string;
  output?: string;
  attributes?: Record<string, unknown>;
}

export interface OtlpResource {
  serviceName: string;
  serviceVersion: string;
  environment: string;
}

interface OtlpAnyValue {
  stringValue?: string;
  doubleValue?: number;
  boolValue?: boolean;
}

interface OtlpAttribute {
  key: string;
  value: OtlpAnyValue;
}

interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OtlpAttribute[];
}

export interface OtlpPayload {
  resourceSpans: Array<{
    resource: {
      attributes: OtlpAttribute[];
    };
    scopeSpans: Array<{
      scope: {
        name: string;
      };
      spans: OtlpSpan[];
    }>;
  }>;
}

function stableHexId(parts: Array<string | number | undefined | null>, targetLength: number): string {
  const h = createHash('sha256');
  for (const p of parts) {
    h.update(String(p ?? ''));
    h.update('\u001f');
  }
  return h.digest('hex').slice(0, targetLength);
}

function toUnixNano(dateString: string): string {
  return `${BigInt(new Date(dateString).getTime()) * 1000000n}`;
}

function toAnyValue(value: unknown): OtlpAnyValue {
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') return { doubleValue: value };
  if (typeof value === 'boolean') return { boolValue: value };
  return { stringValue: JSON.stringify(value) };
}

function observationTypeForCategory(category: string): string {
  switch (category) {
    case 'turn':
      return 'agent';
    case 'shell_command':
      return 'tool';
    case 'mcp':
      return 'tool';
    case 'agent_task':
      return 'agent';
    case 'tool':
      return 'tool';
    case 'agent_command':
      return 'event';
    default:
      return 'span';
  }
}

function observationIdentity(event: SpanoryEvent, idx: number): string {
  const turnId = String(event.turnId ?? '');
  const attrs = event.attributes ?? {};
  const toolCallId = attrs['gen_ai.tool.call.id'];
  const mcpRequestId = attrs['mcp.request.id'];

  if (event.category === 'turn' && turnId) {
    return `turn:${turnId}`;
  }

  if ((event.category === 'shell_command' || event.category === 'tool' || event.category === 'agent_task') && toolCallId) {
    return `${event.category}:${turnId}:${toolCallId}`;
  }

  if (event.category === 'mcp' && (mcpRequestId || toolCallId)) {
    return `mcp:${turnId}:${mcpRequestId ?? toolCallId}`;
  }

  if (event.category === 'agent_command' && turnId) {
    return `agent_command:${turnId}:${event.name}`;
  }

  if (event.category === 'reasoning' && turnId) {
    const outputDigest = stableHexId(['reasoning', event.output ?? ''], 12);
    return `reasoning:${turnId}:${event.startedAt}:${outputDigest}`;
  }

  return `event:${turnId}:${event.category}:${event.name}:${event.startedAt ?? ''}:${idx}`;
}

export function buildResource(input: Partial<OtlpResource> = {}): OtlpResource {
  return {
    serviceName: input.serviceName ?? process.env.SPANORY_SERVICE_NAME ?? 'spanory',
    serviceVersion: input.serviceVersion ?? process.env.SPANORY_VERSION ?? '0.1.1',
    environment: input.environment ?? process.env.SPANORY_ENV ?? 'development',
  };
}

export function parseOtlpHeaders(input?: string): Record<string, string> | undefined {
  if (!input || !input.trim()) return undefined;
  const pairs = input
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part): [string, string] | null => {
      const idx = part.indexOf('=');
      if (idx <= 0) return null;
      const key = part.slice(0, idx).trim();
      const value = part.slice(idx + 1).trim();
      if (!key || !value) return null;
      return [key, value];
    })
    .filter((pair): pair is [string, string] => Boolean(pair));
  if (!pairs.length) return undefined;
  return Object.fromEntries(pairs);
}

export function compileOtlpSpans(events: SpanoryEvent[], resource: OtlpResource): OtlpPayload {
  const traceByTurn = new Map<string, string>();
  const traceContextByTurn = new Map<string, {
    traceName: string;
    traceMetadata: string;
    traceInput: string;
    traceOutput: string;
    hasTurnEvent: boolean;
  }>();
  const rootByTurn = new Map<string, string>();
  const spans: OtlpSpan[] = [];
  const spanIdSet = new Set<string>();
  const identityCountByEvent = new Map<string, number>();

  for (const event of events) {
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

    if (!traceContextByTurn.has(turnKey)) {
      traceContextByTurn.set(turnKey, {
        traceName: `Spanory ${event.runtime} ${event.turnId ?? event.sessionId}`,
        traceMetadata: JSON.stringify({
          runtime: event.runtime,
          projectId: event.projectId,
          sessionId: event.sessionId,
          turnId: event.turnId ?? null,
        }),
        traceInput: '',
        traceOutput: '',
        hasTurnEvent: false,
      });
    }

    const context = traceContextByTurn.get(turnKey);
    if (context && event.category === 'turn') {
      const eventInput = event.input ?? '';
      const eventOutput = event.output ?? '';
      if (!context.hasTurnEvent) {
        context.traceInput = eventInput;
        context.traceOutput = eventOutput;
        context.hasTurnEvent = true;
      } else {
        if (!context.traceInput && eventInput) context.traceInput = eventInput;
        if (!context.traceOutput && eventOutput) context.traceOutput = eventOutput;
      }
    }
  }

  for (let idx = 0; idx < events.length; idx += 1) {
    const event = events[idx];
    const turnKey = event.turnId || `${event.sessionId}:root`;
    const traceId = traceByTurn.get(turnKey);
    const traceContext = traceContextByTurn.get(turnKey);
    if (!traceId || !traceContext) continue;

    const identity = observationIdentity(event, idx);
    const occurrence = (identityCountByEvent.get(identity) ?? 0) + 1;
    identityCountByEvent.set(identity, occurrence);

    const eventStableKey = [
      'span',
      event.runtime,
      event.projectId,
      event.sessionId,
      identity,
      occurrence,
    ];
    let spanId = stableHexId(eventStableKey, 16);
    if (spanIdSet.has(spanId)) {
      spanId = stableHexId([...eventStableKey, 'collision', idx], 16);
    }
    spanIdSet.add(spanId);

    let parentSpanId: string | undefined;
    if (event.category !== 'turn') {
      parentSpanId = rootByTurn.get(turnKey);
    }

    if (event.category === 'turn') {
      rootByTurn.set(turnKey, spanId);
    }

    const attrs = {
      'agentic.runtime.name': event.runtime,
      'langfuse.trace.id': traceId,
      'langfuse.session.id': event.sessionId,
      'session.id': event.sessionId,
      'langfuse.trace.name': traceContext.traceName,
      'langfuse.trace.metadata': traceContext.traceMetadata,
      ...(event.turnId ? { 'agentic.turn.id': event.turnId } : {}),
      ...(event.attributes ?? {}),
      ...(traceContext.hasTurnEvent
        ? {
            'langfuse.trace.input': traceContext.traceInput,
            'langfuse.trace.output': traceContext.traceOutput,
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
              ? [{ key: 'deployment.environment.name', value: { stringValue: resource.environment } }]
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

export async function sendOtlpHttp(endpoint: string, payload: unknown, headers: Record<string, string> = {}): Promise<void> {
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
