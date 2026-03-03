import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

import { langfuseBackendAdapter } from '../../backend-langfuse/src/index.js';
import { buildResource, compileOtlpSpans, parseOtlpHeaders, sendOtlpHttp as sendOtlpHttpDefault } from '../../otlp-core/src/index.js';
import { normalizeTranscriptMessages, pickUsage } from '../../cli/src/runtime/shared/normalize.js';

const PLUGIN_ID = 'spanory-opencode-plugin';

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

function pluginStateRoot() {
  return path.join(resolveOpencodeHome(), 'state', 'spanory');
}

function spoolRoot() {
  return process.env.SPANORY_OPENCODE_SPOOL_DIR ?? path.join(pluginStateRoot(), 'spool');
}

function statusFilePath() {
  return path.join(pluginStateRoot(), 'plugin-status.json');
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
  await writeStatus({
    pluginId: PLUGIN_ID,
    lastFailureAt: nowIso(),
    lastSessionId: item.sessionId,
    message: item.error ?? 'send failed',
    spoolFile: file,
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
  if (part.type === 'text' || part.type === 'reasoning') return String(part.text ?? '');
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
      if (part?.type === 'text' || part?.type === 'reasoning') {
        content.push({ type: 'text', text: String(part.text ?? '') });
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

export function createOpencodeSpanoryPluginRuntime(options) {
  const logger = options?.logger;
  const client = options?.client;
  const sendOtlpHttp = options?.sendOtlpHttp ?? sendOtlpHttpDefault;
  const fingerprints = new Map();

  if (!client?.session?.get || !client?.session?.messages) {
    throw new Error('opencode plugin runtime requires client.session.get and client.session.messages');
  }

  async function sendWithRetry(payload) {
    const endpoint = otlpEndpoint();
    if (!endpoint) return { skipped: true };

    const headers = otlpHeaders();
    let lastErr;
    for (let i = 0; i < retryMax(); i += 1) {
      try {
        await sendOtlpHttp(endpoint, payload, headers);
        return { skipped: false };
      } catch (err) {
        lastErr = err;
        await delay(retryDelayMs(i));
      }
    }
    throw lastErr ?? new Error('send failed');
  }

  async function flushSpool() {
    const items = await readSpoolItems();
    for (const item of items) {
      const result = await sendWithRetry(item.payload.payload);
      if (result.skipped) break;
      await rm(item.file, { force: true });
    }
  }

  let pipeline = Promise.resolve();

  function submit(events, sessionId, fingerprint) {
    pipeline = pipeline.then(async () => {
      const mapped = langfuseBackendAdapter.mapEvents(events);
      const payload = compileOtlpSpans(mapped, buildResource());

      try {
        const result = await sendWithRetry(payload);
        if (!result.skipped) {
          await flushSpool();
        }
        await writeStatus({
          pluginId: PLUGIN_ID,
          lastSessionId: sessionId,
          lastFingerprint: fingerprint,
          lastSuccessAt: nowIso(),
          events: events.length,
          endpointConfigured: !result.skipped,
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

  async function flushSession(sessionId) {
    if (!sessionId) return;
    const events = await collectCanonicalEvents(sessionId);
    if (!events.length) return;

    const fingerprint = hashEvents(events);
    if (fingerprints.get(sessionId) === fingerprint) {
      await writeStatus({
        pluginId: PLUGIN_ID,
        lastSessionId: sessionId,
        lastFingerprint: fingerprint,
        lastSkippedAt: nowIso(),
        reason: 'fingerprint_unchanged',
      });
      return;
    }

    fingerprints.set(sessionId, fingerprint);
    submit(events, sessionId, fingerprint);
  }

  async function onEvent(event) {
    const type = event?.type;
    if (type === 'session.idle' || type === 'session.deleted') {
      await flushSession(event?.properties?.sessionID);
    }
  }

  async function onGatewayStop() {
    await pipeline;
    try {
      await flushSpool();
    } catch (err) {
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
