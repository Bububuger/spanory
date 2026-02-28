#!/usr/bin/env node
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { Command } from 'commander';

import { claudeCodeAdapter } from './runtime/claude/adapter.js';
import { compileOtlp, parseHeaders, sendOtlp } from './otlp.js';
import { evaluateRules, loadAlertRules, sendAlertWebhook } from './alert/evaluate.js';
import {
  loadExportedEvents,
  summarizeAgents,
  summarizeCommands,
  summarizeMcp,
  summarizeSessions,
} from './report/aggregate.js';

const runtimeAdapters = {
  'claude-code': claudeCodeAdapter,
};

function getResource() {
  return {
    serviceName: 'spanory',
    serviceVersion: process.env.SPANORY_VERSION ?? '0.1.0',
    environment: process.env.SPANORY_ENV ?? 'development',
  };
}

function parseHookPayload(raw) {
  if (!raw || !raw.trim()) return {};
  try {
    const payload = JSON.parse(raw);
    return {
      hookEventName: payload.hook_event_name ?? payload.hookEventName,
      sessionId: payload.session_id ?? payload.sessionId,
      transcriptPath: payload.transcript_path ?? payload.transcriptPath,
    };
  } catch {
    throw new Error('hook payload is not valid JSON');
  }
}

function parseSimpleDotEnv(raw) {
  const out = {};
  for (const line of raw.split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const idx = s.indexOf('=');
    if (idx <= 0) continue;
    const key = s.slice(0, idx).trim();
    let value = s.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!key) continue;
    out[key] = value;
  }
  return out;
}

async function loadUserEnv() {
  const envPath = path.join(process.env.HOME || '', '.env');
  try {
    const raw = await readFile(envPath, 'utf-8');
    const parsed = parseSimpleDotEnv(raw);
    for (const [k, v] of Object.entries(parsed)) {
      if (process.env[k] === undefined) process.env[k] = v;
    }
  } catch {
    // ignore missing ~/.env
  }
}

async function readStdinText() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

async function emitSession({ runtimeName, context, events, endpoint, headers, exportJsonPath }) {
  const payload = compileOtlp(events, getResource());

  console.log(`runtime=${runtimeName} projectId=${context.projectId} sessionId=${context.sessionId} events=${events.length}`);

  if (endpoint) {
    await sendOtlp(endpoint, payload, headers);
    console.log(`otlp=sent endpoint=${endpoint}`);
  } else {
    console.log('otlp=skipped endpoint=unset');
  }

  if (exportJsonPath) {
    await writeFile(exportJsonPath, JSON.stringify({ context, events, payload }, null, 2), 'utf-8');
    console.log(`json=${exportJsonPath}`);
  }
}

function resolveEndpoint(optionValue) {
  return optionValue ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
}

function resolveHeaders(optionValue) {
  return parseHeaders(optionValue ?? process.env.OTEL_EXPORTER_OTLP_HEADERS);
}

async function runHookMode(options) {
  const adapter = runtimeAdapters['claude-code'];
  const raw = await readStdinText();
  const hookPayload = parseHookPayload(raw);
  const context = adapter.resolveContextFromHook(hookPayload);
  if (!context) {
    throw new Error('cannot resolve runtime context from hook payload; require session_id and transcript_path');
  }

  const events = await adapter.collectEvents(context);
  const exportJsonPath = options.exportJsonDir ? path.join(options.exportJsonDir, `${context.sessionId}.json`) : undefined;

  await emitSession({
    runtimeName: adapter.runtimeName,
    context,
    events,
    endpoint: resolveEndpoint(options.endpoint),
    headers: resolveHeaders(options.headers),
    exportJsonPath,
  });
}

function sessionIdFromFilename(filename) {
  return filename.endsWith('.jsonl') ? filename.slice(0, -6) : filename;
}

async function listCandidateSessions(projectId, options) {
  const projectDir = path.join(process.env.HOME || '', '.claude', 'projects', projectId);

  if (options.sessionIds) {
    return options.sessionIds
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((sessionId) => ({ sessionId }));
  }

  const names = (await readdir(projectDir)).filter((name) => name.endsWith('.jsonl'));
  const withStat = await Promise.all(
    names.map(async (name) => {
      const fullPath = path.join(projectDir, name);
      const fileStat = await stat(fullPath);
      return {
        sessionId: sessionIdFromFilename(name),
        mtimeMs: fileStat.mtimeMs,
      };
    }),
  );

  const sinceMs = options.since ? new Date(options.since).getTime() : undefined;
  const untilMs = options.until ? new Date(options.until).getTime() : undefined;

  const filtered = withStat.filter((item) => {
    if (Number.isFinite(sinceMs) && item.mtimeMs < sinceMs) return false;
    if (Number.isFinite(untilMs) && item.mtimeMs > untilMs) return false;
    return true;
  });

  const sorted = filtered.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return sorted.slice(0, Number(options.limit)).map(({ sessionId }) => ({ sessionId }));
}

