import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import test from 'node:test';

import register, { createOpenclawSpanoryPluginRuntime } from '../dist/index.js';

const REQUIRED_RUNTIME_HOOKS = [
  'onSessionStart',
  'onLlmInput',
  'onLlmOutput',
  'onAfterToolCall',
  'onToolResultPersist',
  'onBeforeMessageWrite',
  'onSessionEnd',
  'onGatewayStop',
];

test('createOpenclawSpanoryPluginRuntime exposes expected hook contract', () => {
  const runtime = createOpenclawSpanoryPluginRuntime({ warn: () => {} });
  for (const hook of REQUIRED_RUNTIME_HOOKS) {
    assert.equal(typeof runtime[hook], 'function');
  }
});

test('default register wires expected openclaw events', () => {
  const handlers = new Map();
  register({
    logger: { warn: () => {} },
    on(eventName, handler) {
      handlers.set(eventName, handler);
    },
  });

  const expectedEvents = [
    'session_start',
    'llm_input',
    'llm_output',
    'before_tool_call',
    'after_tool_call',
    'tool_result_persist',
    'before_message_write',
    'session_end',
    'gateway_stop',
  ];

  for (const eventName of expectedEvents) {
    assert.equal(typeof handlers.get(eventName), 'function');
  }
});

test('gateway flush continues remaining spool items when one item send fails', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'spanory-openclaw-spool-'));
  const spoolDir = path.join(tempRoot, 'spool');
  await mkdir(spoolDir, { recursive: true });
  await writeFile(path.join(spoolDir, '001-first.json'), JSON.stringify({ payload: { id: 'first' } }), 'utf8');
  await writeFile(path.join(spoolDir, '002-second.json'), JSON.stringify({ payload: { id: 'second' } }), 'utf8');

  const prevSpoolDir = process.env.SPANORY_OPENCLAW_SPOOL_DIR;
  const prevEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const prevRetryMax = process.env.SPANORY_OPENCLAW_RETRY_MAX;
  const prevFetch = globalThis.fetch;

  process.env.SPANORY_OPENCLAW_SPOOL_DIR = spoolDir;
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://example.test/v1/traces';
  process.env.SPANORY_OPENCLAW_RETRY_MAX = '1';

  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    if (fetchCalls === 1) return { ok: false, status: 500 };
    return { ok: true, status: 200 };
  };

  t.after(async () => {
    globalThis.fetch = prevFetch;
    if (prevSpoolDir === undefined) delete process.env.SPANORY_OPENCLAW_SPOOL_DIR;
    else process.env.SPANORY_OPENCLAW_SPOOL_DIR = prevSpoolDir;
    if (prevEndpoint === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = prevEndpoint;
    if (prevRetryMax === undefined) delete process.env.SPANORY_OPENCLAW_RETRY_MAX;
    else process.env.SPANORY_OPENCLAW_RETRY_MAX = prevRetryMax;
    await rm(tempRoot, { recursive: true, force: true });
  });

  const warnings = [];
  const runtime = createOpenclawSpanoryPluginRuntime({
    warn(message) {
      warnings.push(String(message));
    },
  });

  await runtime.onGatewayStop();

  const remaining = (await readdir(spoolDir)).sort();
  assert.deepEqual(remaining, ['001-first.json']);
  assert.equal(fetchCalls, 2);
  assert.match(warnings.join('\n'), /OTLP HTTP 500/);
});
