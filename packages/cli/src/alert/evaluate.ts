// @ts-nocheck
import { readFile } from 'node:fs/promises';
import { parseJsonObject } from '@bububuger/core';

import {
  summarizeAgents,
  summarizeCache,
  summarizeCommands,
  summarizeMcp,
  summarizeSessions,
  summarizeTurnDiff,
} from '../report/aggregate.js';

const DEFAULT_CONTEXT_WINDOW_TOKENS = 200000;
const SUPPORTED_RULE_SCOPES = ['session', 'agent', 'mcp', 'command'];

function getMetricFromSessionRow(row, metric, refs = {}) {
  const cacheRow = refs.cacheBySessionId?.get(row.sessionId);
  const agentRow = refs.agentBySessionId?.get(row.sessionId);
  const turnDiffRows = refs.turnDiffBySessionId?.get(row.sessionId) ?? [];
  const contextRow = refs.contextBySessionId?.get(row.sessionId);

  switch (metric) {
    case 'events':
      return row.events ?? 0;
    case 'turns':
      return row.turns ?? 0;
    case 'usage.total':
      return row.usage?.total ?? 0;
    case 'usage.input':
      return row.usage?.input ?? 0;
    case 'usage.output':
      return row.usage?.output ?? 0;
    case 'cache.read':
      return cacheRow?.cacheReadInputTokens ?? 0;
    case 'cache.creation':
      return cacheRow?.cacheCreationInputTokens ?? 0;
    case 'cache.hit_rate':
      return cacheRow?.cacheHitRate ?? 0;
    case 'subagent.calls':
      return agentRow?.agentTasks ?? 0;
    case 'diff.char_delta.max':
      return turnDiffRows.reduce((max, rowItem) => Math.max(max, Math.abs(Number(rowItem.charDelta ?? 0))), 0);
    case 'context.unknown_delta_share.window5':
      return contextRow?.unknownDeltaShareWindow5 ?? 0;
    case 'context.unknown_top_streak':
      return contextRow?.unknownTopStreak ?? 0;
    case 'context.high_pollution_source_streak':
      return contextRow?.highPollutionSourceStreak ?? 0;
    case 'context.fill_ratio.max':
      return contextRow?.maxFillRatio ?? 0;
    case 'context.delta_ratio.max':
      return contextRow?.maxDeltaRatio ?? 0;
    case 'context.compact.count':
      return contextRow?.compactCount ?? 0;
    default:
      return 0;
  }
}

function parseJsonArray(value) {
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // ignore parse errors
  }
  return [];
}