const program = new Command();
program
  .name('spanory')
  .description('Cross-runtime observability CLI for agent sessions')
  .showHelpAfterError()
  .showSuggestionAfterError(true)
  .version('0.1.0');

const runtime = program.command('runtime').description('Runtime-specific parsers and exporters');
const claudeCode = runtime.command('claude-code').description('Claude Code transcript runtime');

claudeCode
  .command('export')
  .description('Export one Claude Code session as OTLP spans')
  .requiredOption('--project-id <id>', 'Claude project id (folder under ~/.claude/projects)')
  .requiredOption('--session-id <id>', 'Claude session id (jsonl filename without extension)')
  .option('--transcript-path <path>', 'Override transcript path instead of ~/.claude/projects/<project>/<session>.jsonl')
  .option('--endpoint <url>', 'OTLP HTTP endpoint (fallback: OTEL_EXPORTER_OTLP_ENDPOINT)')
  .option('--headers <kv>', 'OTLP HTTP headers, comma-separated k=v (fallback: OTEL_EXPORTER_OTLP_HEADERS)')
  .option('--export-json <path>', 'Write parsed events and OTLP payload to a local JSON file')
  .addHelpText(
    'after',
    '\nExamples:\n'
      + '  spanory runtime claude-code export --project-id my-project --session-id 1234\n'
      + '  spanory runtime claude-code export --project-id my-project --session-id 1234 --endpoint http://localhost:3000/api/public/otel/v1/traces\n',
  )
  .action(async (options) => {
    const adapter = runtimeAdapters['claude-code'];
    const context = {
      projectId: options.projectId,
      sessionId: options.sessionId,
      ...(options.transcriptPath ? { transcriptPath: options.transcriptPath } : {}),
    };
    const events = await adapter.collectEvents(context);
    await emitSession({
      runtimeName: adapter.runtimeName,
      context,
      events,
      endpoint: resolveEndpoint(options.endpoint),
      headers: resolveHeaders(options.headers),
      exportJsonPath: options.exportJson,
    });
  });

claudeCode
  .command('hook')
  .description('Read Claude hook payload from stdin and export the matched session')
  .option('--endpoint <url>', 'OTLP HTTP endpoint (fallback: OTEL_EXPORTER_OTLP_ENDPOINT)')
  .option('--headers <kv>', 'OTLP HTTP headers, comma-separated k=v (fallback: OTEL_EXPORTER_OTLP_HEADERS)')
  .option('--export-json-dir <dir>', 'Write <sessionId>.json into this directory')
  .addHelpText(
    'after',
    '\nExamples:\n'
      + '  echo "{...}" | spanory runtime claude-code hook\n'
      + '  cat payload.json | spanory runtime claude-code hook --export-json-dir ~/.claude/state/spanory-json\n',
  )
  .action(async (options) => runHookMode(options));

claudeCode
  .command('backfill')
  .description('Batch export historical Claude sessions for one project')
  .requiredOption('--project-id <id>', 'Claude project id (folder under ~/.claude/projects)')
  .option('--session-ids <csv>', 'Comma-separated session ids; if set, since/until/limit are ignored')
  .option('--since <iso>', 'Only include sessions with transcript file mtime >= this ISO timestamp')
  .option('--until <iso>', 'Only include sessions with transcript file mtime <= this ISO timestamp')
  .option('--limit <n>', 'Max number of sessions when auto-selecting by mtime', '50')
  .option('--endpoint <url>', 'OTLP HTTP endpoint (fallback: OTEL_EXPORTER_OTLP_ENDPOINT)')
  .option('--headers <kv>', 'OTLP HTTP headers, comma-separated k=v (fallback: OTEL_EXPORTER_OTLP_HEADERS)')
  .option('--export-json-dir <dir>', 'Write one <sessionId>.json file per session into this directory')
  .option('--dry-run', 'Print selected sessions without sending OTLP', false)
  .addHelpText(
    'after',
    '\nExamples:\n'
      + '  spanory runtime claude-code backfill --project-id my-project --since 2026-02-27T00:00:00Z --limit 20\n'
      + '  spanory runtime claude-code backfill --project-id my-project --session-ids a,b,c --dry-run\n',
  )
  .action(async (options) => {
    const adapter = runtimeAdapters['claude-code'];
    const endpoint = resolveEndpoint(options.endpoint);
    const headers = resolveHeaders(options.headers);

    const candidates = await listCandidateSessions(options.projectId, options);
    if (!candidates.length) {
      console.log('backfill=empty selected=0');
      return;
    }

    console.log(`backfill=selected count=${candidates.length}`);

    for (const candidate of candidates) {
      const context = { projectId: options.projectId, sessionId: candidate.sessionId };
      if (options.dryRun) {
        console.log(`dry-run sessionId=${candidate.sessionId}`);
        continue;
      }

      const events = await adapter.collectEvents(context);
      const exportJsonPath = options.exportJsonDir ? path.join(options.exportJsonDir, `${candidate.sessionId}.json`) : undefined;

      await emitSession({
        runtimeName: adapter.runtimeName,
        context,
        events,
        endpoint,
        headers,
        exportJsonPath,
      });
    }
  });

