// @ts-nocheck
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { RUNTIME_CAPABILITIES } from '../shared/capabilities.js';
import { normalizeTranscriptMessages, pickUsage } from '../shared/normalize.js';

function parseTimestamp(raw) {
  const date = raw ? new Date(raw) : new Date();
  if (Number.isNaN(date.getTime())) return new Date();
  return date;
}

function safeJsonParse(raw, fallback = {}) {
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

function normalizeToolCall(name, args, index) {
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

function sanitizeProjectBase(name) {
  const text = String(name ?? '').trim();
  if (!text) return 'codex';
  const out = text.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return out || 'codex';
}

function deriveProjectIdFromCwd(cwd) {
  const base = sanitizeProjectBase(path.basename(String(cwd ?? '').trim()) || 'codex');
  const hash = createHash('sha1').update(String(cwd ?? '')).digest('hex').slice(0, 6);
  return `${base}-${hash}`;
}

function usageFromTotals(start, end) {
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

function createTurn(turnId, startedAt) {
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

async function findSessionTranscript(sessionsRoot, sessionId) {
  const targetName = `${sessionId}.jsonl`;
  const stack = [sessionsRoot];

  while (stack.length > 0) {
    const dir = stack.pop();
    let entries = [];
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

function toIso(timestamp) {
  return parseTimestamp(timestamp).toISOString();
}

function buildMessagesFromTurns(turns, runtimeVersion) {
  const messages = [];

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

async function readCodexSession(transcriptPath) {
  const raw = await readFile(transcriptPath, 'utf-8');
  const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);

  const turns = [];
  let currentTurn = null;
  let pendingUserInput = '';
  let sessionMeta = null;
  let callCounter = 0;
  const callIndex = new Map();

  function finalizeCurrentTurn(at) {
    if (!currentTurn) return;
    currentTurn.endedAt = at ? toIso(at) : currentTurn.endedAt;
    turns.push(currentTurn);
    currentTurn = null;
  }

  function ensureCurrentTurn(at) {
    if (currentTurn) return currentTurn;
    currentTurn = createTurn(`turn-codex-${turns.length + 1}`, toIso(at));
    if (pendingUserInput) {
      currentTurn.userInput = pendingUserInput;
      pendingUserInput = '';
    }
    return currentTurn;
  }

  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const isoAt = toIso(entry.timestamp);

    if (entry.type === 'session_meta') {
      sessionMeta = entry.payload ?? {};
      continue;
    }

    if (entry.type === 'turn_context') {
      const turn = ensureCurrentTurn(entry.timestamp);
      const payload = entry.payload ?? {};
      if (payload.turn_id && turn.turnId.startsWith('turn-codex-')) {
        turn.turnId = payload.turn_id;
      }
      if (payload.model) turn.model = payload.model;
      if (payload.cwd) turn.cwd = payload.cwd;
      continue;
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
        continue;
      }

      if (payload.type === 'user_message') {
        const text = String(payload.message ?? '').trim();
        if (!text) continue;
        if (currentTurn && !currentTurn.userInput) {
          currentTurn.userInput = text;
        } else {
          pendingUserInput = text;
        }
        continue;
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
        continue;
      }

      if (payload.type === 'agent_message') {
        const turn = ensureCurrentTurn(entry.timestamp);
        if (payload.phase === 'final_answer') {
          turn.lastAgentMessage = String(payload.message ?? turn.lastAgentMessage ?? '');
        }
        continue;
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
        continue;
      }
      continue;
    }

    if (entry.type !== 'response_item') continue;
    const payload = entry.payload ?? {};

    if (payload.type === 'message' && payload.role === 'assistant' && Array.isArray(payload.content)) {
      const turn = ensureCurrentTurn(entry.timestamp);
      const text = payload.content
        .map((block) => {
          if (block?.type === 'output_text' || block?.type === 'input_text') return String(block.text ?? '');
          if (typeof block?.text === 'string') return block.text;
          if (typeof block?.output_text === 'string') return block.output_text;
          return '';
        })
        .filter(Boolean)
        .join('\n')
        .trim();
      if (text) turn.lastAgentMessage = text;
      continue;
    }

    if (payload.type === 'function_call' || payload.type === 'custom_tool_call') {
      const turn = ensureCurrentTurn(entry.timestamp);
      callCounter += 1;
      const rawName = payload.name ?? payload.tool_name ?? payload.toolName;
      const rawInput = payload.type === 'custom_tool_call' ? payload.input : payload.arguments;
      const args = safeJsonParse(rawInput, typeof rawInput === 'string' ? { raw: rawInput } : {});
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
      continue;
    }

    if (payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output') {
      const callId = String(payload.call_id ?? payload.callId ?? '');
      const call = callIndex.get(callId);
      if (call) {
        call.output = String(payload.output ?? '');
        call.endedAt = isoAt;
      }
      continue;
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
      continue;
    }
  }

  finalizeCurrentTurn(new Date().toISOString());

  const runtimeVersion = String(sessionMeta?.cli_version ?? '').trim() || undefined;
  const cwd = String(sessionMeta?.cwd ?? '').trim() || undefined;
  return {
    turns,
    runtimeVersion,
    cwd,
  };
}

function remapTurnIds(events, turns) {
  const generatedTurnIds = events
    .filter((event) => event.category === 'turn')
    .map((event) => event.turnId);
  const map = new Map();
  for (let i = 0; i < generatedTurnIds.length; i += 1) {
    const generated = generatedTurnIds[i];
    const rawTurnId = turns[i]?.turnId;
    if (generated && rawTurnId) map.set(generated, rawTurnId);
  }

  return events.map((event) => {
    const mappedTurnId = map.get(event.turnId);
    if (!mappedTurnId) return event;
    return {
      ...event,
      turnId: mappedTurnId,
      name: event.category === 'turn' ? `codex - Turn ${mappedTurnId}` : event.name,
    };
  });
}

function attachCwdAttribute(events, cwd) {
  if (!cwd) return events;
  return events.map((event) => ({
    ...event,
    attributes: {
      ...(event.attributes ?? {}),
      'agentic.project.cwd': cwd,
    },
  }));
}

function attachTurnCompletionAttribute(events, turns) {
  const completionByTurnId = new Map(turns.map((turn) => [turn.turnId, Boolean(turn.completed)]));
  return events.map((event) => {
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

function resolveRuntimeHome(context) {
  return context.runtimeHome ?? process.env.SPANORY_CODEX_HOME ?? path.join(process.env.HOME || '', '.codex');
}

export const codexAdapter = {
  runtimeName: 'codex',
  capabilities: RUNTIME_CAPABILITIES.codex,

  resolveContextFromHook(payload) {
    const sessionId = payload.sessionId;
    if (!sessionId) return null;
    const projectId = payload.cwd ? deriveProjectIdFromCwd(payload.cwd) : 'codex';
    return {
      projectId,
      sessionId,
      ...(payload.transcriptPath ? { transcriptPath: payload.transcriptPath } : {}),
    };
  },

  async collectEvents(context) {
    const runtimeHome = resolveRuntimeHome(context);
    const transcriptPath = context.transcriptPath
      ?? await findSessionTranscript(path.join(runtimeHome, 'sessions'), context.sessionId);

    const parsed = await readCodexSession(transcriptPath);
    const projectId = context.projectId || deriveProjectIdFromCwd(parsed.cwd ?? '');
    const messages = buildMessagesFromTurns(parsed.turns, parsed.runtimeVersion);
    const normalized = normalizeTranscriptMessages({
      runtime: 'codex',
      projectId,
      sessionId: context.sessionId,
      messages,
    });
    const withRawTurnIds = remapTurnIds(normalized, parsed.turns);
    const withCompletion = attachTurnCompletionAttribute(withRawTurnIds, parsed.turns);
    return attachCwdAttribute(withCompletion, parsed.cwd);
  },
};
