type ObservationType = 'agent' | 'tool' | 'event' | 'span';

type LangfuseMappableEvent = {
  category?: string;
  attributes?: Record<string, any>;
  [key: string]: any;
};

function defaultObservationType(category: string | undefined): ObservationType {
  switch (category) {
    case 'turn':
      return 'agent';
    case 'shell_command':
    case 'mcp':
    case 'tool':
      return 'tool';
    case 'agent_command':
      return 'event';
    case 'agent_task':
      return 'agent';
    default:
      return 'span';
  }
}

function normalizeAttributes(event: LangfuseMappableEvent): Record<string, any> {
  const attrs = { ...(event.attributes ?? {}) };
  if (!attrs['agentic.event.category']) {
    attrs['agentic.event.category'] = event.category;
  }
  if (!attrs['langfuse.observation.type']) {
    attrs['langfuse.observation.type'] = defaultObservationType(event.category);
  }
  return attrs;
}

export function toLangfuseEvents(events: any[]): any[] {
  return events.map((event) => ({
    ...event,
    attributes: normalizeAttributes(event),
  }));
}

export const langfuseBackendAdapter = {
  backendName: 'langfuse',
  mapEvents(events: any[]) {
    return toLangfuseEvents(events);
  },
};
