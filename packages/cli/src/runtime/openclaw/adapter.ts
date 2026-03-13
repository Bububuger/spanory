import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { extractToolUses } from '@bububuger/core';

import { RUNTIME_CAPABILITIES } from '../shared/capabilities.js';
import { forEachJsonlEntry } from '../shared/jsonl.js';
import { normalizeTranscriptMessages, parseProjectIdFromTranscriptPath, pickUsage } from '../shared/normalize.js';

const INFER_WINDOW_EPSILON_MS = 1200;

function parseTimestamp(entry) {
  const raw = entry?.timestamp ?? entry?.created_at ?? entry?.createdAt;
  const date = raw ? new Date(raw) : new Date();
  if (Number.isNaN(date.getTime())) return new Date();
  return date;
}

function normalizeToolName(name) {
  if (name === 'exec') return 'Bash';
  return name;
}

function normalizeContentBlocks(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const blocks = [];
  for (const block of content) {
    if (typeof block === 'string') {
      blocks.push(block);
      continue;
    }
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text') {
      blocks.push({ type: 'text', text: block.text ?? '' });
      continue;
    }
    if (block.type === 'toolCall') {
      blocks.push({
        type: 'tool_use',
        id: block.id ?? block.toolCallId ?? '',
        name: normalizeToolName(block.name ?? block.toolName ?? ''),
        input: block.arguments ?? block.input ?? {},
      });
      continue;
    }
    if (block.type === 'toolResult') {
      blocks.push({
        type: 'tool_result',
        tool_use_id: block.toolCallId ?? block.tool_call_id ?? block.id ?? '',
        content: block.content ?? '',
      });
      continue;
    }
    if (block.type === 'tool_use' || block.type === 'tool_result') {
      blocks.push(block);
      continue;
    }
  }
  return blocks;
}

function normalizeRole(entry) {
  if (entry?.type === 'message') {
    const role = entry?.message?.role;
    if (role === 'toolResult') return 'user';
    if (role) return role;
    return null;
  }
  if (entry?.role) return entry.role;
  if (entry?.message?.role) return entry.message.role;
  if (entry?.payload?.role) return entry.payload.role;
  if (entry?.type === 'user' || entry?.type === 'assistant' || entry?.type === 'system') return entry.type;
  return null;
}

function normalizeContent(entry) {
  if (entry?.type === 'message') {
    const role = entry?.message?.role;
    if (role === 'toolResult') {
      return [
        {
          type: 'tool_result',
          tool_use_id: entry?.message?.toolCallId ?? entry?.message?.tool_call_id ?? '',
          content: entry?.message?.content ?? '',
        },
      ];
    }
    return normalizeContentBlocks(entry?.message?.content ?? '');
  }
  return normalizeContentBlocks(entry?.message?.content ?? entry?.content ?? entry?.payload?.content ?? '');
}

function normalizeModel(entry) {
  return entry?.message?.model ?? entry?.model ?? entry?.payload?.model;
}

function normalizeMessageId(entry) {
  return entry?.message?.id ?? entry?.messageId ?? entry?.message_id ?? entry?.id;
}

function normalizeToolUseResult(entry) {
  return entry?.toolUseResult ?? entry?.tool_use_result ?? entry?.tool_result;
}

function normalizeSourceToolUseId(entry) {
  return (
    entry?.sourceToolUseID
    ?? entry?.sourceToolUseId
    ?? entry?.source_tool_use_id
    ?? entry?.message?.toolCallId
    ?? entry?.message?.tool_call_id
  );
}

function normalizeUsage(entry) {
  const raw = entry?.message?.usage
    ?? entry?.usage
    ?? entry?.message_usage
    ?? entry?.token_usage
    ?? entry?.payload?.usage;
  if (!raw || typeof raw !== 'object') return undefined;
  return pickUsage({
    input_tokens: raw.input_tokens ?? raw.prompt_tokens ?? raw.input,
    output_tokens: raw.output_tokens ?? raw.completion_tokens ?? raw.output,
    total_tokens: raw.total_tokens ?? raw.totalTokens,
    cache_read_input_tokens: raw.cache_read_input_tokens ?? raw.cacheRead,
    cache_creation_input_tokens: raw.cache_creation_input_tokens ?? raw.cacheWrite,
  });
}

