// @ts-nocheck

export function extractText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      if (typeof block === 'string') return block;
      if (block && typeof block === 'object' && block.type === 'text') return String(block.text ?? '');
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

export function extractToolUses(content) {
  if (!Array.isArray(content)) return [];
  return content.filter((block) => block && typeof block === 'object' && block.type === 'tool_use');
}

export function extractToolResults(content) {
  if (!Array.isArray(content)) return [];
  return content.filter((block) => block && typeof block === 'object' && block.type === 'tool_result');
}

export function extractReasoningBlocks(content) {
  if (!Array.isArray(content)) return [];
  return content.filter((block) => block && typeof block === 'object' && block.type === 'reasoning');
}

export function isoFromUnknownTimestamp(value, fallback) {
  const candidate = value instanceof Date ? value : new Date(value ?? '');
  if (!Number.isNaN(candidate.getTime())) return candidate.toISOString();
  return fallback.toISOString();
}

function isToolResultOnlyContent(content) {
  return Array.isArray(content)
    && content.length > 0
    && content.every((block) => block && typeof block === 'object' && block.type === 'tool_result');
}

export function isPromptUserMessage(message) {
  if (!message || message.role !== 'user' || message.isMeta) return false;
  const { content } = message;
  if (typeof content === 'string') return content.trim().length > 0;
  if (!Array.isArray(content)) return false;
  if (isToolResultOnlyContent(content)) return false;
  return content.length > 0;
}

export function extractToolResultText(block, message) {
  const raw = block?.content;
  if (typeof raw === 'string' && raw.trim()) return raw;
  if (Array.isArray(raw)) {
    const text = extractText(raw).trim();
    if (text) return text;
    return JSON.stringify(raw);
  }
  if (raw && typeof raw === 'object') return JSON.stringify(raw);

  const stdout = message?.toolUseResult?.stdout;
  if (typeof stdout === 'string' && stdout.length > 0) return stdout;
  const stderr = message?.toolUseResult?.stderr;
  if (typeof stderr === 'string' && stderr.length > 0) return stderr;
  return '';
}

export function parseSlashCommand(text) {
  const m = text.match(/<command-name>\s*\/([^<\s]+)\s*<\/command-name>/i);
  if (m) {
    const argsMatch = text.match(/<command-args>([\s\S]*?)<\/command-args>/i);
    return { name: m[1].trim(), args: argsMatch ? argsMatch[1].trim() : '' };
  }

  // fallback for plain slash commands like "/compact please summarize"
  const plain = String(text ?? '').trim().match(/^\/([a-zA-Z0-9._:-]+)(?:\s+([\s\S]*))?$/);
  if (!plain) return null;
  return {
    name: plain[1].trim(),
    args: plain[2] ? plain[2].trim() : '',
  };
}

export function parseBashCommandAttributes(commandLine) {
  const raw = String(commandLine ?? '').trim();
  if (!raw) {
    return {
      'agentic.command.name': '',
      'agentic.command.args': '',
      'agentic.command.pipe_count': 0,
    };
  }

  const segments = raw.split(/\|(?!\|)/);
  const firstSegment = String(segments[0] ?? '').trim();
  const tokens = firstSegment ? firstSegment.split(/\s+/) : [];
  const name = String(tokens[0] ?? '').trim();
  const args = tokens.length > 1 ? tokens.slice(1).join(' ') : '';

  return {
    'agentic.command.name': name,
    'agentic.command.args': args,
    'agentic.command.pipe_count': Math.max(segments.length - 1, 0),
  };
}

export function isMcpToolName(name) {
  const n = String(name || '').toLowerCase();
  return n === 'mcp' || n.startsWith('mcp__') || n.startsWith('mcp-');
}
