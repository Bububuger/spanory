
// BUB-79: Scoped waiver for legacy Codex adapter parser; strict remains enforced at package command level.
import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { RUNTIME_CAPABILITIES } from '../shared/capabilities.js';
import { forEachJsonlEntry } from '../shared/jsonl.js';
import { normalizeTranscriptMessages, pickUsage } from '../shared/normalize.js';

function parseTimestamp(raw: any) {
  const date = raw ? new Date(raw) : new Date();
  if (Number.isNaN(date.getTime())) return new Date();
  return date;
}

function safeJsonParse(raw: any, fallback: Record<string, any> = {}) {
  if (typeof raw !== 'string') {
    if (raw && typeof raw === 'object') return raw;
    return fallback;
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    // ignore parse errors
  }
  return fallback;
}

function normalizeToolCall(name: any, args: Record<string, any>, index: number) {
  const normalizedName = String(name ?? '').trim();
  const shellTools = new Set(['exec_command', 'shell_command', 'write_stdin']);
  const agentTaskTools = new Set(['spawn_agent', 'wait', 'close_agent']);

  if (shellTools.has(normalizedName)) {
    const command = String(args.command ?? args.cmd ?? args.chars ?? '').trim();
    return {
      toolName: 'Bash',
      input: command ? { command } : args,
      callId: `call-shell-${index}`,
    };
  }

  if (agentTaskTools.has(normalizedName)) {
    return {
      toolName: 'Task',
      input: { name: normalizedName, ...args },
      callId: `call-task-${index}`,
    };
  }

  return {
    toolName: normalizedName || 'tool',
    input: args,
    callId: `call-tool-${index}`,
  };
}

function sanitizeProjectBase(name: any) {
  const text = String(name ?? '').trim();
  if (!text) return 'codex';
  const out = text
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return out || 'codex';
}

function deriveProjectIdFromCwd(cwd: any) {
  const base = sanitizeProjectBase(path.basename(String(cwd ?? '').trim()) || 'codex');
  const hash = createHash('sha1')
    .update(String(cwd ?? ''))
    .digest('hex')
    .slice(0, 10);
  return `${base}-${hash}`;
}

function usageFromTotals(start: Record<string, any> | undefined, end: Record<string, any> | undefined) {
  if (!start || !end) return undefined;
  const input = Math.max(0, Number(end.input_tokens ?? 0) - Number(start.input_tokens ?? 0));
  const output = Math.max(0, Number(end.output_tokens ?? 0) - Number(start.output_tokens ?? 0));
  const total = Math.max(0, Number(end.total_tokens ?? 0) - Number(start.total_tokens ?? 0));
  if (input === 0 && output === 0 && total === 0) return undefined;
  return pickUsage({
    input_tokens: input,
    output_tokens: output,
    total_tokens: total || input + output,
  });
}

function extractPtySessionId(output: any) {
  const text = String(output ?? '');
  const match = text.match(/session ID\s+(\d+)/i);
  return match ? match[1] : undefined;
}

function extractWallTimeMs(output: any) {
  const text = String(output ?? '');
  const match = text.match(/Wall time:\s*([0-9]+(?:\.[0-9]+)?)\s*seconds?/i);
  if (!match) return undefined;
  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return Math.floor(seconds * 1000);
}

function createTurn(turnId: string, startedAt: string) {
  return {
    turnId,
    startedAt,
    endedAt: startedAt,
    completed: false,
    userInput: '',
    lastAgentMessage: '',
    model: undefined,
    cwd: undefined,
    calls: [],
    lastUsage: undefined,
    totalUsageStart: undefined,
    totalUsageEnd: undefined,
  };
}

async function findSessionTranscript(sessionsRoot: string, sessionId: string) {
  const targetName = `${sessionId}.jsonl`;
  const stack = [sessionsRoot];

  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: import('node:fs').Dirent[] = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (entry.isFile() && entry.name === targetName) {
        return full;
      }
    }
  }

  throw new Error(`codex session transcript not found: ${targetName} under ${sessionsRoot}`);
}

function toIso(timestamp: any) {
  return parseTimestamp(timestamp).toISOString();
}

