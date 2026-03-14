import { langfuseObservationTypeForCategory } from '@bububuger/otlp-core';

type LangfuseMappableEvent = {
  category?: string;
  attributes?: Record<string, any>;
  [key: string]: any;
};

function normalizeAttributes(event: LangfuseMappableEvent): Record<string, any> {
  const attrs = { ...(event.attributes ?? {}) };
  if (!attrs['agentic.event.category']) {
    attrs['agentic.event.category'] = event.category;
  }
  if (!attrs['langfuse.observation.type']) {
    attrs['langfuse.observation.type'] = langfuseObservationTypeForCategory(event.category);
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
