
// BUB-79: Scoped waiver for legacy report aggregation path; strict remains enforced at package command level.
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseJsonObject } from '../utils/json.js';

function toNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toOptionalNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function round6(value: unknown) {
  return Number(Number(value).toFixed(6));
}

function parseTurnOrdinal(turnId: string) {
  const m = String(turnId ?? '').match(/^turn-(\d+)$/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

function usageFromEvent(event: Record<string, any>) {
  const attrs = event.attributes ?? {};
  const input = toNumber(attrs['gen_ai.usage.input_tokens']);
  const output = toNumber(attrs['gen_ai.usage.output_tokens']);
  const total = toNumber(attrs['gen_ai.usage.total_tokens']) || input + output;
  return { input, output, total };
}

function parseJsonArray(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // ignore parse errors
  }
  return [];
}

export async function loadExportedEvents(inputPath: string) {
  const inputStat = await stat(inputPath);
  const files = [];

  if (inputStat.isDirectory()) {
    const names = await readdir(inputPath);
    for (const name of names) {
      if (name.endsWith('.json')) files.push(path.join(inputPath, name));
    }
  } else {
    files.push(inputPath);
  }

  const sessions = [];
  for (const file of files) {
    const raw = await readFile(file, 'utf-8');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[report] skip malformed export file: ${file} (${message})`);
      continue;
    }
    if (!Array.isArray(parsed.events)) continue;
    sessions.push({
      file,
      context: parsed.context ?? {},
      events: parsed.events,
    });
  }
  return sessions;
}

export function summarizeSessions(sessions: any[]) {
  return sessions.map((s: any) => {
    const turns = s.events.filter((e: any) => e.category === 'turn');
    const usage = turns.reduce(
      (acc: { input: number; output: number; total: number }, e: any) => {
        const u = usageFromEvent(e);
        acc.input += u.input;
        acc.output += u.output;
        acc.total += u.total;
        return acc;
      },
      { input: 0, output: 0, total: 0 },
    );

    return {
      projectId: s.context.projectId ?? s.events[0]?.projectId,
      sessionId: s.context.sessionId ?? s.events[0]?.sessionId,
      runtime: s.events[0]?.runtime,
      turns: turns.length,
      events: s.events.length,
      usage,
    };
  });
}

export function summarizeMcp(sessions: any[]) {
  const agg = new Map();
  for (const s of sessions) {
    for (const e of s.events) {
      if (e.category !== 'mcp') continue;
      const attrs = e.attributes ?? {};
      const key = attrs['agentic.mcp.server.name'] ?? attrs['gen_ai.tool.name'] ?? e.name;
      const cur = agg.get(key) ?? { server: key, calls: 0, sessions: new Set() };
      cur.calls += 1;
      cur.sessions.add(e.sessionId);
      agg.set(key, cur);
    }
  }
  return [...agg.values()].map((v) => ({ server: v.server, calls: v.calls, sessions: v.sessions.size }));
}

export function summarizeCommands(sessions: any[]) {
  const agg = new Map();
  for (const s of sessions) {
    for (const e of s.events) {
      if (e.category !== 'agent_command') continue;
      const command = e.attributes?.['agentic.command.name'] ?? e.name;
      const cur = agg.get(command) ?? { command, calls: 0, sessions: new Set() };
      cur.calls += 1;
      cur.sessions.add(e.sessionId);
      agg.set(command, cur);
    }
  }
  return [...agg.values()].map((v) => ({ command: v.command, calls: v.calls, sessions: v.sessions.size }));
}

export function summarizeAgents(sessions: any[]) {
  const out = [];
  for (const s of sessions) {
    const turns = s.events.filter((e: any) => e.category === 'turn');
    const tasks = s.events.filter((e: any) => e.category === 'agent_task');
    const shell = s.events.filter((e: any) => e.category === 'shell_command');
    const mcp = s.events.filter((e: any) => e.category === 'mcp');

    const usage = turns.reduce(
      (acc: { input: number; output: number; total: number }, e: any) => {
        const u = usageFromEvent(e);
        acc.input += u.input;
        acc.output += u.output;
        acc.total += u.total;
        return acc;
      },
      { input: 0, output: 0, total: 0 },
    );

    out.push({
      sessionId: s.context.sessionId ?? s.events[0]?.sessionId,
      projectId: s.context.projectId ?? s.events[0]?.projectId,
      runtime: s.events[0]?.runtime,
      turns: turns.length,
      agentTasks: tasks.length,
      shellCommands: shell.length,
      mcpCalls: mcp.length,
      usage,
    });
  }
  return out;
}

export function summarizeCache(sessions: any[]) {
  return sessions.map((s: any) => {
    const turns = s.events.filter((e: any) => e.category === 'turn');
    let inputTokens = 0;
    let cacheReadInputTokens = 0;
    let cacheCreationInputTokens = 0;
    const explicitHitRates = [];

    for (const turn of turns) {
      const attrs = turn.attributes ?? {};
      inputTokens += toNumber(attrs['gen_ai.usage.input_tokens']);
      cacheReadInputTokens += toNumber(attrs['gen_ai.usage.cache_read.input_tokens']);
      cacheCreationInputTokens += toNumber(attrs['gen_ai.usage.cache_creation.input_tokens']);
      const hitRate = toOptionalNumber(attrs['gen_ai.usage.details.cache_hit_rate']);
      if (hitRate !== undefined) explicitHitRates.push(hitRate);
    }

    const cacheHitRate =
      explicitHitRates.length > 0
        ? round6(explicitHitRates.reduce((acc, v) => acc + v, 0) / explicitHitRates.length)
        : round6(
            inputTokens + cacheReadInputTokens > 0 ? cacheReadInputTokens / (inputTokens + cacheReadInputTokens) : 0,
          );

    return {
      projectId: s.context.projectId ?? s.events[0]?.projectId,
      sessionId: s.context.sessionId ?? s.events[0]?.sessionId,
      runtime: s.events[0]?.runtime,
      turns: turns.length,
      inputTokens,
      cacheReadInputTokens,
      cacheCreationInputTokens,
      cacheHitRate,
    };
  });
}

export function summarizeTools(sessions: any[]) {
  const agg = new Map();
  for (const s of sessions) {
    for (const e of s.events) {
      if (!['tool', 'mcp', 'shell_command', 'agent_task'].includes(e.category)) continue;
      const attrs = e.attributes ?? {};
      const tool = attrs['gen_ai.tool.name'] ?? e.name;
      const key = `${e.category}:${tool}`;
      const cur = agg.get(key) ?? {
        category: e.category,
        tool,
        calls: 0,
        sessions: new Set(),
      };
      cur.calls += 1;
      cur.sessions.add(e.sessionId);
      agg.set(key, cur);
    }
  }

  return [...agg.values()]
    .map((v) => ({
      category: v.category,
      tool: v.tool,
      calls: v.calls,
      sessions: v.sessions.size,
    }))
    .sort((a, b) => {
      if (b.calls !== a.calls) return b.calls - a.calls;
      if (a.category !== b.category) return a.category.localeCompare(b.category);
      return a.tool.localeCompare(b.tool);
    });
}

export function summarizeTurnDiff(sessions: any[]) {
  const rows = [];
  for (const s of sessions) {
    const turns = s.events
      .filter((e: any) => e.category === 'turn')
      .slice()
      .sort((a: any, b: any) => {
        const ao = parseTurnOrdinal(a.turnId);
        const bo = parseTurnOrdinal(b.turnId);
        if (ao === undefined && bo === undefined) return String(a.turnId ?? '').localeCompare(String(b.turnId ?? ''));
        if (ao === undefined) return 1;
        if (bo === undefined) return -1;
        return ao - bo;
      });

    for (let i = 0; i < turns.length; i += 1) {
      const turn = turns[i];
      const attrs = turn.attributes ?? {};
      const input = String(turn.input ?? '');
      const prevInput = String(turns[i - 1]?.input ?? '');
      const charDelta =
        toOptionalNumber(attrs['agentic.turn.diff.char_delta']) ?? (i === 0 ? 0 : input.length - prevInput.length);
      const lineDelta =
        toOptionalNumber(attrs['agentic.turn.diff.line_delta']) ??
        (i === 0 ? 0 : (input ? input.split(/\r?\n/).length : 0) - (prevInput ? prevInput.split(/\r?\n/).length : 0));
      const similarity = toOptionalNumber(attrs['agentic.turn.diff.similarity']) ?? (i === 0 ? 1 : undefined);
      const changed =
        typeof attrs['agentic.turn.diff.changed'] === 'boolean'
          ? attrs['agentic.turn.diff.changed']
          : i === 0
            ? false
            : input !== prevInput;

      rows.push({
        projectId: s.context.projectId ?? turn.projectId,
        sessionId: s.context.sessionId ?? turn.sessionId,
        runtime: turn.runtime,
        turnId: turn.turnId,
        inputHash: attrs['agentic.turn.input.hash'] ?? '',
        prevHash: attrs['agentic.turn.input.prev_hash'] ?? '',
        charDelta,
        lineDelta,
        similarity,
        changed,
      });
    }
  }
  return rows;
}

export function summarizeContext(sessions: any[]) {
  return sessions.map((s: any) => {
    const events = s.events ?? [];
    const snapshots = events.filter((e: any) => e?.attributes?.['agentic.context.event_type'] === 'context_snapshot');
    const boundaries = events.filter((e: any) => e?.attributes?.['agentic.context.event_type'] === 'context_boundary');
    const attributions = events.filter(
      (e: any) => e?.attributes?.['agentic.context.event_type'] === 'context_source_attribution',
    );

    let maxFillRatio = 0;
    let maxDeltaTokens = 0;
    for (const snapshot of snapshots) {
      const attrs = snapshot.attributes ?? {};
      const fillRatio = toOptionalNumber(attrs['agentic.context.fill_ratio']) ?? 0;
      const deltaTokens = toOptionalNumber(attrs['agentic.context.delta_tokens']) ?? 0;
      maxFillRatio = Math.max(maxFillRatio, fillRatio);
      maxDeltaTokens = Math.max(maxDeltaTokens, deltaTokens);
    }

    const compactCount = boundaries.filter(
      (e: any) => String(e?.attributes?.['agentic.context.boundary_kind'] ?? '') === 'compact_after',
    ).length;

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
    const unknownDeltaShareWindow5 = totalTokens > 0 ? round6(unknownTokens / totalTokens) : 0;

    let unknownTopStreak = 0;
    let runningUnknown = 0;
    for (const snapshot of snapshots) {
      const topSources = parseJsonArray(snapshot?.attributes?.['agentic.context.top_sources']);
      const top = String(topSources[0] ?? '').trim();
      if (top === 'unknown') {
        runningUnknown += 1;
        unknownTopStreak = Math.max(unknownTopStreak, runningUnknown);
      } else {
        runningUnknown = 0;
      }
    }

    let highPollutionSourceStreak = 0;
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
      if (!sourceKind || !Number.isFinite(score) || score < 80) continue;
      highByTurn.get(turnId).push({ sourceKind, score });
    }
    let runningSource = '';
    let runningCount = 0;
    for (const turnId of turnOrder) {
      const items = highByTurn.get(turnId) ?? [];
      if (!items.length) {
        runningSource = '';
        runningCount = 0;
        continue;
      }
      items.sort((a: any, b: any) => b.score - a.score);
      const topSource = items[0].sourceKind;
      if (topSource === runningSource) {
        runningCount += 1;
      } else {
        runningSource = topSource;
        runningCount = 1;
      }
      highPollutionSourceStreak = Math.max(highPollutionSourceStreak, runningCount);
    }

    return {
      projectId: s.context.projectId ?? events[0]?.projectId,
      sessionId: s.context.sessionId ?? events[0]?.sessionId,
      runtime: events[0]?.runtime,
      snapshots: snapshots.length,
      boundaries: boundaries.length,
      compactCount,
      attributions: attributions.length,
      maxFillRatio: round6(maxFillRatio),
      maxDeltaTokens,
      unknownDeltaShareWindow5,
      unknownTopStreak,
      highPollutionSourceStreak,
    };
  });
}
