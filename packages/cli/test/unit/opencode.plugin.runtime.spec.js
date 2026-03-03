import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createOpencodeSpanoryPluginRuntime } from '../../../opencode-plugin/src/index.js';

async function loadFixture(name) {
  const fixturePath = path.resolve('test/fixtures/opencode', name);
  return JSON.parse(await readFile(fixturePath, 'utf-8'));
}

function mockClient(fixtures) {
  return {
    session: {
      async get() {
        return { data: fixtures.sessionInfo };
      },
      async messages() {
        return { data: fixtures.sessionMessages };
      },
    },
  };
}

describe('opencode plugin runtime', () => {
  it('contract: flushes session.idle and writes status without endpoint', async () => {
    const prevHome = process.env.SPANORY_OPENCODE_HOME;
    const prevSpool = process.env.SPANORY_OPENCODE_SPOOL_DIR;
    const prevEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'spanory-opencode-plugin-'));
    process.env.SPANORY_OPENCODE_HOME = tempRoot;
    process.env.SPANORY_OPENCODE_SPOOL_DIR = path.join(tempRoot, 'state', 'spanory', 'spool');
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

    try {
      const fixtures = {
        idleEvent: await loadFixture('session-idle-event.json'),
        sessionInfo: await loadFixture('session-info.json'),
        sessionMessages: await loadFixture('session-messages.json'),
      };

      const runtime = createOpencodeSpanoryPluginRuntime({
        logger: { warn: () => {} },
        client: mockClient(fixtures),
      });

      await runtime.onEvent(fixtures.idleEvent);
      await runtime.onGatewayStop();

      const statusPath = path.join(tempRoot, 'state', 'spanory', 'plugin-status.json');
      const status = JSON.parse(await readFile(statusPath, 'utf-8'));
      expect(status.pluginId).toBe('spanory-opencode-plugin');
      expect(status.lastSessionId).toBe('session-op-1');
      expect(status.lastSuccessAt).toBeTruthy();
    } finally {
      if (prevHome === undefined) delete process.env.SPANORY_OPENCODE_HOME;
      else process.env.SPANORY_OPENCODE_HOME = prevHome;
      if (prevSpool === undefined) delete process.env.SPANORY_OPENCODE_SPOOL_DIR;
      else process.env.SPANORY_OPENCODE_SPOOL_DIR = prevSpool;
      if (prevEndpoint === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = prevEndpoint;
    }
  });

  it('spool: persists failed payload then flushes on recovery', async () => {
    const prevHome = process.env.SPANORY_OPENCODE_HOME;
    const prevSpool = process.env.SPANORY_OPENCODE_SPOOL_DIR;
    const prevEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const prevRetry = process.env.SPANORY_OPENCODE_RETRY_MAX;

    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'spanory-opencode-plugin-'));
    process.env.SPANORY_OPENCODE_HOME = tempRoot;
    process.env.SPANORY_OPENCODE_SPOOL_DIR = path.join(tempRoot, 'state', 'spanory', 'spool');
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://127.0.0.1:4318/v1/traces';
    process.env.SPANORY_OPENCODE_RETRY_MAX = '1';

    try {
      const fixtures = {
        idleEvent: await loadFixture('session-idle-event.json'),
        sessionInfo: await loadFixture('session-info.json'),
        sessionMessages: await loadFixture('session-messages.json'),
      };

      const failRuntime = createOpencodeSpanoryPluginRuntime({
        logger: { warn: () => {} },
        client: mockClient(fixtures),
        sendOtlpHttp: async () => {
          throw new Error('network down');
        },
      });

      await failRuntime.onEvent(fixtures.idleEvent);
      await failRuntime.onGatewayStop();

      const spoolDir = path.join(tempRoot, 'state', 'spanory', 'spool');
      const filesAfterFail = (await readdir(spoolDir)).filter((name) => name.endsWith('.json'));
      expect(filesAfterFail.length).toBeGreaterThan(0);

      const recoverRuntime = createOpencodeSpanoryPluginRuntime({
        logger: { warn: () => {} },
        client: mockClient(fixtures),
        sendOtlpHttp: async () => {},
      });
      await recoverRuntime.onGatewayStop();

      const filesAfterRecover = (await readdir(spoolDir)).filter((name) => name.endsWith('.json'));
      expect(filesAfterRecover.length).toBe(0);
    } finally {
      if (prevHome === undefined) delete process.env.SPANORY_OPENCODE_HOME;
      else process.env.SPANORY_OPENCODE_HOME = prevHome;
      if (prevSpool === undefined) delete process.env.SPANORY_OPENCODE_SPOOL_DIR;
      else process.env.SPANORY_OPENCODE_SPOOL_DIR = prevSpool;
      if (prevEndpoint === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = prevEndpoint;
      if (prevRetry === undefined) delete process.env.SPANORY_OPENCODE_RETRY_MAX;
      else process.env.SPANORY_OPENCODE_RETRY_MAX = prevRetry;
    }
  });
});
