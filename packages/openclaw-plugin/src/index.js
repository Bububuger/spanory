import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { langfuseBackendAdapter } from '../../backend-langfuse/src/index.js';
import { buildResource, compileOtlpSpans, parseOtlpHeaders, sendOtlpHttp } from '../../otlp-core/src/index.js';

const PLUGIN_ID = 'spanory-openclaw-plugin';

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

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
    attrs['gen_ai.usage.details.cache_read_input_tokens'] = cacheRead;
  }
  if (cacheWrite !== undefined) {
    attrs['gen_ai.usage.details.cache_creation_input_tokens'] = cacheWrite;
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

function normalizeToolCategory(name) {
  const n = String(name ?? '');
  if (n === 'Bash' || n === 'exec') return 'shell_command';
  const lower = n.toLowerCase();
  if (lower === 'mcp' || lower.startsWith('mcp__') || lower.startsWith('mcp-')) return 'mcp';
  if (n === 'Task') return 'agent_task';
  return 'tool';
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

function sessionIdsFromContext(ctx = {}) {
  const sessionKey = ctx.sessionKey ?? ctx.sessionId ?? 'unknown-session';
  const sessionId = ctx.sessionId ?? sessionKey;
  const projectId = ctx.agentId ?? sessionKey.split(':')[1] ?? 'openclaw';
  return { sessionKey, sessionId, projectId };
}

function nowIso() {
  return new Date().toISOString();
}

function pluginStateRoot() {
  const home = process.env.SPANORY_OPENCLOW_HOME
    ?? process.env.SPANORY_OPENCLAW_HOME
    ?? process.env.OPENCLAW_STATE_DIR
    ?? path.join(os.homedir(), '.openclaw');
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

async function readSpoolItems() {
  const root = spoolRoot();
  await mkdir(root, { recursive: true });
  const names = (await readdir(root)).filter((name) => name.endsWith('.json')).sort();
  const out = [];
  for (const name of names) {
    const file = path.join(root, name);
    try {
      const raw = await readFile(file, 'utf-8');
      out.push({ file, payload: JSON.parse(raw) });
    } catch {
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
  return Math.min(2000, 200 * (2 ** attempt));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendWithRetry(payload) {
  const endpoint = otlpEndpoint();
  if (!endpoint) return false;
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
    const items = await readSpoolItems();
    for (const item of items) {
      await sendWithRetry(item.payload.payload);
      await rm(item.file, { force: true });
    }
  };

  const submit = (events) => {
    if (!events.length) return;
    pipeline = pipeline.then(async () => {
      const mapped = langfuseBackendAdapter.mapEvents(events);
      const payload = compileOtlpSpans(mapped, buildResource());
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
    }).catch((err) => {
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
  const sessions = new Map();
  const queue = createRuntimeQueue(logger);

  const getState = (ctx) => {
    const ids = sessionIdsFromContext(ctx);
    if (!sessions.has(ids.sessionKey)) {
      sessions.set(ids.sessionKey, {
        ...ids,
        turnCounter: 0,
        lastTurnId: undefined,
        pendingTools: [],
        currentBatch: null,
        lastPrompt: '',
        lastInputAt: nowIso(),
        lastModel: undefined,
      });
    }
    return sessions.get(ids.sessionKey);
  };

  const flushCurrentBatch = (state) => {
    if (!state.currentBatch || !state.currentBatch.length) return;
    queue.submit(state.currentBatch);
    state.currentBatch = null;
  };

  const onLlmInput = (event, ctx) => {
    const state = getState(ctx);
    state.lastPrompt = String(event?.prompt ?? '');
    state.lastInputAt = nowIso();
  };

  const onLlmOutput = (event, ctx) => {
    const state = getState(ctx);
    flushCurrentBatch(state);
    state.turnCounter += 1;
    state.lastTurnId = `turn-${state.turnCounter}`;
    state.lastModel = event?.model ?? state.lastModel;
    const output = Array.isArray(event?.assistantTexts) ? event.assistantTexts.join('\n') : '';
    const turnEvent = {
      runtime: 'openclaw',
      projectId: state.projectId,
      sessionId: state.sessionId,
      turnId: state.lastTurnId,
      category: 'turn',
      name: `Spanory openclaw - Turn ${state.lastTurnId}`,
      startedAt: state.lastInputAt,
      endedAt: nowIso(),
      input: state.lastPrompt ?? '',
      output,
      attributes: {
        'agentic.event.category': 'turn',
        'gen_ai.operation.name': 'invoke_agent',
        ...(state.lastModel ? { 'langfuse.observation.model.name': state.lastModel } : {}),
        ...usageToAttributes(event?.usage),
      },
    };
    const tools = state.pendingTools.map((tool) => ({ ...tool, turnId: state.lastTurnId }));
    state.pendingTools = [];
    state.currentBatch = [turnEvent, ...tools];
  };

  const onAfterToolCall = (event, ctx) => {
    const state = getState(ctx);
    const toolName = String(event?.toolName ?? 'tool');
    const category = normalizeToolCategory(toolName);
    const startedAt = nowIso();
    const output = event?.error ? String(event.error) : JSON.stringify(event?.result ?? '');
    const input = JSON.stringify(event?.params ?? {});
    const toolCallId = event?.toolCallId ?? event?.tool_call_id ?? undefined;

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
        ...(state.lastModel ? { 'langfuse.observation.model.name': state.lastModel } : {}),
        ...buildToolAttributes(toolName, toolCallId),
      },
    };
    if (state.currentBatch && state.currentBatch.length > 0) {
      const turnId = state.currentBatch[0].turnId;
      state.currentBatch.push({ ...toolEvent, turnId });
    } else {
      state.pendingTools.push(toolEvent);
    }
  };

  const onSessionEnd = async (_event, ctx) => {
    const state = getState(ctx);
    if ((!state.currentBatch || state.currentBatch.length === 0) && state.pendingTools.length > 0) {
      state.turnCounter += 1;
      const turnId = `turn-${state.turnCounter}`;
      state.currentBatch = [
        {
          runtime: 'openclaw',
          projectId: state.projectId,
          sessionId: state.sessionId,
          turnId,
          category: 'turn',
          name: `Spanory openclaw - Turn ${turnId}`,
          startedAt: state.lastInputAt ?? nowIso(),
          endedAt: nowIso(),
          input: state.lastPrompt ?? '',
          output: '',
          attributes: {
            'agentic.event.category': 'turn',
            'gen_ai.operation.name': 'invoke_agent',
            ...(state.lastModel ? { 'langfuse.observation.model.name': state.lastModel } : {}),
          },
        },
        ...state.pendingTools.map((tool) => ({ ...tool, turnId })),
      ];
      state.pendingTools = [];
    }
    flushCurrentBatch(state);
    await queue.flush();
  };

  const onGatewayStop = async () => {
    await queue.flush();
  };

  return {
    onLlmInput,
    onLlmOutput,
    onAfterToolCall,
    onSessionEnd,
    onGatewayStop,
  };
}

export default function register(api) {
  const runtime = createOpenclawSpanoryPluginRuntime(api.logger);
  api.on('session_start', (_event, _ctx) => {});
  api.on('llm_input', runtime.onLlmInput);
  api.on('llm_output', runtime.onLlmOutput);
  api.on('before_tool_call', (_event, _ctx) => ({}));
  api.on('after_tool_call', runtime.onAfterToolCall);
  api.on('tool_result_persist', (_event, _ctx) => undefined);
  api.on('session_end', runtime.onSessionEnd);
  api.on('gateway_stop', runtime.onGatewayStop);
}
