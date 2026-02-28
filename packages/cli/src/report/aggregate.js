import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function usageFromEvent(event) {
  const attrs = event.attributes ?? {};
  const input = toNumber(attrs['gen_ai.usage.input_tokens']);
  const output = toNumber(attrs['gen_ai.usage.output_tokens']);
  const total = toNumber(attrs['gen_ai.usage.total_tokens']) || input + output;
  return { input, output, total };
}

export async function loadExportedEvents(inputPath) {
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
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.events)) continue;
    sessions.push({
      file,
      context: parsed.context ?? {},
      events: parsed.events,
    });
  }
  return sessions;
}

export function summarizeSessions(sessions) {
  return sessions.map((s) => {
    const turns = s.events.filter((e) => e.category === 'turn');
    const usage = turns.reduce(
      (acc, e) => {
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

export function summarizeMcp(sessions) {
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

export function summarizeCommands(sessions) {
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

export function summarizeAgents(sessions) {
  const out = [];
  for (const s of sessions) {
    const turns = s.events.filter((e) => e.category === 'turn');
    const tasks = s.events.filter((e) => e.category === 'agent_task');
    const shell = s.events.filter((e) => e.category === 'shell_command');
    const mcp = s.events.filter((e) => e.category === 'mcp');

    const usage = turns.reduce(
      (acc, e) => {
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
