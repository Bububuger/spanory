// @ts-nocheck
function defaultObservationType(category) {
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
function normalizeAttributes(event) {
    const attrs = { ...(event.attributes ?? {}) };
    if (!attrs['agentic.event.category']) {
        attrs['agentic.event.category'] = event.category;
    }
    if (!attrs['langfuse.observation.type']) {
        attrs['langfuse.observation.type'] = defaultObservationType(event.category);
    }
    return attrs;
}
export function toLangfuseEvents(events) {
    return events.map((event) => ({
        ...event,
        attributes: normalizeAttributes(event),
    }));
}
export const langfuseBackendAdapter = {
    backendName: 'langfuse',
    mapEvents(events) {
        return toLangfuseEvents(events);
    },
};
