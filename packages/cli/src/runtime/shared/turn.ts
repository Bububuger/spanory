import type { Attributes, TranscriptMessage } from '../../types.js';
import {
  extractReasoningBlocks,
  extractText,
  extractToolResultText,
  extractToolResults,
  extractToolUses,
  isMcpToolName,
  isPromptUserMessage,
  isoFromUnknownTimestamp,
  parseBashCommandAttributes,
  parseSlashCommand,
} from './content.js';
import { normalizeUserInput, runtimeVersionAttributes } from './gateway.js';
import { REDACTED, redactBody, truncateText } from './redaction.js';
import { addUsage, modelAttributes, usageAttributes } from './usage.js';

function actorHeuristic(messages: TranscriptMessage[]): { role: string; confidence: number } {
  const hasSidechainSignal = messages.some(
    (m) => m?.isSidechain === true || (typeof m?.agentId === 'string' && m.agentId.trim().length > 0),
  );
  if (hasSidechainSignal) return { role: 'unknown', confidence: 0.6 };
  return { role: 'main', confidence: 0.95 };
}

function firstNonEmptyString(values: unknown[]): string {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

function inferParentLinkAttributes(messages: TranscriptMessage[]): Record<string, string> {
  const agentId = firstNonEmptyString(
    messages.map((m) => m?.agentId ?? m?.agent_id ?? m?.message?.agentId ?? m?.message?.agent_id),
  );

  const parentSessionId = firstNonEmptyString(
    messages.map(
      (m) =>
        m?.parentSessionId ??
        m?.parent_session_id ??
        m?.parent?.sessionId ??
        m?.parent?.session_id ??
        m?.session_meta?.parent_session_id ??
        m?.sessionMeta?.parentSessionId,
    ),
  );

  const parentTurnId = firstNonEmptyString(
    messages.map(
      (m) =>
        m?.parentTurnId ??
        m?.parent_turn_id ??
        m?.parent?.turnId ??
        m?.parent?.turn_id ??
        m?.session_meta?.parent_turn_id ??
        m?.sessionMeta?.parentTurnId,
    ),
  );

  const parentToolCallId = firstNonEmptyString(
    messages.map(
      (m) =>
        m?.parentToolCallId ??
        m?.parent_tool_call_id ??
        m?.parent?.toolCallId ??
        m?.parent?.tool_call_id ??
        m?.session_meta?.parent_tool_call_id ??
        m?.sessionMeta?.parentToolCallId,
    ),
  );

  const explicitConfidence = firstNonEmptyString(
    messages.map((m) => m?.parentLinkConfidence ?? m?.parent_link_confidence),
  );

  const attrs: Record<string, string> = {};
  if (agentId) {
    attrs['gen_ai.agent.id'] = agentId;
  }
  if (parentSessionId) attrs['agentic.parent.session_id'] = parentSessionId;
  if (parentTurnId) attrs['agentic.parent.turn_id'] = parentTurnId;
  if (parentToolCallId) attrs['agentic.parent.tool_call_id'] = parentToolCallId;

  if (explicitConfidence) {
    attrs['agentic.parent.link.confidence'] = explicitConfidence;
  } else if (parentSessionId || parentTurnId || parentToolCallId) {
    attrs['agentic.parent.link.confidence'] = 'exact';
  } else if (agentId) {
    attrs['agentic.parent.link.confidence'] = 'unknown';
  }

  return attrs;
}

const DEFAULT_TOOL_CONTENT_MAX_BYTES = 131072;

function toolContentMaxBytes() {
  const raw = Number(process.env.SPANORY_TOOL_CONTENT_MAX_BYTES);
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  return DEFAULT_TOOL_CONTENT_MAX_BYTES;
}

function isFileTool(toolName: string, toolInput: Record<string, unknown>): boolean {
  const normalizedName = String(toolName ?? '')
    .trim()
    .toLowerCase();
  if (['read', 'write', 'edit', 'multiedit'].includes(normalizedName)) return true;
  if (normalizedName.includes('file')) return true;
  if (!toolInput || typeof toolInput !== 'object') return false;
  return ['file_path', 'filepath', 'path', 'target_file', 'targetPath', 'old_string', 'new_string'].some((key) =>
    Object.prototype.hasOwnProperty.call(toolInput, key),
  );
}

function serializeToolInput(toolName: string, toolInput: Record<string, unknown>): string {
  const maxBytes = toolContentMaxBytes();
  const payload = redactBody(toolInput ?? {}, maxBytes, {
    extraSensitiveKeyPattern: isFileTool(toolName, toolInput)
      ? /(content|token|secret|password|private[_-]?key)/i
      : undefined,
  });
  return JSON.stringify(payload);
}

function serializeToolOutput(toolName: string, toolInput: Record<string, unknown>, toolOutput: string): string {
  if (isFileTool(toolName, toolInput)) return REDACTED;
  return truncateText(toolOutput, toolContentMaxBytes());
}

export interface TurnEvent {
  runtime: string;
  projectId: string;
  sessionId: string;
  turnId: string;
  category: string;
  name: string;
  startedAt: string;
  endedAt: string;
  input: string;
  output: string;
  attributes: Record<string, string | number | boolean>;
}

export function createTurn(
  messages: TranscriptMessage[],
  turnId: string,
  projectId: string,
  sessionId: string,
  runtime: string,
): TurnEvent[] {
  const user =
    messages.find(isPromptUserMessage) ?? messages.find((m) => m.role === 'user' && !m.isMeta) ?? messages[0];
  const assistantsRaw = messages.filter((m) => m.role === 'assistant');
  const assistantOrder: string[] = [];
  const assistantLatest = new Map<string, TranscriptMessage>();
  for (let i = 0; i < assistantsRaw.length; i += 1) {
    const msg = assistantsRaw[i];
    const key = msg.messageId ? `id:${msg.messageId}` : `idx:${i}`;
    if (!assistantLatest.has(key)) assistantOrder.push(key);
    assistantLatest.set(key, msg);
  }
  const assistants = assistantOrder.map((key) => assistantLatest.get(key)!).filter(Boolean);
  const start = user?.timestamp ?? messages[0]?.timestamp ?? new Date();
  const end = messages[messages.length - 1]?.timestamp ?? start;

  const output = assistants
    .map((m) => extractText(m.content))
    .filter(Boolean)
    .join('\n');
  const runtimeVersion = [...messages]
    .map((m) => String(m.runtimeVersion ?? '').trim())
    .filter(Boolean)
    .at(-1);
  const runtimeAttrs = runtimeVersionAttributes(runtimeVersion);
  const normalizedInput = normalizeUserInput(user?.content);

  const totalUsage: Record<string, number> = {};
  let latestModel: string | undefined;
  for (const msg of assistants) {
    if (msg.model) latestModel = msg.model;
    addUsage(totalUsage, msg.usage as Record<string, number> | undefined);
  }
  const usage = Object.keys(totalUsage).length ? totalUsage : undefined;
  const actor = actorHeuristic(messages);
  const parentLinkAttrs = inferParentLinkAttributes(messages);
  const sharedAttrs = { ...runtimeAttrs, ...parentLinkAttrs };

  const events: TurnEvent[] = [
    {
      runtime,
      projectId,
      sessionId,
      turnId,
      category: 'turn',
      name: `${runtime} - Turn ${turnId}`,
      startedAt: start.toISOString(),
      endedAt: end.toISOString(),
      input: normalizedInput.input,
      output,
      attributes: {
        'agentic.event.category': 'turn',
        'langfuse.observation.type': 'agent',
        'gen_ai.operation.name': 'invoke_agent',
        ...sharedAttrs,
        ...modelAttributes(latestModel),
        'agentic.actor.role': actor.role,
        'agentic.actor.role_confidence': actor.confidence,
        ...normalizedInput.attributes,
        ...usageAttributes(usage),
      },
    },
  ];

  const resultByToolId = new Map<string, { content: string; endedAt: string }>();
  for (const msg of messages) {
    if (msg.role !== 'user') continue;
    const resultAt = isoFromUnknownTimestamp(msg.timestamp, end);
    for (const tr of extractToolResults(msg.content)) {
      const toolUseId = String(tr.tool_use_id ?? tr.toolUseId ?? '');
      if (!toolUseId) continue;
      const content = extractToolResultText(tr, msg);
      if (!resultByToolId.has(toolUseId) || !resultByToolId.get(toolUseId)?.content) {
        resultByToolId.set(toolUseId, { content, endedAt: resultAt });
      }
    }

    if (msg.sourceToolUseId) {
      const fallback = extractToolResultText({}, msg);
      if (fallback && (!resultByToolId.has(msg.sourceToolUseId) || !resultByToolId.get(msg.sourceToolUseId)?.content)) {
        resultByToolId.set(msg.sourceToolUseId, { content: fallback, endedAt: resultAt });
      }
    }
  }

  if (user?.role === 'user') {
    const slash = parseSlashCommand(extractText(user.content));
    if (slash) {
      const isMcp = slash.name.toLowerCase() === 'mcp' || slash.name.toLowerCase().startsWith('mcp:');
      events.push({
        runtime,
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
          ...sharedAttrs,
          'agentic.command.name': slash.name,
          'agentic.command.args': slash.args,
          'gen_ai.operation.name': isMcp ? 'execute_tool' : 'invoke_agent',
        },
      });
    }
  }

  for (const assistant of assistants) {
    const reasoningBlocks = extractReasoningBlocks(assistant.content);
    for (const reasoning of reasoningBlocks) {
      const reasoningText = String(reasoning?.text ?? '').trim();
      if (!reasoningText) continue;
      const reasoningAt = isoFromUnknownTimestamp(reasoning?.timestamp, assistant.timestamp ?? end);
      events.push({
        runtime,
        projectId,
        sessionId,
        turnId,
        category: 'reasoning',
        name: 'Assistant Reasoning',
        startedAt: reasoningAt,
        endedAt: reasoningAt,
        input: '',
        output: reasoningText,
        attributes: {
          'agentic.event.category': 'reasoning',
          'langfuse.observation.type': 'span',
          ...sharedAttrs,
          'gen_ai.operation.name': 'invoke_agent',
          ...modelAttributes(assistant.model),
        },
      });
    }

    const toolUses = extractToolUses(assistant.content);
    for (const tu of toolUses) {
      const toolName = String(tu.name ?? '');
      const toolId = String(tu.id ?? '');
      const toolInput = (tu.input ?? {}) as Record<string, unknown>;
      const toolResult = resultByToolId.get(toolId);
      const toolOutput = toolResult?.content ?? '';
      const t = (assistant.timestamp ?? end).toISOString();
      const toolEndedAt = toolResult?.endedAt ?? t;

      if (toolName === 'Bash') {
        const commandLine = String(toolInput.command ?? '');
        events.push({
          runtime,
          projectId,
          sessionId,
          turnId,
          category: 'shell_command',
          name: 'Tool: Bash',
          startedAt: t,
          endedAt: toolEndedAt,
          input: commandLine,
          output: toolOutput,
          attributes: {
            'agentic.event.category': 'shell_command',
            'langfuse.observation.type': 'tool',
            ...sharedAttrs,
            'process.command_line': commandLine,
            ...parseBashCommandAttributes(commandLine),
            'gen_ai.tool.name': 'Bash',
            'gen_ai.tool.call.id': toolId,
            'gen_ai.operation.name': 'execute_tool',
            ...modelAttributes(assistant.model),
            ...usageAttributes(assistant.usage as Record<string, number> | undefined),
          },
        });
        continue;
      }

      if (isMcpToolName(toolName)) {
        const serverName = toolName.startsWith('mcp__') ? toolName.split('__')[1] : undefined;
        events.push({
          runtime,
          projectId,
          sessionId,
          turnId,
          category: 'mcp',
          name: `Tool: ${toolName}`,
          startedAt: t,
          endedAt: toolEndedAt,
          input: serializeToolInput(toolName, toolInput),
          output: serializeToolOutput(toolName, toolInput, toolOutput),
          attributes: {
            'agentic.event.category': 'mcp',
            'langfuse.observation.type': 'tool',
            ...sharedAttrs,
            'gen_ai.tool.name': toolName,
            'mcp.request.id': toolId,
            'gen_ai.operation.name': 'execute_tool',
            ...(serverName ? { 'agentic.mcp.server.name': serverName } : {}),
            ...modelAttributes(assistant.model),
            ...usageAttributes(assistant.usage as Record<string, number> | undefined),
          },
        });
        continue;
      }

      if (toolName === 'Task') {
        events.push({
          runtime,
          projectId,
          sessionId,
          turnId,
          category: 'agent_task',
          name: 'Tool: Task',
          startedAt: t,
          endedAt: toolEndedAt,
          input: serializeToolInput(toolName, toolInput),
          output: serializeToolOutput(toolName, toolInput, toolOutput),
          attributes: {
            'agentic.event.category': 'agent_task',
            'langfuse.observation.type': 'agent',
            ...sharedAttrs,
            'gen_ai.tool.name': 'Task',
            'gen_ai.tool.call.id': toolId,
            'gen_ai.operation.name': 'invoke_agent',
            ...modelAttributes(assistant.model),
            ...usageAttributes(assistant.usage as Record<string, number> | undefined),
          },
        });
        continue;
      }

      if (toolName) {
        events.push({
          runtime,
          projectId,
          sessionId,
          turnId,
          category: 'tool',
          name: `Tool: ${toolName}`,
          startedAt: t,
          endedAt: toolEndedAt,
          input: serializeToolInput(toolName, toolInput),
          output: serializeToolOutput(toolName, toolInput, toolOutput),
          attributes: {
            'agentic.event.category': 'tool',
            'langfuse.observation.type': 'tool',
            ...sharedAttrs,
            'gen_ai.tool.name': toolName,
            'gen_ai.tool.call.id': toolId,
            'gen_ai.operation.name': 'execute_tool',
            ...modelAttributes(assistant.model),
            ...usageAttributes(assistant.usage as Record<string, number> | undefined),
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
  events[0].attributes['agentic.subagent.calls'] = events.filter((e) => e.category === 'agent_task').length;

  return events;
}