function normalizeIsSidechain(entry) {
  const raw = entry?.isSidechain
    ?? entry?.is_sidechain
    ?? entry?.message?.isSidechain
    ?? entry?.message?.is_sidechain
    ?? entry?.payload?.isSidechain
    ?? entry?.payload?.is_sidechain;
  return raw === true;
}

function normalizeAgentId(entry) {
  return (
    entry?.agentId
    ?? entry?.agent_id
    ?? entry?.message?.agentId
    ?? entry?.message?.agent_id
    ?? entry?.payload?.agentId
    ?? entry?.payload?.agent_id
  );
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
  if (!message || message.role !== 'user' || message.isMeta) return false;
  const { content } = message;
  if (typeof content === 'string') return content.trim().length > 0;
  if (!Array.isArray(content)) return false;
  if (isToolResultOnlyContent(content)) return false;
  return content.length > 0;
}

function findChildSessionHints(messages) {
  const hasSidechainSignal = messages.some(
    (m) => m?.isSidechain === true || String(m?.agentId ?? '').trim().length > 0,
  );
  if (!hasSidechainSignal) return null;

  const hasParentLink = messages.some(
    (m) =>
      String(m?.parentSessionId ?? m?.parent_session_id ?? '').trim().length > 0
      || String(m?.parentTurnId ?? m?.parent_turn_id ?? '').trim().length > 0
      || String(m?.parentToolCallId ?? m?.parent_tool_call_id ?? '').trim().length > 0,
  );
  if (hasParentLink) return null;

  const sorted = [...messages].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const childStartedAt = sorted[0]?.timestamp;
  if (!childStartedAt) return null;

  return { childStartedAt };
}

function extractTaskWindows(messages, sessionId) {
  const sorted = [...messages].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const windows = [];
  const byCallId = new Map();

  let turnIndex = 0;
  let currentTurnId = 'turn-1';

  for (const msg of sorted) {
    if (isPromptUserMessage(msg)) {
      turnIndex += 1;
      currentTurnId = `turn-${turnIndex}`;
    }

    if (msg.role === 'assistant') {
      for (const tu of extractToolUses(msg.content)) {
        const toolName = String(tu.name ?? '').trim();
        if (toolName !== 'Task') continue;
        const callId = String(tu.id ?? '').trim();
        if (!callId) continue;
        const window = {
          parentSessionId: sessionId,
          parentTurnId: currentTurnId,
          parentToolCallId: callId,
          startedAtMs: msg.timestamp.getTime(),
          endedAtMs: msg.timestamp.getTime(),
        };
        windows.push(window);
        byCallId.set(callId, window);
      }
    }

    if (msg.role === 'user') {
      for (const tr of extractToolResults(msg.content)) {
        const callId = String(tr.tool_use_id ?? tr.toolUseId ?? '').trim();
        if (!callId) continue;
        const window = byCallId.get(callId);
        if (window) {
          window.endedAtMs = Math.max(window.endedAtMs, msg.timestamp.getTime());
        }
      }
    }
  }

  return windows;
}

async function inferParentLinkFromSiblingSessions({ transcriptPath, messages }) {
  const hints = findChildSessionHints(messages);
  if (!hints) return messages;

  const currentSessionId = path.basename(transcriptPath, '.jsonl');
  const dir = path.dirname(transcriptPath);
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return messages;
  }

  const candidates = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
    const siblingSessionId = entry.name.slice(0, -'.jsonl'.length);
    if (siblingSessionId === currentSessionId) continue;

    const siblingPath = path.join(dir, entry.name);
    const siblingMessages = await readOpenclawTranscript(siblingPath);
    const windows = extractTaskWindows(siblingMessages, siblingSessionId);
    for (const window of windows) {
      const childAtMs = hints.childStartedAt.getTime();
      const lower = window.startedAtMs - INFER_WINDOW_EPSILON_MS;
      const upper = window.endedAtMs + INFER_WINDOW_EPSILON_MS;
      if (childAtMs < lower || childAtMs > upper) continue;

      candidates.push({
        ...window,
        score: Math.abs(childAtMs - window.startedAtMs),
      });
    }
  }

  if (candidates.length === 0) return messages;
  candidates.sort((a, b) => a.score - b.score);
  const best = candidates[0];

  return messages.map((msg) => ({
    ...msg,
    parentSessionId: best.parentSessionId,
    parentTurnId: best.parentTurnId,
    parentToolCallId: best.parentToolCallId,
    parentLinkConfidence: 'inferred',
  }));
}

