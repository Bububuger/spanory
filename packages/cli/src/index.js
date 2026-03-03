#!/usr/bin/env node
import { chmod, copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { Command } from 'commander';

import { claudeCodeAdapter } from './runtime/claude/adapter.js';
import { codexAdapter } from './runtime/codex/adapter.js';
import { createCodexProxyServer } from './runtime/codex/proxy.js';
import { openclawAdapter } from './runtime/openclaw/adapter.js';
import { compileOtlp, parseHeaders, sendOtlp } from './otlp.js';
import { loadUserEnv } from './env.js';
import { langfuseBackendAdapter } from '../../backend-langfuse/src/index.js';
import { evaluateRules, loadAlertRules, sendAlertWebhook } from './alert/evaluate.js';
import {
  summarizeCache,
  loadExportedEvents,
  summarizeAgents,
  summarizeCommands,
  summarizeMcp,
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
const EMPTY_OUTPUT_RETRY_WINDOW_MS = 1000;
const EMPTY_OUTPUT_RETRY_INTERVAL_MS = 120;

function getResource() {
  return {
    serviceName: 'spanory',
    serviceVersion: process.env.SPANORY_VERSION ?? '0.1.1',
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

async function readStdinText() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
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
    hash.update(String(event.category ?? ''));
    hash.update('\u001f');
    hash.update(String(event.name ?? ''));
    hash.update('\u001f');
    hash.update(String(event.startedAt ?? ''));
    hash.update('\u001f');
    hash.update(String(event.endedAt ?? ''));
    hash.update('\u001f');
    hash.update(String(event.input ?? ''));
    hash.update('\u001f');
    hash.update(String(event.output ?? ''));
    hash.update('\u001f');
    const attrs = event.attributes ?? {};
    const keys = Object.keys(attrs).sort();
    for (const key of keys) {
      hash.update(key);
      hash.update('=');
      hash.update(String(attrs[key] ?? ''));
      hash.update('\u001f');
    }
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
  for (const event of events) {
    if (!event?.turnId) continue;
    const turnOrdinal = parseTurnOrdinal(event.turnId);
    if (turnOrdinal === undefined) {
      if (!latestTurnId) latestTurnId = event.turnId;
      continue;
    }
    if (turnOrdinal > latestTurnOrdinal) {
      latestTurnOrdinal = turnOrdinal;
      latestTurnId = event.turnId;
    }
  }

  if (!latestTurnId) {
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
    console.log(`otlp=sent endpoint=${endpoint}`);
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
  const adapter = getRuntimeAdapter(runtimeName);
  const raw = await readStdinText();
  const hookPayload = parseHookPayload(raw);
  const context = adapter.resolveContextFromHook(hookPayload);
  if (!context) {
    throw new Error('cannot resolve runtime context from hook payload; require session_id (or thread_id)');
  }

  const contextWithRuntimeHome = {
    ...context,
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
      if (hookPayload.turnId) {
        selectedTurnId = hookPayload.turnId;
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
    const sessionsRoot = path.join(runtimeHome, 'sessions');
    const files = await listJsonlFilesRecursively(sessionsRoot);
    const withStat = await Promise.all(
      files.map(async (fullPath) => {
        const fileStat = await stat(fullPath);
        return {
          transcriptPath: fullPath,
          sessionId: sessionIdFromFilename(path.basename(fullPath)),
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
    return sorted.slice(0, Number(options.limit)).map(({ sessionId, transcriptPath }) => ({ sessionId, transcriptPath }));
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
  return path.resolve(process.cwd(), 'packages/openclaw-plugin');
}

function resolveOpencodePluginDir() {
  if (process.env.SPANORY_OPENCODE_PLUGIN_DIR) {
    return process.env.SPANORY_OPENCODE_PLUGIN_DIR;
  }
  return path.resolve(process.cwd(), 'packages/opencode-plugin');
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
      ? process.env.OTEL_EXPORTER_OTLP_ENDPOINT
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

  const ok = checks.every((item) => item.ok);
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

  checks.push({
    id: 'otlp_endpoint',
    ok: Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT),
    detail: process.env.OTEL_EXPORTER_OTLP_ENDPOINT
      ? process.env.OTEL_EXPORTER_OTLP_ENDPOINT
      : 'OTEL_EXPORTER_OTLP_ENDPOINT is unset',
  });

  const spoolDir = process.env.SPANORY_OPENCODE_SPOOL_DIR
    ?? path.join(resolveRuntimeStateRoot('opencode', runtimeHome), 'spanory', 'spool');
  try {
    await mkdir(spoolDir, { recursive: true });
    checks.push({ id: 'spool_writable', ok: true, detail: spoolDir });
  } catch (err) {
    checks.push({ id: 'spool_writable', ok: false, detail: String(err) });
  }

  const statusFile = path.join(resolveRuntimeStateRoot('opencode', runtimeHome), 'spanory', 'plugin-status.json');
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

  const ok = checks.every((item) => item.ok);
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

function upsertCodexNotifyConfig(configText, notifyScriptRef) {
  const notifyLine = `notify = ["${escapeTomlBasicString(notifyScriptRef)}"]`;
  if (/^notify\s*=.*$/m.test(configText)) {
    return configText.replace(/^notify\s*=.*$/m, notifyLine);
  }
  const withNewline = configText.trimEnd();
  if (!withNewline) return `${notifyLine}\n`;
  return `${withNewline}\n\n${notifyLine}\n`;
}

function escapeTomlBasicString(value) {
  return String(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"');
}

function codexNotifyScriptContent({ spanoryBin, codexHome, exportDir, logFile }) {
  return '#!/usr/bin/env bash\n'
    + 'set -euo pipefail\n'
    + 'payload="${1:-}"\n'
    + 'if [[ -z "$payload" ]] && [[ ! -t 0 ]]; then\n'
    + '  payload="$(cat || true)"\n'
    + 'fi\n'
    + 'if [[ -z "${payload//[$\'\\t\\r\\n \']/}" ]]; then\n'
    + `  echo "skip=empty-payload source=codex-notify args=$#" >> "${logFile}"\n`
    + '  exit 0\n'
    + 'fi\n'
    + `echo "$payload" | "${spanoryBin}" runtime codex hook \\\n`
    + '  --last-turn-only \\\n'
    + `  --runtime-home "${codexHome}" \\\n`
    + `  --export-json-dir "${exportDir}" \\\n`
    + `  >> "${logFile}" 2>&1 || true\n`;
}

async function applyCodexSetup({ homeRoot, spanoryBin, dryRun }) {
  const codexHome = path.join(homeRoot, '.codex');
  const binDir = path.join(codexHome, 'bin');
  const stateDir = path.join(codexHome, 'state', 'spanory');
  const scriptPath = path.join(binDir, 'spanory-codex-notify.sh');
  const logFile = path.join(codexHome, 'state', 'spanory-codex-hook.log');
  const configPath = path.join(codexHome, 'config.toml');
  const notifyScriptRef = scriptPath;

  const scriptContent = codexNotifyScriptContent({
    spanoryBin,
    codexHome,
    exportDir: stateDir,
    logFile,
  });

  let currentConfig = '';
  try {
    currentConfig = await readFile(configPath, 'utf-8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const nextConfig = upsertCodexNotifyConfig(currentConfig, notifyScriptRef);
  const configChanged = currentConfig !== nextConfig;

  let currentScript = '';
  try {
    currentScript = await readFile(scriptPath, 'utf-8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const scriptChanged = currentScript !== scriptContent;
  const changed = configChanged || scriptChanged;

  let configBackup = null;
  if (changed && !dryRun) {
    await mkdir(binDir, { recursive: true });
    await mkdir(stateDir, { recursive: true });

    if (configChanged) {
      configBackup = await backupIfExists(configPath);
      await writeFile(configPath, nextConfig, 'utf-8');
    }
    if (scriptChanged) {
      await writeFile(scriptPath, scriptContent, 'utf-8');
      await chmod(scriptPath, 0o755);
    }
  }

  return {
    runtime: 'codex',
    ok: true,
    changed,
    dryRun,
    configPath,
    scriptPath,
    configBackup,
  };
}

function commandExists(command) {
  const result = runSystemCommand('which', [command], { env: process.env });
  return result.code === 0;
}

function openclawRuntimeHomeForSetup(homeRoot, explicitRuntimeHome) {
  return explicitRuntimeHome || path.join(homeRoot, '.openclaw');
}

function opencodeRuntimeHomeForSetup(homeRoot, explicitRuntimeHome) {
  return explicitRuntimeHome || path.join(homeRoot, '.config', 'opencode');
}

function installOpenclawPlugin(runtimeHome) {
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
  return {
    installStdout: installResult.stdout.trim(),
    enableStdout: enableResult.stdout.trim(),
  };
}

async function installOpencodePlugin(runtimeHome) {
  const pluginDir = path.resolve(resolveOpencodePluginDir());
  const pluginEntry = path.join(pluginDir, 'src', 'index.js');
  await stat(pluginEntry);

  const installDir = resolveOpencodePluginInstallDir(runtimeHome);
  const loaderFile = opencodePluginLoaderPath(runtimeHome);
  await mkdir(installDir, { recursive: true });

  const importUrl = pathToFileURL(pluginEntry).href;
  const loader = `import plugin from ${JSON.stringify(importUrl)};\n`
    + 'export const SpanoryOpencodePlugin = plugin;\n'
    + 'export default SpanoryOpencodePlugin;\n';
  await writeFile(loaderFile, loader, 'utf-8');
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

  const codexConfigPath = path.join(homeRoot, '.codex', 'config.toml');
  const codexScriptPath = path.join(homeRoot, '.codex', 'bin', 'spanory-codex-notify.sh');
  let codexNotifyConfigured = false;
  try {
    const config = await readFile(codexConfigPath, 'utf-8');
    codexNotifyConfigured = /notify\s*=\s*\[[^\]]*spanory-codex-notify\.sh[^\]]*\]/m.test(config);
  } catch {
    // keep false
  }
  let codexScriptPresent = true;
  try {
    await stat(codexScriptPath);
  } catch {
    codexScriptPresent = false;
  }
  report.runtimes.push({
    runtime: 'codex',
    available: commandExists('codex'),
    configured: codexNotifyConfigured && codexScriptPresent,
    details: {
      configPath: codexConfigPath,
      scriptPath: codexScriptPath,
      notifyConfigured: codexNotifyConfigured,
      scriptPresent: codexScriptPresent,
    },
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
    const configPath = path.join(homeRoot, '.codex', 'config.toml');
    const scriptPath = path.join(homeRoot, '.codex', 'bin', 'spanory-codex-notify.sh');
    let notifyConfigured = false;
    try {
      const config = await readFile(configPath, 'utf-8');
      notifyConfigured = /notify\s*=\s*\[[^\]]*spanory-codex-notify\.sh[^\]]*\]/m.test(config);
    } catch {
      // keep default false
    }
    let scriptPresent = false;
    try {
      await stat(scriptPath);
      scriptPresent = true;
    } catch {
      // keep default false
    }
    checks.push({
      id: 'codex_notify_configured',
      runtime: 'codex',
      ok: notifyConfigured,
      detail: configPath,
    });
    checks.push({
      id: 'codex_notify_script',
      runtime: 'codex',
      ok: scriptPresent,
      detail: scriptPath,
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
  const codexMode = options.codexMode ?? 'notify';
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
    if (codexMode !== 'notify') {
      results.push({
        runtime: 'codex',
        ok: true,
        skipped: true,
        detail: `codex mode "${codexMode}" skips notify setup`,
      });
    } else {
      try {
        const result = await applyCodexSetup({ homeRoot, spanoryBin, dryRun });
        results.push(result);
      } catch (error) {
        results.push({
          runtime: 'codex',
          ok: false,
          error: String(error?.message ?? error),
        });
      }
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
        if (!dryRun) installOpenclawPlugin(runtimeHome);
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
    const exportCmd = runtimeCmd
      .command('export')
      .description(`Export one ${displayName} session as OTLP spans`);

    if (runtimeName !== 'codex') {
      exportCmd.requiredOption('--project-id <id>', `${displayName} project id (folder under runtime projects root)`);
    } else {
      exportCmd.option('--project-id <id>', 'Project id override (optional; defaults to cwd-derived id)');
    }

    exportCmd
      .requiredOption('--session-id <id>', `${displayName} session id (jsonl filename without extension)`)
      .option('--transcript-path <path>', 'Override transcript path instead of <runtime-home>/projects/<project>/<session>.jsonl')
      .option('--runtime-home <path>', 'Override runtime home directory')
      .option('--endpoint <url>', 'OTLP HTTP endpoint (fallback: OTEL_EXPORTER_OTLP_ENDPOINT)')
      .option('--headers <kv>', 'OTLP HTTP headers, comma-separated k=v (fallback: OTEL_EXPORTER_OTLP_HEADERS)')
      .option('--export-json <path>', 'Write parsed events and OTLP payload to a local JSON file')
      .addHelpText(
        'after',
        '\nExamples:\n'
          + `  spanory runtime ${runtimeName} export --project-id my-project --session-id 1234\n`
          + `  spanory runtime ${runtimeName} export --project-id my-project --session-id 1234 --endpoint http://localhost:3000/api/public/otel/v1/traces\n`,
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
      .option('--last-turn-only', 'Export only the newest turn and dedupe by turn fingerprint', false)
      .option('--force', 'Force export even if session payload fingerprint is unchanged', false)
      .addHelpText(
        'after',
        '\nExamples:\n'
          + `  echo "{...}" | spanory runtime ${runtimeName} hook\n`
          + `  cat payload.json | spanory runtime ${runtimeName} hook --export-json-dir ${resolveRuntimeExportDir(runtimeName)}\n`,
      )
      .action(async (options) => runHookMode({
        runtimeName,
        runtimeHome: options.runtimeHome,
        endpoint: options.endpoint,
        headers: options.headers,
        lastTurnOnly: options.lastTurnOnly,
        force: options.force,
        exportJsonDir: options.exportJsonDir,
      }));

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
        '\nExamples:\n'
          + `  spanory runtime ${runtimeName} backfill --project-id my-project --since 2026-02-27T00:00:00Z --limit 20\n`
          + `  spanory runtime ${runtimeName} backfill --project-id my-project --session-ids a,b,c --dry-run\n`,
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
  }

  if (runtimeName === 'codex') {
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
          spoolDir: options.spoolDir
            ?? process.env.SPANORY_CODEX_PROXY_SPOOL_DIR
            ?? path.join(resolveRuntimeStateRoot('codex'), 'spanory', 'proxy-spool'),
          maxBodyBytes: Number(options.maxBodyBytes),
          logger: console,
        });
        await proxy.start({ host, port });
        console.log(`proxy=listening url=${proxy.url()} upstream=${options.upstream ?? process.env.SPANORY_CODEX_PROXY_UPSTREAM ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com'}`);
        await new Promise((resolve) => {
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
    const plugin = runtimeCmd
      .command('plugin')
      .description('Manage Spanory OpenClaw plugin runtime integration');

    plugin
      .command('install')
      .description('Install Spanory OpenClaw plugin using openclaw plugins install -l')
      .option('--plugin-dir <path>', 'Plugin directory path (default: packages/openclaw-plugin)')
      .option('--runtime-home <path>', 'Override runtime home directory')
      .action((options) => {
        const pluginDir = path.resolve(options.pluginDir ?? resolveOpenclawPluginDir());
        const result = runSystemCommand('openclaw', ['plugins', 'install', '-l', pluginDir], {
          env: {
            ...process.env,
            ...(options.runtimeHome ? { OPENCLAW_STATE_DIR: resolveRuntimeHome('openclaw', options.runtimeHome) } : {}),
          },
        });
        if (result.stdout.trim()) console.log(result.stdout.trim());
        if (result.code !== 0) {
          throw new Error(result.stderr || result.error || 'openclaw plugins install failed');
        }
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
      .description('Uninstall Spanory OpenClaw plugin')
      .option('--runtime-home <path>', 'Override runtime home directory')
      .action((options) => {
        const result = runSystemCommand('openclaw', ['plugins', 'uninstall', OPENCLAW_SPANORY_PLUGIN_ID], {
          env: {
            ...process.env,
            ...(options.runtimeHome ? { OPENCLAW_STATE_DIR: resolveRuntimeHome('openclaw', options.runtimeHome) } : {}),
          },
        });
        if (result.stdout.trim()) console.log(result.stdout.trim());
        if (result.code !== 0) {
          throw new Error(result.stderr || result.error || 'openclaw plugins uninstall failed');
        }
      });

    plugin
      .command('doctor')
      .description('Run local diagnostic checks for Spanory OpenClaw plugin')
      .option('--runtime-home <path>', 'Override runtime home directory')
      .action(async (options) => {
        const report = await runOpenclawPluginDoctor(options.runtimeHome);
        console.log(JSON.stringify(report, null, 2));
        if (!report.ok) process.exitCode = 2;
      });
  }

  if (runtimeName === 'opencode') {
    const plugin = runtimeCmd
      .command('plugin')
      .description('Manage Spanory OpenCode plugin runtime integration');

    plugin
      .command('install')
      .description('Install Spanory OpenCode plugin loader into ~/.config/opencode/plugin')
      .option('--plugin-dir <path>', 'Plugin directory path (default: packages/opencode-plugin)')
      .option('--runtime-home <path>', 'Override OpenCode runtime home (default: ~/.config/opencode)')
      .action(async (options) => {
        const pluginDir = path.resolve(options.pluginDir ?? resolveOpencodePluginDir());
        const pluginEntry = path.join(pluginDir, 'src', 'index.js');
        await stat(pluginEntry);

        const installDir = resolveOpencodePluginInstallDir(options.runtimeHome);
        const loaderFile = opencodePluginLoaderPath(options.runtimeHome);
        await mkdir(installDir, { recursive: true });

        const importUrl = pathToFileURL(pluginEntry).href;
        const loader = `import plugin from ${JSON.stringify(importUrl)};\n`
          + 'export const SpanoryOpencodePlugin = plugin;\n'
          + 'export default SpanoryOpencodePlugin;\n';
        await writeFile(loaderFile, loader, 'utf-8');
        console.log(`installed=${loaderFile}`);
      });

    plugin
      .command('uninstall')
      .description('Remove Spanory OpenCode plugin loader')
      .option('--runtime-home <path>', 'Override OpenCode runtime home (default: ~/.config/opencode)')
      .action(async (options) => {
        const loaderFile = opencodePluginLoaderPath(options.runtimeHome);
        await rm(loaderFile, { force: true });
        console.log(`removed=${loaderFile}`);
      });

    plugin
      .command('doctor')
      .description('Run local diagnostic checks for Spanory OpenCode plugin')
      .option('--runtime-home <path>', 'Override OpenCode runtime home (default: ~/.config/opencode)')
      .action(async (options) => {
        const report = await runOpencodePluginDoctor(options.runtimeHome);
        console.log(JSON.stringify(report, null, 2));
        if (!report.ok) process.exitCode = 2;
      });
  }
}

const program = new Command();
program
  .name('spanory')
  .description('Cross-runtime observability CLI for agent sessions')
  .showHelpAfterError()
  .showSuggestionAfterError(true)
  .version('0.1.1');

const runtime = program.command('runtime').description('Runtime-specific parsers and exporters');
for (const runtimeName of ['claude-code', 'codex', 'openclaw', 'opencode']) {
  registerRuntimeCommands(runtime, runtimeName);
}

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

report
  .command('cache')
  .description('Cache usage summary per session')
  .requiredOption('--input-json <path>', 'Path to exported JSON file or directory of JSON files')
  .action(async (options) => {
    const sessions = await loadExportedEvents(options.inputJson);
    console.log(JSON.stringify({ view: 'cache-summary', rows: summarizeCache(sessions) }, null, 2));
  });

report
  .command('tool')
  .description('Tool usage aggregation view')
  .requiredOption('--input-json <path>', 'Path to exported JSON file or directory of JSON files')
  .action(async (options) => {
    const sessions = await loadExportedEvents(options.inputJson);
    console.log(JSON.stringify({ view: 'tool-summary', rows: summarizeTools(sessions) }, null, 2));
  });

report
  .command('turn-diff')
  .description('Turn input diff summary view')
  .requiredOption('--input-json <path>', 'Path to exported JSON file or directory of JSON files')
  .action(async (options) => {
    const sessions = await loadExportedEvents(options.inputJson);
    console.log(JSON.stringify({ view: 'turn-diff-summary', rows: summarizeTurnDiff(sessions) }, null, 2));
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
  .description('Minimal hook entrypoint (defaults to runtime payload + ~/.env + default export dir)')
  .option('--runtime <name>', 'Runtime name (default: SPANORY_HOOK_RUNTIME or claude-code)')
  .option('--runtime-home <path>', 'Override runtime home directory')
  .option('--endpoint <url>', 'OTLP HTTP endpoint (fallback: OTEL_EXPORTER_OTLP_ENDPOINT)')
  .option('--headers <kv>', 'OTLP HTTP headers, comma-separated k=v (fallback: OTEL_EXPORTER_OTLP_HEADERS)')
  .option('--export-json-dir <dir>', 'Write <sessionId>.json into this directory')
  .option('--last-turn-only', 'Export only the newest turn and dedupe by turn fingerprint', false)
  .option('--force', 'Force export even if session payload fingerprint is unchanged', false)
  .addHelpText(
    'after',
    '\nMinimal usage in SessionEnd hook command:\n'
      + '  spanory hook\n'
      + '  spanory hook --runtime openclaw\n',
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
        options.exportJsonDir
        ?? process.env.SPANORY_HOOK_EXPORT_JSON_DIR
        ?? resolveRuntimeExportDir(runtimeName, options.runtimeHome),
    });
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
  .option('--codex-mode <mode>', 'Codex setup mode: notify | proxy (default: notify)', 'notify')
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

loadUserEnv()
  .then(() => program.parseAsync(process.argv))
  .catch((error) => {
    console.error(`[spanory] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