function buildMessagesFromTurns(turns: Record<string, any>[], runtimeVersion: string | undefined) {
  const messages: Record<string, any>[] = [];

  for (const turn of turns) {
    const input = String(turn.userInput ?? '').trim() || '(no user message captured)';
    messages.push({
      role: 'user',
      isMeta: false,
      content: input,
      runtimeVersion,
      messageId: `${turn.turnId}:user`,
      timestamp: parseTimestamp(turn.startedAt),
    });

    for (let i = 0; i < turn.calls.length; i += 1) {
      const call = turn.calls[i];
      const callId = String(call.callId ?? `call-${i + 1}`);
      messages.push({
        role: 'assistant',
        isMeta: false,
        content: [
          {
            type: 'tool_use',
            id: callId,
            name: call.toolName,
            input: call.input ?? {},
          },
        ],
        model: turn.model,
        runtimeVersion,
        messageId: `${turn.turnId}:tool-use:${i + 1}`,
        timestamp: parseTimestamp(call.startedAt ?? turn.startedAt),
      });
      messages.push({
        role: 'user',
        isMeta: false,
        content: [
          {
            type: 'tool_result',
            tool_use_id: callId,
            content: String(call.output ?? ''),
          },
        ],
        sourceToolUseId: callId,
        toolUseResult: {
          stdout: String(call.output ?? ''),
        },
        runtimeVersion,
        messageId: `${turn.turnId}:tool-result:${i + 1}`,
        timestamp: parseTimestamp(call.endedAt ?? call.startedAt ?? turn.endedAt),
      });
    }

    messages.push({
      role: 'assistant',
      isMeta: false,
      content: [{ type: 'text', text: String(turn.lastAgentMessage ?? '') }],
      model: turn.model,
      usage: turn.lastUsage ?? usageFromTotals(turn.totalUsageStart, turn.totalUsageEnd),
      runtimeVersion,
      messageId: `${turn.turnId}:assistant`,
      timestamp: parseTimestamp(turn.endedAt),
    });
  }

  messages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  return messages;
}

