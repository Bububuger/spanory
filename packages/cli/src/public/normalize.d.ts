export type CanonicalUsage = {
  input_tokens?: number;
  prompt_tokens?: number;
  output_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

export type CanonicalMessage = {
  role: 'user' | 'assistant';
  isMeta?: boolean;
  content: unknown;
  model?: string;
  usage?: CanonicalUsage;
  runtimeVersion?: string;
  messageId?: string;
  timestamp?: Date | string;
};

export type CanonicalEvent = {
  category: string;
  name: string;
  timestamp: string;
  attributes?: Record<string, string | number | boolean>;
  input?: string;
  output?: string;
  error?: string;
};

export function pickUsage(raw: unknown): CanonicalUsage | undefined;
export function normalizeTranscriptMessages(args: {
  runtime: string;
  projectId: string;
  sessionId: string;
  messages: Array<Record<string, any>>;
}): CanonicalEvent[];
