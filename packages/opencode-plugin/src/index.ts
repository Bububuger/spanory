// @ts-nocheck
import { appendFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

import { langfuseBackendAdapter } from '../../backend-langfuse/dist/index.js';
import { buildResource, compileOtlpSpans, parseOtlpHeaders, sendOtlpHttp as sendOtlpHttpDefault } from '../../otlp-core/dist/index.js';
import { loadUserEnv } from '../../cli/dist/env.js';
import { normalizeTranscriptMessages, pickUsage } from '../../cli/dist/runtime/shared/normalize.js';

const PLUGIN_ID = 'spanory-opencode-plugin';
const DEFAULT_FLUSH_MODE = 'turn';
const SESSION_FLUSH_EVENTS = new Set([
  'session.idle',
  'session.deleted',
  'session.completed',
  'session.complete',
  'session.ended',
  'session.end',
  'session.closed',
  'session.close',
]);
const TURN_FLUSH_EVENTS = new Set([
  'turn.completed',
  'turn.complete',
  'turn.ended',
  'turn.end',
  'message.completed',
  'message.complete',
  'response.completed',
  'response.complete',
  'assistant.completed',
  'assistant.complete',
]);

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function nowIso() {
  return new Date().toISOString();
}

function resolveOpencodeHome() {
  return process.env.SPANORY_OPENCODE_HOME ?? path.join(os.homedir(), '.config', 'opencode');
}

function resolveSpanoryHome() {
  return process.env.SPANORY_HOME ?? path.join(os.homedir(), '.spanory');
}

function resolveSpanoryEnvPath() {
  return path.join(resolveSpanoryHome(), '.env');
}

function pluginStateRoot() {
  if (process.env.SPANORY_OPENCODE_STATE_DIR) return process.env.SPANORY_OPENCODE_STATE_DIR;
  if (process.env.SPANORY_OPENCODE_HOME) return path.join(resolveOpencodeHome(), 'state', 'spanory');
  return path.join(resolveSpanoryHome(), 'opencode');
}

function spoolRoot() {
  return process.env.SPANORY_OPENCODE_SPOOL_DIR ?? path.join(pluginStateRoot(), 'spool');
}

function statusFilePath() {
  return path.join(pluginStateRoot(), 'plugin-status.json');
}

function pluginLogFilePath() {
  return path.join(pluginStateRoot(), 'plugin.log');
}

function userEnvPath() {
  return resolveSpanoryEnvPath();
}

function sanitizeLogValue(value) {
  return String(value)
    .replace(/(authorization\s*[:=]\s*)(basic|bearer)\s+[^\s"']+/ig, '$1[REDACTED]')
    .replace(/\b(sk|pk)_[a-z0-9_-]{8,}\b/ig, '[REDACTED]')
    .replace(/\s+/g, ' ')
    .replace(/[^ -~]/g, '')
    .slice(0, 320);
}

async function appendPluginLog(level, event, fields = {}) {
  try {
    const file = pluginLogFilePath();
    const pairs = Object.entries(fields)
      .filter(([, value]) => value !== undefined && value !== null && String(value).length > 0)
      .map(([key, value]) => `${key}=${JSON.stringify(sanitizeLogValue(value))}`)
      .join(' ');
    const line = `${nowIso()} level=${level} event=${event}${pairs ? ` ${pairs}` : ''}\n`;
    await mkdir(path.dirname(file), { recursive: true });
    await appendFile(file, line, 'utf-8');
  } catch {
    // never fail plugin main path because of diagnostics logging
  }
}

async function writeStatus(status) {
  const file = statusFilePath();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(status, null, 2), 'utf-8');
}

async function enqueueSpool(item) {
  const root = spoolRoot();
  await mkdir(root, { recursive: true });
  const file = path.join(root, `${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  await writeFile(file, JSON.stringify(item), 'utf-8');
  await appendPluginLog('warn', 'spool_enqueue', {
    sessionId: item.sessionId,
    reason: item.error ?? 'send failed',
    spoolFile: file,
  });
  await writeStatus({
    pluginId: PLUGIN_ID,
    lastFailureAt: nowIso(),
    lastSessionId: item.sessionId,
    message: item.error ?? 'send failed',
    spoolFile: file,
    logFile: pluginLogFilePath(),
  });
}

async function readSpoolItems() {
  const root = spoolRoot();
  await mkdir(root, { recursive: true });
  const names = (await readdir(root)).filter((name) => name.endsWith('.json')).sort();
  const out = [];
  for (const name of names) {
    const file = path.join(root, name);
    try {
      out.push({ file, payload: JSON.parse(await readFile(file, 'utf-8')) });
    } catch {
      await rm(file, { force: true });
    }
  }
  return out;
}

function retryMax() {
  const v = Number(process.env.SPANORY_OPENCODE_RETRY_MAX ?? 6);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 6;
}

function retryDelayMs(attempt) {
  return Math.min(2000, 200 * (2 ** attempt));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseTimestamp(msLike) {
  const n = Number(msLike);
  if (Number.isFinite(n) && n > 0) return new Date(n);
  return new Date();
}

function partTime(part, fallbackMs) {
  const partEnd = part?.time?.end;
  const partStart = part?.time?.start;
  const stateEnd = part?.state?.time?.end;
  const stateStart = part?.state?.time?.start;
  return parseTimestamp(partEnd ?? partStart ?? stateEnd ?? stateStart ?? fallbackMs);
}

function normalizeToolName(name) {
  const n = String(name ?? '');
  const lower = n.toLowerCase();
  if (lower === 'bash' || lower === 'exec') return 'Bash';
  return n || 'tool';
}

function parseUsageFromAssistantInfo(info) {
  const tokens = info?.tokens;
  if (!tokens || typeof tokens !== 'object') return undefined;
  return pickUsage({
    input_tokens: toNumber(tokens.input),
    output_tokens: toNumber(tokens.output),
    cache_read_input_tokens: toNumber(tokens?.cache?.read),
    cache_creation_input_tokens: toNumber(tokens?.cache?.write),
  });
}

function normalizePartText(part) {
  if (!part || typeof part !== 'object') return '';
  if (part.type === 'text') return String(part.text ?? '');
  return '';
}

function extractToolResult(part) {
  const state = part?.state;
  if (!state || typeof state !== 'object') return null;
  if (state.status === 'completed') return String(state.output ?? '');
  if (state.status === 'error') return String(state.error ?? '');
  return null;
}

function partTimestamp(part, fallbackMs) {
  const end = part?.state?.time?.end;
  const start = part?.state?.time?.start;
  return parseTimestamp(end ?? start ?? fallbackMs);
}

function normalizeMessages({ sessionInfo, sessionMessages }) {
  const runtimeVersion = sessionInfo?.version;
  const normalized = [];

  for (const message of sessionMessages) {
    const info = message?.info ?? {};
    const parts = Array.isArray(message?.parts) ? message.parts : [];
    const baseTimeMs = info?.time?.created;
    const role = info?.role === 'assistant' ? 'assistant' : 'user';

    if (role === 'user') {
      const text = parts.map(normalizePartText).filter(Boolean).join('\n');
      normalized.push({
        role: 'user',
        isMeta: false,
        content: text,
        runtimeVersion,
        messageId: info?.id,
        timestamp: parseTimestamp(baseTimeMs),
      });
      continue;
    }

    const content = [];
    for (const part of parts) {
      if (part?.type === 'text') {
        content.push({ type: 'text', text: String(part.text ?? '') });
        continue;
      }
      if (part?.type === 'reasoning') {
        content.push({
          type: 'reasoning',
          text: String(part.text ?? ''),
          timestamp: partTime(part, baseTimeMs),
        });
        continue;
      }
      if (part?.type === 'tool') {
        content.push({
          type: 'tool_use',
          id: String(part.callID ?? part.id ?? ''),
          name: normalizeToolName(part.tool),
          input: part?.state?.input ?? {},
        });
      }
    }

    normalized.push({
      role: 'assistant',
      isMeta: false,
      content,
      model: info?.modelID ? `${info.providerID ?? 'opencode'}/${info.modelID}` : undefined,
      usage: parseUsageFromAssistantInfo(info),
      runtimeVersion,
      messageId: info?.id,
      timestamp: parseTimestamp(info?.time?.completed ?? baseTimeMs),
    });

    for (const part of parts) {
      if (part?.type !== 'tool') continue;
      const toolUseId = String(part.callID ?? part.id ?? '');
      if (!toolUseId) continue;
      const toolOutput = extractToolResult(part);
      if (toolOutput == null) continue;

      normalized.push({
        role: 'user',
        isMeta: false,
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolUseId,
            content: toolOutput,
          },
        ],
        runtimeVersion,
        messageId: `${info?.id ?? 'assistant'}:${toolUseId}:result`,
        sourceToolUseId: toolUseId,
        toolUseResult: {
          stdout: part?.state?.status === 'completed' ? toolOutput : '',
          stderr: part?.state?.status === 'error' ? toolOutput : '',
        },
        timestamp: partTimestamp(part, baseTimeMs),
      });
    }
  }

  normalized.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  return normalized;
}

function otlpEndpoint() {
  return process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
}

function otlpHeaders() {
  return parseOtlpHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS) ?? {};
}

function hashEvents(events) {
  const hash = createHash('sha256');
  hash.update(JSON.stringify(events));
  return hash.digest('hex');
}

function unwrapData(response) {
  if (response && typeof response === 'object' && 'data' in response) return response.data;
  return response;
}

function resolveFlushMode() {
  const raw = String(process.env.SPANORY_OPENCODE_FLUSH_MODE ?? DEFAULT_FLUSH_MODE).trim().toLowerCase();
  if (raw === 'session' || raw === 'turn') return raw;
  return DEFAULT_FLUSH_MODE;
}

function extractSessionId(event) {
  return event?.properties?.sessionID
    ?? event?.properties?.sessionId
    ?? event?.sessionID
    ?? event?.sessionId
    ?? undefined;
}

function normalizeEventType(type) {
  return String(type ?? '').trim().toLowerCase();
}

function looksLikeTurnDoneEvent(type) {
  return /(?:^|\.)(turn|message|response|assistant)(?:\.|_)?(completed|complete|done|ended|end|finished|finish|stopped|stop)$/.test(type);
}

function shouldFlushForEvent(type, flushMode) {
  if (!type) return false;
  if (SESSION_FLUSH_EVENTS.has(type)) return true;
  if (flushMode === 'session') return false;
  if (TURN_FLUSH_EVENTS.has(type)) return true;
  return looksLikeTurnDoneEvent(type);
}

export function createOpencodeSpanoryPluginRuntime(options) {
  const logger = options?.logger;
  const client = options?.client;
  const sendOtlpHttp = options?.sendOtlpHttp ?? sendOtlpHttpDefault;
  const autoLoadUserEnv = options?.autoLoadUserEnv === true;
  const userEnvLoader = options?.userEnvLoader ?? loadUserEnv;
  const flushMode = resolveFlushMode();
  const fingerprints = new Map();
  const observedSessionIds = new Set();
  let envLoadPromise;

  if (!client?.session?.get || !client?.session?.messages) {
    throw new Error('opencode plugin runtime requires client.session.get and client.session.messages');
  }

  async function ensureUserEnvLoaded() {
    if (!autoLoadUserEnv) return;
    if (!envLoadPromise) {
      envLoadPromise = (async () => {
        try {
          const beforeEndpoint = Boolean(otlpEndpoint());
          const beforeHeaders = Boolean(process.env.OTEL_EXPORTER_OTLP_HEADERS);
          await userEnvLoader();
          const afterEndpoint = Boolean(otlpEndpoint());
          const afterHeaders = Boolean(process.env.OTEL_EXPORTER_OTLP_HEADERS);
          await appendPluginLog('info', 'env_loaded', {
            envPath: userEnvPath(),
            endpointBefore: beforeEndpoint,
            endpointAfter: afterEndpoint,
            headersBefore: beforeHeaders,
            headersAfter: afterHeaders,
          });
        } catch (err) {
          await appendPluginLog('warn', 'env_load_failed', {
            envPath: userEnvPath(),
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })();
    }
    await envLoadPromise;
  }

  async function sendWithRetry(payload, meta = {}) {
    await ensureUserEnvLoaded();
    const endpoint = otlpEndpoint();
    if (!endpoint) {
      await appendPluginLog('warn', 'otlp_skip_endpoint_unset', {
        source: meta.source ?? 'live',
        sessionId: meta.sessionId,
        trigger: meta.triggerType,
      });
      return { skipped: true };
    }

    const headers = otlpHeaders();
    let lastErr;
    for (let i = 0; i < retryMax(); i += 1) {
      try {
        await sendOtlpHttp(endpoint, payload, headers);
        await appendPluginLog('info', 'otlp_sent', {
          source: meta.source ?? 'live',
          sessionId: meta.sessionId,
          trigger: meta.triggerType,
        });
        return { skipped: false };
      } catch (err) {
        lastErr = err;
        await delay(retryDelayMs(i));
      }
    }
    await appendPluginLog('error', 'otlp_send_failed', {
      source: meta.source ?? 'live',
      sessionId: meta.sessionId,
      trigger: meta.triggerType,
      error: lastErr instanceof Error ? lastErr.message : String(lastErr),
    });
    throw lastErr ?? new Error('send failed');
  }

  async function flushSpool() {
    const items = await readSpoolItems();
    for (const item of items) {
      const result = await sendWithRetry(item.payload.payload, {
        source: 'spool',
        sessionId: item.payload?.sessionId,
      });
      if (result.skipped) break;
      await rm(item.file, { force: true });
      await appendPluginLog('info', 'spool_flush_success', {
        sessionId: item.payload?.sessionId,
        spoolFile: item.file,
      });
    }
  }

  let pipeline = Promise.resolve();

  function submit(events, sessionId, fingerprint, triggerType) {
    pipeline = pipeline.then(async () => {
      const mapped = langfuseBackendAdapter.mapEvents(events);
      const payload = compileOtlpSpans(mapped, buildResource());

      try {
        const result = await sendWithRetry(payload, {
          source: 'live',
          sessionId,
          triggerType,
        });
        if (!result.skipped) {
          await flushSpool();
        }
        await writeStatus({
          pluginId: PLUGIN_ID,
          lastSessionId: sessionId,
          lastFingerprint: fingerprint,
          lastTriggerEvent: triggerType,
          lastSuccessAt: nowIso(),
          events: events.length,
          ...(result.skipped ? { lastSkippedAt: nowIso(), reason: 'otlp_endpoint_unset' } : {}),
          endpointConfigured: !result.skipped,
          flushMode,
          logFile: pluginLogFilePath(),
        });
      } catch (err) {
        await enqueueSpool({
          payload,
          sessionId,
          fingerprint,
          createdAt: nowIso(),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }).catch((err) => {
      appendPluginLog('error', 'pipeline_error', {
        error: err instanceof Error ? err.message : String(err),
      }).catch(() => {});
      logger?.warn?.(`[${PLUGIN_ID}] pipeline error: ${String(err)}`);
    });
  }

  async function collectCanonicalEvents(sessionId) {
    const sessionInfo = unwrapData(await client.session.get({ path: { id: sessionId } }));
    const sessionMessages = unwrapData(await client.session.messages({ path: { id: sessionId } }));
    const normalizedMessages = normalizeMessages({
      sessionInfo,
      sessionMessages: Array.isArray(sessionMessages) ? sessionMessages : [],
    });

    const projectId = sessionInfo?.projectID ?? sessionInfo?.projectId ?? 'opencode';
    return normalizeTranscriptMessages({
      runtime: 'opencode',
      projectId,
      sessionId,
      messages: normalizedMessages,
    });
  }

  async function flushSession(sessionId, triggerType) {
    if (!sessionId) return;
    const events = await collectCanonicalEvents(sessionId);
    if (!events.length) return;

    const fingerprint = hashEvents(events);
    if (fingerprints.get(sessionId) === fingerprint) {
      await appendPluginLog('info', 'flush_skip_fingerprint_unchanged', {
        sessionId,
        trigger: triggerType,
      });
      await writeStatus({
        pluginId: PLUGIN_ID,
        lastSessionId: sessionId,
        lastFingerprint: fingerprint,
        lastTriggerEvent: triggerType,
        lastSkippedAt: nowIso(),
        reason: 'fingerprint_unchanged',
        flushMode,
        logFile: pluginLogFilePath(),
      });
      return;
    }

    fingerprints.set(sessionId, fingerprint);
    submit(events, sessionId, fingerprint, triggerType);
  }

  async function onEvent(event) {
    const type = normalizeEventType(event?.type);
    const sessionId = extractSessionId(event);
    if (sessionId) observedSessionIds.add(sessionId);

    if (shouldFlushForEvent(type, flushMode)) {
      await appendPluginLog('info', 'flush_triggered', {
        type,
        sessionId,
        flushMode,
      });
      await flushSession(sessionId, type);
    }
  }

  async function onGatewayStop() {
    for (const sessionId of observedSessionIds) {
      if (fingerprints.has(sessionId)) continue;
      try {
        await flushSession(sessionId, 'gateway.stop');
      } catch (err) {
        await appendPluginLog('warn', 'gateway_stop_flush_error', {
          sessionId,
          error: err instanceof Error ? err.message : String(err),
        });
        logger?.warn?.(`[${PLUGIN_ID}] gateway-stop flush session error: ${String(err)}`);
      }
    }

    await pipeline;
    try {
      await flushSpool();
    } catch (err) {
      await appendPluginLog('warn', 'spool_flush_error', {
        error: err instanceof Error ? err.message : String(err),
      });
      logger?.warn?.(`[${PLUGIN_ID}] flush error: ${String(err)}`);
    }
  }

  return {
    onEvent,
    onGatewayStop,
  };
}

export default async function register(api) {
  const runtime = createOpencodeSpanoryPluginRuntime({
    client: api.client,
    logger: { warn: (...args) => api.$?.logger?.error?.(...args) ?? console.warn(...args) },
    autoLoadUserEnv: true,
  });

  return {
    event: async ({ event }) => {
      await runtime.onEvent(event);
    },
    'session.deleted': async (input) => {
      await runtime.onEvent({
        type: 'session.deleted',
        properties: { sessionID: input?.sessionID },
      });
    },
  };
}
