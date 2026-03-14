#!/usr/bin/env node
// @ts-nocheck
import { existsSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

import { claudeCodeAdapter } from './runtime/claude/adapter.js';
import { codexAdapter } from './runtime/codex/adapter.js';
import { createCodexProxyServer } from './runtime/codex/proxy.js';
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
import {
  loadIssueState,
  parsePendingTodoItems,
  resolveIssueStatePath,
  resolveTodoPath,
  saveIssueState,
  setIssueStatus,
  syncIssueState,
} from './issue/state.js';
import { createProgram } from './cli/commands.js';
import {
  CODEX_WATCH_DEFAULT_POLL_MS,
  CODEX_WATCH_DEFAULT_SETTLE_MS,
  listCodexSessions,
  runCodexWatch as runCodexWatchModule,
  sessionIdFromFilename,
} from './codex/watch.js';
import {
  OPENCLAW_SPANORY_PLUGIN_ID,
  installOpenclawPlugin as installOpenclawPluginModule,
  openclawRuntimeHomeForSetup as openclawRuntimeHomeForSetupModule,
  resolveOpenclawPluginDir as resolveOpenclawPluginDirModule,
  runOpenclawPluginDoctor as runOpenclawPluginDoctorModule,
} from './plugin/openclaw.js';
import {
  OPENCODE_SPANORY_PLUGIN_ID,
  installOpencodePlugin as installOpencodePluginModule,
  opencodePluginLoaderPath as opencodePluginLoaderPathModule,
  opencodeRuntimeHomeForSetup as opencodeRuntimeHomeForSetupModule,
  resolveOpencodePluginDir as resolveOpencodePluginDirModule,
  uninstallOpencodePlugin as uninstallOpencodePluginModule,
  runOpencodePluginDoctor as runOpencodePluginDoctorModule,
} from './plugin/opencode.js';
import { runSetupApply as runSetupApplyModule } from './setup/apply.js';
import {
  runSetupDetect as runSetupDetectModule,
  runSetupDoctor as runSetupDoctorModule,
} from './setup/detect.js';
import { runSetupTeardown as runSetupTeardownModule } from './setup/teardown.js';

const runtimeAdapters = {
  'claude-code': claudeCodeAdapter,
  codex: codexAdapter,
  openclaw: openclawAdapter,
};

const backendAdapters = {
  langfuse: langfuseBackendAdapter,
};

const DEFAULT_SETUP_RUNTIMES = ['claude-code', 'codex', 'openclaw', 'opencode'];
const EMPTY_OUTPUT_RETRY_WINDOW_MS = 1000;
const EMPTY_OUTPUT_RETRY_INTERVAL_MS = 120;
const SPANORY_NPM_PACKAGE = '@bububuger/spanory';
const HOOK_STDIN_IDLE_MS = 200;
const HOOK_STDIN_TIMEOUT_MS = 1500;
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

function readVersionFromPackageJson() {
  const packageNameCandidates = ['@bububuger/spanory', '@spanory/cli'];
  for (const packageName of packageNameCandidates) {
    try {
      const pkgJsonPath = requireFromHere.resolve(`${packageName}/package.json`);
      const parsed = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
      const version = String(parsed?.version ?? '').trim();
      if (version) return version;
    } catch {}
  }

  const candidates = [
    path.join(CLI_PACKAGE_DIR, 'package.json'),
    path.resolve(process.cwd(), 'packages', 'cli', 'package.json'),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      const version = String(parsed?.version ?? '').trim();
      if (version) return version;
    } catch {}
  }
  return null;
}

