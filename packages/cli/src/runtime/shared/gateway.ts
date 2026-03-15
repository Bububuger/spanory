import { extractText } from './content.js';

const GATEWAY_INPUT_METADATA_BLOCK_RE = /Conversation info \(untrusted metadata\):\s*```json\s*([\s\S]*?)\s*```\s*/i;

export function runtimeVersionAttributes(version: unknown): Record<string, string> {
  if (version === undefined || version === null) return {};
  const normalized = String(version).trim();
  if (!normalized) return {};
  return {
    'agentic.runtime.version': normalized,
  };
}

export function extractGatewayInputMetadata(text: string): { input: string; attributes: Record<string, string> } {
  if (!text) return { input: '', attributes: {} };
  const match = text.match(GATEWAY_INPUT_METADATA_BLOCK_RE);
  if (!match) return { input: text.trim(), attributes: {} };

  const attributes: Record<string, string> = {};
  const metadataRaw = match[1];
  try {
    const parsed = JSON.parse(metadataRaw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      attributes['agentic.input.metadata'] = JSON.stringify(parsed);
      if (parsed.message_id !== undefined) attributes['agentic.input.message_id'] = String(parsed.message_id);
      if (parsed.sender !== undefined) attributes['agentic.input.sender'] = String(parsed.sender);
    }
  } catch {
    // ignore malformed metadata JSON and only strip wrapper text
  }

  const input = text.slice((match.index ?? 0) + match[0].length).trim() || text.trim();
  return { input, attributes };
}

export function normalizeUserInput(content: unknown): { input: string; attributes: Record<string, string> } {
  const text = extractText(content).trim();
  if (text) return extractGatewayInputMetadata(text);
  if (Array.isArray(content)) return { input: JSON.stringify(content), attributes: {} };
  if (typeof content === 'string') return extractGatewayInputMetadata(content);
  return { input: '', attributes: {} };
}