const report = program.command('report').description('Aggregate exported session JSON into infra-level views');

report
  .command('session')
  .description('Session-level summary view')
  .requiredOption('--input-json <path>', 'Path to exported JSON file or directory of JSON files')
  .action(async (options) => {
    const sessions = await loadExportedEvents(options.inputJson);
    console.log(JSON.stringify({ view: 'session-summary', rows: summarizeSessions(sessions) }, null, 2));
  });

report
  .command('mcp')
  .description('MCP server aggregation view')
  .requiredOption('--input-json <path>', 'Path to exported JSON file or directory of JSON files')
  .action(async (options) => {
    const sessions = await loadExportedEvents(options.inputJson);
    console.log(JSON.stringify({ view: 'mcp-summary', rows: summarizeMcp(sessions) }, null, 2));
  });

report
  .command('command')
  .description('Agent command aggregation view')
  .requiredOption('--input-json <path>', 'Path to exported JSON file or directory of JSON files')
  .action(async (options) => {
    const sessions = await loadExportedEvents(options.inputJson);
    console.log(JSON.stringify({ view: 'command-summary', rows: summarizeCommands(sessions) }, null, 2));
  });

report
  .command('agent')
  .description('Agent activity summary per session')
  .requiredOption('--input-json <path>', 'Path to exported JSON file or directory of JSON files')
  .action(async (options) => {
    const sessions = await loadExportedEvents(options.inputJson);
    console.log(JSON.stringify({ view: 'agent-summary', rows: summarizeAgents(sessions) }, null, 2));
  });

const alert = program.command('alert').description('Evaluate alert rules against exported telemetry data');

alert
  .command('eval')
  .description('Run threshold rules and emit alert events')
  .requiredOption('--input-json <path>', 'Path to exported JSON file or directory of JSON files')
  .requiredOption('--rules <path>', 'Path to alert rules JSON file')
  .option('--webhook-url <url>', 'Optional webhook URL to post alert payload')
  .option('--webhook-headers <kv>', 'Webhook headers, comma-separated k=v')
  .option('--fail-on-alert', 'Exit with non-zero code when alert count > 0', false)
  .addHelpText(
    'after',
    '\nRule file format:\n'
      + '  {\n'
      + '    "rules": [\n'
      + '      {"id":"high-token","scope":"session","metric":"usage.total","op":"gt","threshold":10000}\n'
      + '    ]\n'
      + '  }\n',
  )
  .action(async (options) => {
    const sessions = await loadExportedEvents(options.inputJson);
    const rules = await loadAlertRules(options.rules);
    const alerts = evaluateRules(rules, sessions);

    const result = {
      evaluatedAt: new Date().toISOString(),
      sessions: sessions.length,
      rules: rules.length,
      alerts,
    };
    console.log(JSON.stringify(result, null, 2));

    if (options.webhookUrl) {
      await sendAlertWebhook(options.webhookUrl, result, parseHeaders(options.webhookHeaders));
      console.log(`webhook=sent url=${options.webhookUrl}`);
    }

    if (options.failOnAlert && alerts.length > 0) {
      process.exitCode = 2;
    }
  });

program
  .command('hook')
  .description('Minimal hook entrypoint (defaults to Claude payload + ~/.env + default export dir)')
  .option('--endpoint <url>', 'OTLP HTTP endpoint (fallback: OTEL_EXPORTER_OTLP_ENDPOINT)')
  .option('--headers <kv>', 'OTLP HTTP headers, comma-separated k=v (fallback: OTEL_EXPORTER_OTLP_HEADERS)')
  .option('--export-json-dir <dir>', 'Write <sessionId>.json into this directory')
  .addHelpText(
    'after',
    '\nMinimal usage in Claude SessionEnd hook command:\n'
      + '  spanory hook\n',
  )
  .action(async (options) => {
    await runHookMode({
      endpoint: options.endpoint,
      headers: options.headers,
      exportJsonDir: options.exportJsonDir ?? process.env.SPANORY_HOOK_EXPORT_JSON_DIR ?? path.join(process.env.HOME || '', '.claude', 'state', 'spanory-json'),
    });
  });

loadUserEnv()
  .then(() => program.parseAsync(process.argv))
  .catch((error) => {
  console.error(`[spanory] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
  });
