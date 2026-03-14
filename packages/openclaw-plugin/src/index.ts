import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { langfuseBackendAdapter } from '@bububuger/backend-langfuse';
import { buildResource, compileOtlpSpans, parseOtlpHeaders, sendOtlpHttp } from '@bububuger/otlp-core';
import { loadUserEnv } from '@bububuger/spanory/env';
import { GATEWAY_INPUT_METADATA_BLOCK_RE, toNumber } from '@bububuger/core';

const PLUGIN_ID = 'spanory-openclaw-plugin';
const EXECUTION_ENTRY = (() => {
  const candidate = fileURLToPath(import.meta.url);
  try {
    return realpathSync(candidate);
  } catch {
    return candidate;
  }
})();
const requireFromHere = createRequire(EXECUTION_ENTRY);
const PLUGIN_FILE_DIR = path.dirname(EXECUTION_ENTRY);
const DEFAULT_SPANORY_VERSION = 'unknown';

function readSpanoryVersionFromBinary() {
  try {
    const stdout = execFileSync('spanory', ['-v'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const version = String(stdout ?? '').trim();
    return version || null;
  } catch {
    return null;
  }
}

function readSpanoryVersionFromPackageJson() {
  for (const packageName of ['@bububuger/spanory', '@alipay/spanory']) {
    try {
      const pkgJsonPath = requireFromHere.resolve(`${packageName}/package.json`);
      const parsed = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
      const version = String(parsed?.version ?? '').trim();
      if (version) return version;
    } catch {}
  }

  const candidates = [
    path.resolve(PLUGIN_FILE_DIR, '..', '..', 'package.json'),
    path.resolve(PLUGIN_FILE_DIR, '..', '..', '..', 'package.json'),
    path.resolve(PLUGIN_FILE_DIR, '..', '..', 'cli', 'package.json'),
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

const SPANORY_SERVICE_VERSION =
  process.env.SPANORY_VERSION ??
  readSpanoryVersionFromBinary() ??
  readSpanoryVersionFromPackageJson() ??
  DEFAULT_SPANORY_VERSION;

function usageToAttributes(usage) {
  if (!usage || typeof usage !== 'object') return {};
  const attrs = {};
  const input = toNumber(usage.input ?? usage.input_tokens ?? usage.prompt_tokens);
  const output = toNumber(usage.output ?? usage.output_tokens ?? usage.completion_tokens);
  const total = toNumber(usage.total ?? usage.total_tokens) ?? ((input ?? 0) + (output ?? 0) || undefined);
  const cacheRead = toNumber(usage.cacheRead ?? usage.cache_read_input_tokens);
  const cacheWrite = toNumber(usage.cacheWrite ?? usage.cache_creation_input_tokens);

  if (input !== undefined) {
    attrs['gen_ai.usage.input_tokens'] = input;
    attrs['gen_ai.usage.prompt_tokens'] = input;
  }
  if (output !== undefined) {
    attrs['gen_ai.usage.output_tokens'] = output;
    attrs['gen_ai.usage.completion_tokens'] = output;
  }
  if (total !== undefined) {
    attrs['gen_ai.usage.total_tokens'] = total;
  }
  if (cacheRead !== undefined) {
    attrs['gen_ai.usage.cache_read.input_tokens'] = cacheRead;
  }
  if (cacheWrite !== undefined) {
    attrs['gen_ai.usage.cache_creation.input_tokens'] = cacheWrite;
  }
  attrs['langfuse.observation.usage_details'] = JSON.stringify({
    ...(input !== undefined ? { input } : {}),
    ...(output !== undefined ? { output } : {}),
    ...(total !== undefined ? { total } : {}),
    ...(cacheRead !== undefined ? { input_cache_read: cacheRead } : {}),
    ...(cacheWrite !== undefined ? { input_cache_creation: cacheWrite } : {}),
  });
  return attrs;
}

function mergeUsage(target: Record<string, number> = {}, usage: any) {
  if (!usage || typeof usage !== 'object') return target;
  const next = { ...target };
  const input = toNumber(usage.input ?? usage.input_tokens ?? usage.prompt_tokens);
  const output = toNumber(usage.output ?? usage.output_tokens ?? usage.completion_tokens);
  const total = toNumber(usage.total ?? usage.total_tokens);
  const cacheRead = toNumber(usage.cacheRead ?? usage.cache_read_input_tokens);
  const cacheWrite = toNumber(usage.cacheWrite ?? usage.cache_creation_input_tokens);
  if (input !== undefined) next.input = (next.input ?? 0) + input;
  if (output !== undefined) next.output = (next.output ?? 0) + output;
  if (total !== undefined) next.total = (next.total ?? 0) + total;
  if (cacheRead !== undefined) next.cacheRead = (next.cacheRead ?? 0) + cacheRead;
  if (cacheWrite !== undefined) next.cacheWrite = (next.cacheWrite ?? 0) + cacheWrite;
  return next;
}

function normalizeToolCategory(name) {
  const n = String(name ?? '');
  if (n === 'Bash' || n === 'exec') return 'shell_command';
  const lower = n.toLowerCase();
  if (lower === 'mcp' || lower.startsWith('mcp__') || lower.startsWith('mcp-')) return 'mcp';
  if (n === 'Task') return 'agent_task';
  return 'tool';
}

function normalizeToolName(name) {
  const n = String(name ?? 'tool');
  if (n === 'exec') return 'Bash';
  return n;
}

function buildToolAttributes(name, toolCallId) {
  const attrs = {
    'gen_ai.tool.name': name,
    'gen_ai.operation.name': name === 'Task' ? 'invoke_agent' : 'execute_tool',
  };
  if (toolCallId) {
    attrs['gen_ai.tool.call.id'] = toolCallId;
  }
  if (name.startsWith('mcp__')) {
    const server = name.split('__')[1];
    if (server) attrs['agentic.mcp.server.name'] = server;
  }
  return attrs;
}

function extractToolResultContent(message) {
  const content = message?.content;
  if (typeof content === 'string' && content.trim()) return content;
  if (Array.isArray(content)) {
    const text = content
      .map((block) => {
        if (typeof block === 'string') return block;
        if (block && typeof block === 'object' && typeof block.text === 'string') return block.text;
        return '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();
    if (text) return text;
  }

  const details = message?.details;
  if (details && typeof details === 'object') {
    if (typeof details.aggregated === 'string' && details.aggregated.trim()) return details.aggregated;
    if (typeof details.stdout === 'string' && details.stdout.trim()) return details.stdout;
    if (typeof details.stderr === 'string' && details.stderr.trim()) return details.stderr;
  }

  return '';
}

function extractAssistantOutput(event) {
  const assistantTexts = Array.isArray(event?.assistantTexts) ? event.assistantTexts.join('\n').trim() : '';
  if (assistantTexts) return assistantTexts;

  const lastAssistant = event?.lastAssistant;
  if (!lastAssistant || typeof lastAssistant !== 'object') return '';
  if (typeof lastAssistant.content === 'string' && lastAssistant.content.trim()) return lastAssistant.content.trim();
  if (!Array.isArray(lastAssistant.content)) return '';

  return lastAssistant.content
    .map((block) => {
      if (typeof block === 'string') return block;
      if (block && typeof block === 'object' && typeof block.text === 'string') return block.text;
      return '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function normalizeRuntimeVersion(value) {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text || undefined;
}

function runtimeVersionAttributes(version) {
  if (!version) return {};
  return {
    'agentic.runtime.version': version,
  };
}

function detectOpenclawRuntimeVersion() {
  const envVersion = normalizeRuntimeVersion(
    process.env.OPENCLAW_RUNTIME_VERSION ?? process.env.OPENCLAW_VERSION ?? process.env.npm_package_version,
  );
  if (envVersion) return envVersion;
  try {
    const stdout = execFileSync('openclaw', ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return normalizeRuntimeVersion(stdout);
  } catch {
    return 'unknown';
  }
}

function extractPromptMetadata(prompt) {
  const input = String(prompt ?? '');
  const match = input.match(GATEWAY_INPUT_METADATA_BLOCK_RE);
  if (!match) return { prompt: input, attributes: {} };

  const attributes = {};
  try {
    const parsed = JSON.parse(match[1]);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      attributes['agentic.input.metadata'] = JSON.stringify(parsed);
      if (parsed.message_id !== undefined) attributes['agentic.input.message_id'] = String(parsed.message_id);
      if (parsed.sender !== undefined) attributes['agentic.input.sender'] = String(parsed.sender);
    }
  } catch {
    // ignore malformed metadata JSON and only strip wrapper text
  }

  const matchIndex = match.index ?? 0;
  const normalizedPrompt = input.slice(matchIndex + match[0].length).trim() || input;
  return { prompt: normalizedPrompt, attributes };
}

function normalizeToolParams(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      // ignore invalid JSON and fall through
    }
  }
  return {};
}

type AssistantToolCall = {
  toolCallId: string;
  toolName: string;
  params: Record<string, unknown>;
};

function extractAssistantToolCalls(message): AssistantToolCall[] {
  if (!message || typeof message !== 'object') return [];
  if (message.role !== 'assistant') return [];
  if (!Array.isArray(message.content)) return [];
  const out: AssistantToolCall[] = [];
  for (const block of message.content) {
    if (!block || typeof block !== 'object') continue;
    if (block.type !== 'toolCall') continue;
    const toolCallId = block.id ?? block.toolCallId ?? undefined;
    if (!toolCallId) continue;
    out.push({
      toolCallId,
      toolName: normalizeToolName(block.name ?? block.toolName ?? 'tool'),
      params: normalizeToolParams(block.arguments ?? block.params),
    });
  }
  return out;
}

function sessionIdsFromContext(ctx: any = {}) {
  const sessionKey = ctx.sessionKey ?? ctx.sessionId ?? 'unknown-session';
  const sessionId = ctx.sessionId ?? sessionKey;
  const projectId = ctx.agentId ?? sessionKey.split(':')[1] ?? 'openclaw';
  const stateKey = `${projectId}:${sessionId}`;
  return { stateKey, sessionKey, sessionId, projectId };
}

function nowIso() {
  return new Date().toISOString();
}

function pluginStateRoot() {
  const home =
    process.env.SPANORY_OPENCLAW_HOME ?? process.env.OPENCLAW_STATE_DIR ?? path.join(os.homedir(), '.openclaw');
  return path.join(home, 'state', 'spanory');
}

function spoolRoot() {
  return process.env.SPANORY_OPENCLAW_SPOOL_DIR ?? path.join(pluginStateRoot(), 'spool');
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
  const name = `${Date.now()}-${Math.random().toString(16).slice(2)}.json`;
  const file = path.join(root, name);
  await writeFile(file, JSON.stringify(item), 'utf-8');
  await writeStatus({
    pluginId: PLUGIN_ID,
    lastFailureAt: new Date().toISOString(),
    spoolFile: file,
    message: item.error ?? 'send failed',
  });
}

async function readSpoolItems(logger) {
  const root = spoolRoot();
  await mkdir(root, { recursive: true });
  const names = (await readdir(root)).filter((name) => name.endsWith('.json')).sort();
  const out: Array<{ file: string; payload: any }> = [];
  for (const name of names) {
    const file = path.join(root, name);
    try {
      const raw = await readFile(file, 'utf-8');
      out.push({ file, payload: JSON.parse(raw) });
    } catch (err) {
      logger?.warn?.(`[${PLUGIN_ID}] dropping unreadable spool file ${file}: ${String(err)}`);
      await rm(file, { force: true });
    }
  }
  return out;
}

function otlpEndpoint() {
  return process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
}

function otlpHeaders() {
  return parseOtlpHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS) ?? {};
}

function retryMax() {
  const v = Number(process.env.SPANORY_OPENCLAW_RETRY_MAX ?? 6);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 6;
}

function retryDelayMs(attempt) {
  return Math.min(2000, 200 * 2 ** attempt);
}

function flushDelayMs() {
  const raw = Number(process.env.SPANORY_OPENCLAW_FLUSH_DELAY_MS ?? 300);
  if (!Number.isFinite(raw) || raw < 0) return 300;
  return Math.floor(raw);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendWithRetry(payload) {
  await ensureUserEnvLoaded();
  const endpoint = otlpEndpoint();
  if (!endpoint) {
    throw new Error('OTEL_EXPORTER_OTLP_ENDPOINT is unset');
  }
  const headers = otlpHeaders();
  const max = retryMax();
  let lastErr;
  for (let i = 0; i < max; i += 1) {
    try {
      await sendOtlpHttp(endpoint, payload, headers);
      return true;
    } catch (err) {
      lastErr = err;
      await delay(retryDelayMs(i));
    }
  }
  throw lastErr ?? new Error('send failed');
}

function createRuntimeQueue(logger) {
  let pipeline = Promise.resolve();

  const flushSpool = async () => {
    const items = await readSpoolItems(logger);
    for (const item of items) {
      await sendWithRetry(item.payload.payload);
      await rm(item.file, { force: true });
    }
  };

  const submit = (events) => {
    if (!events.length) return;
    pipeline = pipeline
      .then(async () => {
        const mapped = langfuseBackendAdapter.mapEvents(events);
        const payload = compileOtlpSpans(
          mapped,
          buildResource({
            serviceVersion: SPANORY_SERVICE_VERSION,
          }),
        );
        try {
          await sendWithRetry(payload);
          await flushSpool();
          await writeStatus({
            pluginId: PLUGIN_ID,
            lastSuccessAt: new Date().toISOString(),
            events: events.length,
          });
        } catch (err) {
          await enqueueSpool({
            payload,
            error: err instanceof Error ? err.message : String(err),
            createdAt: new Date().toISOString(),
          });
        }
      })
      .catch((err) => {
        logger?.warn?.(`[${PLUGIN_ID}] pipeline error: ${String(err)}`);
      });
  };

  const flush = async () => {
    await pipeline;
    try {
      await flushSpool();
    } catch (err) {
      logger?.warn?.(`[${PLUGIN_ID}] flush error: ${String(err)}`);
    }
  };

  return { submit, flush };
}

export function createOpenclawSpanoryPluginRuntime(logger) {
  const sessions = new Map<string, any>();
  const sessionAliases = new Map<string, string>();
  const queue = createRuntimeQueue(logger);
  const defaultRuntimeVersion = detectOpenclawRuntimeVersion();

  const resolveStateKey = (ctx) => {
    if (ctx?.sessionId) {
      const ids = sessionIdsFromContext(ctx);
      return { stateKey: ids.stateKey, ids };
    }

    if (ctx?.sessionKey && sessionAliases.has(ctx.sessionKey)) {
      const aliasedStateKey = sessionAliases.get(ctx.sessionKey);
      if (aliasedStateKey) {
        const existing = sessions.get(aliasedStateKey);
        if (existing) return { stateKey: aliasedStateKey, ids: existing };
      }
    }

    const ids = sessionIdsFromContext(ctx);
    return { stateKey: ids.stateKey, ids };
  };

  const getState = (ctx: any, options: { requireResolved?: boolean } = {}) => {
    const { requireResolved = false } = options;
    const hasResolvedAlias = Boolean(ctx?.sessionId) || (ctx?.sessionKey && sessionAliases.has(ctx.sessionKey));
    if (requireResolved && !hasResolvedAlias) return null;

    const { stateKey, ids } = resolveStateKey(ctx);
    if (!sessions.has(stateKey)) {
      sessions.set(stateKey, {
        stateKey,
        ...ids,
        turnCounter: 0,
        pendingTurnId: undefined,
        lastTurnId: undefined,
        pendingTools: [],
        pendingToolCalls: new Map(),
        pendingOutputParts: [],
        pendingUsage: {},
        pendingInputAttributes: {},
        currentBatch: null,
        flushTimer: null,
        seenToolCallIds: new Set(),
        seenToolCallOrder: [],
        lastPrompt: '',
        lastInputAt: nowIso(),
        lastModel: undefined,
        runtimeVersion: defaultRuntimeVersion,
        lastTouchedAt: Date.now(),
      });
    }
    const state = sessions.get(stateKey);
    state.lastTouchedAt = Date.now();
    if (ctx?.sessionKey) sessionAliases.set(ctx.sessionKey, stateKey);
    return state;
  };

  const findFallbackState = (ctx) => {
    const candidates: any[] = [];
    for (const state of sessions.values()) {
      if (ctx?.agentId && state.projectId !== ctx.agentId) continue;
      candidates.push(state);
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => (b.lastTouchedAt ?? 0) - (a.lastTouchedAt ?? 0));
    return candidates[0];
  };

  const getToolState = (ctx) => {
    const resolved = getState(ctx, { requireResolved: true });
    if (resolved) return resolved;
    const fallback = findFallbackState(ctx);
    if (!fallback) return null;
    fallback.lastTouchedAt = Date.now();
    if (ctx?.sessionKey) sessionAliases.set(ctx.sessionKey, fallback.stateKey);
    return fallback;
  };

  const seenToolCall = (state, toolCallId) => {
    if (!toolCallId) return false;
    if (state.seenToolCallIds.has(toolCallId)) return true;
    state.seenToolCallIds.add(toolCallId);
    state.seenToolCallOrder.push(toolCallId);
    if (state.seenToolCallOrder.length > 500) {
      const evicted = state.seenToolCallOrder.shift();
      if (evicted) state.seenToolCallIds.delete(evicted);
    }
    return false;
  };

  const clearTurnFlushTimer = (state) => {
    if (state.flushTimer) {
      clearTimeout(state.flushTimer);
      state.flushTimer = null;
    }
  };

  const flushCurrentBatch = (state) => {
    clearTurnFlushTimer(state);
    if (!state.currentBatch || !state.currentBatch.length) return;
    queue.submit(state.currentBatch);
    state.currentBatch = null;
  };

  const scheduleTurnFlush = (state) => {
    clearTurnFlushTimer(state);
    const delayMs = flushDelayMs();
    state.flushTimer = setTimeout(() => {
      state.flushTimer = null;
      flushCurrentBatch(state);
    }, delayMs);
  };

  const createTurnId = (state) => {
    state.turnCounter += 1;
    const turnMs = Number.isFinite(Date.parse(state.lastInputAt)) ? Date.parse(state.lastInputAt) : Date.now();
    return `turn-${turnMs}-${state.turnCounter}`;
  };

  const clearPendingTurn = (state) => {
    state.pendingTurnId = undefined;
    state.pendingOutputParts = [];
    state.pendingUsage = {};
    state.pendingInputAttributes = {};
  };

  const finalizePendingTurn = (state: any, options: { force?: boolean; requireOutput?: boolean } = {}) => {
    const { force = false, requireOutput = false } = options;
    if (!state.pendingTurnId) return false;
    const output = state.pendingOutputParts
      .map((part) => String(part ?? ''))
      .filter(Boolean)
      .join('\n')
      .trim();
    const hasTools = state.pendingTools.length > 0;
    if (requireOutput && !output) return false;
    if (!force && !output && !hasTools) return false;

    const turnId = state.pendingTurnId;
    state.lastTurnId = turnId;
    const turnEvent = {
      runtime: 'openclaw',
      projectId: state.projectId,
      sessionId: state.sessionId,
      turnId,
      category: 'turn',
      name: `openclaw - Turn ${turnId}`,
      startedAt: state.lastInputAt,
      endedAt: nowIso(),
      input: state.lastPrompt ?? '',
      output,
      attributes: {
        'agentic.event.category': 'turn',
        'gen_ai.operation.name': 'invoke_agent',
        ...runtimeVersionAttributes(state.runtimeVersion),
        ...(state.pendingInputAttributes ?? {}),
        ...(state.lastModel ? { 'langfuse.observation.model.name': state.lastModel } : {}),
        ...usageToAttributes(state.pendingUsage),
      },
    };
    const tools = state.pendingTools.map((tool) => ({ ...tool, turnId }));
    state.pendingTools = [];
    state.currentBatch = [turnEvent, ...tools];
    clearPendingTurn(state);
    scheduleTurnFlush(state);
    return true;
  };

  const enqueueToolEvent = (state, toolEvent) => {
    state.lastTouchedAt = Date.now();
    const hasPendingUnmaterializedTurn = Boolean(
      state.pendingTurnId &&
      state.pendingTurnId !== state.lastTurnId &&
      (!state.currentBatch || state.currentBatch.length === 0),
    );
    if (hasPendingUnmaterializedTurn) {
      state.pendingTools.push({ ...toolEvent, turnId: state.pendingTurnId });
      return;
    }
    if (state.currentBatch && state.currentBatch.length > 0) {
      const turnId = state.currentBatch[0].turnId;
      state.currentBatch.push({ ...toolEvent, turnId });
      scheduleTurnFlush(state);
    } else if (state.lastTurnId) {
      queue.submit([{ ...toolEvent, turnId: state.lastTurnId }]);
    } else {
      state.pendingTools.push(toolEvent);
    }
  };

  const onLlmInput = (event, ctx) => {
    const state = getState(ctx);
    flushCurrentBatch(state);
    if (finalizePendingTurn(state)) {
      flushCurrentBatch(state);
    }
    const normalized = extractPromptMetadata(event?.prompt ?? '');
    const runtimeVersion = normalizeRuntimeVersion(
      event?.runtimeVersion ??
        event?.runtime_version ??
        event?.openclawVersion ??
        event?.openclaw_version ??
        event?.version,
    );
    if (runtimeVersion) state.runtimeVersion = runtimeVersion;
    state.lastPrompt = normalized.prompt;
    state.lastInputAt = nowIso();
    state.pendingTurnId = createTurnId(state);
    state.pendingOutputParts = [];
    state.pendingUsage = {};
    state.pendingInputAttributes = normalized.attributes;
    state.lastTouchedAt = Date.now();
  };

  const onLlmOutput = (event, ctx) => {
    const state = getState(ctx);
    if (!state.pendingTurnId) return;
    const runtimeVersion = normalizeRuntimeVersion(
      event?.runtimeVersion ??
        event?.runtime_version ??
        event?.openclawVersion ??
        event?.openclaw_version ??
        event?.version,
    );
    if (runtimeVersion) state.runtimeVersion = runtimeVersion;
    state.lastModel = event?.model ?? state.lastModel;
    state.lastTouchedAt = Date.now();
    state.pendingUsage = mergeUsage(state.pendingUsage, event?.usage);
    const output = extractAssistantOutput(event);
    if (!output) return;
    state.pendingOutputParts.push(output);
    finalizePendingTurn(state, { requireOutput: true });
  };

  const onAfterToolCall = (event, ctx) => {
    const state = getToolState(ctx);
    if (!state) return;
    state.lastTouchedAt = Date.now();
    const toolName = normalizeToolName(event?.toolName ?? 'tool');
    const category = normalizeToolCategory(toolName);
    const startedAt = nowIso();
    const output = event?.error ? String(event.error) : JSON.stringify(event?.result ?? '');
    const params = normalizeToolParams(event?.params);
    const input = JSON.stringify(params);
    const toolCallId = event?.toolCallId ?? event?.tool_call_id ?? undefined;
    if (!toolCallId) return;
    if (seenToolCall(state, toolCallId)) return;
    state.pendingToolCalls.set(toolCallId, { toolName, params });

    const toolEvent = {
      runtime: 'openclaw',
      projectId: state.projectId,
      sessionId: state.sessionId,
      turnId: state.lastTurnId,
      category,
      name: `Tool: ${toolName}`,
      startedAt,
      endedAt: startedAt,
      input,
      output,
      attributes: {
        'agentic.event.category': category,
        ...runtimeVersionAttributes(state.runtimeVersion),
        ...(state.lastModel ? { 'langfuse.observation.model.name': state.lastModel } : {}),
        ...buildToolAttributes(toolName, toolCallId),
      },
    };
    enqueueToolEvent(state, toolEvent);
  };

  const onToolResultPersist = (event, ctx) => {
    const state = getToolState(ctx);
    if (!state) return;
    state.lastTouchedAt = Date.now();

    const toolCallId = event?.toolCallId ?? ctx?.toolCallId ?? event?.message?.toolCallId ?? undefined;
    const cachedCall = toolCallId ? state.pendingToolCalls.get(toolCallId) : undefined;
    const toolName = normalizeToolName(event?.toolName ?? cachedCall?.toolName ?? ctx?.toolName ?? 'tool');
    if (seenToolCall(state, toolCallId)) return;
    if (toolCallId) state.pendingToolCalls.delete(toolCallId);

    const category = normalizeToolCategory(toolName);
    const startedAt = nowIso();
    const output = extractToolResultContent(event?.message);
    const input = JSON.stringify(cachedCall?.params ?? {});
    const toolEvent = {
      runtime: 'openclaw',
      projectId: state.projectId,
      sessionId: state.sessionId,
      turnId: state.lastTurnId,
      category,
      name: `Tool: ${toolName}`,
      startedAt,
      endedAt: startedAt,
      input,
      output,
      attributes: {
        'agentic.event.category': category,
        ...runtimeVersionAttributes(state.runtimeVersion),
        ...(state.lastModel ? { 'langfuse.observation.model.name': state.lastModel } : {}),
        ...buildToolAttributes(toolName, toolCallId),
      },
    };

    enqueueToolEvent(state, toolEvent);
  };

  const onBeforeMessageWrite = (event, ctx) => {
    const state = getToolState(ctx);
    if (!state) return {};
    state.lastTouchedAt = Date.now();
    const message = event?.message;
    if (!message || typeof message !== 'object') return {};

    const assistantToolCalls = extractAssistantToolCalls(message);
    for (const call of assistantToolCalls) {
      state.pendingToolCalls.set(call.toolCallId, { toolName: call.toolName, params: call.params });
    }

    if (message.role !== 'toolResult') return {};

    const toolCallId = message.toolCallId ?? undefined;
    const cachedCall = toolCallId ? state.pendingToolCalls.get(toolCallId) : undefined;
    const toolName = normalizeToolName(message.toolName ?? cachedCall?.toolName ?? ctx?.toolName ?? 'tool');
    if (seenToolCall(state, toolCallId)) return {};
    if (toolCallId) state.pendingToolCalls.delete(toolCallId);

    const category = normalizeToolCategory(toolName);
    const startedAt = nowIso();
    const toolEvent = {
      runtime: 'openclaw',
      projectId: state.projectId,
      sessionId: state.sessionId,
      turnId: state.lastTurnId,
      category,
      name: `Tool: ${toolName}`,
      startedAt,
      endedAt: startedAt,
      input: JSON.stringify(cachedCall?.params ?? {}),
      output: extractToolResultContent(message),
      attributes: {
        'agentic.event.category': category,
        ...runtimeVersionAttributes(state.runtimeVersion),
        ...(state.lastModel ? { 'langfuse.observation.model.name': state.lastModel } : {}),
        ...buildToolAttributes(toolName, toolCallId),
      },
    };

    enqueueToolEvent(state, toolEvent);
    return {};
  };

  const onSessionEnd = async (_event, ctx) => {
    const state = getState(ctx);
    if (finalizePendingTurn(state)) {
      flushCurrentBatch(state);
    }
    if ((!state.currentBatch || state.currentBatch.length === 0) && state.pendingTools.length > 0) {
      const turnId = state.pendingTurnId ?? createTurnId(state);
      state.lastTurnId = turnId;
      state.currentBatch = [
        {
          runtime: 'openclaw',
          projectId: state.projectId,
          sessionId: state.sessionId,
          turnId,
          category: 'turn',
          name: `openclaw - Turn ${turnId}`,
          startedAt: state.lastInputAt ?? nowIso(),
          endedAt: nowIso(),
          input: state.lastPrompt ?? '',
          output: '',
          attributes: {
            'agentic.event.category': 'turn',
            'gen_ai.operation.name': 'invoke_agent',
            ...runtimeVersionAttributes(state.runtimeVersion),
            ...(state.pendingInputAttributes ?? {}),
            ...(state.lastModel ? { 'langfuse.observation.model.name': state.lastModel } : {}),
          },
        },
        ...state.pendingTools.map((tool) => ({ ...tool, turnId })),
      ];
      state.pendingTools = [];
      clearPendingTurn(state);
    }
    flushCurrentBatch(state);
    await queue.flush();
  };

  const onSessionStart = (event, ctx) => {
    const state = getState(ctx);
    const runtimeVersion = normalizeRuntimeVersion(
      event?.runtimeVersion ??
        event?.runtime_version ??
        event?.openclawVersion ??
        event?.openclaw_version ??
        event?.version ??
        event?.session?.runtimeVersion ??
        event?.session?.runtime_version ??
        event?.session?.version,
    );
    if (runtimeVersion) state.runtimeVersion = runtimeVersion;
    state.lastTouchedAt = Date.now();
  };

  const onGatewayStop = async () => {
    for (const state of sessions.values()) {
      if (finalizePendingTurn(state)) {
        flushCurrentBatch(state);
      }
      flushCurrentBatch(state);
    }
    await queue.flush();
  };

  return {
    onSessionStart,
    onLlmInput,
    onLlmOutput,
    onAfterToolCall,
    onToolResultPersist,
    onBeforeMessageWrite,
    onSessionEnd,
    onGatewayStop,
  };
}

let envLoadPromise;

function ensureUserEnvLoaded() {
  if (!envLoadPromise) {
    envLoadPromise = loadUserEnv().catch(() => {});
  }
  return envLoadPromise;
}

export default function register(api) {
  ensureUserEnvLoaded();
  const runtime = createOpenclawSpanoryPluginRuntime(api.logger);
  api.on('session_start', runtime.onSessionStart);
  api.on('llm_input', runtime.onLlmInput);
  api.on('llm_output', runtime.onLlmOutput);
  api.on('before_tool_call', (_event, _ctx) => ({}));
  api.on('after_tool_call', runtime.onAfterToolCall);
  api.on('tool_result_persist', runtime.onToolResultPersist);
  api.on('before_message_write', runtime.onBeforeMessageWrite);
  api.on('session_end', runtime.onSessionEnd);
  api.on('gateway_stop', runtime.onGatewayStop);
}
