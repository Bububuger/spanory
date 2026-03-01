import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { RUNTIME_CAPABILITIES } from '../shared/capabilities.js';
import { normalizeTranscriptMessages, parseProjectIdFromTranscriptPath, pickUsage } from '../shared/normalize.js';

function parseTimestamp(entry) {
  const raw = entry?.timestamp;
  const date = raw ? new Date(raw) : new Date();
  if (Number.isNaN(date.getTime())) return new Date();
  return date;
}

async function readClaudeTranscript(transcriptPath) {
  const raw = await readFile(transcriptPath, 'utf-8');
  const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
  const messages = [];
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      messages.push({
        role: entry.type,
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

    const messages = await readClaudeTranscript(transcriptPath);
    return normalizeTranscriptMessages({
      runtime: 'claude-code',
      projectId: context.projectId,
      sessionId: context.sessionId,
      messages,
    });
  },
};
