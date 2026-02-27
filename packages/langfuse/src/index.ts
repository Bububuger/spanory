export interface LangfuseTraceEnvelope {
  traceName: string;
  sessionId?: string;
  input?: string;
  output?: string;
}
