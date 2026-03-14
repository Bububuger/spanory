import assert from 'node:assert/strict';
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
