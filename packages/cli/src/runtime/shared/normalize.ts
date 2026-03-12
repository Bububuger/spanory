// @ts-nocheck
import { createHash } from 'node:crypto';
import {
  calibratedEstimate,
  calibrate,
  CONTEXT_SOURCE_KINDS,
  estimateTokens,
  pollutionScoreV1,
} from '@bububuger/core';

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function pickUsage(raw) {
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
    attrs['gen_ai.usage.cache_read.input_tokens'] = usage.cache_read_input_tokens;
  }
  if (usage.cache_creation_input_tokens !== undefined) {
    attrs['gen_ai.usage.cache_creation.input_tokens'] = usage.cache_creation_input_tokens;
  }
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const denominator = (usage.input_tokens ?? 0) + cacheRead;
  const cacheHitRate = denominator > 0 ? cacheRead / denominator : 0;
  attrs['gen_ai.usage.details.cache_hit_rate'] = Number(cacheHitRate.toFixed(6));
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

function extractReasoningBlocks(content) {
  if (!Array.isArray(content)) return [];
  return content.filter((block) => block && typeof block === 'object' && block.type === 'reasoning');
}

function isoFromUnknownTimestamp(value, fallback) {
  const candidate = value instanceof Date ? value : new Date(value ?? '');
  if (!Number.isNaN(candidate.getTime())) return candidate.toISOString();
  return fallback.toISOString();
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

const GATEWAY_INPUT_METADATA_BLOCK_RE = /Conversation info \(untrusted metadata\):\s*```json\s*([\s\S]*?)\s*```\s*/i;

function runtimeVersionAttributes(version) {
  if (version === undefined || version === null) return {};
  const normalized = String(version).trim();
  if (!normalized) return {};
  return {
    'agentic.runtime.version': normalized,
  };
}

function extractGatewayInputMetadata(text) {
  if (!text) return { input: '', attributes: {} };
  const match = text.match(GATEWAY_INPUT_METADATA_BLOCK_RE);
  if (!match) return { input: text.trim(), attributes: {} };

  const attributes = {};
  const metadataRaw = match[1];
  try {
    const parsed = JSON.parse(metadataRaw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      attributes['agentic.input.metadata'] = JSON.stringify(parsed);
      if (parsed.message_id !== undefined) attributes['agentic.input.message_id'] = String(parsed.message_id);
      if (parsed.sender !== undefined) attributes['agentic.input.sender'] = String(parsed.sender);
    }
  } catch {
    // ignore malformed metadata JSON and only strip wrapper text
  }

  const input = text.slice(match.index + match[0].length).trim() || text.trim();
  return { input, attributes };
}

function normalizeUserInput(content) {
  const text = extractText(content).trim();
  if (text) return extractGatewayInputMetadata(text);
  if (Array.isArray(content)) return { input: JSON.stringify(content), attributes: {} };
  if (typeof content === 'string') return extractGatewayInputMetadata(content);
  return { input: '', attributes: {} };
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
  if (m) {
    const argsMatch = text.match(/<command-args>([\s\S]*?)<\/command-args>/i);
    return { name: m[1].trim(), args: argsMatch ? argsMatch[1].trim() : '' };
  }

  // fallback for plain slash commands like "/compact please summarize"
  const plain = String(text ?? '').trim().match(/^\/([a-zA-Z0-9._:-]+)(?:\s+([\s\S]*))?$/);
  if (!plain) return null;
  return {
    name: plain[1].trim(),
    args: plain[2] ? plain[2].trim() : '',
  };
}

function parseBashCommandAttributes(commandLine) {
  const raw = String(commandLine ?? '').trim();
  if (!raw) {
    return {
      'agentic.command.name': '',
      'agentic.command.args': '',
      'agentic.command.pipe_count': 0,
    };
  }

  const segments = raw.split(/\|(?!\|)/);
  const firstSegment = String(segments[0] ?? '').trim();
  const tokens = firstSegment ? firstSegment.split(/\s+/) : [];
  const name = String(tokens[0] ?? '').trim();
  const args = tokens.length > 1 ? tokens.slice(1).join(' ') : '';

  return {
    'agentic.command.name': name,
    'agentic.command.args': args,
    'agentic.command.pipe_count': Math.max(segments.length - 1, 0),
  };
}

function isMcpToolName(name) {
  const n = String(name || '').toLowerCase();
  return n === 'mcp' || n.startsWith('mcp__') || n.startsWith('mcp-');
}

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

function actorHeuristic(messages) {
  const hasSidechainSignal = messages.some(
    (m) => m?.isSidechain === true || (typeof m?.agentId === 'string' && m.agentId.trim().length > 0),
  );
  if (hasSidechainSignal) return { role: 'unknown', confidence: 0.6 };
  return { role: 'main', confidence: 0.95 };
}

function firstNonEmptyString(values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

function inferParentLinkAttributes(messages) {
  const agentId = firstNonEmptyString(
    messages.map((m) => m?.agentId ?? m?.agent_id ?? m?.message?.agentId ?? m?.message?.agent_id),
  );

  const parentSessionId = firstNonEmptyString(
    messages.map(
      (m) =>
        m?.parentSessionId
        ?? m?.parent_session_id
        ?? m?.parent?.sessionId
        ?? m?.parent?.session_id
        ?? m?.session_meta?.parent_session_id
        ?? m?.sessionMeta?.parentSessionId,
    ),
  );

  const parentTurnId = firstNonEmptyString(
    messages.map(
      (m) =>
        m?.parentTurnId
        ?? m?.parent_turn_id
        ?? m?.parent?.turnId
        ?? m?.parent?.turn_id
        ?? m?.session_meta?.parent_turn_id
        ?? m?.sessionMeta?.parentTurnId,
    ),
  );

  const parentToolCallId = firstNonEmptyString(
    messages.map(
      (m) =>
        m?.parentToolCallId
        ?? m?.parent_tool_call_id
        ?? m?.parent?.toolCallId
        ?? m?.parent?.tool_call_id
        ?? m?.session_meta?.parent_tool_call_id
        ?? m?.sessionMeta?.parentToolCallId,
    ),
  );

  const explicitConfidence = firstNonEmptyString(
    messages.map((m) => m?.parentLinkConfidence ?? m?.parent_link_confidence),
  );

  const attrs = {};
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

function createTurn(messages, turnId, projectId, sessionId, runtime) {
  const user = messages.find(isPromptUserMessage) ?? messages.find((m) => m.role === 'user' && !m.isMeta) ?? messages[0];
  const assistantsRaw = messages.filter((m) => m.role === 'assistant');
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
  const runtimeVersion = [...messages]
    .map((m) => String(m.runtimeVersion ?? '').trim())
    .filter(Boolean)
    .at(-1);
  const runtimeAttrs = runtimeVersionAttributes(runtimeVersion);
  const normalizedInput = normalizeUserInput(user?.content);

  const totalUsage = {};
  let latestModel;
  for (const msg of assistants) {
    if (msg.model) latestModel = msg.model;
    addUsage(totalUsage, msg.usage);
  }
  const usage = Object.keys(totalUsage).length ? totalUsage : undefined;
  const actor = actorHeuristic(messages);
  const parentLinkAttrs = inferParentLinkAttributes(messages);
  const sharedAttrs = { ...runtimeAttrs, ...parentLinkAttrs };

  const events = [
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

  const resultByToolId = new Map();
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
      if (
        fallback
        && (!resultByToolId.has(msg.sourceToolUseId) || !resultByToolId.get(msg.sourceToolUseId)?.content)
      ) {
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
      const reasoningAt = isoFromUnknownTimestamp(reasoning?.timestamp, assistant.timestamp);
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
      const toolInput = tu.input ?? {};
      const toolResult = resultByToolId.get(toolId);
      const toolOutput = toolResult?.content ?? '';
      const t = assistant.timestamp.toISOString();
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
            ...usageAttributes(assistant.usage),
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
          input: JSON.stringify(toolInput),
          output: toolOutput,
          attributes: {
            'agentic.event.category': 'mcp',
            'langfuse.observation.type': 'tool',
            ...sharedAttrs,
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
          runtime,
          projectId,
          sessionId,
          turnId,
          category: 'agent_task',
          name: 'Tool: Task',
          startedAt: t,
          endedAt: toolEndedAt,
          input: JSON.stringify(toolInput),
          output: toolOutput,
          attributes: {
            'agentic.event.category': 'agent_task',
            'langfuse.observation.type': 'agent',
            ...sharedAttrs,
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
          runtime,
          projectId,
          sessionId,
          turnId,
          category: 'tool',
          name: `Tool: ${toolName}`,
          startedAt: t,
          endedAt: toolEndedAt,
          input: JSON.stringify(toolInput),
          output: toolOutput,
          attributes: {
            'agentic.event.category': 'tool',
            'langfuse.observation.type': 'tool',
            ...sharedAttrs,
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
  events[0].attributes['agentic.subagent.calls'] = events.filter((e) => e.category === 'agent_task').length;

  return events;
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
