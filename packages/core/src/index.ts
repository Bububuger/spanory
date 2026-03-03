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
  threadId?: string;
  turnId?: string;
  cwd?: string;
  event?: string;
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

export interface CaptureRecord {
  runtime: string;
  sessionId?: string;
  projectId?: string;
  turnId?: string;
  timestamp: string;
  channel: 'http' | 'stdio' | 'file' | 'hook';
  direction: 'request' | 'response' | 'event';
  name: string;
  payload?: unknown;
  metadata?: Record<string, string | number | boolean>;
}

export interface CaptureRedactionPolicy {
  enabled: boolean;
  mode: 'allowlist' | 'denylist';
  rules: Array<{
    target: 'header' | 'query' | 'body' | 'path';
    pattern: string;
    replaceWith?: string;
  }>;
  maxPayloadBytes?: number;
  dropBinary?: boolean;
}

export interface CaptureAdapter {
  runtimeName: string;
  enabled?(context: RuntimeAdapterContext): boolean;
  startSession?(context: RuntimeAdapterContext): Promise<void> | void;
  capture(record: CaptureRecord, context: RuntimeAdapterContext): Promise<void> | void;
  flush?(context: RuntimeAdapterContext): Promise<void> | void;
}

export type CanonicalEvent = SpanoryEvent;

export interface BackendCompileContext {
  backendName: 'langfuse';
  runtimeName: string;
  projectId: string;
  sessionId: string;
}

export interface BackendAdapter {
  backendName: 'langfuse';
  mapEvents(events: CanonicalEvent[], context?: BackendCompileContext): SpanoryEvent[];
}