function summarizeContextForSession(events) {
  const snapshots = events.filter(
    (event) => event?.attributes?.['agentic.context.event_type'] === 'context_snapshot',
  );
  const attributions = events.filter(
    (event) => event?.attributes?.['agentic.context.event_type'] === 'context_source_attribution',
  );

  const last5 = snapshots.slice(-5);
  let unknownTokens = 0;
  let totalTokens = 0;
  for (const snapshot of last5) {
    const composition = parseJsonObject(snapshot?.attributes?.['agentic.context.composition']);
    if (!composition) continue;
    for (const [kind, raw] of Object.entries(composition)) {
      const value = Number(raw);
      if (!Number.isFinite(value) || value <= 0) continue;
      totalTokens += value;
      if (kind === 'unknown') unknownTokens += value;
    }
  }
  const unknownDeltaShareWindow5 = totalTokens > 0 ? unknownTokens / totalTokens : 0;

  let unknownTopStreak = 0;
  let runningUnknown = 0;
  for (const snapshot of snapshots) {
    const topSources = parseJsonArray(snapshot?.attributes?.['agentic.context.top_sources']);
    const top = String(topSources[0] ?? '').trim();
    if (top === 'unknown') {
      runningUnknown += 1;
      if (runningUnknown > unknownTopStreak) unknownTopStreak = runningUnknown;
    } else {
      runningUnknown = 0;
    }
  }

  const turnOrder = [];
  const highByTurn = new Map();
  for (const event of attributions) {
    const attrs = event?.attributes ?? {};
    const turnId = String(event?.turnId ?? '');
    if (!turnId) continue;
    if (!highByTurn.has(turnId)) {
      highByTurn.set(turnId, []);
      turnOrder.push(turnId);
    }
    const sourceKind = String(attrs['agentic.context.source_kind'] ?? '').trim();
    const score = Number(attrs['agentic.context.pollution_score']);
    if (!sourceKind || !Number.isFinite(score)) continue;
    if (score < 80) continue;
    highByTurn.get(turnId).push({ sourceKind, score });
  }

  let highPollutionSourceStreak = 0;
  let runningSource = '';
  let runningCount = 0;
  for (const turnId of turnOrder) {
    const items = highByTurn.get(turnId) ?? [];
    if (!items.length) {
      runningSource = '';
      runningCount = 0;
      continue;
    }
    items.sort((a, b) => b.score - a.score);
    const topSource = items[0].sourceKind;
    if (topSource === runningSource) {
      runningCount += 1;
    } else {
      runningSource = topSource;
      runningCount = 1;
    }
    if (runningCount > highPollutionSourceStreak) {
      highPollutionSourceStreak = runningCount;
    }
  }

  let maxFillRatio = 0;
  let maxDeltaRatio = 0;
  let compactCount = 0;
  for (const event of events) {
    const attrs = event?.attributes ?? {};
    if (String(attrs['agentic.context.event_type'] ?? '') === 'context_snapshot') {
      const fillRatio = Number(attrs['agentic.context.fill_ratio']);
      if (Number.isFinite(fillRatio) && fillRatio > maxFillRatio) maxFillRatio = fillRatio;

      const deltaTokens = Number(attrs['agentic.context.delta_tokens']);
      if (Number.isFinite(deltaTokens) && deltaTokens > 0) {
        const ratio = deltaTokens / DEFAULT_CONTEXT_WINDOW_TOKENS;
        if (ratio > maxDeltaRatio) maxDeltaRatio = ratio;
      }
    }
    if (
      String(attrs['agentic.context.event_type'] ?? '') === 'context_boundary'
      && String(attrs['agentic.context.boundary_kind'] ?? '') === 'compact_after'
    ) {
      compactCount += 1;
    }
  }

  return {
    unknownDeltaShareWindow5,
    unknownTopStreak,
    highPollutionSourceStreak,
    maxFillRatio,
    maxDeltaRatio,
    compactCount,
  };
}

function getMetricFromAgentRow(row, metric) {
  switch (metric) {
    case 'agentTasks':
      return row.agentTasks ?? 0;
    case 'shellCommands':
      return row.shellCommands ?? 0;
    case 'mcpCalls':
      return row.mcpCalls ?? 0;
    case 'usage.total':
      return row.usage?.total ?? 0;
    default:
      return 0;
  }
}

function compare(value, op, threshold) {
  if (op === 'gt') return value > threshold;
  if (op === 'gte') return value >= threshold;
  if (op === 'lt') return value < threshold;
  if (op === 'lte') return value <= threshold;
  if (op === 'eq') return value === threshold;
  throw new Error(`unsupported operator: ${op}`);
}

function assertValidRule(rule, index = null) {
  const ruleRef = Number.isInteger(index) ? `rule at index ${index}` : 'rule';
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
    throw new Error(`invalid ${ruleRef}: expected object`);
  }

  for (const field of ['id', 'scope', 'metric', 'op']) {
    const value = rule[field];
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`invalid ${ruleRef}: "${field}" must be a non-empty string`);
    }
  }

  if (typeof rule.threshold !== 'number' || !Number.isFinite(rule.threshold)) {
    throw new Error(`invalid ${ruleRef}: "threshold" must be a finite number`);
  }

  if (!SUPPORTED_RULE_SCOPES.includes(rule.scope)) {
    throw new Error(`unsupported rule scope: ${rule.scope}`);
  }
}

function buildTurnDiffBySessionId(rows) {
  const turnDiffBySessionId = new Map();
  for (const row of rows) {
    const key = row.sessionId;
    const list = turnDiffBySessionId.get(key) ?? [];
    list.push(row);
    turnDiffBySessionId.set(key, list);
  }
  return turnDiffBySessionId;
}

