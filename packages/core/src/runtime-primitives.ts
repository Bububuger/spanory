export const GATEWAY_INPUT_METADATA_BLOCK_RE = /Conversation info \(untrusted metadata\):\s*```json\s*([\s\S]*?)\s*```\s*/i;

export function toNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore parse errors
  }
  return null;
}

export function extractToolUses(content: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(content)) return [];
  return content.filter(
    (block): block is Record<string, unknown> =>
      !!block && typeof block === 'object' && block.type === 'tool_use',
  );
}
