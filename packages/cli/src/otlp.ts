import {
  buildResource,
  compileOtlpSpans,
  parseOtlpHeaders,
  sendOtlpHttp,
} from '../../otlp-core/dist/index.js';
import type { OtlpPayload, OtlpResource, SpanoryEvent } from '../../otlp-core/dist/index.js';

export { buildResource };

export function parseHeaders(input?: string): Record<string, string> | undefined {
  return parseOtlpHeaders(input);
}

export function compileOtlp(events: SpanoryEvent[], resource: OtlpResource): OtlpPayload {
  return compileOtlpSpans(events, resource);
}

export async function sendOtlp(
  endpoint: string,
  payload: OtlpPayload,
  headers: Record<string, string> = {},
): Promise<void> {
  await sendOtlpHttp(endpoint, payload, headers);
}