const CLI_VERSION = process.env.SPANORY_VERSION ?? readVersionFromPackageJson() ?? DEFAULT_VERSION;

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
    .replace(/(authorization\s*[:=]\s*)(basic|bearer)\s+[^\s"']+/ig, '$1[REDACTED]')
    .replace(/\b(sk|pk)_[a-z0-9_-]{8,}\b/ig, '[REDACTED]');
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

function resolveRuntimeHome(runtimeName, explicitRuntimeHome) {
  if (explicitRuntimeHome) return explicitRuntimeHome;
  if (runtimeName === 'codex') {
    return process.env.SPANORY_CODEX_HOME ?? path.join(process.env.HOME || '', '.codex');
  }
  if (runtimeName === 'openclaw') {
    return (
      process.env.SPANORY_OPENCLOW_HOME
      ?? process.env.SPANORY_OPENCLAW_HOME
      ?? path.join(process.env.HOME || '', '.openclaw')
    );
  }
  if (runtimeName === 'opencode') {
    return process.env.SPANORY_OPENCODE_HOME ?? path.join(process.env.HOME || '', '.config', 'opencode');
  }
  return path.join(process.env.HOME || '', '.claude');
}

function resolveRuntimeProjectRoot(runtimeName, explicitRuntimeHome) {
  return path.join(resolveRuntimeHome(runtimeName, explicitRuntimeHome), 'projects');
}

function resolveRuntimeStateRoot(runtimeName, explicitRuntimeHome) {
  return path.join(resolveRuntimeHome(runtimeName, explicitRuntimeHome), 'state');
}

function resolveOpencodePluginStateRoot(runtimeHome) {
  if (process.env.SPANORY_OPENCODE_STATE_DIR) return process.env.SPANORY_OPENCODE_STATE_DIR;
  if (runtimeHome || process.env.SPANORY_OPENCODE_HOME) {
    return path.join(runtimeHome ?? resolveRuntimeHome('opencode'), 'state', 'spanory');
  }
  return path.join(resolveSpanoryHome(), 'opencode');
}

function resolveRuntimeExportDir(runtimeName, explicitRuntimeHome) {
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

  console.log(`runtime=${runtimeName} projectId=${context.projectId} sessionId=${context.sessionId} events=${events.length}`);

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
    const transcriptPath = resolvedContext.transcriptPath
      ?? (await listCodexSessions(runtimeHome)).find((session) => session.sessionId === resolvedContext.sessionId)?.transcriptPath;
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

  const spoolDir = process.env.SPANORY_OPENCLAW_SPOOL_DIR
    ?? path.join(resolveRuntimeStateRoot('openclaw', runtimeHome), 'spanory', 'spool');
  try {
    await mkdir(spoolDir, { recursive: true });
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
      detail: hasDefault ? 'plugin module loaded and exports a register function' : 'plugin module loaded but missing default export function',
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
      detail: registered ? opencodeConfigPath : `${OPENCODE_SPANORY_PLUGIN_ID} not in plugin array of ${opencodeConfigPath}`,
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

  const spoolDir = process.env.SPANORY_OPENCODE_SPOOL_DIR
    ?? path.join(resolveOpencodePluginStateRoot(runtimeHome), 'spool');
  try {
    await mkdir(spoolDir, { recursive: true });
    checks.push({ id: 'spool_writable', ok: true, detail: spoolDir });
  } catch (err) {
    checks.push({ id: 'spool_writable', ok: false, detail: String(err) });
  }

  const statusFile = path.join(resolveOpencodePluginStateRoot(runtimeHome), 'plugin-status.json');
  const logFile = path.join(resolveOpencodePluginStateRoot(runtimeHome), 'plugin.log');
  try {
    await mkdir(path.dirname(logFile), { recursive: true });
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
  if (existsSync(configPath)) {
    const content = await readFile(configPath, 'utf-8');
    const cleaned = content
      .split('\n')
      .filter((line) => !/^\s*notify\s*=/.test(line))
      .join('\n');
    if (cleaned !== content && !dryRun) {
      await writeFile(configPath, cleaned, 'utf-8');
      changed = true;
    }
  }

  return { runtime: 'codex', ok: true, changed, dryRun, mode: 'watch' };
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

async function teardownCodexSetup({ dryRun }) {
  let watchStopped = null;
  if (!dryRun) watchStopped = await stopCodexWatch();
  return { runtime: 'codex', ok: true, dryRun, watchStopped };
}

async function teardownOpenclawSetup({ homeRoot, openclawRuntimeHome, dryRun }) {
  if (!commandExists('openclaw')) {
    return { runtime: 'openclaw', ok: true, skipped: true, detail: 'openclaw command not found in PATH' };
  }
  const runtimeHome = openclawRuntimeHomeForSetup(homeRoot, openclawRuntimeHome);
  if (dryRun) return { runtime: 'openclaw', ok: true, changed: true, dryRun };
  const result = runSystemCommand('openclaw', ['plugins', 'uninstall', OPENCLAW_SPANORY_PLUGIN_ID], {
    env: { ...process.env, ...(runtimeHome ? { OPENCLAW_STATE_DIR: resolveRuntimeHome('openclaw', runtimeHome) } : {}) },
  });
  if (result.code !== 0) throw new Error(result.stderr || result.error || 'openclaw plugins uninstall failed');
  return { runtime: 'openclaw', ok: true, changed: true, dryRun };
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
    } catch { /* no config to clean */ }
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
    try { results.push(await teardownClaudeSetup({ homeRoot, dryRun })); }
    catch (error) { results.push({ runtime: 'claude-code', ok: false, error: String(error?.message ?? error) }); }
  }
  if (selected.includes('codex')) {
    try { results.push(await teardownCodexSetup({ dryRun })); }
    catch (error) { results.push({ runtime: 'codex', ok: false, error: String(error?.message ?? error) }); }
  }
  if (selected.includes('openclaw')) {
    try { results.push(await teardownOpenclawSetup({ homeRoot, openclawRuntimeHome: options.openclawRuntimeHome, dryRun })); }
    catch (error) { results.push({ runtime: 'openclaw', ok: false, error: String(error?.message ?? error) }); }
  }
  if (selected.includes('opencode')) {
    try { results.push(await teardownOpencodeSetup({ homeRoot, opencodeRuntimeHome: options.opencodeRuntimeHome, dryRun })); }
    catch (error) { results.push({ runtime: 'opencode', ok: false, error: String(error?.message ?? error) }); }
  }
  return { ok: results.every((r) => r.ok), results };
}

function commandExists(command) {
  const result = runSystemCommand('which', [command], { env: process.env });
  return result.code === 0;
}

function detectUpgradePackageManager(userAgent = process.env.npm_config_user_agent) {
  const token = String(userAgent ?? '').trim().split(/\s+/)[0] ?? '';
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

async function installOpenclawPlugin(runtimeHome, dryRun) {
  const pluginDir = path.resolve(resolveOpenclawPluginDir());
  const installResult = runSystemCommand('openclaw', ['plugins', 'install', '-l', pluginDir], {
    env: {
      ...process.env,
      OPENCLAW_STATE_DIR: runtimeHome,
    },
  });
  if (installResult.code !== 0) {
    throw new Error(installResult.stderr || installResult.error || 'openclaw plugins install failed');
  }
  const enableResult = runSystemCommand('openclaw', ['plugins', 'enable', OPENCLAW_SPANORY_PLUGIN_ID], {
    env: {
      ...process.env,
      OPENCLAW_STATE_DIR: runtimeHome,
    },
  });
  if (enableResult.code !== 0) {
    throw new Error(enableResult.stderr || enableResult.error || 'openclaw plugins enable failed');
  }
  const pathNormalizeResult = await normalizeOpenclawPluginLoadPaths(runtimeHome, pluginDir, dryRun);
  return {
    pluginDir,
    installStdout: installResult.stdout.trim(),
    enableStdout: enableResult.stdout.trim(),
    pathNormalizeResult,
  };
}

async function installOpencodePlugin(runtimeHome, pluginDirOverride) {
  const pluginDir = path.resolve(pluginDirOverride ?? resolveOpencodePluginDir());
  let pluginEntry;
  try {
    pluginEntry = await resolveOpencodePluginEntry(pluginDir);
  } catch {
    throw new Error(
      `opencode plugin entry not found at ${path.join(pluginDir, 'dist', 'index.js')}. `
      + 'build plugin first: npm run --workspace @bububuger/spanory-opencode-plugin build',
    );
  }

  const installDir = resolveOpencodePluginInstallDir(runtimeHome);
  const loaderFile = opencodePluginLoaderPath(runtimeHome);
  await mkdir(installDir, { recursive: true });

  const importUrl = pathToFileURL(pluginEntry).href;
  const loader = `import plugin from ${JSON.stringify(importUrl)};\n`
    + 'export const SpanoryOpencodePlugin = plugin;\n'
    + 'export default SpanoryOpencodePlugin;\n';
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
      await writeFile(opencodeConfigPath, JSON.stringify({ plugin: [OPENCODE_SPANORY_PLUGIN_ID] }, null, 2) + '\n', 'utf-8');
    }
  }

  return { loaderFile };
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

  report.runtimes.push({
    runtime: 'openclaw',
    available: commandExists('openclaw'),
    configured: undefined,
    details: {
      runtimeHome: openclawRuntimeHomeForSetup(homeRoot, options.openclawRuntimeHome),
    },
  });
  report.runtimes.push({
    runtime: 'opencode',
    available: commandExists('opencode'),
    configured: undefined,
    details: {
      runtimeHome: opencodeRuntimeHomeForSetup(homeRoot, options.opencodeRuntimeHome),
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
      ok: watchRunning,
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
      const result = await applyCodexWatchSetup({ homeRoot, dryRun });
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
        if (!dryRun) await installOpenclawPlugin(runtimeHome, dryRun);
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


const program = createProgram({
  cliVersion: CLI_VERSION,
  runtimeAdapters,
  codexWatchDefaultPollMs: CODEX_WATCH_DEFAULT_POLL_MS,
  codexWatchDefaultSettleMs: CODEX_WATCH_DEFAULT_SETTLE_MS,
  defaultSetupRuntimes: DEFAULT_SETUP_RUNTIMES,
  openclawPluginId: OPENCLAW_SPANORY_PLUGIN_ID,
  opencodePluginId: OPENCODE_SPANORY_PLUGIN_ID,

  getRuntimeAdapter,
  emitSession,
  resolveEndpoint,
  resolveHeaders,
  resolveRuntimeExportDir,
  runHookMode,
  listCandidateSessions,
  runContextExportMode,
  parseListenAddress,
  createCodexProxyServer,
  runSystemCommand,
  resolveRuntimeHome,
  resolveRuntimeStateRoot,
  resolveOpencodePluginStateRoot,
  resolveSpanoryEnvPath,
  resolveOpenclawPluginDir,
  resolveOpencodePluginDir,
  openclawRuntimeHomeForSetup,
  opencodeRuntimeHomeForSetup,
  commandExists,
  isCodexWatchRunning,
  codexWatchPidFile,
  backupIfExists,
  startCodexWatch,
  stopCodexWatch,
  sleep,
  maskEndpoint,
  detectUpgradePackageManager,
  detectUpgradeScope,
  resolveUpgradeInvocation,

  runCodexWatch: (options) => runCodexWatchModule(options, {
    resolveRuntimeHome,
    runContextExportMode,
    sleep,
  }),
  installOpenclawPlugin: (runtimeHome, dryRun, deps) => installOpenclawPluginModule(runtimeHome, dryRun, deps),
  runOpenclawPluginDoctor: (runtimeHome, deps) => runOpenclawPluginDoctorModule(
    runtimeHome,
    deps ?? {
      runSystemCommand,
      resolveRuntimeHome,
      resolveRuntimeStateRoot,
      maskEndpoint,
    },
  ),
  installOpencodePlugin: (runtimeHome, pluginDirOverride, deps) => {
    return installOpencodePluginModule(
      runtimeHome,
      pluginDirOverride,
      deps ?? {
        resolveRuntimeHome,
        resolveOpencodePluginDir,
      },
    );
  },
  uninstallOpencodePlugin: (runtimeHome, deps) => uninstallOpencodePluginModule(
    runtimeHome,
    deps ?? { resolveRuntimeHome },
  ),
  opencodePluginLoaderPath: (runtimeHome) => opencodePluginLoaderPathModule(runtimeHome, resolveRuntimeHome),
  runOpencodePluginDoctor: (runtimeHome, deps) => runOpencodePluginDoctorModule(
    runtimeHome,
    deps ?? {
      resolveRuntimeHome,
      resolveOpencodePluginStateRoot,
      maskEndpoint,
      resolveSpanoryEnvPath,
    },
  ),

  runSetupDetect: (options) => runSetupDetectModule(options, {
    commandExists,
    isCodexWatchRunning,
    openclawRuntimeHomeForSetup,
    opencodeRuntimeHomeForSetup,
  }),
  runSetupApply: (options) => runSetupApplyModule(options, {
    defaultSetupRuntimes: DEFAULT_SETUP_RUNTIMES,
    backupIfExists,
    startCodexWatch,
    commandExists,
    openclawRuntimeHomeForSetup,
    opencodeRuntimeHomeForSetup,
    installOpenclawPlugin: installOpenclawPluginModule,
    installOpencodePlugin: installOpencodePluginModule,
    runOpenclawPluginDoctor: runOpenclawPluginDoctorModule,
    runOpencodePluginDoctor: runOpencodePluginDoctorModule,
    resolveRuntimeHome,
    resolveRuntimeStateRoot,
    resolveOpencodePluginStateRoot,
    resolveSpanoryEnvPath,
    resolveOpenclawPluginDir,
    resolveOpencodePluginDir,
    runSystemCommand,
    maskEndpoint,
  }),
  runSetupDoctor: (options) => runSetupDoctorModule(options, {
    defaultSetupRuntimes: DEFAULT_SETUP_RUNTIMES,
    isCodexWatchRunning,
    codexWatchPidFile,
    commandExists,
    openclawRuntimeHomeForSetup,
    opencodeRuntimeHomeForSetup,
    runOpenclawPluginDoctor: runOpenclawPluginDoctorModule,
    runOpencodePluginDoctor: runOpencodePluginDoctorModule,
    runSystemCommand,
    resolveRuntimeHome,
    resolveRuntimeStateRoot,
    resolveOpencodePluginStateRoot,
    maskEndpoint,
    resolveSpanoryEnvPath,
  }),
  runSetupTeardown: (options) => runSetupTeardownModule(options, {
    defaultSetupRuntimes: DEFAULT_SETUP_RUNTIMES,
    backupIfExists,
    stopCodexWatch,
    commandExists,
    openclawRuntimeHomeForSetup,
    openclawPluginId: OPENCLAW_SPANORY_PLUGIN_ID,
    runSystemCommand,
    resolveRuntimeHome,
    opencodeRuntimeHomeForSetup,
    opencodePluginLoaderPath: opencodePluginLoaderPathModule,
    opencodePluginId: OPENCODE_SPANORY_PLUGIN_ID,
  }),

  loadExportedEvents,
  summarizeSessions,
  summarizeMcp,
  summarizeCommands,
  summarizeAgents,
  summarizeCache,
  summarizeTools,
  summarizeContext,
  summarizeTurnDiff,
  loadAlertRules,
  evaluateRules,
  sendAlertWebhook,
  parseHeaders,
  resolveTodoPath,
  resolveIssueStatePath,
  parsePendingTodoItems,
  loadIssueState,
  syncIssueState,
  saveIssueState,
  setIssueStatus,
});

const normalizeLegacyAlertEvalArgv = (argv) => {
  if (argv[2] === 'alert' && argv[3] === 'eval') {
    return [argv[0], argv[1], 'alert', ...argv.slice(4)];
  }
  return argv;
};

loadUserEnv()
  .then(() => program.parseAsync(normalizeLegacyAlertEvalArgv(process.argv)))
  .catch((error) => {
    console.error(`[spanory] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