async function readCodexSession(transcriptPath: string) {
  const turns: Record<string, any>[] = [];
  let currentTurn: Record<string, any> | null = null;
  let pendingUserInput = '';
  let sessionMeta: Record<string, any> | null = null;
  let callCounter = 0;
  const callIndex = new Map();
  const ptyCallBySession = new Map();

  function finalizeCurrentTurn(at: any) {
    if (!currentTurn) return;
    currentTurn.endedAt = at ? toIso(at) : currentTurn.endedAt;
    turns.push(currentTurn);
    currentTurn = null;
  }

  function ensureCurrentTurn(at: any) {
    if (currentTurn) return currentTurn;
    currentTurn = createTurn(`turn-codex-${turns.length + 1}`, toIso(at));
    if (pendingUserInput) {
      currentTurn.userInput = pendingUserInput;
      pendingUserInput = '';
    }
    return currentTurn;
  }

  await forEachJsonlEntry(transcriptPath, (entry) => {
    const isoAt = toIso(entry.timestamp);

    if (entry.type === 'session_meta') {
      sessionMeta = entry.payload ?? {};
      return;
    }

    if (entry.type === 'turn_context') {
      const turn = ensureCurrentTurn(entry.timestamp);
      const payload = entry.payload ?? {};
      if (payload.turn_id && turn.turnId.startsWith('turn-codex-')) {
        turn.turnId = payload.turn_id;
      }
      if (payload.model) turn.model = payload.model;
      if (payload.cwd) turn.cwd = payload.cwd;
      return;
    }

    if (entry.type === 'event_msg') {
      const payload = entry.payload ?? {};
      if (payload.type === 'task_started') {
        finalizeCurrentTurn(entry.timestamp);
        currentTurn = createTurn(payload.turn_id ?? `turn-codex-${turns.length + 1}`, isoAt);
        if (pendingUserInput) {
          currentTurn.userInput = pendingUserInput;
          pendingUserInput = '';
        }
        return;
      }

      if (payload.type === 'user_message') {
        const text = String(payload.message ?? '').trim();
        if (!text) return;
        if (currentTurn && !currentTurn.userInput) {
          currentTurn.userInput = text;
        } else {
          pendingUserInput = text;
        }
        return;
      }

      if (payload.type === 'token_count') {
        const turn = ensureCurrentTurn(entry.timestamp);
        const info = payload.info ?? {};
        const lastUsage = pickUsage(info.last_token_usage ?? info.lastTokenUsage);
        if (lastUsage) {
          turn.lastUsage = lastUsage;
        }
        const totalUsage = pickUsage(info.total_token_usage ?? info.totalTokenUsage);
        if (totalUsage) {
          if (!turn.totalUsageStart) turn.totalUsageStart = totalUsage;
          turn.totalUsageEnd = totalUsage;
        }
        return;
      }

      if (payload.type === 'agent_message') {
        const turn = ensureCurrentTurn(entry.timestamp);
        if (payload.phase === 'final_answer') {
          turn.lastAgentMessage = String(payload.message ?? turn.lastAgentMessage ?? '');
        }
        return;
      }

      if (payload.type === 'task_complete' || payload.type === 'turn_aborted') {
        const turn = ensureCurrentTurn(entry.timestamp);
        if (payload.turn_id) turn.turnId = payload.turn_id;
        if (payload.last_agent_message) {
          turn.lastAgentMessage = String(payload.last_agent_message);
        }
        turn.completed = true;
        turn.endedAt = isoAt;
        finalizeCurrentTurn(entry.timestamp);
        return;
      }
      return;
    }

    if (entry.type !== 'response_item') return;
    const payload = entry.payload ?? {};

    if (payload.type === 'message' && payload.role === 'assistant' && Array.isArray(payload.content)) {
      const turn = ensureCurrentTurn(entry.timestamp);
      const text = payload.content
        .map((block: any) => {
          if (block?.type === 'output_text' || block?.type === 'input_text') return String(block.text ?? '');
          if (typeof block?.text === 'string') return block.text;
          if (typeof block?.output_text === 'string') return block.output_text;
          return '';
        })
        .filter(Boolean)
        .join('\n')
        .trim();
      if (text) turn.lastAgentMessage = text;
      return;
    }

    if (payload.type === 'function_call' || payload.type === 'custom_tool_call') {
      const turn = ensureCurrentTurn(entry.timestamp);
      callCounter += 1;
      const rawName = payload.name ?? payload.tool_name ?? payload.toolName;
      const rawInput = payload.type === 'custom_tool_call' ? payload.input : payload.arguments;
      const args = safeJsonParse(rawInput, typeof rawInput === 'string' ? { raw: rawInput } : {});
      const ptySessionId = args.session_id != null ? String(args.session_id) : '';
      if (String(rawName ?? '') === 'write_stdin' && ptySessionId && ptyCallBySession.has(ptySessionId)) {
        callIndex.set(
          String(payload.call_id ?? payload.callId ?? `call-${callCounter}`),
          ptyCallBySession.get(ptySessionId),
        );
        return;
      }
      const normalized = normalizeToolCall(rawName, args, callCounter);
      const callId = String(payload.call_id ?? payload.callId ?? normalized.callId ?? `call-${callCounter}`);
      const call = {
        callId,
        toolName: normalized.toolName,
        input: normalized.input,
        output: '',
        startedAt: isoAt,
        endedAt: isoAt,
      };
      turn.calls.push(call);
      callIndex.set(callId, call);
      return;
    }

    if (payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output') {
      const callId = String(payload.call_id ?? payload.callId ?? '');
      const call = callIndex.get(callId);
      if (call) {
        const output = String(payload.output ?? '');
        if (output) call.output = output;
        call.endedAt = isoAt;
        const wallTimeMs = extractWallTimeMs(output);
        if (wallTimeMs) {
          const derivedEndedAt = new Date(parseTimestamp(call.startedAt).getTime() + wallTimeMs).toISOString();
          if (parseTimestamp(derivedEndedAt).getTime() > parseTimestamp(call.endedAt).getTime()) {
            call.endedAt = derivedEndedAt;
          }
        }
        if (call.toolName === 'Bash') {
          const ptySessionId = extractPtySessionId(output);
          if (ptySessionId) ptyCallBySession.set(ptySessionId, call);
        }
      }
      return;
    }

    if (payload.type === 'web_search_call') {
      const turn = ensureCurrentTurn(entry.timestamp);
      callCounter += 1;
      const call = {
        callId: `call-web-search-${callCounter}`,
        toolName: 'WebSearch',
        input: payload.action ?? {},
        output: JSON.stringify({
          status: payload.status ?? 'unknown',
          query: payload.action?.query ?? '',
        }),
        startedAt: isoAt,
        endedAt: isoAt,
      };
      turn.calls.push(call);
      return;
    }
  });

  finalizeCurrentTurn(new Date().toISOString());

  const runtimeVersion = String((sessionMeta as Record<string, any> | null)?.cli_version ?? '').trim() || undefined;
  const cwd = String((sessionMeta as Record<string, any> | null)?.cwd ?? '').trim() || undefined;
  return {
    turns,
    runtimeVersion,
    cwd,
  };
}

