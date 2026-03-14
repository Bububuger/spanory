#!/usr/bin/env node
// @ts-nocheck
// BUB-79: Scoped waiver for legacy CLI entrypoint; keep strict at package level and retire incrementally.
import { existsSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { chmod, copyFile, mkdir, readdir, readFile, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

import { Command, Option } from 'commander';

import { claudeCodeAdapter } from './runtime/claude/adapter.js';
import { codexAdapter } from './runtime/codex/adapter.js';
import { createCodexProxyServer } from './runtime/codex/proxy.js';
import { mapCodexSessionsWithStat } from './runtime/codex/sessions.js';
import { openclawAdapter } from './runtime/openclaw/adapter.js';
import {
  compileOtlpSpans as compileOtlp,
  parseOtlpHeaders as parseHeaders,
  sendOtlpHttp as sendOtlp,
} from '../../otlp-core/dist/index.js';
import { loadUserEnv, resolveSpanoryEnvPath, resolveSpanoryHome } from './env.js';
import { waitForFileMtimeToSettle } from './runtime/shared/file-settle.js';
import { langfuseBackendAdapter } from '../../backend-langfuse/dist/index.js';
import { evaluateRules, loadAlertRules, sendAlertWebhook } from './alert/evaluate.js';
import {
  summarizeCache,
  loadExportedEvents,
  summarizeAgents,
  summarizeCommands,
  summarizeMcp,
  summarizeContext,
  summarizeSessions,
  summarizeTools,
  summarizeTurnDiff,
} from './report/aggregate.js';
const runtimeAdapters = {
  'claude-code': claudeCodeAdapter,
  codex: codexAdapter,
  openclaw: openclawAdapter,
};

const backendAdapters = {
  langfuse: langfuseBackendAdapter,
};

const OPENCLAW_SPANORY_PLUGIN_ID = 'spanory-openclaw-plugin';
const OPENCODE_SPANORY_PLUGIN_ID = 'spanory-opencode-plugin';
const DEFAULT_SETUP_RUNTIMES = ['claude-code', 'codex', 'openclaw', 'opencode'];
const PLUGIN_RUNTIME_NAMES = ['openclaw', 'opencode'];
const EMPTY_OUTPUT_RETRY_WINDOW_MS = 1000;
const EMPTY_OUTPUT_RETRY_INTERVAL_MS = 120;
const SPANORY_NPM_PACKAGE = '@bububuger/spanory';
const HOOK_STDIN_IDLE_MS = 200;
const HOOK_STDIN_TIMEOUT_MS = 1500;

const CODEX_WATCH_DEFAULT_POLL_MS = 1200;
const CODEX_WATCH_DEFAULT_SETTLE_MS = 250;
const EXECUTION_ENTRY = (() => {
  if (!('pkg' in process)) {
    return fileURLToPath(import.meta.url);
  }
  const candidate = path.resolve(process.argv[1] ?? process.cwd());
  try {
    return realpathSync(candidate);
  } catch {
    return candidate;
  }
})();
const requireFromHere = createRequire(EXECUTION_ENTRY);
const CLI_FILE_DIR = path.dirname(EXECUTION_ENTRY);
const CLI_PACKAGE_DIR = path.resolve(CLI_FILE_DIR, '..');
const DEFAULT_VERSION = 'unknown';
const CLI_VERSION = process.env.SPANORY_VERSION ?? DEFAULT_VERSION;

function getResource() {
  return {
    serviceName: 'spanory',
    serviceVersion: CLI_VERSION,
    environment: process.env.SPANORY_ENV ?? 'development',
  };
}

function getBackendAdapter() {
  const backendName = process.env.SPANORY_BACKEND ?? 'langfuse';
  const backend = backendAdapters[backendName];
  if (!backend) {
    throw new Error(`unsupported backend: ${backendName}`);
  }
  return backend;
}

function parseHookPayload(raw) {
  if (!raw || !raw.trim()) return {};
  try {
    const payload = JSON.parse(raw);
    return {
      hookEventName: payload.hook_event_name ?? payload.hookEventName,
      sessionId: payload.session_id ?? payload.sessionId ?? payload.thread_id ?? payload.threadId,
      threadId: payload.thread_id ?? payload.threadId,
      turnId: payload.turn_id ?? payload.turnId,
      cwd: payload.cwd,
      event: payload.event ?? payload.type ?? payload.event_name ?? payload.eventName,
      transcriptPath: payload.transcript_path ?? payload.transcriptPath,
    };
  } catch {
    throw new Error('hook payload is not valid JSON');
  }
}

function redactSecretText(value) {
  return String(value ?? '')
    .replace(/(authorization\s*[:=]\s*)(basic|bearer)\s+[^\s"']+/gi, '$1[REDACTED]')
    .replace(/\b(sk|pk)_[a-z0-9_-]{8,}\b/gi, '[REDACTED]');
}

function maskEndpoint(endpoint) {
  const raw = String(endpoint ?? '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return redactSecretText(raw);
  }
}

async function readStdinText() {
  if (process.stdin.isTTY) return '';

  return new Promise((resolve, reject) => {
    const chunks = [];
    let lastDataAt = Date.now();
    let settled = false;

    function done(error, value = '') {
      if (settled) return;
      settled = true;
      clearInterval(idleTimer);
      clearTimeout(hardTimeout);
      process.stdin.off('data', onData);
      process.stdin.off('end', onEnd);
      process.stdin.off('error', onError);
      process.stdin.pause();
      if (typeof process.stdin.unref === 'function') {
        process.stdin.unref();
      }
      if (error) reject(error);
      else resolve(value);
    }

    function onData(chunk) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      lastDataAt = Date.now();
    }

    function onEnd() {
      done(null, Buffer.concat(chunks).toString('utf-8'));
    }

    function onError(error) {
      done(error);
    }

    const idleTimer = setInterval(() => {
      if (chunks.length === 0) return;
      if (Date.now() - lastDataAt >= HOOK_STDIN_IDLE_MS) {
        done(null, Buffer.concat(chunks).toString('utf-8'));
      }
    }, 50);

    const hardTimeout = setTimeout(() => {
      done(new Error(`hook stdin read timeout after ${HOOK_STDIN_TIMEOUT_MS}ms`));
    }, HOOK_STDIN_TIMEOUT_MS);

    process.stdin.on('data', onData);
    process.stdin.on('end', onEnd);
    process.stdin.on('error', onError);
    process.stdin.resume();
  });
}

function fingerprintSession(context, events) {
  const hash = createHash('sha256');
  hash.update(String(context.projectId ?? ''));
  hash.update('\u001f');
  hash.update(String(context.sessionId ?? ''));
  hash.update('\u001f');
  hash.update(String(context.transcriptPath ?? ''));
  hash.update('\u001f');
  for (const event of events) {
    hash.update(String(event.turnId ?? ''));
    hash.update('\u001f');
    hash.update(String(event.startedAt ?? ''));
    hash.update('\u001f');
    hash.update(String(event.endedAt ?? ''));
    hash.update('\u001e');
  }
  return hash.digest('hex');
}

function parseTurnOrdinal(turnId) {
  const m = String(turnId ?? '').match(/^turn-(\d+)$/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

function selectLatestTurnEvents(events) {
  if (!Array.isArray(events) || events.length === 0) {
    return { turnId: undefined, events: [] };
  }

  let latestTurnId;
  let latestTurnOrdinal = -1;
  let hasOrdinal = false;
  for (const event of events) {
    if (!event?.turnId) continue;
    const turnOrdinal = parseTurnOrdinal(event.turnId);
    if (turnOrdinal === undefined) continue;
    hasOrdinal = true;
    if (turnOrdinal > latestTurnOrdinal) {
      latestTurnOrdinal = turnOrdinal;
      latestTurnId = event.turnId;
    }
  }

  if (!hasOrdinal) {
    const latestTurnByTime = events
      .filter((event) => event?.category === 'turn' && event?.turnId)
      .slice()
      .sort((a, b) => new Date(b.startedAt ?? 0).getTime() - new Date(a.startedAt ?? 0).getTime())[0];
    if (!latestTurnByTime?.turnId) return { turnId: undefined, events: [] };
    latestTurnId = latestTurnByTime.turnId;
  }
  return {
    turnId: latestTurnId,
    events: events.filter((event) => event.turnId === latestTurnId),
  };
}

function isTurnOutputEmpty(events, turnId) {
  if (!Array.isArray(events) || events.length === 0) return true;
  const turn = events.find((event) => event.category === 'turn' && (!turnId || event.turnId === turnId));
  if (!turn) return true;
  return String(turn.output ?? '').trim().length === 0;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveRuntimeHome(runtimeName: string, explicitRuntimeHome?: string) {
  if (explicitRuntimeHome) return explicitRuntimeHome;
  if (runtimeName === 'codex') {
    return process.env.SPANORY_CODEX_HOME ?? path.join(process.env.HOME || '', '.codex');
  }
  if (runtimeName === 'openclaw') {
    return process.env.SPANORY_OPENCLAW_HOME ?? path.join(process.env.HOME || '', '.openclaw');
  }
  if (runtimeName === 'opencode') {
    return process.env.SPANORY_OPENCODE_HOME ?? path.join(process.env.HOME || '', '.config', 'opencode');
  }
  return path.join(process.env.HOME || '', '.claude');
}

function resolveRuntimeProjectRoot(runtimeName: string, explicitRuntimeHome?: string) {
  return path.join(resolveRuntimeHome(runtimeName, explicitRuntimeHome), 'projects');
}

function resolveRuntimeStateRoot(runtimeName: string, explicitRuntimeHome?: string) {
  return path.join(resolveRuntimeHome(runtimeName, explicitRuntimeHome), 'state');
}

function resolveOpencodePluginStateRoot(runtimeHome?: string) {
  if (process.env.SPANORY_OPENCODE_STATE_DIR) return process.env.SPANORY_OPENCODE_STATE_DIR;
  if (runtimeHome || process.env.SPANORY_OPENCODE_HOME) {
    return path.join(runtimeHome ?? resolveRuntimeHome('opencode'), 'state', 'spanory');
  }
  return path.join(resolveSpanoryHome(), 'opencode');
}

function resolveRuntimeExportDir(runtimeName: string, explicitRuntimeHome?: string) {
  return path.join(resolveRuntimeStateRoot(runtimeName, explicitRuntimeHome), 'spanory-json');
}

function hookStatePath(runtimeName, sessionId, runtimeHome) {
  return path.join(resolveRuntimeStateRoot(runtimeName, runtimeHome), 'spanory', `${sessionId}.json`);
}

async function readHookState(runtimeName, sessionId, runtimeHome) {
  const file = hookStatePath(runtimeName, sessionId, runtimeHome);
  try {
    const raw = await readFile(file, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeHookState(runtimeName, sessionId, value, runtimeHome) {
  const file = hookStatePath(runtimeName, sessionId, runtimeHome);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2), 'utf-8');
}

function getRuntimeAdapter(runtimeName) {
  const adapter = runtimeAdapters[runtimeName];
  if (!adapter) throw new Error(`unsupported runtime: ${runtimeName}`);
  return adapter;
}

async function emitSession({ runtimeName, context, events, endpoint, headers, exportJsonPath }) {
  const backend = getBackendAdapter();
  const backendEvents = backend.mapEvents(events, {
    backendName: backend.backendName,
    runtimeName,
    projectId: context.projectId,
    sessionId: context.sessionId,
  });
  const payload = compileOtlp(backendEvents, getResource());

  console.log(
    `runtime=${runtimeName} projectId=${context.projectId} sessionId=${context.sessionId} events=${events.length}`,
  );

  if (endpoint) {
    await sendOtlp(endpoint, payload, headers);
    console.log(`otlp=sent endpoint=${maskEndpoint(endpoint)}`);
  } else {
    console.log('otlp=skipped endpoint=unset');
  }

  if (exportJsonPath) {
    await mkdir(path.dirname(exportJsonPath), { recursive: true });
    await writeFile(exportJsonPath, JSON.stringify({ context, events: backendEvents, payload }, null, 2), 'utf-8');
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
  const runtimeName = options.runtimeName ?? 'claude-code';
  const raw = await readStdinText();
  const hookPayload = parseHookPayload(raw);
  const adapter = getRuntimeAdapter(runtimeName);
  const resolvedContext = adapter.resolveContextFromHook(hookPayload);
  if (!resolvedContext) {
    throw new Error('cannot resolve runtime context from hook payload; require session_id (or thread_id)');
  }

  if (runtimeName === 'codex') {
    const runtimeHome = resolveRuntimeHome(runtimeName, options.runtimeHome);
    const transcriptPath =
      resolvedContext.transcriptPath ??
      (await listCodexSessions(runtimeHome)).find((session) => session.sessionId === resolvedContext.sessionId)
        ?.transcriptPath;
    if (transcriptPath) {
      const settle = await waitForFileMtimeToSettle({
        filePath: transcriptPath,
        stableWindowMs: 350,
        timeoutMs: 2500,
        pollMs: 120,
      });
      resolvedContext.transcriptPath = transcriptPath;
      if (!settle.settled) {
        console.log(`hook=settle-timeout sessionId=${resolvedContext.sessionId} waitedMs=${settle.waitedMs}`);
      }
    }
  }

  await runContextExportMode({
    runtimeName,
    context: resolvedContext,
    runtimeHome: options.runtimeHome,
    endpoint: options.endpoint,
    headers: options.headers,
    exportJsonDir: options.exportJsonDir,
    force: options.force,
    lastTurnOnly: options.lastTurnOnly,
    preferredTurnId: hookPayload.turnId,
  });
}

async function runContextExportMode(options) {
  const runtimeName = options.runtimeName;
  const adapter = getRuntimeAdapter(runtimeName);
  const contextWithRuntimeHome = {
    ...options.context,
    ...(options.runtimeHome ? { runtimeHome: options.runtimeHome } : {}),
  };
  let allEvents = [];
  let fullFingerprint = '';
  let selectedTurnId;
  let events = [];
  let selectedFingerprint = '';

  const retryDeadline = Date.now() + EMPTY_OUTPUT_RETRY_WINDOW_MS;
  for (;;) {
    allEvents = await adapter.collectEvents(contextWithRuntimeHome);
    fullFingerprint = fingerprintSession(contextWithRuntimeHome, allEvents);
    selectedTurnId = undefined;
    events = allEvents;
    selectedFingerprint = fullFingerprint;

    if (options.lastTurnOnly) {
      if (options.preferredTurnId) {
        selectedTurnId = options.preferredTurnId;
        events = allEvents.filter((event) => event.turnId === selectedTurnId);
      } else {
        const latest = selectLatestTurnEvents(allEvents);
        selectedTurnId = latest.turnId;
        events = latest.events;
      }
      if (!selectedTurnId || events.length === 0) {
        console.log(`skip=no-turn sessionId=${contextWithRuntimeHome.sessionId}`);
        return;
      }
      selectedFingerprint = fingerprintSession(contextWithRuntimeHome, events);
    }

    const shouldRetryEmptyOutput = options.lastTurnOnly && isTurnOutputEmpty(events, selectedTurnId);
    if (!shouldRetryEmptyOutput) break;

    const remainingMs = retryDeadline - Date.now();
    if (remainingMs <= 0) {
      console.log(
        `retry=empty-output-timeout sessionId=${contextWithRuntimeHome.sessionId} turnId=${selectedTurnId} waitedMs=${EMPTY_OUTPUT_RETRY_WINDOW_MS}`,
      );
      break;
    }

    const waitMs = Math.min(EMPTY_OUTPUT_RETRY_INTERVAL_MS, remainingMs);
    await sleep(waitMs);
  }

  if (!options.force) {
    const prev = await readHookState(runtimeName, contextWithRuntimeHome.sessionId, options.runtimeHome);
    if (options.lastTurnOnly) {
      if (prev?.lastTurnId === selectedTurnId && prev?.lastTurnFingerprint === selectedFingerprint) {
        console.log(`skip=unchanged-turn sessionId=${contextWithRuntimeHome.sessionId} turnId=${selectedTurnId}`);
        return;
      }
    } else if (prev?.fingerprint === fullFingerprint) {
      console.log(`skip=unchanged sessionId=${contextWithRuntimeHome.sessionId}`);
      return;
    }
  }

  const exportJsonPath = options.exportJsonDir
    ? path.join(options.exportJsonDir, `${contextWithRuntimeHome.sessionId}.json`)
    : undefined;

  await emitSession({
    runtimeName: adapter.runtimeName,
    context: contextWithRuntimeHome,
    events,
    endpoint: resolveEndpoint(options.endpoint),
    headers: resolveHeaders(options.headers),
    exportJsonPath,
  });

  await writeHookState(
    runtimeName,
    contextWithRuntimeHome.sessionId,
    {
      sessionId: contextWithRuntimeHome.sessionId,
      projectId: contextWithRuntimeHome.projectId,
      fingerprint: fullFingerprint,
      ...(options.lastTurnOnly ? { lastTurnId: selectedTurnId, lastTurnFingerprint: selectedFingerprint } : {}),
      updatedAt: new Date().toISOString(),
    },
    options.runtimeHome,
  );
  return { status: 'sent', sessionId: contextWithRuntimeHome.sessionId, turnId: selectedTurnId };
}

function sessionIdFromFilename(filename) {
  return filename.endsWith('.jsonl') ? filename.slice(0, -6) : filename;
}

async function listJsonlFilesRecursively(rootDir) {
  const out = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    let names = [];
    try {
      names = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const name of names) {
      const fullPath = path.join(dir, name.name);
      if (name.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (name.isFile() && name.name.endsWith('.jsonl')) {
        out.push(fullPath);
      }
    }
  }
  return out;
}

function normalizePositiveInt(raw, fallback, label) {
  const value = raw ?? fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`invalid ${label}: ${value}`);
  }
  return Math.floor(parsed);
}

type ListCodexSessionsOptions = {
  since?: string;
  until?: string;
  limit?: number;
};

async function listCodexSessions(runtimeHome: string, options: ListCodexSessionsOptions = {}) {
  const sessionsRoot = path.join(runtimeHome, 'sessions');
  const files = await listJsonlFilesRecursively(sessionsRoot);
  const withStat = await mapCodexSessionsWithStat(files);

  const sinceMs = options.since ? new Date(options.since).getTime() : undefined;
  const untilMs = options.until ? new Date(options.until).getTime() : undefined;
  const filtered = withStat.filter((item) => {
    if (Number.isFinite(sinceMs) && item.mtimeMs < sinceMs) return false;
    if (Number.isFinite(untilMs) && item.mtimeMs > untilMs) return false;
    return true;
  });

  const sorted = filtered.sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (!Number.isFinite(options.limit)) return sorted;
  return sorted.slice(0, Number(options.limit));
}

async function runCodexWatch(options) {
  const runtimeName = 'codex';
  const runtimeHome = resolveRuntimeHome(runtimeName, options.runtimeHome);
  const pollMs = normalizePositiveInt(options.pollMs, CODEX_WATCH_DEFAULT_POLL_MS, '--poll-ms');
  const settleMs = normalizePositiveInt(options.settleMs, CODEX_WATCH_DEFAULT_SETTLE_MS, '--settle-ms');
  const includeExisting = Boolean(options.includeExisting);
  const processedMtimeByPath = new Map();

  if (!includeExisting) {
    const baseline = await listCodexSessions(runtimeHome);
    for (const session of baseline) {
      processedMtimeByPath.set(session.transcriptPath, session.mtimeMs);
    }
    console.log(`watch=baseline files=${baseline.length}`);
  }

  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  try {
    do {
      const nowMs = Date.now();
      const sessions = await listCodexSessions(runtimeHome);
      let exportedCount = 0;
      let skippedCount = 0;

      for (const session of sessions) {
        const prevProcessedMtime = processedMtimeByPath.get(session.transcriptPath);
        if (prevProcessedMtime !== undefined && session.mtimeMs <= prevProcessedMtime) {
          continue;
        }
        if (nowMs - session.mtimeMs < settleMs) {
          continue;
        }

        const context = {
          projectId: options.projectId ?? 'codex',
          sessionId: session.sessionId,
          transcriptPath: session.transcriptPath,
          runtimeHome,
        };

        try {
          const result = await runContextExportMode({
            runtimeName,
            context,
            runtimeHome,
            endpoint: options.endpoint,
            headers: options.headers,
            exportJsonDir: options.exportJsonDir,
            force: options.force,
            lastTurnOnly: options.lastTurnOnly,
          });
          if (result?.status === 'sent') exportedCount += 1;
          else skippedCount += 1;
        } catch (error) {
          skippedCount += 1;
          const message = error?.message ? String(error.message).replace(/\s+/g, ' ') : 'unknown-error';
          console.log(`watch=error sessionId=${session.sessionId} error=${message}`);
        } finally {
          processedMtimeByPath.set(session.transcriptPath, session.mtimeMs);
        }
      }

      console.log(`watch=scan files=${sessions.length} exported=${exportedCount} skipped=${skippedCount}`);
      if (options.once) break;
      if (!stopped) await sleep(pollMs);
    } while (!stopped);
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
}

async function listCandidateSessions(runtimeName, projectId, options) {
  if (options.sessionIds) {
    return options.sessionIds
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((sessionId) => ({ sessionId }));
  }

  if (runtimeName === 'codex') {
    const runtimeHome = resolveRuntimeHome(runtimeName, options.runtimeHome);
    const sessions = await listCodexSessions(runtimeHome, options);
    return sessions.map(({ sessionId, transcriptPath }) => ({ sessionId, transcriptPath }));
  }

  let projectDir = path.join(resolveRuntimeProjectRoot(runtimeName, options.runtimeHome), projectId);
  if (runtimeName === 'openclaw') {
    const runtimeHome = resolveRuntimeHome(runtimeName, options.runtimeHome);
    const openclawCandidates = [
      path.join(runtimeHome, 'projects', projectId),
      path.join(runtimeHome, 'agents', projectId, 'sessions'),
    ];
    let selected = null;
    for (const dir of openclawCandidates) {
      try {
        await stat(dir);
        selected = dir;
        break;
      } catch {
        // try next candidate
      }
    }
    if (selected) {
      projectDir = selected;
    }
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

function runtimeDisplayName(runtimeName) {
  if (runtimeName === 'codex') return 'Codex';
  if (runtimeName === 'openclaw') return 'OpenClaw';
  if (runtimeName === 'opencode') return 'OpenCode';
  return 'Claude Code';
}

function runtimeDescription(runtimeName) {
  return `${runtimeDisplayName(runtimeName)} transcript runtime`;
}

function runSystemCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf-8',
    ...options,
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error ? String(result.error.message ?? result.error) : undefined,
  };
}

function parseListenAddress(input) {
  const raw = String(input ?? '127.0.0.1:8787').trim();
  if (!raw.includes(':')) {
    return { host: '127.0.0.1', port: Number(raw) };
  }
  const idx = raw.lastIndexOf(':');
  const host = raw.slice(0, idx) || '127.0.0.1';
  const port = Number(raw.slice(idx + 1));
  return { host, port };
}

function resolveOpenclawPluginDir() {
  if (process.env.SPANORY_OPENCLAW_PLUGIN_DIR) {
    return process.env.SPANORY_OPENCLAW_PLUGIN_DIR;
  }
  const pkgCandidate = (process as any).pkg
    ? path.resolve(path.dirname(process.execPath), '..', 'openclaw-plugin')
    : undefined;
  const candidates = [
    resolveInstalledPackageDir('@bububuger/spanory-openclaw-plugin'),
    pkgCandidate,
    path.resolve(CLI_PACKAGE_DIR, '..', 'openclaw-plugin'),
    path.resolve(CLI_PACKAGE_DIR, 'openclaw-plugin'),
    path.resolve(process.cwd(), 'packages/openclaw-plugin'),
  ].filter(Boolean);
  const hit = candidates.find((dir) => existsSync(path.join(dir, 'package.json')));
  return hit ?? candidates[0] ?? path.resolve(process.cwd(), 'packages/openclaw-plugin');
}

function resolveOpencodePluginDir() {
  if (process.env.SPANORY_OPENCODE_PLUGIN_DIR) {
    return process.env.SPANORY_OPENCODE_PLUGIN_DIR;
  }
  const pkgCandidate = (process as any).pkg
    ? path.resolve(path.dirname(process.execPath), '..', 'opencode-plugin')
    : undefined;
  const candidates = [
    resolveInstalledPackageDir('@bububuger/spanory-opencode-plugin'),
    pkgCandidate,
    path.resolve(CLI_PACKAGE_DIR, '..', 'opencode-plugin'),
    path.resolve(CLI_PACKAGE_DIR, 'opencode-plugin'),
    path.resolve(process.cwd(), 'packages/opencode-plugin'),
  ].filter(Boolean);
  const hit = candidates.find((dir) => existsSync(path.join(dir, 'package.json')));
  return hit ?? candidates[0] ?? path.resolve(process.cwd(), 'packages/opencode-plugin');
}

function resolveInstalledPackageDir(packageName) {
  try {
    const pkgJsonPath = requireFromHere.resolve(`${packageName}/package.json`);
    return path.dirname(pkgJsonPath);
  } catch {
    return undefined;
  }
}

async function resolveOpencodePluginEntry(pluginDir) {
  const explicitEntry = process.env.SPANORY_OPENCODE_PLUGIN_ENTRY;
  if (explicitEntry) {
    await stat(explicitEntry);
    return explicitEntry;
  }

  const pluginEntry = path.join(pluginDir, 'dist', 'index.js');
  await stat(pluginEntry);
  return pluginEntry;
}

function resolveOpencodePluginInstallDir(runtimeHome) {
  return path.join(resolveRuntimeHome('opencode', runtimeHome), 'plugin');
}

function opencodePluginLoaderPath(runtimeHome) {
  return path.join(resolveOpencodePluginInstallDir(runtimeHome), `${OPENCODE_SPANORY_PLUGIN_ID}.js`);
}

function resolveOpenclawPluginSpoolDir(runtimeHome) {
  return (
    process.env.SPANORY_OPENCLAW_SPOOL_DIR ??
    path.join(resolveRuntimeStateRoot('openclaw', runtimeHome), 'spanory', 'spool')
  );
}

function resolveOpencodePluginSpoolDir(runtimeHome) {
  return process.env.SPANORY_OPENCODE_SPOOL_DIR ?? path.join(resolveOpencodePluginStateRoot(runtimeHome), 'spool');
}

function resolveOpencodePluginLogFile(runtimeHome) {
  return path.join(resolveOpencodePluginStateRoot(runtimeHome), 'plugin.log');
}

async function ensureOpenclawPluginRuntimeDirs(runtimeHome) {
  const spoolDir = resolveOpenclawPluginSpoolDir(runtimeHome);
  await mkdir(spoolDir, { recursive: true });
  return { spoolDir };
}

async function ensureOpencodePluginRuntimeDirs(runtimeHome) {
  const spoolDir = resolveOpencodePluginSpoolDir(runtimeHome);
  const logFile = resolveOpencodePluginLogFile(runtimeHome);
  await mkdir(spoolDir, { recursive: true });
  await mkdir(path.dirname(logFile), { recursive: true });
  return { spoolDir, logFile };
}

function parsePluginEnabledFromInfoOutput(output) {
  if (!output) return undefined;
  const yes = /enabled\s*[:=]\s*(true|yes|1)/i.test(output);
  const no = /enabled\s*[:=]\s*(false|no|0)/i.test(output);
  if (yes) return true;
  if (no) return false;
  return undefined;
}

const NON_BLOCKING_PLUGIN_DOCTOR_CHECK_IDS = new Set(['otlp_endpoint']);

function computePluginDoctorOk(checks) {
  return checks.every((item) => item.ok || NON_BLOCKING_PLUGIN_DOCTOR_CHECK_IDS.has(item.id));
}

async function runOpenclawPluginDoctor(runtimeHome) {
  const checks = [];

  const info = runSystemCommand('openclaw', ['plugins', 'info', OPENCLAW_SPANORY_PLUGIN_ID], {
    env: {
      ...process.env,
      ...(runtimeHome ? { OPENCLAW_STATE_DIR: resolveRuntimeHome('openclaw', runtimeHome) } : {}),
    },
  });
  checks.push({
    id: 'plugin_installed',
    ok: info.code === 0,
    detail: info.code === 0 ? 'openclaw plugins info succeeded' : info.stderr || info.error || 'plugin not installed',
  });

  const enabled = parsePluginEnabledFromInfoOutput(`${info.stdout}\n${info.stderr}`);
  checks.push({
    id: 'plugin_enabled',
    ok: enabled !== false,
    detail: enabled === undefined ? 'cannot infer enabled status from openclaw output' : `enabled=${enabled}`,
  });

  checks.push({
    id: 'otlp_endpoint',
    ok: Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT),
    detail: process.env.OTEL_EXPORTER_OTLP_ENDPOINT
      ? maskEndpoint(process.env.OTEL_EXPORTER_OTLP_ENDPOINT)
      : 'OTEL_EXPORTER_OTLP_ENDPOINT is unset',
  });

  const spoolDir = resolveOpenclawPluginSpoolDir(runtimeHome);
  try {
    await stat(spoolDir);
    checks.push({ id: 'spool_writable', ok: true, detail: spoolDir });
  } catch (err) {
    checks.push({ id: 'spool_writable', ok: false, detail: String(err) });
  }

  const statusFile = path.join(resolveRuntimeStateRoot('openclaw', runtimeHome), 'spanory', 'plugin-status.json');
  try {
    const raw = await readFile(statusFile, 'utf-8');
    checks.push({ id: 'last_send_status', ok: true, detail: raw.slice(0, 500) });
  } catch {
    checks.push({
      id: 'last_send_status',
      ok: true,
      detail: `status file not generated yet: ${statusFile}`,
    });
  }

  const ok = computePluginDoctorOk(checks);
  return { ok, checks };
}

async function runOpencodePluginDoctor(runtimeHome) {
  const checks = [];

  const loaderFile = opencodePluginLoaderPath(runtimeHome);
  try {
    await stat(loaderFile);
    checks.push({ id: 'plugin_installed', ok: true, detail: loaderFile });
  } catch {
    checks.push({ id: 'plugin_installed', ok: false, detail: `plugin loader missing: ${loaderFile}` });
  }

  try {
    const loaderUrl = pathToFileURL(loaderFile).href;
    const mod = await import(loaderUrl);
    const hasDefault = typeof mod.default === 'function' || typeof mod.SpanoryOpencodePlugin === 'function';
    checks.push({
      id: 'plugin_loadable',
      ok: hasDefault,
      detail: hasDefault
        ? 'plugin module loaded and exports a register function'
        : 'plugin module loaded but missing default export function',
    });
  } catch (err) {
    checks.push({
      id: 'plugin_loadable',
      ok: false,
      detail: `plugin import failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  const opencodeConfigPath = path.join(resolveRuntimeHome('opencode', runtimeHome), 'opencode.json');
  try {
    const raw = await readFile(opencodeConfigPath, 'utf-8');
    const config = JSON.parse(raw);
    const plugins = Array.isArray(config.plugin) ? config.plugin : [];
    const registered = plugins.includes(OPENCODE_SPANORY_PLUGIN_ID);
    checks.push({
      id: 'plugin_registered',
      ok: registered,
      detail: registered
        ? opencodeConfigPath
        : `${OPENCODE_SPANORY_PLUGIN_ID} not in plugin array of ${opencodeConfigPath}`,
    });
  } catch {
    checks.push({ id: 'plugin_registered', ok: false, detail: `cannot read ${opencodeConfigPath}` });
  }

  checks.push({
    id: 'otlp_endpoint',
    ok: Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT),
    detail: process.env.OTEL_EXPORTER_OTLP_ENDPOINT
      ? maskEndpoint(process.env.OTEL_EXPORTER_OTLP_ENDPOINT)
      : 'OTEL_EXPORTER_OTLP_ENDPOINT is unset',
  });

  const spoolDir = resolveOpencodePluginSpoolDir(runtimeHome);
  try {
    await stat(spoolDir);
    checks.push({ id: 'spool_writable', ok: true, detail: spoolDir });
  } catch (err) {
    checks.push({ id: 'spool_writable', ok: false, detail: String(err) });
  }

  const statusFile = path.join(resolveOpencodePluginStateRoot(runtimeHome), 'plugin-status.json');
  const logFile = resolveOpencodePluginLogFile(runtimeHome);
  try {
    await stat(path.dirname(logFile));
    checks.push({ id: 'opencode_plugin_log', ok: true, detail: logFile });
  } catch (err) {
    checks.push({ id: 'opencode_plugin_log', ok: false, detail: String(err) });
  }
  try {
    const raw = await readFile(statusFile, 'utf-8');
    checks.push({ id: 'last_send_status', ok: true, detail: raw.slice(0, 500) });
    try {
      const parsed = JSON.parse(raw);
      const endpointConfigured = parsed?.endpointConfigured;
      if (endpointConfigured === false) {
        checks.push({
          id: 'last_send_endpoint_configured',
          ok: false,
          detail: `last send skipped or failed to resolve OTLP endpoint in opencode process; check ${resolveSpanoryEnvPath()} and restart opencode`,
        });
      } else if (endpointConfigured === true) {
        checks.push({
          id: 'last_send_endpoint_configured',
          ok: true,
          detail: 'last send had OTLP endpoint configured in opencode process',
        });
      }
    } catch {
      // ignore malformed status file
    }
  } catch {
    checks.push({
      id: 'last_send_status',
      ok: true,
      detail: `status file not generated yet: ${statusFile}`,
    });
  }

  const ok = computePluginDoctorOk(checks);
  return { ok, checks };
}

function setupHomeRoot(homeOption) {
  if (homeOption) return path.resolve(homeOption);
  return process.env.HOME || '';
}

function parseSetupRuntimes(csv) {
  const selected = (csv ?? DEFAULT_SETUP_RUNTIMES.join(','))
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const allowed = new Set(DEFAULT_SETUP_RUNTIMES);
  for (const runtimeName of selected) {
    if (!allowed.has(runtimeName)) {
      throw new Error(`unsupported runtime in --runtimes: ${runtimeName}`);
    }
  }
  return selected;
}

function parsePluginRuntimeName(runtimeName) {
  const name = String(runtimeName ?? '').trim();
  if (name === 'openclaw' || name === 'opencode') {
    return name;
  }
  throw new Error(`unsupported runtime in --runtime: ${name || '<empty>'}`);
}

function backupSuffix() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function backupIfExists(filePath) {
  try {
    await stat(filePath);
  } catch {
    return null;
  }
  const backupPath = `${filePath}.bak.${backupSuffix()}`;
  await copyFile(filePath, backupPath);
  return backupPath;
}

function isSpanoryHookCommand(command) {
  const text = String(command ?? '');
  return /\bspanory\b/.test(text) && /\bhook\b/.test(text);
}

function ensureClaudeHookEvent(settings, eventName, command) {
  if (!settings.hooks || typeof settings.hooks !== 'object' || Array.isArray(settings.hooks)) {
    settings.hooks = {};
  }
  if (!Array.isArray(settings.hooks[eventName]) || settings.hooks[eventName].length === 0) {
    settings.hooks[eventName] = [{ hooks: [] }];
  }
  if (!settings.hooks[eventName][0] || typeof settings.hooks[eventName][0] !== 'object') {
    settings.hooks[eventName][0] = { hooks: [] };
  }
  if (!Array.isArray(settings.hooks[eventName][0].hooks)) {
    settings.hooks[eventName][0].hooks = [];
  }

  const hooks = settings.hooks[eventName][0].hooks.filter(
    (hook) => !(hook && typeof hook === 'object' && isSpanoryHookCommand(hook.command)),
  );
  hooks.unshift({ type: 'command', command });
  settings.hooks[eventName][0].hooks = hooks;
}

async function applyClaudeSetup({ homeRoot, spanoryBin, dryRun }) {
  const settingsPath = path.join(homeRoot, '.claude', 'settings.json');
  let settings = {};
  try {
    settings = JSON.parse(await readFile(settingsPath, 'utf-8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw new Error(`failed to parse Claude settings: ${error.message ?? String(error)}`);
    }
  }

  const before = JSON.stringify(settings);
  const hookCommand = `${spanoryBin} hook --last-turn-only`;
  ensureClaudeHookEvent(settings, 'Stop', hookCommand);
  ensureClaudeHookEvent(settings, 'SessionEnd', hookCommand);
  const after = JSON.stringify(settings);
  const changed = before !== after;

  let backup = null;
  if (changed && !dryRun) {
    await mkdir(path.dirname(settingsPath), { recursive: true });
    backup = await backupIfExists(settingsPath);
    await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
  }

  return {
    runtime: 'claude-code',
    ok: true,
    changed,
    dryRun,
    settingsPath,
    backup,
  };
}

async function applyCodexWatchSetup({ homeRoot, dryRun }) {
  let changed = false;

  // Remove legacy notify script
  const legacyScript = path.join(homeRoot, '.codex', 'bin', 'spanory-codex-notify.sh');
  if (existsSync(legacyScript) && !dryRun) {
    await rm(legacyScript, { force: true });
    changed = true;
  }

  // Remove notify lines from config.toml
  const configPath = path.join(homeRoot, '.codex', 'config.toml');
  const notifyBackupPath = path.join(homeRoot, '.codex', 'spanory-notify.backup.json');
  let notifyBackup = null;
  if (existsSync(configPath)) {
    const content = await readFile(configPath, 'utf-8');
    const notifyLines = content
      .split('\n')
      .filter((line) => /^\s*notify\s*=/.test(line))
      .map((line) => line.trimEnd());
    const cleaned = content
      .split('\n')
      .filter((line) => !/^\s*notify\s*=/.test(line))
      .join('\n');
    if (cleaned !== content && !dryRun) {
      await mkdir(path.dirname(notifyBackupPath), { recursive: true });
      await writeFile(notifyBackupPath, `${JSON.stringify({ notifyLines }, null, 2)}\n`, 'utf-8');
      await writeFile(configPath, cleaned, 'utf-8');
      changed = true;
    }
    if (cleaned !== content) {
      notifyBackup = {
        saved: !dryRun,
        dryRun,
        backupPath: notifyBackupPath,
        notifyLineCount: notifyLines.length,
      };
    }
  }

  return { runtime: 'codex', ok: true, changed, dryRun, mode: 'watch', notifyBackup };
}

function codexWatchPidFile() {
  return path.join(resolveSpanoryHome(), 'codex-watch.pid');
}

function isCodexWatchRunning() {
  try {
    const pid = Number(readFileSync(codexWatchPidFile(), 'utf-8').trim());
    if (!pid || !Number.isFinite(pid)) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function startCodexWatch(spanoryBin) {
  if (isCodexWatchRunning()) return { started: false, reason: 'already running' };
  const binResolvable = path.isAbsolute(spanoryBin) ? existsSync(spanoryBin) : commandExists(spanoryBin);
  if (!binResolvable) return { started: false, reason: `spanory binary not found: ${spanoryBin}` };
  const logDir = path.join(resolveSpanoryHome(), 'logs');
  await mkdir(logDir, { recursive: true });
  const logFile = path.join(logDir, 'codex-watch.log');
  const out = openSync(logFile, 'a');
  const child = spawn(spanoryBin, ['runtime', 'codex', 'watch', '--last-turn-only'], {
    detached: true,
    stdio: ['ignore', out, out],
    env: process.env,
  });
  child.unref();
  const pidFile = codexWatchPidFile();
  await mkdir(path.dirname(pidFile), { recursive: true });
  await writeFile(pidFile, String(child.pid), 'utf-8');
  return { started: true, pid: child.pid, logFile, pidFile };
}

async function stopCodexWatch() {
  const pidFile = codexWatchPidFile();
  let pid;
  try {
    pid = Number((await readFile(pidFile, 'utf-8')).trim());
  } catch {
    return { stopped: false, reason: 'no pid file' };
  }
  if (!pid || !Number.isFinite(pid)) {
    await rm(pidFile, { force: true });
    return { stopped: false, reason: 'invalid pid' };
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // already dead
  }
  await rm(pidFile, { force: true });
  return { stopped: true, pid };
}

function removeClaudeHooks(settings) {
  if (!settings.hooks || typeof settings.hooks !== 'object') return;
  for (const eventName of Object.keys(settings.hooks)) {
    const groups = settings.hooks[eventName];
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (!group || !Array.isArray(group.hooks)) continue;
      group.hooks = group.hooks.filter(
        (hook) => !(hook && typeof hook === 'object' && isSpanoryHookCommand(hook.command)),
      );
    }
    settings.hooks[eventName] = groups.filter(
      (group) => !group || !Array.isArray(group.hooks) || group.hooks.length > 0,
    );
    if (settings.hooks[eventName].length === 0) delete settings.hooks[eventName];
  }
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
}

async function teardownClaudeSetup({ homeRoot, dryRun }) {
  const settingsPath = path.join(homeRoot, '.claude', 'settings.json');
  let settings = {};
  try {
    settings = JSON.parse(await readFile(settingsPath, 'utf-8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw new Error(`failed to parse Claude settings: ${error.message ?? String(error)}`);
    return { runtime: 'claude-code', ok: true, changed: false, dryRun, settingsPath, backup: null };
  }
  const before = JSON.stringify(settings);
  removeClaudeHooks(settings);
  const after = JSON.stringify(settings);
  const changed = before !== after;
  let backup = null;
  if (changed && !dryRun) {
    backup = await backupIfExists(settingsPath);
    await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
  }
  return { runtime: 'claude-code', ok: true, changed, dryRun, settingsPath, backup };
}

async function teardownCodexSetup({ homeRoot, dryRun }) {
  let watchStopped = null;
  if (!dryRun) watchStopped = await stopCodexWatch();
  const notifyBackupPath = path.join(homeRoot, '.codex', 'spanory-notify.backup.json');
  const configPath = path.join(homeRoot, '.codex', 'config.toml');
  let notifyRestore: {
    restored: boolean;
    changed: boolean;
    dryRun: boolean;
    backupPath: string;
    configPath: string;
    detail: string;
    notifyLineCount?: number;
  } = {
    restored: false,
    changed: false,
    dryRun,
    backupPath: notifyBackupPath,
    configPath,
    detail: 'no notify backup found; nothing to restore',
  };
  try {
    const backupRaw = await readFile(notifyBackupPath, 'utf-8');
    const parsed = JSON.parse(backupRaw);
    const notifyLines = Array.isArray(parsed?.notifyLines)
      ? parsed.notifyLines
          .filter((line) => typeof line === 'string')
          .map((line) => line.trimEnd())
          .filter(Boolean)
      : [];
    if (notifyLines.length > 0) {
      let current = '';
      try {
        current = await readFile(configPath, 'utf-8');
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      const cleaned = current
        .split('\n')
        .filter((line) => !/^\s*notify\s*=/.test(line))
        .join('\n');
      let restored = cleaned;
      if (restored && !restored.endsWith('\n')) restored += '\n';
      restored += notifyLines.join('\n');
      if (!restored.endsWith('\n')) restored += '\n';
      const changed = restored !== current;
      if (!dryRun) {
        await mkdir(path.dirname(configPath), { recursive: true });
        if (changed) await writeFile(configPath, restored, 'utf-8');
        await rm(notifyBackupPath, { force: true });
      }
      notifyRestore = {
        restored: true,
        changed,
        dryRun,
        backupPath: notifyBackupPath,
        configPath,
        notifyLineCount: notifyLines.length,
        detail: changed
          ? dryRun
            ? `would restore ${notifyLines.length} notify line(s) from setup backup`
            : `restored ${notifyLines.length} notify line(s) from setup backup`
          : dryRun
            ? 'notify lines already match setup backup; no config changes in dry-run'
            : 'notify lines already match setup backup; backup cleaned',
      };
    } else {
      if (!dryRun) {
        await rm(notifyBackupPath, { force: true });
      }
      notifyRestore = {
        ...notifyRestore,
        detail: dryRun
          ? 'notify backup is empty; no changes in dry-run'
          : 'notify backup is empty; backup cleaned without config changes',
      };
    }
  } catch (error) {
    if (error?.code === 'ENOENT') {
      notifyRestore = {
        ...notifyRestore,
        detail: 'no notify backup found; this teardown cannot restore notify from older apply runs',
      };
    } else {
      throw new Error(`failed to restore codex notify config: ${error?.message ?? String(error)}`);
    }
  }
  return { runtime: 'codex', ok: true, dryRun, watchStopped, notifyRestore };
}

async function teardownOpenclawSetup({ homeRoot, openclawRuntimeHome, dryRun }) {
  if (!commandExists('openclaw')) {
    return { runtime: 'openclaw', ok: true, skipped: true, detail: 'openclaw command not found in PATH' };
  }
  const runtimeHome = openclawRuntimeHomeForSetup(homeRoot, openclawRuntimeHome);
  if (dryRun) return { runtime: 'openclaw', ok: true, changed: true, dryRun };
  uninstallOpenclawPlugin(runtimeHome);
  const pathCleanupResult = await removeSpanoryOpenclawPluginLoadPaths(resolveRuntimeHome('openclaw', runtimeHome));
  return { runtime: 'openclaw', ok: true, changed: true, dryRun, pathCleanupResult };
}

async function teardownOpencodeSetup({ homeRoot, opencodeRuntimeHome, dryRun }) {
  const runtimeHome = opencodeRuntimeHomeForSetup(homeRoot, opencodeRuntimeHome);
  const pluginDir = resolveOpencodePluginInstallDir(runtimeHome);
  const loaderFile = opencodePluginLoaderPath(runtimeHome);
  const packageFile = path.join(pluginDir, 'package.json');
  let present = false;
  try {
    await stat(loaderFile);
    present = true;
  } catch {
    /* not present */
  }

  let packagePresent = false;
  try {
    await stat(packageFile);
    packagePresent = true;
  } catch {
    /* not present */
  }

  if (present && !dryRun) await rm(loaderFile, { force: true });
  if (packagePresent && !dryRun) await rm(packageFile, { force: true });
  if (!dryRun) {
    try {
      await rmdir(pluginDir);
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTEMPTY') throw error;
    }
  }

  let unregistered = false;
  if (!dryRun) {
    const opencodeConfigPath = path.join(resolveRuntimeHome('opencode', runtimeHome), 'opencode.json');
    try {
      const raw = await readFile(opencodeConfigPath, 'utf-8');
      const config = JSON.parse(raw);
      if (Array.isArray(config.plugin) && config.plugin.includes(OPENCODE_SPANORY_PLUGIN_ID)) {
        config.plugin = config.plugin.filter((p) => p !== OPENCODE_SPANORY_PLUGIN_ID);
        await writeFile(opencodeConfigPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
        unregistered = true;
      }
    } catch {
      /* no config to clean */
    }
  }

  return {
    runtime: 'opencode',
    ok: true,
    changed: present || packagePresent || unregistered,
    dryRun,
    loaderFile,
    unregistered,
  };
}

async function runSetupTeardown(options) {
  const homeRoot = setupHomeRoot(options.home);
  const selected = parseSetupRuntimes(options.runtimes);
  const dryRun = Boolean(options.dryRun);
  const results = [];
  if (selected.includes('claude-code')) {
    try {
      results.push(await teardownClaudeSetup({ homeRoot, dryRun }));
    } catch (error) {
      results.push({ runtime: 'claude-code', ok: false, error: String(error?.message ?? error) });
    }
  }
  if (selected.includes('codex')) {
    try {
      results.push(await teardownCodexSetup({ homeRoot, dryRun }));
    } catch (error) {
      results.push({ runtime: 'codex', ok: false, error: String(error?.message ?? error) });
    }
  }
  if (selected.includes('openclaw')) {
    try {
      results.push(await teardownOpenclawSetup({ homeRoot, openclawRuntimeHome: options.openclawRuntimeHome, dryRun }));
    } catch (error) {
      results.push({ runtime: 'openclaw', ok: false, error: String(error?.message ?? error) });
    }
  }
  if (selected.includes('opencode')) {
    try {
      results.push(await teardownOpencodeSetup({ homeRoot, opencodeRuntimeHome: options.opencodeRuntimeHome, dryRun }));
    } catch (error) {
      results.push({ runtime: 'opencode', ok: false, error: String(error?.message ?? error) });
    }
  }
  return { ok: results.every((r) => r.ok), results };
}

function commandExists(command) {
  const result = runSystemCommand('which', [command], { env: process.env });
  return result.code === 0;
}

function detectUpgradePackageManager(userAgent = process.env.npm_config_user_agent) {
  const token =
    String(userAgent ?? '')
      .trim()
      .split(/\s+/)[0] ?? '';
  if (token.startsWith('tnpm/')) return 'tnpm';
  return 'npm';
}

function detectUpgradeScope() {
  if (String(process.env.npm_config_global ?? '').trim() === 'true') {
    return 'global';
  }
  const normalizedEntry = String(EXECUTION_ENTRY ?? '').replaceAll('\\', '/');
  if (normalizedEntry.includes('/lib/node_modules/') || normalizedEntry.includes('/npm-global/')) {
    return 'global';
  }
  if (normalizedEntry.includes('/node_modules/')) {
    return 'local';
  }
  return 'global';
}

function resolveUpgradeInvocation(scope, manager) {
  const selectedManager = manager === 'tnpm' ? 'tnpm' : 'npm';
  const args = ['install'];
  if (scope === 'global') args.push('-g');
  args.push(`${SPANORY_NPM_PACKAGE}@latest`);
  return {
    manager: selectedManager,
    command: selectedManager,
    args,
    scope,
  };
}

function openclawRuntimeHomeForSetup(homeRoot, explicitRuntimeHome) {
  return explicitRuntimeHome || path.join(homeRoot, '.openclaw');
}

function opencodeRuntimeHomeForSetup(homeRoot, explicitRuntimeHome) {
  return explicitRuntimeHome || path.join(homeRoot, '.config', 'opencode');
}

function resolveOpenclawConfigPath(runtimeHome) {
  return path.join(runtimeHome, 'openclaw.json');
}

function canonicalPath(input) {
  const resolved = path.resolve(String(input ?? ''));
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function readOpenclawPluginNameFromDir(dirPath) {
  const pkgPath = path.join(dirPath, 'package.json');
  if (!existsSync(pkgPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const name = String(parsed?.name ?? '').trim();
    return name || null;
  } catch {
    return null;
  }
}

function isSpanoryOpenclawPluginPath(candidatePath) {
  const text = String(candidatePath ?? '').trim();
  if (!text) return false;

  const normalized = text.replaceAll('\\', '/').toLowerCase();
  if (normalized.includes('spanory') && normalized.includes('openclaw-plugin')) {
    return true;
  }

  const canonical = canonicalPath(text);
  const pluginName = readOpenclawPluginNameFromDir(canonical);
  return pluginName === '@bububuger/spanory-openclaw-plugin' || pluginName === '@alipay/spanory-openclaw-plugin';
}

async function removeSpanoryOpenclawPluginLoadPaths(runtimeHome) {
  const configPath = resolveOpenclawConfigPath(runtimeHome);
  let configRaw = '';
  try {
    configRaw = await readFile(configPath, 'utf-8');
  } catch (error) {
    if (error?.code === 'ENOENT') return { changed: false, configPath, backup: null };
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(configRaw);
  } catch (error) {
    throw new Error(`failed to parse openclaw config ${configPath}: ${error?.message ?? String(error)}`);
  }

  const currentPaths = parsed?.plugins?.load?.paths;
  if (!Array.isArray(currentPaths)) {
    return { changed: false, configPath, backup: null };
  }

  const nextPaths = currentPaths.filter((item) => !(typeof item === 'string' && isSpanoryOpenclawPluginPath(item)));
  if (nextPaths.length === currentPaths.length) {
    return { changed: false, configPath, backup: null };
  }

  parsed.plugins.load.paths = nextPaths;
  const backup = await backupIfExists(configPath);
  await writeFile(configPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf-8');
  return { changed: true, configPath, backup };
}

async function normalizeOpenclawPluginLoadPaths(runtimeHome, pluginDir, dryRun) {
  const configPath = resolveOpenclawConfigPath(runtimeHome);
  let configRaw = '';
  try {
    configRaw = await readFile(configPath, 'utf-8');
  } catch (error) {
    if (error?.code === 'ENOENT') return { changed: false, configPath, backup: null };
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(configRaw);
  } catch (error) {
    throw new Error(`failed to parse openclaw config ${configPath}: ${error?.message ?? String(error)}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    parsed = {};
  }
  if (!parsed.plugins || typeof parsed.plugins !== 'object' || Array.isArray(parsed.plugins)) {
    parsed.plugins = {};
  }
  if (!parsed.plugins.load || typeof parsed.plugins.load !== 'object' || Array.isArray(parsed.plugins.load)) {
    parsed.plugins.load = {};
  }

  const target = path.resolve(pluginDir);
  const targetCanonical = canonicalPath(target);
  const currentPaths = Array.isArray(parsed.plugins.load.paths) ? parsed.plugins.load.paths : [];
  const nonSpanoryPaths = [];
  const seen = new Set();

  for (const item of currentPaths) {
    if (typeof item !== 'string') continue;
    const text = item.trim();
    if (!text) continue;
    if (isSpanoryOpenclawPluginPath(text)) continue;
    const key = canonicalPath(text);
    if (seen.has(key)) continue;
    seen.add(key);
    nonSpanoryPaths.push(text);
  }

  if (!seen.has(targetCanonical)) {
    nonSpanoryPaths.push(target);
  }
  parsed.plugins.load.paths = nonSpanoryPaths;

  const nextRaw = `${JSON.stringify(parsed, null, 2)}\n`;
  if (nextRaw === configRaw) {
    return { changed: false, configPath, backup: null };
  }

  let backup = null;
  if (!dryRun) {
    backup = await backupIfExists(configPath);
    await writeFile(configPath, nextRaw, 'utf-8');
  }
  return { changed: true, configPath, backup };
}

async function installOpenclawPlugin(runtimeHome, dryRun, pluginDirOverride) {
  const pluginDir = path.resolve(pluginDirOverride ?? resolveOpenclawPluginDir());
  const resolvedRuntimeHome = resolveRuntimeHome('openclaw', runtimeHome);
  const installResult = runSystemCommand('openclaw', ['plugins', 'install', '-l', pluginDir], {
    env: {
      ...process.env,
      OPENCLAW_STATE_DIR: resolvedRuntimeHome,
    },
  });
  if (installResult.code !== 0) {
    throw new Error(installResult.stderr || installResult.error || 'openclaw plugins install failed');
  }
  const enableResult = runSystemCommand('openclaw', ['plugins', 'enable', OPENCLAW_SPANORY_PLUGIN_ID], {
    env: {
      ...process.env,
      OPENCLAW_STATE_DIR: resolvedRuntimeHome,
    },
  });
  if (enableResult.code !== 0) {
    throw new Error(enableResult.stderr || enableResult.error || 'openclaw plugins enable failed');
  }
  const pathNormalizeResult = await normalizeOpenclawPluginLoadPaths(resolvedRuntimeHome, pluginDir, dryRun);
  const runtimeDirs = await ensureOpenclawPluginRuntimeDirs(resolvedRuntimeHome);
  return {
    pluginDir,
    installStdout: installResult.stdout.trim(),
    enableStdout: enableResult.stdout.trim(),
    pathNormalizeResult,
    runtimeDirs,
  };
}

async function installOpencodePlugin(runtimeHome: string, pluginDirOverride?: string) {
  const pluginDir = path.resolve(pluginDirOverride ?? resolveOpencodePluginDir());
  let pluginEntry;
  try {
    pluginEntry = await resolveOpencodePluginEntry(pluginDir);
  } catch {
    throw new Error(
      `opencode plugin entry not found at ${path.join(pluginDir, 'dist', 'index.js')}. ` +
        'build plugin first: npm run --workspace @bububuger/spanory-opencode-plugin build',
    );
  }

  const installDir = resolveOpencodePluginInstallDir(runtimeHome);
  const loaderFile = opencodePluginLoaderPath(runtimeHome);
  await mkdir(installDir, { recursive: true });

  const importUrl = pathToFileURL(pluginEntry).href;
  const loader =
    `import plugin from ${JSON.stringify(importUrl)};\n` +
    'export const SpanoryOpencodePlugin = plugin;\n' +
    'export default SpanoryOpencodePlugin;\n';
  await writeFile(path.join(installDir, 'package.json'), '{"type":"module"}\n', 'utf-8');
  await writeFile(loaderFile, loader, 'utf-8');

  const opencodeConfigPath = path.join(resolveRuntimeHome('opencode', runtimeHome), 'opencode.json');
  try {
    const raw = await readFile(opencodeConfigPath, 'utf-8');
    const config = JSON.parse(raw);
    const plugins = Array.isArray(config.plugin) ? config.plugin : [];
    if (!plugins.includes(OPENCODE_SPANORY_PLUGIN_ID)) {
      config.plugin = [...plugins, OPENCODE_SPANORY_PLUGIN_ID];
      await writeFile(opencodeConfigPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    }
  } catch (err) {
    if (err?.code === 'ENOENT') {
      await writeFile(
        opencodeConfigPath,
        JSON.stringify({ plugin: [OPENCODE_SPANORY_PLUGIN_ID] }, null, 2) + '\n',
        'utf-8',
      );
      return { loaderFile };
    }
    throw err;
  }

  const runtimeDirs = await ensureOpencodePluginRuntimeDirs(runtimeHome);
  return { loaderFile, runtimeDirs };
}

function uninstallOpenclawPlugin(runtimeHome) {
  const result = runSystemCommand('openclaw', ['plugins', 'uninstall', OPENCLAW_SPANORY_PLUGIN_ID], {
    env: {
      ...process.env,
      OPENCLAW_STATE_DIR: resolveRuntimeHome('openclaw', runtimeHome),
    },
  });
  if (result.code !== 0) {
    throw new Error(result.stderr || result.error || 'openclaw plugins uninstall failed');
  }
  return {
    stdout: result.stdout.trim(),
  };
}

async function uninstallOpencodePlugin(runtimeHome) {
  const loaderFile = opencodePluginLoaderPath(runtimeHome);
  await rm(loaderFile, { force: true });

  let unregistered = false;
  const opencodeConfigPath = path.join(resolveRuntimeHome('opencode', runtimeHome), 'opencode.json');
  try {
    const raw = await readFile(opencodeConfigPath, 'utf-8');
    const config = JSON.parse(raw);
    if (Array.isArray(config.plugin) && config.plugin.includes(OPENCODE_SPANORY_PLUGIN_ID)) {
      config.plugin = config.plugin.filter((pluginId) => pluginId !== OPENCODE_SPANORY_PLUGIN_ID);
      await writeFile(opencodeConfigPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
      unregistered = true;
    }
  } catch {
    /* ignore opencode.json cleanup failures */
  }

  return { loaderFile, unregistered };
}

type PluginCommandOptions = {
  runtimeHome?: string;
  pluginDir?: string;
};

async function runPluginInstallCommand(runtimeName, options: PluginCommandOptions = {}) {
  const runtime = parsePluginRuntimeName(runtimeName);
  if (runtime === 'openclaw') {
    const result = await installOpenclawPlugin(options.runtimeHome, false, options.pluginDir);
    if (result.installStdout) console.log(result.installStdout);
    if (result.enableStdout) console.log(result.enableStdout);
    return;
  }

  const result = await installOpencodePlugin(options.runtimeHome, options.pluginDir);
  console.log(`installed=${result.loaderFile}`);
}

async function runPluginDoctorCommand(runtimeName, options: PluginCommandOptions = {}) {
  const runtime = parsePluginRuntimeName(runtimeName);
  if (runtime === 'openclaw') {
    const report = await runOpenclawPluginDoctor(options.runtimeHome);
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 2;
    return;
  }

  const report = await runOpencodePluginDoctor(options.runtimeHome);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 2;
}

async function runPluginUninstallCommand(runtimeName, options: PluginCommandOptions = {}) {
  const runtime = parsePluginRuntimeName(runtimeName);
  if (runtime === 'openclaw') {
    const result = await uninstallOpenclawPlugin(options.runtimeHome);
    if (result.stdout) console.log(result.stdout);
    return;
  }

  const result = await uninstallOpencodePlugin(options.runtimeHome);
  console.log(`removed=${result.loaderFile}`);
}

async function runSetupDetect(options) {
  const homeRoot = setupHomeRoot(options.home);
  const report = {
    homeRoot,
    runtimes: [],
  };

  const claudeSettingsPath = path.join(homeRoot, '.claude', 'settings.json');
  let claudeHooks = { stop: false, sessionEnd: false };
  try {
    const parsed = JSON.parse(await readFile(claudeSettingsPath, 'utf-8'));
    const hooks = parsed?.hooks ?? {};
    const stopHooks = hooks?.Stop?.[0]?.hooks ?? [];
    const endHooks = hooks?.SessionEnd?.[0]?.hooks ?? [];
    claudeHooks = {
      stop: Array.isArray(stopHooks) && stopHooks.some((h) => isSpanoryHookCommand(h?.command)),
      sessionEnd: Array.isArray(endHooks) && endHooks.some((h) => isSpanoryHookCommand(h?.command)),
    };
  } catch {
    // keep defaults
  }
  report.runtimes.push({
    runtime: 'claude-code',
    available: commandExists('claude'),
    configured: claudeHooks.stop && claudeHooks.sessionEnd,
    details: {
      settingsPath: claudeSettingsPath,
      stopHookConfigured: claudeHooks.stop,
      sessionEndHookConfigured: claudeHooks.sessionEnd,
    },
  });

  report.runtimes.push({
    runtime: 'codex',
    available: commandExists('codex'),
    configured: isCodexWatchRunning(),
    details: { mode: 'watch', watchRunning: isCodexWatchRunning() },
  });

  const openclawRuntimeHome = openclawRuntimeHomeForSetup(homeRoot, options.openclawRuntimeHome);
  const opencodeRuntimeHome = opencodeRuntimeHomeForSetup(homeRoot, options.opencodeRuntimeHome);
  const [openclawDoctor, opencodeDoctor] = await Promise.all([
    runOpenclawPluginDoctor(openclawRuntimeHome).catch((error) => ({
      ok: false,
      error: String(error?.message ?? error),
    })),
    runOpencodePluginDoctor(opencodeRuntimeHome).catch((error) => ({
      ok: false,
      error: String(error?.message ?? error),
    })),
  ]);
  const openclawDoctorError = 'error' in openclawDoctor ? openclawDoctor.error : undefined;
  const opencodeDoctorError = 'error' in opencodeDoctor ? opencodeDoctor.error : undefined;

  report.runtimes.push({
    runtime: 'openclaw',
    available: commandExists('openclaw'),
    configured: Boolean(openclawDoctor.ok),
    details: {
      runtimeHome: openclawRuntimeHome,
      ...(openclawDoctorError ? { doctorError: openclawDoctorError } : {}),
    },
  });
  report.runtimes.push({
    runtime: 'opencode',
    available: commandExists('opencode'),
    configured: Boolean(opencodeDoctor.ok),
    details: {
      runtimeHome: opencodeRuntimeHome,
      ...(opencodeDoctorError ? { doctorError: opencodeDoctorError } : {}),
    },
  });

  return report;
}

async function runSetupDoctor(options) {
  const homeRoot = setupHomeRoot(options.home);
  const selected = parseSetupRuntimes(options.runtimes);
  const checks = [];

  if (selected.includes('claude-code')) {
    const settingsPath = path.join(homeRoot, '.claude', 'settings.json');
    let stopHookConfigured = false;
    let sessionEndHookConfigured = false;
    try {
      const parsed = JSON.parse(await readFile(settingsPath, 'utf-8'));
      const stopHooks = parsed?.hooks?.Stop?.[0]?.hooks ?? [];
      const endHooks = parsed?.hooks?.SessionEnd?.[0]?.hooks ?? [];
      stopHookConfigured = Array.isArray(stopHooks) && stopHooks.some((h) => isSpanoryHookCommand(h?.command));
      sessionEndHookConfigured = Array.isArray(endHooks) && endHooks.some((h) => isSpanoryHookCommand(h?.command));
    } catch {
      // keep defaults
    }
    checks.push({
      id: 'claude_hook_stop',
      runtime: 'claude-code',
      ok: stopHookConfigured,
      detail: settingsPath,
    });
    checks.push({
      id: 'claude_hook_session_end',
      runtime: 'claude-code',
      ok: sessionEndHookConfigured,
      detail: settingsPath,
    });
  }

  if (selected.includes('codex')) {
    checks.push({
      id: 'codex_watch_mode',
      runtime: 'codex',
      ok: true,
      detail: 'codex is configured for watch mode',
    });

    const legacyScript = path.join(homeRoot, '.codex', 'bin', 'spanory-codex-notify.sh');
    const legacyAbsent = !existsSync(legacyScript);
    checks.push({
      id: 'codex_notify_script_absent',
      runtime: 'codex',
      ok: legacyAbsent,
      detail: legacyAbsent ? 'legacy notify script absent' : `legacy notify script still exists: ${legacyScript}`,
    });

    const watchRunning = isCodexWatchRunning();
    checks.push({
      id: 'codex_watch_running',
      runtime: 'codex',
      ok: true,
      running: watchRunning,
      detail: watchRunning ? codexWatchPidFile() : 'codex watch process not running (non-blocking)',
    });
  }

  if (selected.includes('openclaw')) {
    const openclawHome = openclawRuntimeHomeForSetup(homeRoot, options.openclawRuntimeHome);
    if (commandExists('openclaw')) {
      const report = await runOpenclawPluginDoctor(openclawHome);
      for (const check of report.checks) {
        checks.push({
          ...check,
          runtime: 'openclaw',
        });
      }
    } else {
      checks.push({
        id: 'openclaw_binary',
        runtime: 'openclaw',
        ok: false,
        detail: 'openclaw command not found in PATH',
      });
    }
  }

  if (selected.includes('opencode')) {
    const opencodeHome = opencodeRuntimeHomeForSetup(homeRoot, options.opencodeRuntimeHome);
    const report = await runOpencodePluginDoctor(opencodeHome);
    for (const check of report.checks) {
      checks.push({
        ...check,
        runtime: 'opencode',
      });
    }
  }

  return {
    ok: checks.every((check) => check.ok),
    checks,
  };
}

async function runSetupApply(options) {
  const homeRoot = setupHomeRoot(options.home);
  const selected = parseSetupRuntimes(options.runtimes);
  const spanoryBin = options.spanoryBin ?? 'spanory';
  const dryRun = Boolean(options.dryRun);
  const results = [];

  if (selected.includes('claude-code')) {
    try {
      const result = await applyClaudeSetup({ homeRoot, spanoryBin, dryRun });
      results.push(result);
    } catch (error) {
      results.push({
        runtime: 'claude-code',
        ok: false,
        error: String(error?.message ?? error),
      });
    }
  }

  if (selected.includes('codex')) {
    try {
      const result: any = await applyCodexWatchSetup({ homeRoot, dryRun });
      if (!dryRun) {
        const watch = await startCodexWatch(spanoryBin);
        result.watch = watch;
      }
      results.push(result);
    } catch (error) {
      results.push({ runtime: 'codex', ok: false, error: String(error?.message ?? error) });
    }
  }

  if (selected.includes('openclaw')) {
    if (!commandExists('openclaw')) {
      results.push({
        runtime: 'openclaw',
        ok: true,
        skipped: true,
        detail: 'openclaw command not found in PATH',
      });
    } else {
      const runtimeHome = openclawRuntimeHomeForSetup(homeRoot, options.openclawRuntimeHome);
      try {
        if (!dryRun) await installOpenclawPlugin(runtimeHome, dryRun, undefined);
        const doctor = await runOpenclawPluginDoctor(runtimeHome);
        results.push({
          runtime: 'openclaw',
          ok: doctor.ok,
          dryRun,
          doctor,
        });
      } catch (error) {
        results.push({
          runtime: 'openclaw',
          ok: false,
          error: String(error?.message ?? error),
        });
      }
    }
  }

  if (selected.includes('opencode')) {
    const runtimeHome = opencodeRuntimeHomeForSetup(homeRoot, options.opencodeRuntimeHome);
    try {
      if (!dryRun) await installOpencodePlugin(runtimeHome);
      const doctor = await runOpencodePluginDoctor(runtimeHome);
      results.push({
        runtime: 'opencode',
        ok: doctor.ok,
        dryRun,
        doctor,
      });
    } catch (error) {
      results.push({
        runtime: 'opencode',
        ok: false,
        error: String(error?.message ?? error),
      });
    }
  }

  return {
    ok: results.every((item) => item.ok),
    results,
  };
}

function registerRuntimeCommands(runtimeRoot, runtimeName) {
  const runtimeCmd = runtimeRoot.command(runtimeName).description(runtimeDescription(runtimeName));
  const displayName = runtimeDisplayName(runtimeName);
  const hasTranscriptAdapter = Boolean(runtimeAdapters[runtimeName]);

  if (hasTranscriptAdapter) {
    const exportCmd = runtimeCmd.command('export').description(`Export one ${displayName} session as OTLP spans`);

    if (runtimeName !== 'codex') {
      exportCmd.requiredOption('--project-id <id>', `${displayName} project id (folder under runtime projects root)`);
    } else {
      exportCmd.option('--project-id <id>', 'Project id override (optional; defaults to cwd-derived id)');
    }

    exportCmd
      .requiredOption('--session-id <id>', `${displayName} session id (jsonl filename without extension)`)
      .option(
        '--transcript-path <path>',
        'Override transcript path instead of <runtime-home>/projects/<project>/<session>.jsonl',
      )
      .option('--runtime-home <path>', 'Override runtime home directory')
      .option('--endpoint <url>', 'OTLP HTTP endpoint (fallback: OTEL_EXPORTER_OTLP_ENDPOINT)')
      .option('--headers <kv>', 'OTLP HTTP headers, comma-separated k=v (fallback: OTEL_EXPORTER_OTLP_HEADERS)')
      .option('--export-json <path>', 'Write parsed events and OTLP payload to a local JSON file')
      .addHelpText(
        'after',
        '\nExamples:\n' +
          `  spanory runtime ${runtimeName} export --project-id my-project --session-id 1234\n` +
          `  spanory runtime ${runtimeName} export --project-id my-project --session-id 1234 --endpoint http://localhost:3000/api/public/otel/v1/traces\n`,
      )
      .action(async (options) => {
        const adapter = getRuntimeAdapter(runtimeName);
        const context = {
          projectId: options.projectId ?? 'codex',
          sessionId: options.sessionId,
          ...(options.transcriptPath ? { transcriptPath: options.transcriptPath } : {}),
          ...(options.runtimeHome ? { runtimeHome: options.runtimeHome } : {}),
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

    runtimeCmd
      .command('hook')
      .description(`Read ${displayName} hook payload from stdin and export the matched session`)
      .option('--runtime-home <path>', 'Override runtime home directory')
      .option('--endpoint <url>', 'OTLP HTTP endpoint (fallback: OTEL_EXPORTER_OTLP_ENDPOINT)')
      .option('--headers <kv>', 'OTLP HTTP headers, comma-separated k=v (fallback: OTEL_EXPORTER_OTLP_HEADERS)')
      .option('--export-json-dir <dir>', 'Write <sessionId>.json into this directory')
      .option('--last-turn-only', 'Export only the newest turn and dedupe by turn fingerprint', true)
      .option('--force', 'Force export even if session payload fingerprint is unchanged', false)
      .addHelpText(
        'after',
        '\nExamples:\n' +
          `  echo "{...}" | spanory runtime ${runtimeName} hook\n` +
          `  cat payload.json | spanory runtime ${runtimeName} hook --export-json-dir ${resolveRuntimeExportDir(runtimeName)}\n`,
      )
      .action(async (options) =>
        runHookMode({
          runtimeName,
          runtimeHome: options.runtimeHome,
          endpoint: options.endpoint,
          headers: options.headers,
          lastTurnOnly: options.lastTurnOnly,
          force: options.force,
          exportJsonDir: options.exportJsonDir,
        }),
      );

    const backfillCmd = runtimeCmd
      .command('backfill')
      .description(`Batch export historical ${displayName} sessions for one project`);
    if (runtimeName !== 'codex') {
      backfillCmd.requiredOption('--project-id <id>', `${displayName} project id (folder under runtime projects root)`);
    } else {
      backfillCmd.option('--project-id <id>', 'Project id override (optional; defaults to cwd-derived id)');
    }
    backfillCmd
      .option('--runtime-home <path>', 'Override runtime home directory')
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
        '\nExamples:\n' +
          `  spanory runtime ${runtimeName} backfill --project-id my-project --since 2026-02-27T00:00:00Z --limit 20\n` +
          `  spanory runtime ${runtimeName} backfill --project-id my-project --session-ids a,b,c --dry-run\n`,
      )
      .action(async (options) => {
        const adapter = getRuntimeAdapter(runtimeName);
        const endpoint = resolveEndpoint(options.endpoint);
        const headers = resolveHeaders(options.headers);

        const candidates = await listCandidateSessions(runtimeName, options.projectId ?? 'codex', options);
        if (!candidates.length) {
          console.log('backfill=empty selected=0');
          return;
        }

        console.log(`backfill=selected count=${candidates.length}`);
        let exportedCount = 0;
        let skippedCount = 0;

        for (const candidate of candidates) {
          const context = {
            projectId: options.projectId ?? 'codex',
            sessionId: candidate.sessionId,
            ...(candidate.transcriptPath ? { transcriptPath: candidate.transcriptPath } : {}),
            ...(options.runtimeHome ? { runtimeHome: options.runtimeHome } : {}),
          };
          if (options.dryRun) {
            console.log(`dry-run sessionId=${candidate.sessionId}`);
            continue;
          }

          try {
            const events = await adapter.collectEvents(context);
            const exportJsonPath = options.exportJsonDir
              ? path.join(options.exportJsonDir, `${candidate.sessionId}.json`)
              : undefined;

            await emitSession({
              runtimeName: adapter.runtimeName,
              context,
              events,
              endpoint,
              headers,
              exportJsonPath,
            });
            exportedCount += 1;
          } catch (error) {
            skippedCount += 1;
            const message = error?.message ? String(error.message).replace(/\s+/g, ' ') : 'unknown-error';
            console.log(`backfill=error sessionId=${candidate.sessionId} error=${message}`);
          }
        }

        if (!options.dryRun) {
          console.log(`backfill=done selected=${candidates.length} exported=${exportedCount} skipped=${skippedCount}`);
        }
      });
  }

  if (runtimeName === 'codex') {
    runtimeCmd
      .command('watch')
      .description('Poll Codex session transcripts and export newly updated sessions (notify fallback)')
      .option('--project-id <id>', 'Project id override (optional; defaults to cwd-derived id)')
      .option('--runtime-home <path>', 'Override runtime home directory')
      .option('--poll-ms <n>', `Polling interval in milliseconds (default: ${CODEX_WATCH_DEFAULT_POLL_MS})`)
      .option('--settle-ms <n>', `Minimum file age before parsing (default: ${CODEX_WATCH_DEFAULT_SETTLE_MS})`)
      .option('--include-existing', 'Also process existing sessions on startup', false)
      .option('--once', 'Run one scan cycle and exit', false)
      .option('--endpoint <url>', 'OTLP HTTP endpoint (fallback: OTEL_EXPORTER_OTLP_ENDPOINT)')
      .option('--headers <kv>', 'OTLP HTTP headers, comma-separated k=v (fallback: OTEL_EXPORTER_OTLP_HEADERS)')
      .option('--export-json-dir <dir>', 'Write one <sessionId>.json file per exported session into this directory')
      .option('--last-turn-only', 'Export only the newest turn and dedupe by turn fingerprint', true)
      .option('--force', 'Force export even if session payload fingerprint is unchanged', false)
      .addHelpText(
        'after',
        '\nExamples:\n' +
          '  spanory runtime codex watch\n' +
          '  spanory runtime codex watch --include-existing --once --settle-ms 0\n',
      )
      .action(async (options) => {
        await runCodexWatch(options);
      });

    runtimeCmd
      .command('proxy')
      .description('Run OpenAI-compatible proxy capture for Codex traffic with full redaction')
      .option('--listen <host:port>', 'Listen address (default: 127.0.0.1:8787)', '127.0.0.1:8787')
      .option('--upstream <url>', 'Upstream OpenAI-compatible base URL')
      .option('--spool-dir <path>', 'Capture spool directory')
      .option('--max-body-bytes <n>', 'Maximum bytes to keep per redacted body', '131072')
      .action(async (options) => {
        const { host, port } = parseListenAddress(options.listen);
        if (!Number.isFinite(port) || port <= 0) {
          throw new Error(`invalid --listen port: ${options.listen}`);
        }
        const proxy = createCodexProxyServer({
          upstreamBaseUrl: options.upstream ?? process.env.SPANORY_CODEX_PROXY_UPSTREAM ?? process.env.OPENAI_BASE_URL,
          spoolDir:
            options.spoolDir ??
            process.env.SPANORY_CODEX_PROXY_SPOOL_DIR ??
            path.join(resolveRuntimeStateRoot('codex'), 'spanory', 'proxy-spool'),
          maxBodyBytes: Number(options.maxBodyBytes),
          logger: console,
        });
        await proxy.start({ host, port });
        console.log(
          `proxy=listening url=${proxy.url()} upstream=${options.upstream ?? process.env.SPANORY_CODEX_PROXY_UPSTREAM ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com'}`,
        );
        await new Promise<void>((resolve) => {
          const stop = async () => {
            process.off('SIGINT', stop);
            process.off('SIGTERM', stop);
            await proxy.stop();
            resolve();
          };
          process.on('SIGINT', stop);
          process.on('SIGTERM', stop);
        });
      });
  }

  if (runtimeName === 'openclaw') {
    const plugin = runtimeCmd.command('plugin').description('Manage Spanory OpenClaw plugin runtime integration');

    plugin
      .command('install')
      .description('Install Spanory OpenClaw plugin (alias: spanory install --runtime openclaw)')
      .option('--plugin-dir <path>', 'Plugin directory path (default: packages/openclaw-plugin)')
      .option('--runtime-home <path>', 'Override runtime home directory')
      .action(async (options) => {
        await runPluginInstallCommand('openclaw', options);
      });

    plugin
      .command('enable')
      .description('Enable Spanory OpenClaw plugin')
      .option('--runtime-home <path>', 'Override runtime home directory')
      .action((options) => {
        const result = runSystemCommand('openclaw', ['plugins', 'enable', OPENCLAW_SPANORY_PLUGIN_ID], {
          env: {
            ...process.env,
            ...(options.runtimeHome ? { OPENCLAW_STATE_DIR: resolveRuntimeHome('openclaw', options.runtimeHome) } : {}),
          },
        });
        if (result.stdout.trim()) console.log(result.stdout.trim());
        if (result.code !== 0) {
          throw new Error(result.stderr || result.error || 'openclaw plugins enable failed');
        }
      });

    plugin
      .command('disable')
      .description('Disable Spanory OpenClaw plugin')
      .option('--runtime-home <path>', 'Override runtime home directory')
      .action((options) => {
        const result = runSystemCommand('openclaw', ['plugins', 'disable', OPENCLAW_SPANORY_PLUGIN_ID], {
          env: {
            ...process.env,
            ...(options.runtimeHome ? { OPENCLAW_STATE_DIR: resolveRuntimeHome('openclaw', options.runtimeHome) } : {}),
          },
        });
        if (result.stdout.trim()) console.log(result.stdout.trim());
        if (result.code !== 0) {
          throw new Error(result.stderr || result.error || 'openclaw plugins disable failed');
        }
      });

    plugin
      .command('uninstall')
      .description('Uninstall Spanory OpenClaw plugin (alias: spanory uninstall --runtime openclaw)')
      .option('--runtime-home <path>', 'Override runtime home directory')
      .action(async (options) => {
        await runPluginUninstallCommand('openclaw', options);
      });

    plugin
      .command('doctor')
      .description('Run local diagnostic checks for Spanory OpenClaw plugin (alias: spanory doctor --runtime openclaw)')
      .option('--runtime-home <path>', 'Override runtime home directory')
      .action(async (options) => {
        await runPluginDoctorCommand('openclaw', options);
      });
  }

  if (runtimeName === 'opencode') {
    const plugin = runtimeCmd.command('plugin').description('Manage Spanory OpenCode plugin runtime integration');

    plugin
      .command('install')
      .description('Install Spanory OpenCode plugin loader (alias: spanory install --runtime opencode)')
      .option('--plugin-dir <path>', 'Plugin directory path (default: packages/opencode-plugin)')
      .option('--runtime-home <path>', 'Override OpenCode runtime home (default: ~/.config/opencode)')
      .action(async (options) => {
        await runPluginInstallCommand('opencode', options);
      });

    plugin
      .command('uninstall')
      .description('Remove Spanory OpenCode plugin loader (alias: spanory uninstall --runtime opencode)')
      .option('--runtime-home <path>', 'Override OpenCode runtime home (default: ~/.config/opencode)')
      .action(async (options) => {
        await runPluginUninstallCommand('opencode', options);
      });

    plugin
      .command('doctor')
      .description('Run local diagnostic checks for Spanory OpenCode plugin (alias: spanory doctor --runtime opencode)')
      .option('--runtime-home <path>', 'Override OpenCode runtime home (default: ~/.config/opencode)')
      .action(async (options) => {
        await runPluginDoctorCommand('opencode', options);
      });
  }
}

const program = new Command();
program
  .name('spanory')
  .description('Cross-runtime observability CLI for agent sessions')
  .showHelpAfterError()
  .showSuggestionAfterError(true)
  .version(CLI_VERSION, '-v, --version')
  .addHelpText(
    'after',
    '\nExit codes:\n' +
      '  0  Success\n' +
      '  1  Unhandled runtime error (crash)\n' +
      '  2  Command completed with failed checks or alerts\n',
  );

const runtime = program.command('runtime').description('Runtime-specific parsers and exporters');
for (const runtimeName of ['claude-code', 'codex', 'openclaw', 'opencode']) {
  registerRuntimeCommands(runtime, runtimeName);
}

function createReportInputJsonOption() {
  return new Option(
    '--input-json <path>',
    'Path to exported JSON file or directory of JSON files (fallback: SPANORY_INPUT_JSON)',
  )
    .env('SPANORY_INPUT_JSON')
    .makeOptionMandatory(true);
}

const report = program.command('report').description('Aggregate exported session JSON into infra-level views');

report
  .command('session')
  .description('Session-level summary view')
  .addOption(createReportInputJsonOption())
  .action(async (options) => {
    const sessions = await loadExportedEvents(options.inputJson);
    console.log(JSON.stringify({ view: 'session-summary', rows: summarizeSessions(sessions) }, null, 2));
  });

report
  .command('mcp')
  .description('MCP server aggregation view')
  .addOption(createReportInputJsonOption())
  .action(async (options) => {
    const sessions = await loadExportedEvents(options.inputJson);
    console.log(JSON.stringify({ view: 'mcp-summary', rows: summarizeMcp(sessions) }, null, 2));
  });

report
  .command('command')
  .description('Agent command aggregation view')
  .addOption(createReportInputJsonOption())
  .action(async (options) => {
    const sessions = await loadExportedEvents(options.inputJson);
    console.log(JSON.stringify({ view: 'command-summary', rows: summarizeCommands(sessions) }, null, 2));
  });

report
  .command('agent')
  .description('Agent activity summary per session')
  .addOption(createReportInputJsonOption())
  .action(async (options) => {
    const sessions = await loadExportedEvents(options.inputJson);
    console.log(JSON.stringify({ view: 'agent-summary', rows: summarizeAgents(sessions) }, null, 2));
  });

report
  .command('cache')
  .description('Cache usage summary per session')
  .addOption(createReportInputJsonOption())
  .action(async (options) => {
    const sessions = await loadExportedEvents(options.inputJson);
    console.log(JSON.stringify({ view: 'cache-summary', rows: summarizeCache(sessions) }, null, 2));
  });

report
  .command('tool')
  .description('Tool usage aggregation view')
  .addOption(createReportInputJsonOption())
  .action(async (options) => {
    const sessions = await loadExportedEvents(options.inputJson);
    console.log(JSON.stringify({ view: 'tool-summary', rows: summarizeTools(sessions) }, null, 2));
  });

report
  .command('context')
  .description('Context observability summary per session')
  .addOption(createReportInputJsonOption())
  .action(async (options) => {
    const sessions = await loadExportedEvents(options.inputJson);
    console.log(JSON.stringify({ view: 'context-summary', rows: summarizeContext(sessions) }, null, 2));
  });

report
  .command('turn-diff')
  .description('Turn input diff summary view')
  .addOption(createReportInputJsonOption())
  .action(async (options) => {
    const sessions = await loadExportedEvents(options.inputJson);
    console.log(JSON.stringify({ view: 'turn-diff-summary', rows: summarizeTurnDiff(sessions) }, null, 2));
  });

const alert = program.command('alert').description('Evaluate alert rules against exported telemetry data');

alert
  .requiredOption('--input-json <path>', 'Path to exported JSON file or directory of JSON files')
  .requiredOption('--rules <path>', 'Path to alert rules JSON file')
  .option('--webhook-url <url>', 'Optional webhook URL to post alert payload')
  .option('--webhook-headers <kv>', 'Webhook headers, comma-separated k=v')
  .option('--fail-on-alert', 'Exit with non-zero code when alert count > 0', false)
  .addHelpText(
    'after',
    '\nRule file format:\n' +
      '  {\n' +
      '    "rules": [\n' +
      '      {"id":"high-token","scope":"session","metric":"usage.total","op":"gt","threshold":10000}\n' +
      '    ]\n' +
      '  }\n',
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
      console.error(`webhook=sent url=${options.webhookUrl}`);
    }

    if (options.failOnAlert && alerts.length > 0) {
      process.exitCode = 2;
    }
  });

program
  .command('hook')
  .description('Minimal hook entrypoint (defaults to runtime payload + ~/.spanory/.env + default export dir)')
  .option('--runtime <name>', 'Runtime name (default: SPANORY_HOOK_RUNTIME or claude-code)')
  .option('--runtime-home <path>', 'Override runtime home directory')
  .option('--endpoint <url>', 'OTLP HTTP endpoint (fallback: OTEL_EXPORTER_OTLP_ENDPOINT)')
  .option('--headers <kv>', 'OTLP HTTP headers, comma-separated k=v (fallback: OTEL_EXPORTER_OTLP_HEADERS)')
  .option('--export-json-dir <dir>', 'Write <sessionId>.json into this directory')
  .option('--last-turn-only', 'Export only the newest turn and dedupe by turn fingerprint', true)
  .option('--force', 'Force export even if session payload fingerprint is unchanged', false)
  .addHelpText(
    'after',
    '\nMinimal usage in SessionEnd hook command:\n' + '  spanory hook\n' + '  spanory hook --runtime openclaw\n',
  )
  .action(async (options) => {
    const runtimeName = options.runtime ?? process.env.SPANORY_HOOK_RUNTIME ?? 'claude-code';
    await runHookMode({
      runtimeName,
      runtimeHome: options.runtimeHome,
      endpoint: options.endpoint,
      headers: options.headers,
      lastTurnOnly: options.lastTurnOnly,
      force: options.force,
      exportJsonDir:
        options.exportJsonDir ??
        process.env.SPANORY_HOOK_EXPORT_JSON_DIR ??
        resolveRuntimeExportDir(runtimeName, options.runtimeHome),
    });
  });

program
  .command('install')
  .description('Install Spanory runtime plugin (shortcut for runtime <runtime> plugin install)')
  .requiredOption('--runtime <name>', `Target runtime (${PLUGIN_RUNTIME_NAMES.join('|')})`)
  .option('--plugin-dir <path>', 'Plugin directory path override')
  .option('--runtime-home <path>', 'Override runtime home directory')
  .action(async (options) => {
    await runPluginInstallCommand(options.runtime, options);
  });

program
  .command('doctor')
  .description('Run Spanory runtime plugin diagnostics (shortcut for runtime <runtime> plugin doctor)')
  .requiredOption('--runtime <name>', `Target runtime (${PLUGIN_RUNTIME_NAMES.join('|')})`)
  .option('--runtime-home <path>', 'Override runtime home directory')
  .action(async (options) => {
    await runPluginDoctorCommand(options.runtime, options);
  });

program
  .command('uninstall')
  .description('Uninstall Spanory runtime plugin (shortcut for runtime <runtime> plugin uninstall)')
  .requiredOption('--runtime <name>', `Target runtime (${PLUGIN_RUNTIME_NAMES.join('|')})`)
  .option('--runtime-home <path>', 'Override runtime home directory')
  .action(async (options) => {
    await runPluginUninstallCommand(options.runtime, options);
  });

const setup = program.command('setup').description('One-command local runtime integration setup and diagnostics');

setup
  .command('detect')
  .description('Detect local runtime availability and setup status')
  .option('--home <path>', 'Home directory root override (default: $HOME)')
  .option('--openclaw-runtime-home <path>', 'Override OpenClaw runtime home for reporting')
  .option('--opencode-runtime-home <path>', 'Override OpenCode runtime home for reporting')
  .action(async (options) => {
    const report = await runSetupDetect(options);
    console.log(JSON.stringify(report, null, 2));
  });

setup
  .command('apply')
  .description('Apply idempotent local setup for selected runtimes')
  .option(
    '--runtimes <csv>',
    `Comma-separated runtimes (default: ${DEFAULT_SETUP_RUNTIMES.join(',')})`,
    DEFAULT_SETUP_RUNTIMES.join(','),
  )
  .option('--home <path>', 'Home directory root override (default: $HOME)')
  .option('--spanory-bin <path>', 'Spanory binary/command to write into runtime configs', 'spanory')
  .option('--openclaw-runtime-home <path>', 'Override OpenClaw runtime home (default: ~/.openclaw)')
  .option('--opencode-runtime-home <path>', 'Override OpenCode runtime home (default: ~/.config/opencode)')
  .option('--dry-run', 'Only print planned changes without writing files', false)
  .action(async (options) => {
    const report = await runSetupApply(options);
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 2;
  });

setup
  .command('doctor')
  .description('Run setup diagnostics for selected runtimes')
  .option(
    '--runtimes <csv>',
    `Comma-separated runtimes (default: ${DEFAULT_SETUP_RUNTIMES.join(',')})`,
    DEFAULT_SETUP_RUNTIMES.join(','),
  )
  .option('--home <path>', 'Home directory root override (default: $HOME)')
  .option('--openclaw-runtime-home <path>', 'Override OpenClaw runtime home (default: ~/.openclaw)')
  .option('--opencode-runtime-home <path>', 'Override OpenCode runtime home (default: ~/.config/opencode)')
  .action(async (options) => {
    const report = await runSetupDoctor(options);
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 2;
  });

setup
  .command('teardown')
  .description('Remove all Spanory integration from local runtimes')
  .option(
    '--runtimes <csv>',
    `Comma-separated runtimes (default: ${DEFAULT_SETUP_RUNTIMES.join(',')})`,
    DEFAULT_SETUP_RUNTIMES.join(','),
  )
  .option('--home <path>', 'Home directory root override (default: $HOME)')
  .option('--openclaw-runtime-home <path>', 'Override OpenClaw runtime home (default: ~/.openclaw)')
  .option('--opencode-runtime-home <path>', 'Override OpenCode runtime home (default: ~/.config/opencode)')
  .option('--dry-run', 'Only print planned changes without writing files', false)
  .action(async (options) => {
    const report = await runSetupTeardown(options);
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 2;
  });

program
  .command('upgrade')
  .description('Upgrade spanory CLI from npm registry')
  .option('--dry-run', 'Print upgrade command without executing', false)
  .option('--manager <name>', 'Package manager override: npm|tnpm')
  .option('--scope <scope>', 'Install scope override: global|local')
  .action(async (options) => {
    const manager = options.manager === 'tnpm' ? 'tnpm' : detectUpgradePackageManager();
    const scope = options.scope === 'local' ? 'local' : options.scope === 'global' ? 'global' : detectUpgradeScope();
    const invocation = resolveUpgradeInvocation(scope, manager);

    if (options.dryRun) {
      console.log(JSON.stringify({ dryRun: true, ...invocation }, null, 2));
      return;
    }

    const result = runSystemCommand(invocation.command, invocation.args, { env: process.env });
    const output = (result.stdout || result.stderr || '').trim();
    if (result.code !== 0) {
      console.error(output || result.error || 'upgrade failed');
      process.exitCode = 2;
      return;
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          ...invocation,
          output,
        },
        null,
        2,
      ),
    );
  });

const formatUnhandledRejection = (reason: unknown): string => {
  if (reason instanceof Error) return reason.stack ?? reason.message;
  if (typeof reason === 'string') return reason;
  try {
    return JSON.stringify(reason);
  } catch {
    return String(reason);
  }
};

const normalizeLegacyAlertEvalArgv = (argv) => {
  if (argv[2] === 'alert' && argv[3] === 'eval') {
    return [argv[0], argv[1], 'alert', ...argv.slice(4)];
  }
  return argv;
};

process.on('unhandledRejection', (reason) => {
  console.error(`[spanory] Unhandled promise rejection: ${formatUnhandledRejection(reason)}`);
  process.exitCode = 1;
});

loadUserEnv()
  .then(() => program.parseAsync(normalizeLegacyAlertEvalArgv(process.argv)))
  .catch((error) => {
    console.error(`[spanory] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
