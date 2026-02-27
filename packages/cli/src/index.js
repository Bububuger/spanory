#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { claudeCodeAdapter } from './runtime/claude/adapter.js';
import { compileOtlp, parseHeaders, sendOtlp } from './otlp.js';

const runtimeAdapters = {
  'claude-code': claudeCodeAdapter,
};

function usage() {
  console.log([
    'Spanory CLI',
    '',
    'Commands:',
    '  spanory runtime claude-code export --project-id <id> --session-id <id> [--endpoint <url>] [--headers <k=v,...>] [--export-json <path>]',
    '  spanory runtime claude-code hook [--endpoint <url>] [--headers <k=v,...>] [--export-json-dir <dir>]',
    '',
    'Notes:',
    '  - hook mode reads Claude hook payload JSON from stdin.',
    '  - endpoint fallback: OTEL_EXPORTER_OTLP_ENDPOINT',
    '  - headers fallback: OTEL_EXPORTER_OTLP_HEADERS',
  ].join('\n'));
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      out[arg.slice(2)] = argv[i + 1];
      i += 1;
    } else {
      out._.push(arg);
    }
  }
  return out;
}

async function readStdinJson() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf-8').trim();
  if (!raw) return {};
  try {
    const payload = JSON.parse(raw);
    return {
      hookEventName: payload.hook_event_name ?? payload.hookEventName,
      sessionId: payload.session_id ?? payload.sessionId,
      transcriptPath: payload.transcript_path ?? payload.transcriptPath,
    };
  } catch {
    return {};
  }
}

function resolveContext(adapter, mode, args, hookPayload) {
  if (mode === 'export') {
    const projectId = args['project-id'];
    const sessionId = args['session-id'];
    if (!projectId || !sessionId) {
      throw new Error('export mode requires --project-id and --session-id');
    }
    return { projectId, sessionId };
  }

  if (mode === 'hook') {
    const ctx = adapter.resolveContextFromHook(hookPayload);
    if (!ctx) throw new Error('cannot resolve runtime context from hook payload');
    return ctx;
  }

  throw new Error(`unknown mode: ${mode}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [target, runtimeName, mode] = args._;

  if (args.help || args.h || !target) {
    usage();
    return;
  }

  if (target !== 'runtime') throw new Error('only `runtime` command is supported');
  const adapter = runtimeAdapters[runtimeName];
  if (!adapter) throw new Error(`unsupported runtime: ${runtimeName}`);
  if (!mode) throw new Error('missing mode: export|hook');

  const hookPayload = mode === 'hook' ? await readStdinJson() : {};
  const context = resolveContext(adapter, mode, args, hookPayload);

  const events = await adapter.collectEvents(context);
  const payload = compileOtlp(events, {
    serviceName: 'spanory',
    serviceVersion: process.env.SPANORY_VERSION ?? '0.1.0',
    environment: process.env.SPANORY_ENV ?? 'development',
  });

  console.log(`runtime=${runtimeName} mode=${mode} projectId=${context.projectId} sessionId=${context.sessionId}`);
  console.log(`events=${events.length}`);

  const endpoint = args.endpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const headers = parseHeaders(args.headers ?? process.env.OTEL_EXPORTER_OTLP_HEADERS);

  if (endpoint) {
    await sendOtlp(endpoint, payload, headers);
    console.log(`otlp=sent endpoint=${endpoint}`);
  } else {
    console.log('otlp=skipped endpoint=unset');
  }

  if (args['export-json']) {
    await writeFile(args['export-json'], JSON.stringify({ context, events, payload }, null, 2), 'utf-8');
    console.log(`json=${args['export-json']}`);
  }

  if (mode === 'hook' && args['export-json-dir']) {
    const outputPath = path.join(args['export-json-dir'], `${context.sessionId}.json`);
    await writeFile(outputPath, JSON.stringify({ context, events, payload }, null, 2), 'utf-8');
    console.log(`json=${outputPath}`);
  }
}

main().catch((error) => {
  console.error(`[spanory] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
