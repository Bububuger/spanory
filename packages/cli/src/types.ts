/**
 * Shared internal types for @bububuger/spanory CLI.
 *
 * These types describe the shapes flowing through the CLI's normalize/adapter
 * pipeline.  They intentionally use index signatures where runtime payloads are
 * loosely structured — strict narrowing happens at the adapter boundary.
 */

export type { SpanoryEvent, SpanoryCategory, RuntimeAdapterContext, HookPayload, RuntimeCapabilities } from '@bububuger/core';

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

/** Raw token-usage object coming from LLM API responses. */
export interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  [key: string]: number | undefined;
}

// ---------------------------------------------------------------------------
// Content blocks
// ---------------------------------------------------------------------------

/** A single content block inside a message (text / tool_use / tool_result / reasoning). */
export interface ContentBlock {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  toolUseId?: string;
  content?: unknown;
  timestamp?: Date;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Transcript messages
// ---------------------------------------------------------------------------

/** Superset message shape across all supported runtimes. */
export interface TranscriptMessage {
  role: string;
  content?: unknown;
  isMeta?: boolean;
  timestamp?: Date;
  model?: string;
  usage?: RawUsage;
  messageId?: string;
  runtimeVersion?: string;
  toolUseResult?: { stdout?: string; stderr?: string };
  sourceToolUseId?: string;
  isSidechain?: boolean;
  agentId?: string;
  agent_id?: string;
  parentSessionId?: string;
  parent_session_id?: string;
  parentTurnId?: string;
  parent_turn_id?: string;
  parentToolCallId?: string;
  parent_tool_call_id?: string;
  parentLinkConfidence?: string;
  parent_link_confidence?: string;
  parent?: Record<string, unknown>;
  session_meta?: Record<string, unknown>;
  sessionMeta?: Record<string, unknown>;
  message?: Record<string, unknown>;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Attributes
// ---------------------------------------------------------------------------

/** OTLP-style attribute bag. */
export type Attributes = Record<string, string | number | boolean>;

// ---------------------------------------------------------------------------
// Gateway metadata extraction result
// ---------------------------------------------------------------------------

export interface GatewayInputResult {
  input: string;
  attributes: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Codex watch
// ---------------------------------------------------------------------------

export interface CodexWatchOptions {
  runtimeHome?: string;
  pollMs?: number;
  settleMs?: number;
  includeExisting?: boolean;
  once?: boolean;
  projectId?: string;
  endpoint?: string;
  headers?: string;
  exportJsonDir?: string;
  force?: boolean;
  lastTurnOnly?: boolean;
}

export interface CodexWatchDeps {
  resolveRuntimeHome: (runtimeName: string, explicit?: string) => string;
  runContextExportMode: (opts: Record<string, unknown>) => Promise<{ status: string } | null>;
  sleep: (ms: number) => Promise<void>;
}

export interface CodexSessionListOptions {
  since?: string;
  until?: string;
  limit?: number;
}