async function readOpenclawTranscript(transcriptPath) {
  const messages = [];
  let runtimeVersion;
  await forEachJsonlEntry(transcriptPath, (entry) => {
    if (entry?.type === 'session') {
      runtimeVersion = entry?.runtimeVersion
        ?? entry?.runtime_version
        ?? entry?.openclawVersion
        ?? entry?.openclaw_version
        ?? entry?.version
        ?? runtimeVersion;
      return;
    }
    const role = normalizeRole(entry);
    if (!role) return;
    messages.push({
      role,
      isMeta: entry?.isMeta ?? entry?.is_meta ?? false,
      isSidechain: normalizeIsSidechain(entry),
      agentId: normalizeAgentId(entry),
      parentSessionId: entry?.parentSessionId ?? entry?.parent_session_id,
      parentTurnId: entry?.parentTurnId ?? entry?.parent_turn_id,
      parentToolCallId: entry?.parentToolCallId ?? entry?.parent_tool_call_id,
      content: normalizeContent(entry),
      model: normalizeModel(entry),
      usage: normalizeUsage(entry),
      messageId: normalizeMessageId(entry),
      toolUseResult: normalizeToolUseResult(entry),
      sourceToolUseId: normalizeSourceToolUseId(entry),
      runtimeVersion:
        entry?.runtimeVersion
        ?? entry?.runtime_version
        ?? entry?.version
        ?? entry?.app_version
        ?? entry?.appVersion
        ?? runtimeVersion,
      timestamp: parseTimestamp(entry),
    });
  });
  messages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  return messages;
}

function resolveRuntimeHome(context) {
  return (
    context.runtimeHome
    ?? process.env.SPANORY_OPENCLAW_HOME
    ?? path.join(process.env.HOME || '', '.openclaw')
  );
}

function parseOpenclawProjectId(transcriptPath) {
  return (
    parseProjectIdFromTranscriptPath(transcriptPath, '/.openclaw/projects/')
    ?? parseProjectIdFromTranscriptPath(transcriptPath, '/.openclaw/agents/')
  );
}

async function resolveTranscriptPath(context) {
  if (context.transcriptPath) return context.transcriptPath;
  const runtimeHome = resolveRuntimeHome(context);
  const candidates = [
    path.join(runtimeHome, 'projects', context.projectId, `${context.sessionId}.jsonl`),
    path.join(runtimeHome, 'agents', context.projectId, 'sessions', `${context.sessionId}.jsonl`),
  ];
  for (const p of candidates) {
    try {
      await stat(p);
      return p;
    } catch {
      // try next candidate
    }
  }
  return candidates[0];
}

export const openclawAdapter = {
  runtimeName: 'openclaw',
  capabilities: RUNTIME_CAPABILITIES.openclaw,

  resolveContextFromHook(payload) {
    const sessionId = payload.sessionId;
    const transcriptPath = payload.transcriptPath;
    if (!sessionId || !transcriptPath) return null;
    const projectId = parseOpenclawProjectId(transcriptPath);
    if (!projectId) return null;
    return { projectId, sessionId, transcriptPath };
  },

  async collectEvents(context) {
    const transcriptPath = await resolveTranscriptPath(context);
    const loaded = await readOpenclawTranscript(transcriptPath);
    const messages = await inferParentLinkFromSiblingSessions({ transcriptPath, messages: loaded });
    return normalizeTranscriptMessages({
      runtime: 'openclaw',
      projectId: context.projectId,
      sessionId: context.sessionId,
      messages,
    });
  },
};
