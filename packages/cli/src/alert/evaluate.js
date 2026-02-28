import { readFile } from 'node:fs/promises';

import { summarizeAgents, summarizeCommands, summarizeMcp, summarizeSessions } from '../report/aggregate.js';

function getMetricFromSessionRow(row, metric) {
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
    default:
      return 0;
  }
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

function evaluateSessionRule(rule, sessions) {
  const rows = summarizeSessions(sessions);
  const matched = rows
    .map((row) => {
      const value = getMetricFromSessionRow(row, rule.metric);
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

function evaluateAgentRule(rule, sessions) {
  const rows = summarizeAgents(sessions);
  const matched = rows
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

function evaluateMcpRule(rule, sessions) {
  const rows = summarizeMcp(sessions);
  const matched = rows.filter((row) => compare(row.calls ?? 0, rule.op, Number(rule.threshold)));
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

function evaluateCommandRule(rule, sessions) {
  const rows = summarizeCommands(sessions);
  const matched = rows.filter((row) => compare(row.calls ?? 0, rule.op, Number(rule.threshold)));
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
  return parsed.rules;
}

export function evaluateRules(rules, sessions) {
  const alerts = [];

  for (const rule of rules) {
    if (!rule.id || !rule.scope || !rule.metric || !rule.op) {
      throw new Error(`invalid rule: ${JSON.stringify(rule)}`);
    }

    if (rule.scope === 'session') {
      alerts.push(...evaluateSessionRule(rule, sessions));
      continue;
    }

    if (rule.scope === 'agent') {
      alerts.push(...evaluateAgentRule(rule, sessions));
      continue;
    }

    if (rule.scope === 'mcp') {
      alerts.push(...evaluateMcpRule(rule, sessions));
      continue;
    }

    if (rule.scope === 'command') {
      alerts.push(...evaluateCommandRule(rule, sessions));
      continue;
    }

    throw new Error(`unsupported rule scope: ${rule.scope}`);
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