function buildEvaluationContext(rules, sessions) {
  const scopes = new Set(rules.map((rule) => rule.scope));
  const needsSession = scopes.has('session');
  const needsAgent = scopes.has('agent');
  const needsMcp = scopes.has('mcp');
  const needsCommand = scopes.has('command');

  const agentRows = needsSession || needsAgent ? summarizeAgents(sessions) : [];
  const contextBySessionId = needsSession
    ? new Map(
      sessions.map((session) => [
        session.context?.sessionId ?? session.events?.[0]?.sessionId,
        summarizeContextForSession(session.events ?? []),
      ]),
    )
    : new Map();

  return {
    sessionRows: needsSession ? summarizeSessions(sessions) : [],
    cacheBySessionId: needsSession
      ? new Map(summarizeCache(sessions).map((row) => [row.sessionId, row]))
      : new Map(),
    agentRows,
    agentBySessionId: needsSession ? new Map(agentRows.map((row) => [row.sessionId, row])) : new Map(),
    turnDiffBySessionId: needsSession ? buildTurnDiffBySessionId(summarizeTurnDiff(sessions)) : new Map(),
    contextBySessionId,
    mcpRows: needsMcp ? summarizeMcp(sessions) : [],
    commandRows: needsCommand ? summarizeCommands(sessions) : [],
  };
}

function evaluateSessionRule(rule, context) {
  const matched = context.sessionRows
    .map((row) => {
      const value = getMetricFromSessionRow(row, rule.metric, {
        cacheBySessionId: context.cacheBySessionId,
        agentBySessionId: context.agentBySessionId,
        turnDiffBySessionId: context.turnDiffBySessionId,
        contextBySessionId: context.contextBySessionId,
      });
      return { row, value };
    })
    .filter((x) => compare(x.value, rule.op, Number(rule.threshold)));

  return matched.map((m) => ({
    ruleId: rule.id,
    severity: rule.severity ?? 'warning',
    scope: 'session',
    metric: rule.metric,
    op: rule.op,
    threshold: Number(rule.threshold),
    value: m.value,
    context: {
      sessionId: m.row.sessionId,
      projectId: m.row.projectId,
      runtime: m.row.runtime,
    },
  }));
}

function evaluateAgentRule(rule, context) {
  const matched = context.agentRows
    .map((row) => {
      const value = getMetricFromAgentRow(row, rule.metric);
      return { row, value };
    })
    .filter((x) => compare(x.value, rule.op, Number(rule.threshold)));

  return matched.map((m) => ({
    ruleId: rule.id,
    severity: rule.severity ?? 'warning',
    scope: 'agent',
    metric: rule.metric,
    op: rule.op,
    threshold: Number(rule.threshold),
    value: m.value,
    context: {
      sessionId: m.row.sessionId,
      projectId: m.row.projectId,
      runtime: m.row.runtime,
    },
  }));
}

function evaluateMcpRule(rule, context) {
  const matched = context.mcpRows.filter((row) => compare(row.calls ?? 0, rule.op, Number(rule.threshold)));
  return matched.map((row) => ({
    ruleId: rule.id,
    severity: rule.severity ?? 'warning',
    scope: 'mcp',
    metric: 'calls',
    op: rule.op,
    threshold: Number(rule.threshold),
    value: row.calls,
    context: {
      server: row.server,
    },
  }));
}

function evaluateCommandRule(rule, context) {
  const matched = context.commandRows.filter((row) => compare(row.calls ?? 0, rule.op, Number(rule.threshold)));
  return matched.map((row) => ({
    ruleId: rule.id,
    severity: rule.severity ?? 'warning',
    scope: 'command',
    metric: 'calls',
    op: rule.op,
    threshold: Number(rule.threshold),
    value: row.calls,
    context: {
      command: row.command,
    },
  }));
}

export async function loadAlertRules(path) {
  const raw = await readFile(path, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.rules)) {
    throw new Error('rule file must be JSON with {"rules": [...]}');
  }

  parsed.rules.forEach((rule, index) => {
    assertValidRule(rule, index);
  });
  return parsed.rules;
}

export function evaluateRules(rules, sessions) {
  for (const [index, rule] of rules.entries()) {
    assertValidRule(rule, index);
  }

  const context = buildEvaluationContext(rules, sessions);
  const alerts = [];

  for (const rule of rules) {
    if (rule.scope === 'session') {
      alerts.push(...evaluateSessionRule(rule, context));
      continue;
    }

    if (rule.scope === 'agent') {
      alerts.push(...evaluateAgentRule(rule, context));
      continue;
    }

    if (rule.scope === 'mcp') {
      alerts.push(...evaluateMcpRule(rule, context));
      continue;
    }

    if (rule.scope === 'command') {
      alerts.push(...evaluateCommandRule(rule, context));
      continue;
    }
  }

  return alerts;
}

export async function sendAlertWebhook(url, payload, headers = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`webhook HTTP ${response.status}`);
  }
}