function remapTurnIds(events: Record<string, any>[], turns: Record<string, any>[]) {
  const generatedTurnIds = events.filter((event: Record<string, any>) => event.category === 'turn').map((event: Record<string, any>) => event.turnId);
  const map = new Map();
  for (let i = 0; i < generatedTurnIds.length; i += 1) {
    const generated = generatedTurnIds[i];
    const rawTurnId = turns[i]?.turnId;
    if (generated && rawTurnId) map.set(generated, rawTurnId);
  }

  return events.map((event: Record<string, any>) => {
    const mappedTurnId = map.get(event.turnId);
    if (!mappedTurnId) return event;
    return {
      ...event,
      turnId: mappedTurnId,
      name: event.category === 'turn' ? `codex - Turn ${mappedTurnId}` : event.name,
    };
  });
}

function attachCwdAttribute(events: Record<string, any>[], cwd: string | undefined) {
  if (!cwd) return events;
  const sanitizedCwd = deriveProjectIdFromCwd(cwd);
  return events.map((event: Record<string, any>) => ({
    ...event,
    attributes: {
      ...(event.attributes ?? {}),
      'agentic.project.cwd': sanitizedCwd,
    },
  }));
}

function attachTurnCompletionAttribute(events: Record<string, any>[], turns: Record<string, any>[]) {
  const completionByTurnId = new Map(turns.map((turn: Record<string, any>) => [turn.turnId, Boolean(turn.completed)]));
  return events.map((event: Record<string, any>) => {
    if (event.category !== 'turn') return event;
    return {
      ...event,
      attributes: {
        ...(event.attributes ?? {}),
        'agentic.turn.completed': completionByTurnId.get(event.turnId) ?? false,
      },
    };
  });
}

function resolveRuntimeHome(context: Record<string, any>) {
  return context.runtimeHome ?? process.env.SPANORY_CODEX_HOME ?? path.join(process.env.HOME || '', '.codex');
}

export const codexAdapter = {
  runtimeName: 'codex',
  capabilities: RUNTIME_CAPABILITIES.codex,

  resolveContextFromHook(payload: Record<string, any>) {
    const sessionId = payload.sessionId;
    if (!sessionId) return null;
    const projectId = payload.cwd ? deriveProjectIdFromCwd(payload.cwd) : 'codex';
    return {
      projectId,
      sessionId,
      ...(payload.transcriptPath ? { transcriptPath: payload.transcriptPath } : {}),
    };
  },

  async collectEvents(context: Record<string, any>) {
    const runtimeHome = resolveRuntimeHome(context);
    const transcriptPath =
      context.transcriptPath ?? (await findSessionTranscript(path.join(runtimeHome, 'sessions'), context.sessionId));

    const parsed = await readCodexSession(transcriptPath);
    const projectId = context.projectId || deriveProjectIdFromCwd(parsed.cwd ?? '');
    const messages = buildMessagesFromTurns(parsed.turns, parsed.runtimeVersion);
    const normalized = normalizeTranscriptMessages({
      runtime: 'codex',
      projectId,
      sessionId: context.sessionId,
      messages: messages as import('../../types.js').TranscriptMessage[],
    });
    const withRawTurnIds = remapTurnIds(normalized, parsed.turns);
    const withCompletion = attachTurnCompletionAttribute(withRawTurnIds, parsed.turns);
    return attachCwdAttribute(withCompletion, parsed.cwd);
  },
};
