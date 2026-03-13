// @ts-nocheck
import { createHash } from 'node:crypto';
import {
  calibratedEstimate,
  calibrate,
  CONTEXT_SOURCE_KINDS,
  estimateTokens,
  pollutionScoreV1,
} from '@bububuger/core';
import { REDACTED, redactBody, truncateText } from './redaction.js';

import { isPromptUserMessage } from './content.js';
import { createTurn } from './turn.js';

export { pickUsage } from './usage.js';

function hashText(text) {
  return createHash('sha256').update(String(text ?? '')).digest('hex');
}

function lineCount(text) {
  const s = String(text ?? '');
  if (!s) return 0;
  return s.split(/\r?\n/).length;
}

function tokenSet(text) {
  const tokens = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  return new Set(tokens);
}

function similarityScore(a, b) {
  if (a === b) return 1;
  const setA = tokenSet(a);
  const setB = tokenSet(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  if (union === 0) return 1;
  return Number((intersection / union).toFixed(6));
}

const DEFAULT_CONTEXT_WINDOW_TOKENS = 200000;
const CONTEXT_ENABLED_RUNTIMES = new Set(['claude-code', 'codex', 'openclaw', 'opencode']);
const CONTEXT_PARSING_ENABLED = process.env.SPANORY_CONTEXT_ENABLED !== '0';

function contextWindowTokens() {
  const raw = Number(process.env.SPANORY_CONTEXT_WINDOW_TOKENS);
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  return DEFAULT_CONTEXT_WINDOW_TOKENS;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round6(value) {
  return Number(value.toFixed(6));
}

function detectCompactInferred(currentTokens, previousTokens) {
  if (!(previousTokens > 0)) return { detected: false, compactionRatio: 0 };
  const dropRatio = (previousTokens - currentTokens) / previousTokens;
  if (dropRatio > 0.4) return { detected: true, compactionRatio: round6(dropRatio) };
  return { detected: false, compactionRatio: 0 };
}

function createSourceDeltaMap() {
  const out = {};
  for (const kind of CONTEXT_SOURCE_KINDS) out[kind] = 0;
  return out;
}

function addSourceDelta(map, kind, delta) {
  if (!kind || !Object.prototype.hasOwnProperty.call(map, kind)) return;
  const n = Number(delta);
  if (!Number.isFinite(n) || n <= 0) return;
  map[kind] += n;
}

function moveSourceDelta(map, fromKind, toKind, delta) {
  const n = Number(delta);
  if (!Number.isFinite(n) || n <= 0) return;
  if (!Object.prototype.hasOwnProperty.call(map, fromKind)) return;
  if (!Object.prototype.hasOwnProperty.call(map, toKind)) return;
  const moved = Math.min(map[fromKind], n);
  if (moved <= 0) return;
  map[fromKind] -= moved;
  map[toKind] += moved;
}

function parseJsonObject(raw) {
  const text = String(raw ?? '').trim();
  if (!text || !text.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    // ignore parse errors
  }
  return null;
}

function extractMentionFileSignals(text) {
  const input = String(text ?? '');
  if (!input) return [];
  const matches = input.match(/(?:\/|\b)[^\s"'`]+?\.[a-zA-Z0-9]{1,8}\b/g) ?? [];
  return [...new Set(matches.map((m) => m.trim()).filter(Boolean))];
}

function extractSourceName(event) {
  const attrs = event?.attributes ?? {};
  return String(attrs['gen_ai.tool.name'] ?? attrs['agentic.command.name'] ?? event?.name ?? '').trim();
}

function classifyContextSignals(turnEvents) {
  const sourceDelta = createSourceDeltaMap();
  const sourceNames = new Map();
  let compactRequested = false;
  let restoreRequested = false;

  function markSourceName(kind, name) {
    const text = String(name ?? '').trim();
    if (!text) return;
    if (!sourceNames.has(kind)) sourceNames.set(kind, new Set());
    sourceNames.get(kind).add(text);
  }

  function absorbFileSignals(text, fromKind) {
    const mentions = extractMentionFileSignals(text);
    if (!mentions.length) return;
    const mentionTokens = estimateTokens(mentions.join('\n'));
    addSourceDelta(sourceDelta, 'mention_file', mentionTokens);
    moveSourceDelta(sourceDelta, fromKind, 'mention_file', mentionTokens);
    markSourceName('mention_file', mentions[0]);
    const hasClaudeMd = mentions.some((item) => /(?:^|\/)(?:claude|agents)\.md$/i.test(item));
    if (hasClaudeMd) {
      addSourceDelta(sourceDelta, 'claude_md', mentionTokens);
      moveSourceDelta(sourceDelta, 'mention_file', 'claude_md', mentionTokens);
      markSourceName('claude_md', mentions.find((item) => /(?:^|\/)(?:claude|agents)\.md$/i.test(item)));
    }
  }

  for (const event of turnEvents) {
    const category = String(event?.category ?? '');
    const attrs = event?.attributes ?? {};
    const input = String(event?.input ?? '');
    const output = String(event?.output ?? '');
    const inputTokens = estimateTokens(input);
    const outputTokens = estimateTokens(output);
    const sourceName = extractSourceName(event);

    if (category === 'turn') {
      addSourceDelta(sourceDelta, 'turn', inputTokens + outputTokens);
      absorbFileSignals(input, 'turn');
      const sender = String(attrs['agentic.input.sender'] ?? '').toLowerCase();
      if (sender === 'system') {
        addSourceDelta(sourceDelta, 'system_prompt', inputTokens);
        moveSourceDelta(sourceDelta, 'turn', 'system_prompt', inputTokens);
        markSourceName('system_prompt', 'system_input');
      }
      if (/\b(delegate|handoff|coordinate|sync)\b/i.test(input)) {
        const coordinationTokens = Math.min(estimateTokens(input), Math.max(1, Math.floor(inputTokens / 2)));
        addSourceDelta(sourceDelta, 'team_coordination', coordinationTokens);
        moveSourceDelta(sourceDelta, 'turn', 'team_coordination', coordinationTokens);
        markSourceName('team_coordination', 'turn_coordination');
      }
      continue;
    }

    if (category === 'agent_command') {
      const commandName = String(attrs['agentic.command.name'] ?? '').trim().toLowerCase();
      addSourceDelta(sourceDelta, 'skill', inputTokens + outputTokens);
      markSourceName('skill', sourceName ? `/${sourceName}` : 'slash_command');
      if (commandName === 'compact') compactRequested = true;
      if (commandName === 'restore' || commandName === 'resume') restoreRequested = true;
      continue;
    }

    if (category === 'agent_task') {
      addSourceDelta(sourceDelta, 'subagent', inputTokens + outputTokens);
      addSourceDelta(sourceDelta, 'team_coordination', inputTokens);
      markSourceName('subagent', sourceName || 'Task');
      markSourceName('team_coordination', sourceName || 'Task');
      continue;
    }

    if (category === 'tool' || category === 'mcp' || category === 'shell_command') {
      addSourceDelta(sourceDelta, 'tool_input', inputTokens);
      addSourceDelta(sourceDelta, 'tool_output', outputTokens);
      if (sourceName) {
        markSourceName('tool_input', sourceName);
        markSourceName('tool_output', sourceName);
      }
      absorbFileSignals(input, 'tool_input');
      const toolName = String(attrs['gen_ai.tool.name'] ?? '').toLowerCase();
      if (toolName.includes('memory') || /\bmemory\b/i.test(input)) {
        const memoryTokens = Math.max(1, Math.floor(inputTokens * 0.6));
        addSourceDelta(sourceDelta, 'memory', memoryTokens);
        moveSourceDelta(sourceDelta, 'tool_input', 'memory', memoryTokens);
        markSourceName('memory', sourceName || 'memory');
      }
      continue;
    }
  }

  const knownTotal = CONTEXT_SOURCE_KINDS
    .filter((kind) => kind !== 'unknown')
    .reduce((acc, kind) => acc + Number(sourceDelta[kind] ?? 0), 0);
  if (knownTotal <= 0) {
    sourceDelta.unknown = 1;
    markSourceName('unknown', 'unclassified');
  }

  return { sourceDelta, sourceNames, compactRequested, restoreRequested };
}

function composeContextEvents({
  runtime,
  projectId,
  sessionId,
  turnEvent,
  turnEvents,
  previousEstimatedTotal,
  recentSourceKindsWindow,
  calibrationState,
}) {
  const attrs = turnEvent?.attributes ?? {};
  const usageInput = Number(attrs['gen_ai.usage.input_tokens'] ?? 0);
  const usageCacheRead = Number(attrs['gen_ai.usage.cache_read.input_tokens'] ?? 0);
  const usageEstimated = Math.max(0, usageInput + usageCacheRead);
  const fallbackEstimated = estimateTokens(`${turnEvent?.input ?? ''}\n${turnEvent?.output ?? ''}`);
  let estimationMethod = 'heuristic';
  let estimationConfidence = 0.4;
  let estimatedTotalTokens = Math.max(0, fallbackEstimated);
  let nextCalibrationState = calibrationState;
  if (usageEstimated > 0) {
    estimationMethod = 'usage';
    estimationConfidence = 1;
    estimatedTotalTokens = usageEstimated;
    nextCalibrationState = calibrate(calibrationState, usageEstimated, Math.max(fallbackEstimated, 1));
  } else if (Number(calibrationState?.sampleCount ?? 0) >= 2) {
    estimationMethod = 'calibrated';
    estimationConfidence = round6(0.7 + 0.03 * Math.min(Number(calibrationState.sampleCount ?? 0), 10));
    estimatedTotalTokens = Math.max(0, calibratedEstimate(fallbackEstimated, calibrationState));
  }
  const { sourceDelta, sourceNames, compactRequested, restoreRequested } = classifyContextSignals(turnEvents);
  const deltaTokens = previousEstimatedTotal > 0 ? (estimatedTotalTokens - previousEstimatedTotal) : 0;
  const windowLimitTokens = contextWindowTokens();
  const fillRatio = round6(clamp(estimatedTotalTokens / windowLimitTokens, 0, 1));

  const compositionEntries = Object.entries(sourceDelta)
    .filter(([, value]) => Number(value) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]));
  const activeKinds = compositionEntries.map(([kind]) => kind);
  const nextRecentSourceKindsWindow = [...recentSourceKindsWindow, activeKinds].slice(-5);
  const repeatCountByKind = {};
  for (const kind of CONTEXT_SOURCE_KINDS) {
    repeatCountByKind[kind] = nextRecentSourceKindsWindow.reduce(
      (count, row) => count + (row.includes(kind) ? 1 : 0),
      0,
    );
  }
  const totalDelta = compositionEntries.reduce((sum, [, value]) => sum + Number(value), 0);
  const composition = Object.fromEntries(compositionEntries);
  const topSources = compositionEntries.slice(0, 3).map(([kind]) => kind);

  const passthroughAttrs = {};
  const passthroughKeys = [
    'gen_ai.agent.id',
    'agentic.parent.session_id',
    'agentic.parent.turn_id',
    'agentic.parent.tool_call_id',
    'agentic.parent.link.confidence',
    'agentic.runtime.version',
  ];
  for (const key of passthroughKeys) {
    if (attrs[key] !== undefined) passthroughAttrs[key] = attrs[key];
  }

  const baseAttrs = {
    'agentic.event.category': 'context',
    'agentic.context.event_type': 'context_snapshot',
    'agentic.context.estimated_total_tokens': estimatedTotalTokens,
    'agentic.context.fill_ratio': fillRatio,
    'agentic.context.delta_tokens': deltaTokens,
    'agentic.context.composition': JSON.stringify(composition),
    'agentic.context.top_sources': JSON.stringify(topSources),
    'agentic.context.estimation_method': estimationMethod,
    'agentic.context.estimation_confidence': estimationConfidence,
    ...passthroughAttrs,
  };

  const out = [
    {
      runtime,
      projectId,
      sessionId,
      turnId: turnEvent.turnId,
      category: 'context',
      name: 'Context Snapshot',
      startedAt: turnEvent.startedAt,
      endedAt: turnEvent.endedAt,
      input: '',
      output: '',
      attributes: baseAttrs,
    },
  ];

  if (compactRequested && previousEstimatedTotal > 0) {
    out.push({
      runtime,
      projectId,
      sessionId,
      turnId: turnEvent.turnId,
      category: 'context',
      name: 'Context Boundary',
      startedAt: turnEvent.startedAt,
      endedAt: turnEvent.startedAt,
      input: '',
      output: '',
      attributes: {
        'agentic.event.category': 'context',
        'agentic.context.event_type': 'context_boundary',
        'agentic.context.boundary_kind': 'compact_before',
        'agentic.context.compaction_ratio': 0,
        'agentic.context.detection_method': 'hook',
        ...passthroughAttrs,
      },
    });
  }

  const inferred = detectCompactInferred(estimatedTotalTokens, previousEstimatedTotal);
  if (inferred.detected) {
    out.push({
      runtime,
      projectId,
      sessionId,
      turnId: turnEvent.turnId,
      category: 'context',
      name: 'Context Boundary',
      startedAt: turnEvent.startedAt,
      endedAt: turnEvent.endedAt,
      input: '',
      output: '',
      attributes: {
        'agentic.event.category': 'context',
        'agentic.context.event_type': 'context_boundary',
        'agentic.context.boundary_kind': 'compact_after',
        'agentic.context.compaction_ratio': inferred.compactionRatio,
        'agentic.context.detection_method': 'inferred',
        ...passthroughAttrs,
      },
    });
  }

  if (restoreRequested) {
    out.push({
      runtime,
      projectId,
      sessionId,
      turnId: turnEvent.turnId,
      category: 'context',
      name: 'Context Boundary',
      startedAt: turnEvent.startedAt,
      endedAt: turnEvent.startedAt,
      input: '',
      output: '',
      attributes: {
        'agentic.event.category': 'context',
        'agentic.context.event_type': 'context_boundary',
        'agentic.context.boundary_kind': 'restore',
        'agentic.context.compaction_ratio': 0,
        'agentic.context.detection_method': 'hook',
        ...passthroughAttrs,
      },
    });
  }

  for (const [kind, value] of compositionEntries) {
    const tokenDelta = Number(value);
    if (tokenDelta <= 0) continue;
    const sourceShare = totalDelta > 0 ? round6(tokenDelta / totalDelta) : 0;
    const repeatCountRecent = Number(repeatCountByKind[kind] ?? 0);
    const names = [...(sourceNames.get(kind) ?? [])];
    out.push({
      runtime,
      projectId,
      sessionId,
      turnId: turnEvent.turnId,
      category: 'context',
      name: 'Context Source Attribution',
      startedAt: turnEvent.startedAt,
      endedAt: turnEvent.endedAt,
      input: '',
      output: '',
      attributes: {
        'agentic.event.category': 'context',
        'agentic.context.event_type': 'context_source_attribution',
        'agentic.context.source_kind': kind,
        'agentic.context.source_name': names[0] ?? kind,
        'agentic.context.token_delta': tokenDelta,
        'agentic.context.source_share': sourceShare,
        'agentic.context.repeat_count_recent': repeatCountRecent,
        'agentic.context.pollution_score': pollutionScoreV1({
          tokenDelta,
          windowLimitTokens,
          sourceShare,
          repeatCountRecent,
          sourceKind: kind,
        }),
        'agentic.context.score_version': 'pollution_score_v1',
        ...passthroughAttrs,
      },
    });
  }

  return {
    events: out,
    estimatedTotalTokens,
    recentSourceKindsWindow: nextRecentSourceKindsWindow,
    calibrationState: nextCalibrationState,
  };
}

export function groupByTurns(messages) {
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

export function normalizeTranscriptMessages({ runtime, projectId, sessionId, messages }) {
  const turns = groupByTurns(messages);
  const events = [];
  let previousInput = '';
  let previousHash = '';
  let hasPreviousTurn = false;
  let previousEstimatedTotal = 0;
  let recentSourceKindsWindow = [];
  let calibrationState = { ema: 1, sampleCount: 0 };

  for (let i = 0; i < turns.length; i += 1) {
    const turnEvents = createTurn(turns[i], `turn-${i + 1}`, projectId, sessionId, runtime);
    if (!turnEvents.length) continue;

    const turnEvent = turnEvents[0];
    const input = String(turnEvent.input ?? '');
    const inputHash = hashText(input);

    if (!hasPreviousTurn) {
      turnEvent.attributes['agentic.turn.input.hash'] = inputHash;
      turnEvent.attributes['agentic.turn.input.prev_hash'] = '';
      turnEvent.attributes['agentic.turn.diff.char_delta'] = 0;
      turnEvent.attributes['agentic.turn.diff.line_delta'] = 0;
      turnEvent.attributes['agentic.turn.diff.similarity'] = 1;
      turnEvent.attributes['agentic.turn.diff.changed'] = false;
      hasPreviousTurn = true;
    } else {
      turnEvent.attributes['agentic.turn.input.hash'] = inputHash;
      turnEvent.attributes['agentic.turn.input.prev_hash'] = previousHash;
      turnEvent.attributes['agentic.turn.diff.char_delta'] = input.length - previousInput.length;
      turnEvent.attributes['agentic.turn.diff.line_delta'] = lineCount(input) - lineCount(previousInput);
      turnEvent.attributes['agentic.turn.diff.similarity'] = similarityScore(previousInput, input);
      turnEvent.attributes['agentic.turn.diff.changed'] = inputHash !== previousHash;
    }

    previousInput = input;
    previousHash = inputHash;
    events.push(...turnEvents);

    if (CONTEXT_PARSING_ENABLED && CONTEXT_ENABLED_RUNTIMES.has(runtime)) {
      const contextResult = composeContextEvents({
        runtime,
        projectId,
        sessionId,
        turnEvent,
        turnEvents,
        previousEstimatedTotal,
        recentSourceKindsWindow,
        calibrationState,
      });
      events.push(...contextResult.events);
      previousEstimatedTotal = contextResult.estimatedTotalTokens;
      recentSourceKindsWindow = contextResult.recentSourceKindsWindow;
      calibrationState = contextResult.calibrationState;
    }
  }
  return events;
}

export function parseProjectIdFromTranscriptPath(transcriptPath, marker) {
  if (!transcriptPath) return undefined;
  const normalized = transcriptPath.replace(/\\/g, '/');
  const idx = normalized.indexOf(marker);
  if (idx === -1) return undefined;
  const rest = normalized.slice(idx + marker.length);
  return rest.split('/')[0] || undefined;
}
