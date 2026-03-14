// @ts-nocheck
// BUB-79: Scoped waiver for legacy Claude adapter parser; strict remains enforced at package command level.
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { extractToolUses } from '@bububuger/core';

import { RUNTIME_CAPABILITIES } from '../shared/capabilities.js';
import { forEachJsonlEntry } from '../shared/jsonl.js';
import { normalizeTranscriptMessages, parseProjectIdFromTranscriptPath, pickUsage } from '../shared/normalize.js';

const INFER_WINDOW_EPSILON_MS = 1200;

function parseTimestamp(entry) {
  const raw = entry?.timestamp;
  const date = raw ? new Date(raw) : new Date();
  if (Number.isNaN(date.getTime())) return new Date();
  return date;
}

function normalizeIsSidechain(entry) {
  const raw = entry?.isSidechain ?? entry?.is_sidechain ?? entry?.message?.isSidechain ?? entry?.message?.is_sidechain;
  return raw === true;
}

function normalizeAgentId(entry) {
  return entry?.agentId ?? entry?.agent_id ?? entry?.message?.agentId ?? entry?.message?.agent_id;
}

function extractToolResults(content) {
  if (!Array.isArray(content)) return [];
  return content.filter((block) => block && typeof block === 'object' && block.type === 'tool_result');
}

function isToolResultOnlyContent(content) {
  return (
    Array.isArray(content) &&
    content.length > 0 &&
    content.every((block) => block && typeof block === 'object' && block.type === 'tool_result')
  );
}

function isPromptUserMessage(message) {
  if (!message || message.role !== 'user' || message.isMeta) return false;
  const { content } = message;
  if (typeof content === 'string') return content.trim().length > 0;
  if (!Array.isArray(content)) return false;
  if (isToolResultOnlyContent(content)) return false;
  return content.length > 0;
}

function firstNonEmpty(values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

function findChildSessionHints(messages) {
  const hasSidechainSignal = messages.some(
    (m) => m?.isSidechain === true || String(m?.agentId ?? '').trim().length > 0,
  );
  if (!hasSidechainSignal) return null;

  const hasParentLink = messages.some(
    (m) =>
      String(m?.parentSessionId ?? m?.parent_session_id ?? '').trim().length > 0 ||
      String(m?.parentTurnId ?? m?.parent_turn_id ?? '').trim().length > 0 ||
      String(m?.parentToolCallId ?? m?.parent_tool_call_id ?? '').trim().length > 0,
  );
  if (hasParentLink) return null;

  const sorted = [...messages].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const childStartedAt = sorted[0]?.timestamp;
  if (!childStartedAt) return null;

  return {
    childStartedAt,
    agentId: firstNonEmpty(messages.map((m) => m?.agentId)),
  };
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
    const siblingMessages = await readClaudeTranscript(siblingPath);
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

async function readClaudeTranscript(transcriptPath) {
  const messages = [];
  await forEachJsonlEntry(transcriptPath, (entry) => {
    messages.push({
      role: entry.type,
      isMeta: entry.isMeta ?? false,
      isSidechain: normalizeIsSidechain(entry),
      agentId: normalizeAgentId(entry),
      parentSessionId: entry?.parentSessionId ?? entry?.parent_session_id,
      parentTurnId: entry?.parentTurnId ?? entry?.parent_turn_id,
      parentToolCallId: entry?.parentToolCallId ?? entry?.parent_tool_call_id,
      content: entry?.message?.content ?? entry.content ?? '',
      model: entry?.message?.model ?? entry.model,
      usage: pickUsage(entry?.message?.usage ?? entry?.usage ?? entry?.message_usage),
      runtimeVersion: entry?.version,
      messageId: entry?.message?.id,
      toolUseResult: entry?.toolUseResult,
      sourceToolUseId: entry?.sourceToolUseID ?? entry?.sourceToolUseId,
      timestamp: parseTimestamp(entry),
    });
  });
  messages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  return messages;
}

export const claudeCodeAdapter = {
  runtimeName: 'claude-code',
  capabilities: RUNTIME_CAPABILITIES['claude-code'],

  resolveContextFromHook(payload) {
    const sessionId = payload.sessionId;
    const transcriptPath = payload.transcriptPath;
    if (!sessionId || !transcriptPath) return null;
    const projectId = parseProjectIdFromTranscriptPath(transcriptPath, '/.claude/projects/');
    if (!projectId) return null;
    return { projectId, sessionId, transcriptPath };
  },

  async collectEvents(context) {
    const transcriptPath =
      context.transcriptPath ??
      path.join(process.env.HOME || '', '.claude', 'projects', context.projectId, `${context.sessionId}.jsonl`);

    const loaded = await readClaudeTranscript(transcriptPath);
    const messages = await inferParentLinkFromSiblingSessions({ transcriptPath, messages: loaded });
    return normalizeTranscriptMessages({
      runtime: 'claude-code',
      projectId: context.projectId,
      sessionId: context.sessionId,
      messages,
    });
  },
};
