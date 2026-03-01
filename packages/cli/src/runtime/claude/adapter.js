import { readFile } from 'node:fs/promises';
import path from 'node:path';

function parseTimestamp(entry) {
  const raw = entry?.timestamp;
  const date = raw ? new Date(raw) : new Date();
  if (Number.isNaN(date.getTime())) return new Date();
  return date;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function pickUsage(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const inputTokens = toNumber(raw.input_tokens ?? raw.prompt_tokens);
  const outputTokens = toNumber(raw.output_tokens ?? raw.completion_tokens);
  const totalTokens = toNumber(raw.total_tokens) ?? ((inputTokens ?? 0) + (outputTokens ?? 0) || undefined);
  const cacheReadInputTokens = toNumber(raw.cache_read_input_tokens);
  const cacheCreationInputTokens = toNumber(raw.cache_creation_input_tokens);

  const usage = {};
  if (inputTokens !== undefined) usage.input_tokens = inputTokens;
  if (outputTokens !== undefined) usage.output_tokens = outputTokens;
  if (totalTokens !== undefined) usage.total_tokens = totalTokens;
  if (cacheReadInputTokens !== undefined) usage.cache_read_input_tokens = cacheReadInputTokens;
  if (cacheCreationInputTokens !== undefined) usage.cache_creation_input_tokens = cacheCreationInputTokens;
  return Object.keys(usage).length ? usage : undefined;
}

function addUsage(total, usage) {
  if (!usage) return;
  for (const [key, value] of Object.entries(usage)) {
    total[key] = (total[key] ?? 0) + Number(value);
  }
}

function usageAttributes(usage) {
  if (!usage) return {};
  const attrs = {};
  if (usage.input_tokens !== undefined) {
    attrs['gen_ai.usage.input_tokens'] = usage.input_tokens;
    attrs['gen_ai.usage.prompt_tokens'] = usage.input_tokens;
  }
  if (usage.output_tokens !== undefined) {
    attrs['gen_ai.usage.output_tokens'] = usage.output_tokens;
    attrs['gen_ai.usage.completion_tokens'] = usage.output_tokens;
  }
  if (usage.total_tokens !== undefined) {
    attrs['gen_ai.usage.total_tokens'] = usage.total_tokens;
  }
  if (usage.cache_read_input_tokens !== undefined) {
    attrs['gen_ai.usage.details.cache_read_input_tokens'] = usage.cache_read_input_tokens;
  }
  if (usage.cache_creation_input_tokens !== undefined) {
    attrs['gen_ai.usage.details.cache_creation_input_tokens'] = usage.cache_creation_input_tokens;
  }

  attrs['langfuse.observation.usage_details'] = JSON.stringify({
    ...(usage.input_tokens !== undefined ? { input: usage.input_tokens } : {}),
    ...(usage.output_tokens !== undefined ? { output: usage.output_tokens } : {}),
    ...(usage.total_tokens !== undefined ? { total: usage.total_tokens } : {}),
    ...(usage.cache_read_input_tokens !== undefined ? { input_cache_read: usage.cache_read_input_tokens } : {}),
    ...(usage.cache_creation_input_tokens !== undefined
      ? { input_cache_creation: usage.cache_creation_input_tokens }
      : {}),
  });
  return attrs;
}

function modelAttributes(model) {
  if (!model) return {};
  return {
    'langfuse.observation.model.name': model,
    'gen_ai.request.model': model,
  };
}

function extractText(content) {
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

function extractToolUses(content) {
  if (!Array.isArray(content)) return [];
  return content.filter((block) => block && typeof block === 'object' && block.type === 'tool_use');
}

function extractToolResults(content) {
  if (!Array.isArray(content)) return [];
  return content.filter((block) => block && typeof block === 'object' && block.type === 'tool_result');
}

function isToolResultOnlyContent(content) {
  return Array.isArray(content)
    && content.length > 0
    && content.every((block) => block && typeof block === 'object' && block.type === 'tool_result');
}

function isPromptUserMessage(message) {
  if (!message || message.type !== 'user' || message.isMeta) return false;
  const { content } = message;
  if (typeof content === 'string') return content.trim().length > 0;
  if (!Array.isArray(content)) return false;
  if (isToolResultOnlyContent(content)) return false;
  return content.length > 0;
}

function normalizeUserInput(content) {
  const text = extractText(content).trim();
  if (text) return text;
  if (Array.isArray(content)) return JSON.stringify(content);
  if (typeof content === 'string') return content;
  return '';
}

function extractToolResultText(block, message) {
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

function parseSlashCommand(text) {
  const m = text.match(/<command-name>\s*\/([^<\s]+)\s*<\/command-name>/i);
  if (!m) return null;
  const argsMatch = text.match(/<command-args>([\s\S]*?)<\/command-args>/i);
  return { name: m[1].trim(), args: argsMatch ? argsMatch[1].trim() : '' };
}

function isMcpToolName(name) {
  const n = String(name || '').toLowerCase();
  return n === 'mcp' || n.startsWith('mcp__') || n.startsWith('mcp-');
}

function parseProjectIdFromTranscript(transcriptPath) {
  if (!transcriptPath) return undefined;
  const normalized = transcriptPath.replace(/\\/g, '/');
  const marker = '/.claude/projects/';
  const idx = normalized.indexOf(marker);
  if (idx === -1) return undefined;
  const rest = normalized.slice(idx + marker.length);
  return rest.split('/')[0] || undefined;
}

function createTurn(messages, turnId, projectId, sessionId) {
  const user = messages.find(isPromptUserMessage) ?? messages.find((m) => m.type === 'user' && !m.isMeta) ?? messages[0];
  const assistantsRaw = messages.filter((m) => m.type === 'assistant');
  const assistantOrder = [];
  const assistantLatest = new Map();
  for (let i = 0; i < assistantsRaw.length; i += 1) {
    const msg = assistantsRaw[i];
    const key = msg.messageId ? `id:${msg.messageId}` : `idx:${i}`;
    if (!assistantLatest.has(key)) assistantOrder.push(key);
    assistantLatest.set(key, msg);
  }
  const assistants = assistantOrder.map((key) => assistantLatest.get(key)).filter(Boolean);
  const start = user?.timestamp ?? messages[0]?.timestamp ?? new Date();
  const end = messages[messages.length - 1]?.timestamp ?? start;

  const output = assistants.map((m) => extractText(m.content)).filter(Boolean).join('\n');

  const totalUsage = {};
  let latestModel;
  for (const msg of assistants) {
    if (msg.model) latestModel = msg.model;
    addUsage(totalUsage, msg.usage);
  }
  const usage = Object.keys(totalUsage).length ? totalUsage : undefined;
  const runtimeVersion = [...messages]
    .map((m) => String(m.runtimeVersion ?? '').trim())
    .filter(Boolean)
    .at(-1);
  const runtimeVersionAttrs = runtimeVersion ? { 'agentic.runtime.version': runtimeVersion } : {};

  const events = [
    {
      runtime: 'claude-code',
      projectId,
      sessionId,
      turnId,
      category: 'turn',
      name: `Claude Code - Turn ${turnId}`,
      startedAt: start.toISOString(),
      endedAt: end.toISOString(),
      input: normalizeUserInput(user?.content),
      output,
      attributes: {
        'agentic.event.category': 'turn',
        'langfuse.observation.type': 'agent',
        'gen_ai.operation.name': 'invoke_agent',
        ...runtimeVersionAttrs,
        ...modelAttributes(latestModel),
        ...usageAttributes(usage),
      },
    },
  ];

  const resultByToolId = new Map();
  for (const msg of messages) {
    if (msg.type !== 'user') continue;
    for (const tr of extractToolResults(msg.content)) {
      const toolUseId = String(tr.tool_use_id ?? tr.toolUseId ?? '');
      if (!toolUseId) continue;
      const content = extractToolResultText(tr, msg);
      if (!resultByToolId.has(toolUseId) || !resultByToolId.get(toolUseId)) {
        resultByToolId.set(toolUseId, content);
      }
    }

    if (msg.sourceToolUseId) {
      const fallback = extractToolResultText({}, msg);
      if (fallback && (!resultByToolId.has(msg.sourceToolUseId) || !resultByToolId.get(msg.sourceToolUseId))) {
        resultByToolId.set(msg.sourceToolUseId, fallback);
      }
    }
  }

  if (user?.type === 'user') {
    const slash = parseSlashCommand(extractText(user.content));
    if (slash) {
      const isMcp = slash.name.toLowerCase() === 'mcp' || slash.name.toLowerCase().startsWith('mcp:');
      events.push({
        runtime: 'claude-code',
        projectId,
        sessionId,
        turnId,
        category: isMcp ? 'mcp' : 'agent_command',
        name: isMcp ? 'MCP Slash Command' : `Agent Command: /${slash.name}`,
        startedAt: start.toISOString(),
        endedAt: start.toISOString(),
        input: extractText(user.content),
        output: '',
        attributes: {
          'agentic.event.category': isMcp ? 'mcp' : 'agent_command',
          'langfuse.observation.type': isMcp ? 'tool' : 'event',
          ...runtimeVersionAttrs,
          'agentic.command.name': slash.name,
          'agentic.command.args': slash.args,
          'gen_ai.operation.name': isMcp ? 'execute_tool' : 'invoke_agent',
        },
      });
    }
  }

  for (const assistant of assistants) {
    const toolUses = extractToolUses(assistant.content);
    for (const tu of toolUses) {
      const toolName = String(tu.name ?? '');
      const toolId = String(tu.id ?? '');
      const toolInput = tu.input ?? {};
      const toolOutput = resultByToolId.get(toolId) ?? '';
      const t = assistant.timestamp.toISOString();

      if (toolName === 'Bash') {
        const commandLine = String(toolInput.command ?? '');
        const model = assistant.model;
        events.push({
          runtime: 'claude-code',
          projectId,
          sessionId,
          turnId,
          category: 'shell_command',
          name: 'Tool: Bash',
          startedAt: t,
          endedAt: t,
          input: commandLine,
          output: toolOutput,
          attributes: {
            'agentic.event.category': 'shell_command',
            'langfuse.observation.type': 'tool',
            ...runtimeVersionAttrs,
            'process.command_line': commandLine,
            'gen_ai.tool.name': 'Bash',
            'gen_ai.tool.call.id': toolId,
            'gen_ai.operation.name': 'execute_tool',
            ...modelAttributes(model),
            ...usageAttributes(assistant.usage),
          },
        });
        continue;
      }

      if (isMcpToolName(toolName)) {
        const serverName = toolName.startsWith('mcp__') ? toolName.split('__')[1] : undefined;
        events.push({
          runtime: 'claude-code',
          projectId,
          sessionId,
          turnId,
          category: 'mcp',
          name: `Tool: ${toolName}`,
          startedAt: t,
          endedAt: t,
          input: JSON.stringify(toolInput),
          output: toolOutput,
          attributes: {
            'agentic.event.category': 'mcp',
            'langfuse.observation.type': 'tool',
            ...runtimeVersionAttrs,
            'gen_ai.tool.name': toolName,
            'mcp.request.id': toolId,
            'gen_ai.operation.name': 'execute_tool',
            ...(serverName ? { 'agentic.mcp.server.name': serverName } : {}),
            ...modelAttributes(assistant.model),
            ...usageAttributes(assistant.usage),
          },
        });
        continue;
      }

      if (toolName === 'Task') {
        events.push({
          runtime: 'claude-code',
          projectId,
          sessionId,
          turnId,
          category: 'agent_task',
          name: 'Tool: Task',
          startedAt: t,
          endedAt: t,
          input: JSON.stringify(toolInput),
          output: toolOutput,
          attributes: {
            'agentic.event.category': 'agent_task',
            'langfuse.observation.type': 'agent',
            ...runtimeVersionAttrs,
            'gen_ai.tool.name': 'Task',
            'gen_ai.tool.call.id': toolId,
            'gen_ai.operation.name': 'invoke_agent',
            ...modelAttributes(assistant.model),
            ...usageAttributes(assistant.usage),
          },
        });
        continue;
      }

      if (toolName) {
        events.push({
          runtime: 'claude-code',
          projectId,
          sessionId,
          turnId,
          category: 'tool',
          name: `Tool: ${toolName}`,
          startedAt: t,
          endedAt: t,
          input: JSON.stringify(toolInput),
          output: toolOutput,
          attributes: {
            'agentic.event.category': 'tool',
            'langfuse.observation.type': 'tool',
            ...runtimeVersionAttrs,
            'gen_ai.tool.name': toolName,
            'gen_ai.tool.call.id': toolId,
            'gen_ai.operation.name': 'execute_tool',
            ...modelAttributes(assistant.model),
            ...usageAttributes(assistant.usage),
          },
        });
      }
    }
  }

  const turnInput = String(events[0].input ?? '').trim();
  const turnOutput = String(events[0].output ?? '').trim();
  if (!turnInput && !turnOutput && events.length === 1) {
    return [];
  }

  return events;
}

async function readClaudeTranscript(transcriptPath) {
  const raw = await readFile(transcriptPath, 'utf-8');
  const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
  const messages = [];
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      messages.push({
        type: entry.type,
        isMeta: entry.isMeta ?? false,
        content: entry?.message?.content ?? entry.content ?? '',
        model: entry?.message?.model ?? entry.model,
      usage: pickUsage(entry?.message?.usage ?? entry?.usage ?? entry?.message_usage),
      runtimeVersion: entry?.version,
      messageId: entry?.message?.id,
        toolUseResult: entry?.toolUseResult,
        sourceToolUseId: entry?.sourceToolUseID ?? entry?.sourceToolUseId,
        timestamp: parseTimestamp(entry),
      });
    } catch {
      // ignore malformed lines
    }
  }
  messages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  return messages;
}

function groupByTurns(messages) {
  const turns = [];
  let current = [];

  for (const msg of messages) {
    if (isPromptUserMessage(msg)) {
      if (current.length > 0) turns.push(current);
      current = [msg];
      continue;
    }
    if (current.length > 0) current.push(msg);
  }
  if (current.length > 0) turns.push(current);
  return turns;
}

export const claudeCodeAdapter = {
  runtimeName: 'claude-code',

  resolveContextFromHook(payload) {
    const sessionId = payload.sessionId;
    const transcriptPath = payload.transcriptPath;
    if (!sessionId || !transcriptPath) return null;
    const projectId = parseProjectIdFromTranscript(transcriptPath);
    if (!projectId) return null;
    return { projectId, sessionId, transcriptPath };
  },

  async collectEvents(context) {
    const transcriptPath =
      context.transcriptPath ??
      path.join(process.env.HOME || '', '.claude', 'projects', context.projectId, `${context.sessionId}.jsonl`);

    const messages = await readClaudeTranscript(transcriptPath);
    const turns = groupByTurns(messages);

    const events = [];
    for (let i = 0; i < turns.length; i += 1) {
      events.push(...createTurn(turns[i], `turn-${i + 1}`, context.projectId, context.sessionId));
    }
    return events;
  },
};
