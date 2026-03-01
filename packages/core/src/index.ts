export type SpanoryCategory = 'agent_command' | 'shell_command' | 'mcp' | 'agent_task' | 'turn' | 'tool';

export interface SpanoryEvent {
  runtime: string;
  sessionId: string;
  projectId: string;
  turnId?: string;
  category: SpanoryCategory;
  name: string;
  startedAt: string;
  endedAt?: string;
  input?: string;
  output?: string;
  attributes?: Record<string, string | number | boolean>;
}

export interface HookPayload {
  hookEventName?: string;
  sessionId?: string;
  transcriptPath?: string;
}

export interface RuntimeAdapterContext {
  projectId: string;
  sessionId: string;
  transcriptPath?: string;
  runtimeHome?: string;
}

export interface RuntimeCapabilities {
  turnDetection: boolean;
  toolCallAttribution: boolean;
  toolResultCorrelation: boolean;
  modelName: boolean;
  usageDetails: boolean;
  slashCommandExtraction: boolean;
  mcpServerExtraction: boolean;
}

export interface RuntimeAdapter {
  runtimeName: string;
  capabilities?: RuntimeCapabilities;
  resolveContextFromHook(payload: HookPayload): RuntimeAdapterContext | null;
  collectEvents(context: RuntimeAdapterContext): Promise<SpanoryEvent[]>;
}
