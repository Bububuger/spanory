import assert from 'node:assert/strict';
import test from 'node:test';

import register, { createOpencodeSpanoryPluginRuntime } from '../dist/index.js';

test('createOpencodeSpanoryPluginRuntime requires client session API contract', () => {
  assert.throws(
    () => createOpencodeSpanoryPluginRuntime({ client: {} }),
    /client\.session\.get and client\.session\.messages/,
  );
});

test('default register returns opencode handler contract', async () => {
  const api = {
    client: {
      session: {
        async get() {
          return { data: { id: 's1', projectID: 'p1' } };
        },
        async messages() {
          return { data: [] };
        },
      },
    },
    $: {
      logger: {
        error: () => {},
      },
    },
  };

  const handlers = await register(api);
  assert.equal(typeof handlers.event, 'function');
  assert.equal(typeof handlers['session.deleted'], 'function');

  await handlers.event({ event: { type: 'noop' } });
});
