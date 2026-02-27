import { readFile } from 'node:fs/promises';
import path from 'node:path';

function parseTimestamp(entry) {
  const raw = entry?.timestamp;
  const date = raw ? new Date(raw) : new Date();
  if (Number.isNaN(date.getTime())) return new Date();
  return date;
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
  const user = messages.find((m) => m.type === 'user' && !m.isMeta) ?? messages[0];
  const assistants = messages.filter((m) => m.type === 'assistant');
  const start = user?.timestamp ?? messages[0]?.timestamp ?? new Date();
  const end = messages[messages.length - 1]?.timestamp ?? start;

  const output = assistants.map((m) => extractText(m.content)).filter(Boolean).join('\n');

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
      input: extractText(user?.content),
      output,
      attributes: {
        'agentic.event.category': 'turn',
      },
    },
  ];

  const resultByToolId = new Map();
  for (const msg of messages) {
    if (msg.type !== 'user') continue;
    for (const tr of extractToolResults(msg.content)) {
      const toolUseId = String(tr.tool_use_id ?? tr.toolUseId ?? '');
      if (!toolUseId) continue;
      const content = typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content ?? '');
      resultByToolId.set(toolUseId, content);
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
          'agentic.command.name': slash.name,
          'agentic.command.args': slash.args,
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
            'process.command_line': commandLine,
            'gen_ai.tool.name': 'Bash',
            'gen_ai.tool.call.id': toolId,
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
            'gen_ai.tool.name': toolName,
            'mcp.request.id': toolId,
            ...(serverName ? { 'agentic.mcp.server.name': serverName } : {}),
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
            'gen_ai.tool.name': 'Task',
            'gen_ai.tool.call.id': toolId,
          },
        });
      }
    }
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
    if (msg.type === 'user' && !msg.isMeta) {
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
