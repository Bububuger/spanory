import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { RUNTIME_CAPABILITIES } from '../shared/capabilities.js';
import { normalizeTranscriptMessages, parseProjectIdFromTranscriptPath, pickUsage } from '../shared/normalize.js';

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

async function readOpenclawTranscript(transcriptPath) {
  const raw = await readFile(transcriptPath, 'utf-8');
  const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
  const messages = [];
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      const role = normalizeRole(entry);
      if (!role) continue;
      messages.push({
        role,
        isMeta: entry?.isMeta ?? entry?.is_meta ?? false,
        isSidechain: normalizeIsSidechain(entry),
        agentId: normalizeAgentId(entry),
        content: normalizeContent(entry),
        model: normalizeModel(entry),
        usage: normalizeUsage(entry),
        runtimeVersion: entry?.version ?? entry?.app_version ?? entry?.appVersion,
        messageId: normalizeMessageId(entry),
        toolUseResult: normalizeToolUseResult(entry),
        sourceToolUseId: normalizeSourceToolUseId(entry),
        timestamp: parseTimestamp(entry),
      });
    } catch {
      // ignore malformed lines
    }
  }
  messages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  return messages;
}

function resolveRuntimeHome(context) {
  return (
    context.runtimeHome
    ?? process.env.SPANORY_OPENCLOW_HOME
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
    const messages = await readOpenclawTranscript(transcriptPath);
    return normalizeTranscriptMessages({
      runtime: 'openclaw',
      projectId: context.projectId,
      sessionId: context.sessionId,
      messages,
    });
  },
};
