#!/usr/bin/env node
import { readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { Command } from 'commander';

import { claudeCodeAdapter } from './runtime/claude/adapter.js';
import { compileOtlp, parseHeaders, sendOtlp } from './otlp.js';

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
  .action(async (options) => {
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
  });

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

program.parseAsync(process.argv).catch((error) => {
  console.error(`[spanory] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
