export type SpanoryCategory = 'agent_command' | 'shell_command' | 'mcp' | 'agent_task' | 'turn' | 'tool' | 'reasoning' | 'context';

export const CONTEXT_SOURCE_KINDS = [
  'turn',
  'tool_input',
  'tool_output',
  'skill',
  'claude_md',
  'memory',
  'mention_file',
  'subagent',
  'system_prompt',
  'team_coordination',
  'unknown',
] as const;

export type ContextSourceKind = (typeof CONTEXT_SOURCE_KINDS)[number];
export type ContextEventType = 'context_snapshot' | 'context_boundary' | 'context_source_attribution';
export type ContextBoundaryKind = 'compact_before' | 'compact_after' | 'restore' | 'resume';

export interface ContextSnapshotCanonical {
  eventType: 'context_snapshot';
  estimatedTotalTokens: number;
  fillRatio: number;
  deltaTokens: number;
  composition: Partial<Record<ContextSourceKind, number>>;
  topSources: ContextSourceKind[];
  estimationMethod?: 'usage' | 'heuristic' | 'calibrated';
  estimationConfidence?: number;
}

export interface ContextBoundaryCanonical {
  eventType: 'context_boundary';
  boundaryKind: ContextBoundaryKind;
  compactionRatio: number;
  detectionMethod?: 'hook' | 'inferred';
}

export interface ContextSourceAttributionCanonical {
  eventType: 'context_source_attribution';
  sourceKind: ContextSourceKind;
  sourceName: string;
  tokenDelta: number;
  pollutionScore: number;
  scoreVersion: 'pollution_score_v1';
  sourceShare?: number;
  repeatCountRecent?: number;
}

export type ContextCanonicalEvent =
  | ContextSnapshotCanonical
  | ContextBoundaryCanonical
  | ContextSourceAttributionCanonical;

export interface PollutionScoreV1Input {
  tokenDelta: number;
  windowLimitTokens: number;
  sourceShare: number;
  repeatCountRecent: number;
  sourceKind?: ContextSourceKind;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Shared scoring contract for context source attribution.
export function pollutionScoreV1(input: PollutionScoreV1Input): number {
  const tokenDelta = Number(input?.tokenDelta ?? 0);
  const windowLimitTokens = Math.max(1, Number(input?.windowLimitTokens ?? 200000));
  const sourceShare = Number(input?.sourceShare ?? 0);
  const repeatCountRecent = Number(input?.repeatCountRecent ?? 0);
  const sourceKind = String(input?.sourceKind ?? '') as ContextSourceKind | '';

  if (!Number.isFinite(tokenDelta) || tokenDelta <= 0) return 0;

  const deltaRatio = clamp(tokenDelta / Math.max(2000, 0.05 * windowLimitTokens), 0, 1);
  const shareRatio = clamp(sourceShare / 0.25, 0, 1);
  const repeatRatio = clamp(repeatCountRecent / 3, 0, 1);
  const unknownPenalty = sourceKind === 'unknown' ? 0.15 : 0;

  return Math.round(
    100
      * clamp(
        0.5 * deltaRatio + 0.3 * shareRatio + 0.2 * repeatRatio + unknownPenalty,
        0,
        1,
      ),
  );
}

export interface CalibrationState {
  ema: number;
  sampleCount: number;
}

export type EstimationMethod = 'usage' | 'heuristic' | 'calibrated';
export type ContentTypeHint = 'json' | 'code' | 'markdown' | 'plain' | 'cjk';

const CHARS_PER_TOKEN_BY_TYPE: Record<ContentTypeHint, number> = {
  json: 2.5,
  cjk: 1.8,
  code: 3.0,
  markdown: 3.5,
  plain: 4.0,
};

function detectContentType(text: string, hint?: ContentTypeHint): ContentTypeHint {
  if (hint) return hint;
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return 'plain';
  if (/^[\[{]/.test(trimmed)) return 'json';

  const cjkCount = (trimmed.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) ?? []).length;
  if (cjkCount / Math.max(trimmed.length, 1) > 0.3) return 'cjk';

  const codeSigCount = (trimmed.match(/[{};()=><]/g) ?? []).length;
  if (codeSigCount / Math.max(trimmed.length, 1) > 0.05) return 'code';

  if (/(^#{1,6}\s)|(```)|(\[[^\]]+\]\([^)]+\))|(^[-*]\s)/m.test(trimmed)) return 'markdown';
  return 'plain';
}

export function estimateTokens(value: string, hint?: ContentTypeHint): number {
  const text = String(value ?? '').trim();
  if (!text) return 0;
  const contentType = detectContentType(text, hint);
  const charsPerToken = CHARS_PER_TOKEN_BY_TYPE[contentType];
  return Math.max(1, Math.ceil(text.length / charsPerToken));
}

export function calibrate(state: CalibrationState, actual: number, estimated: number): CalibrationState {
  const prev: CalibrationState = {
    ema: Number(state?.ema ?? 1),
    sampleCount: Number(state?.sampleCount ?? 0),
  };
  if (!Number.isFinite(actual) || !Number.isFinite(estimated) || actual <= 0 || estimated <= 0) return prev;

  const ratio = actual / estimated;
  const alpha = Math.min(0.3, 1 / (prev.sampleCount + 1));
  return {
    ema: prev.ema * (1 - alpha) + ratio * alpha,
    sampleCount: prev.sampleCount + 1,
  };
}

export function calibratedEstimate(rawEstimate: number, state: CalibrationState): number {
  const raw = Number(rawEstimate ?? 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  const sampleCount = Number(state?.sampleCount ?? 0);
  if (sampleCount < 2) return Math.round(raw);
  const ema = Number(state?.ema ?? 1);
  if (!Number.isFinite(ema) || ema <= 0) return Math.round(raw);
  return Math.max(1, Math.round(raw * ema));
}

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
