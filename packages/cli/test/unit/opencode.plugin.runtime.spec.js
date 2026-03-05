import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
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

function readOtlpAttr(span, key) {
  const found = (span?.attributes ?? []).find((item) => item?.key === key);
  if (!found?.value || typeof found.value !== 'object') return undefined;
  return found.value.stringValue
    ?? found.value.doubleValue
    ?? found.value.boolValue
    ?? found.value.intValue
    ?? undefined;
}

describe('opencode plugin runtime', () => {
  it('env: auto loads ~/.env and sends OTLP when process env is missing', async () => {
    const prevHome = process.env.HOME;
    const prevOpencodeHome = process.env.SPANORY_OPENCODE_HOME;
    const prevSpool = process.env.SPANORY_OPENCODE_SPOOL_DIR;
    const prevEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const prevHeaders = process.env.OTEL_EXPORTER_OTLP_HEADERS;
    const prevFlushMode = process.env.SPANORY_OPENCODE_FLUSH_MODE;

    const fakeHome = await mkdtemp(path.join(os.tmpdir(), 'spanory-opencode-env-home-'));
    const opencodeHome = await mkdtemp(path.join(os.tmpdir(), 'spanory-opencode-env-runtime-'));
    process.env.HOME = fakeHome;
    process.env.SPANORY_OPENCODE_HOME = opencodeHome;
    process.env.SPANORY_OPENCODE_SPOOL_DIR = path.join(opencodeHome, 'state', 'spanory', 'spool');
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_HEADERS;
    delete process.env.SPANORY_OPENCODE_FLUSH_MODE;

    await writeFile(
      path.join(fakeHome, '.env'),
      'OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318/v1/traces\n'
        + 'OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic TEST\n',
      'utf-8',
    );

    try {
      const fixtures = {
        sessionInfo: await loadFixture('session-info.json'),
        sessionMessages: await loadFixture('session-messages.json'),
      };
      const sent = [];
      const runtime = createOpencodeSpanoryPluginRuntime({
        logger: { warn: () => {} },
        client: mockClient(fixtures),
        autoLoadUserEnv: true,
        sendOtlpHttp: async (_endpoint, payload, headers) => {
          sent.push({ payload, headers });
        },
      });

      await runtime.onEvent({
        type: 'session.completed',
        properties: { sessionID: 'session-op-1' },
      });
      await runtime.onGatewayStop();

      expect(sent.length).toBeGreaterThan(0);
      const statusPath = path.join(opencodeHome, 'state', 'spanory', 'plugin-status.json');
      const status = JSON.parse(await readFile(statusPath, 'utf-8'));
      expect(status.endpointConfigured).toBe(true);
      const logPath = path.join(opencodeHome, 'state', 'spanory', 'plugin.log');
      const logRaw = await readFile(logPath, 'utf-8');
      expect(logRaw).toContain('event=env_loaded');
      expect(logRaw).toContain('event=otlp_sent');
    } finally {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
      if (prevOpencodeHome === undefined) delete process.env.SPANORY_OPENCODE_HOME;
      else process.env.SPANORY_OPENCODE_HOME = prevOpencodeHome;
      if (prevSpool === undefined) delete process.env.SPANORY_OPENCODE_SPOOL_DIR;
      else process.env.SPANORY_OPENCODE_SPOOL_DIR = prevSpool;
      if (prevEndpoint === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = prevEndpoint;
      if (prevHeaders === undefined) delete process.env.OTEL_EXPORTER_OTLP_HEADERS;
      else process.env.OTEL_EXPORTER_OTLP_HEADERS = prevHeaders;
      if (prevFlushMode === undefined) delete process.env.SPANORY_OPENCODE_FLUSH_MODE;
      else process.env.SPANORY_OPENCODE_FLUSH_MODE = prevFlushMode;
    }
  });

  it('diagnostics: writes plugin.log when endpoint is missing', async () => {
    const prevHome = process.env.HOME;
    const prevOpencodeHome = process.env.SPANORY_OPENCODE_HOME;
    const prevSpool = process.env.SPANORY_OPENCODE_SPOOL_DIR;
    const prevEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const prevHeaders = process.env.OTEL_EXPORTER_OTLP_HEADERS;
    const prevFlushMode = process.env.SPANORY_OPENCODE_FLUSH_MODE;

    const fakeHome = await mkdtemp(path.join(os.tmpdir(), 'spanory-opencode-log-home-'));
    const opencodeHome = await mkdtemp(path.join(os.tmpdir(), 'spanory-opencode-log-runtime-'));
    process.env.HOME = fakeHome;
    process.env.SPANORY_OPENCODE_HOME = opencodeHome;
    process.env.SPANORY_OPENCODE_SPOOL_DIR = path.join(opencodeHome, 'state', 'spanory', 'spool');
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_HEADERS;
    delete process.env.SPANORY_OPENCODE_FLUSH_MODE;

    try {
      const fixtures = {
        sessionInfo: await loadFixture('session-info.json'),
        sessionMessages: await loadFixture('session-messages.json'),
      };

      const runtime = createOpencodeSpanoryPluginRuntime({
        logger: { warn: () => {} },
        client: mockClient(fixtures),
        autoLoadUserEnv: true,
      });

      await runtime.onEvent({
        type: 'session.completed',
        properties: { sessionID: 'session-op-1' },
      });
      await runtime.onGatewayStop();

      const statusPath = path.join(opencodeHome, 'state', 'spanory', 'plugin-status.json');
      const status = JSON.parse(await readFile(statusPath, 'utf-8'));
      expect(status.endpointConfigured).toBe(false);
      expect(status.reason).toBe('otlp_endpoint_unset');

      const logPath = path.join(opencodeHome, 'state', 'spanory', 'plugin.log');
      const logRaw = await readFile(logPath, 'utf-8');
      expect(logRaw).toContain('event=otlp_skip_endpoint_unset');
    } finally {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
      if (prevOpencodeHome === undefined) delete process.env.SPANORY_OPENCODE_HOME;
      else process.env.SPANORY_OPENCODE_HOME = prevOpencodeHome;
      if (prevSpool === undefined) delete process.env.SPANORY_OPENCODE_SPOOL_DIR;
      else process.env.SPANORY_OPENCODE_SPOOL_DIR = prevSpool;
      if (prevEndpoint === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = prevEndpoint;
      if (prevHeaders === undefined) delete process.env.OTEL_EXPORTER_OTLP_HEADERS;
      else process.env.OTEL_EXPORTER_OTLP_HEADERS = prevHeaders;
      if (prevFlushMode === undefined) delete process.env.SPANORY_OPENCODE_FLUSH_MODE;
      else process.env.SPANORY_OPENCODE_FLUSH_MODE = prevFlushMode;
    }
  });

  it('contract: flushes session.idle and writes status without endpoint', async () => {
    const prevHome = process.env.SPANORY_OPENCODE_HOME;
    const prevSpool = process.env.SPANORY_OPENCODE_SPOOL_DIR;
    const prevEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const prevFlushMode = process.env.SPANORY_OPENCODE_FLUSH_MODE;

    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'spanory-opencode-plugin-'));
    process.env.SPANORY_OPENCODE_HOME = tempRoot;
    process.env.SPANORY_OPENCODE_SPOOL_DIR = path.join(tempRoot, 'state', 'spanory', 'spool');
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.SPANORY_OPENCODE_FLUSH_MODE;

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
      if (prevFlushMode === undefined) delete process.env.SPANORY_OPENCODE_FLUSH_MODE;
      else process.env.SPANORY_OPENCODE_FLUSH_MODE = prevFlushMode;
    }
  });

  it('contract: flushes session.completed and writes status without endpoint', async () => {
    const prevHome = process.env.SPANORY_OPENCODE_HOME;
    const prevSpool = process.env.SPANORY_OPENCODE_SPOOL_DIR;
    const prevEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const prevFlushMode = process.env.SPANORY_OPENCODE_FLUSH_MODE;

    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'spanory-opencode-plugin-'));
    process.env.SPANORY_OPENCODE_HOME = tempRoot;
    process.env.SPANORY_OPENCODE_SPOOL_DIR = path.join(tempRoot, 'state', 'spanory', 'spool');
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.SPANORY_OPENCODE_FLUSH_MODE;

    try {
      const fixtures = {
        sessionInfo: await loadFixture('session-info.json'),
        sessionMessages: await loadFixture('session-messages.json'),
      };

      const runtime = createOpencodeSpanoryPluginRuntime({
        logger: { warn: () => {} },
        client: mockClient(fixtures),
      });

      await runtime.onEvent({
        type: 'session.completed',
        properties: { sessionID: 'session-op-1' },
      });
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
      if (prevFlushMode === undefined) delete process.env.SPANORY_OPENCODE_FLUSH_MODE;
      else process.env.SPANORY_OPENCODE_FLUSH_MODE = prevFlushMode;
    }
  });

  it('contract: flushes turn.completed by default turn mode', async () => {
    const prevHome = process.env.SPANORY_OPENCODE_HOME;
    const prevSpool = process.env.SPANORY_OPENCODE_SPOOL_DIR;
    const prevEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const prevFlushMode = process.env.SPANORY_OPENCODE_FLUSH_MODE;

    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'spanory-opencode-plugin-'));
    process.env.SPANORY_OPENCODE_HOME = tempRoot;
    process.env.SPANORY_OPENCODE_SPOOL_DIR = path.join(tempRoot, 'state', 'spanory', 'spool');
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.SPANORY_OPENCODE_FLUSH_MODE;

    try {
      const fixtures = {
        sessionInfo: await loadFixture('session-info.json'),
        sessionMessages: await loadFixture('session-messages.json'),
      };

      const runtime = createOpencodeSpanoryPluginRuntime({
        logger: { warn: () => {} },
        client: mockClient(fixtures),
      });

      await runtime.onEvent({
        type: 'turn.completed',
        properties: { sessionID: 'session-op-1' },
      });
      await runtime.onGatewayStop();

      const statusPath = path.join(tempRoot, 'state', 'spanory', 'plugin-status.json');
      const status = JSON.parse(await readFile(statusPath, 'utf-8'));
      expect(status.lastSuccessAt).toBeTruthy();
      expect(status.lastTriggerEvent).toBe('turn.completed');
      expect(status.flushMode).toBe('turn');
    } finally {
      if (prevHome === undefined) delete process.env.SPANORY_OPENCODE_HOME;
      else process.env.SPANORY_OPENCODE_HOME = prevHome;
      if (prevSpool === undefined) delete process.env.SPANORY_OPENCODE_SPOOL_DIR;
      else process.env.SPANORY_OPENCODE_SPOOL_DIR = prevSpool;
      if (prevEndpoint === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = prevEndpoint;
      if (prevFlushMode === undefined) delete process.env.SPANORY_OPENCODE_FLUSH_MODE;
      else process.env.SPANORY_OPENCODE_FLUSH_MODE = prevFlushMode;
    }
  });

  it('config: session mode defers turn event flush until gateway stop', async () => {
    const prevHome = process.env.SPANORY_OPENCODE_HOME;
    const prevSpool = process.env.SPANORY_OPENCODE_SPOOL_DIR;
    const prevEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const prevFlushMode = process.env.SPANORY_OPENCODE_FLUSH_MODE;

    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'spanory-opencode-plugin-'));
    process.env.SPANORY_OPENCODE_HOME = tempRoot;
    process.env.SPANORY_OPENCODE_SPOOL_DIR = path.join(tempRoot, 'state', 'spanory', 'spool');
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    process.env.SPANORY_OPENCODE_FLUSH_MODE = 'session';

    try {
      const fixtures = {
        sessionInfo: await loadFixture('session-info.json'),
        sessionMessages: await loadFixture('session-messages.json'),
      };

      const runtime = createOpencodeSpanoryPluginRuntime({
        logger: { warn: () => {} },
        client: mockClient(fixtures),
      });

      await runtime.onEvent({
        type: 'turn.completed',
        properties: { sessionID: 'session-op-1' },
      });

      const statusPath = path.join(tempRoot, 'state', 'spanory', 'plugin-status.json');
      await expect(readFile(statusPath, 'utf-8')).rejects.toThrow();

      await runtime.onGatewayStop();

      const status = JSON.parse(await readFile(statusPath, 'utf-8'));
      expect(status.lastSuccessAt).toBeTruthy();
      expect(status.lastTriggerEvent).toBe('gateway.stop');
      expect(status.flushMode).toBe('session');
    } finally {
      if (prevHome === undefined) delete process.env.SPANORY_OPENCODE_HOME;
      else process.env.SPANORY_OPENCODE_HOME = prevHome;
      if (prevSpool === undefined) delete process.env.SPANORY_OPENCODE_SPOOL_DIR;
      else process.env.SPANORY_OPENCODE_SPOOL_DIR = prevSpool;
      if (prevEndpoint === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = prevEndpoint;
      if (prevFlushMode === undefined) delete process.env.SPANORY_OPENCODE_FLUSH_MODE;
      else process.env.SPANORY_OPENCODE_FLUSH_MODE = prevFlushMode;
    }
  });

  it('spool: persists failed payload then flushes on recovery', async () => {
    const prevHome = process.env.SPANORY_OPENCODE_HOME;
    const prevSpool = process.env.SPANORY_OPENCODE_SPOOL_DIR;
    const prevEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const prevRetry = process.env.SPANORY_OPENCODE_RETRY_MAX;
    const prevFlushMode = process.env.SPANORY_OPENCODE_FLUSH_MODE;

    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'spanory-opencode-plugin-'));
    process.env.SPANORY_OPENCODE_HOME = tempRoot;
    process.env.SPANORY_OPENCODE_SPOOL_DIR = path.join(tempRoot, 'state', 'spanory', 'spool');
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://127.0.0.1:4318/v1/traces';
    process.env.SPANORY_OPENCODE_RETRY_MAX = '1';
    delete process.env.SPANORY_OPENCODE_FLUSH_MODE;

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
      if (prevFlushMode === undefined) delete process.env.SPANORY_OPENCODE_FLUSH_MODE;
      else process.env.SPANORY_OPENCODE_FLUSH_MODE = prevFlushMode;
    }
  });

  it('reports reasoning as separate span and keeps turn output final-only', async () => {
    const prevHome = process.env.SPANORY_OPENCODE_HOME;
    const prevSpool = process.env.SPANORY_OPENCODE_SPOOL_DIR;
    const prevEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const prevFlushMode = process.env.SPANORY_OPENCODE_FLUSH_MODE;

    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'spanory-opencode-plugin-'));
    process.env.SPANORY_OPENCODE_HOME = tempRoot;
    process.env.SPANORY_OPENCODE_SPOOL_DIR = path.join(tempRoot, 'state', 'spanory', 'spool');
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://127.0.0.1:4318/v1/traces';
    delete process.env.SPANORY_OPENCODE_FLUSH_MODE;

    try {
      const sessionMessages = await loadFixture('session-messages.json');
      sessionMessages[1].parts.unshift({
        id: 'part-a-reasoning-1',
        sessionID: 'session-op-1',
        messageID: 'msg-a-1',
        type: 'reasoning',
        text: '先分析命令是否安全，再执行。',
        time: {
          start: 1700000001100,
          end: 1700000001150,
        },
      });

      const fixtures = {
        idleEvent: await loadFixture('session-idle-event.json'),
        sessionInfo: await loadFixture('session-info.json'),
        sessionMessages,
      };

      const sent = [];
      const runtime = createOpencodeSpanoryPluginRuntime({
        logger: { warn: () => {} },
        client: mockClient(fixtures),
        sendOtlpHttp: async (_endpoint, payload) => {
          sent.push(payload);
        },
      });

      await runtime.onEvent(fixtures.idleEvent);
      await runtime.onGatewayStop();

      expect(sent.length).toBe(1);
      const spans = sent[0]?.resourceSpans?.[0]?.scopeSpans?.[0]?.spans ?? [];

      const turnSpan = spans.find((span) => readOtlpAttr(span, 'agentic.event.category') === 'turn');
      const reasoningSpan = spans.find((span) => readOtlpAttr(span, 'agentic.event.category') === 'reasoning');
      expect(turnSpan).toBeTruthy();
      expect(reasoningSpan).toBeTruthy();
      expect(readOtlpAttr(turnSpan, 'langfuse.observation.output')).toBe('我来执行这个命令。');
      expect(readOtlpAttr(turnSpan, 'langfuse.observation.output')).not.toContain('先分析命令是否安全');
      expect(readOtlpAttr(reasoningSpan, 'langfuse.observation.output')).toBe('先分析命令是否安全，再执行。');
      expect(readOtlpAttr(reasoningSpan, 'langfuse.observation.type')).toBe('span');
    } finally {
      if (prevHome === undefined) delete process.env.SPANORY_OPENCODE_HOME;
      else process.env.SPANORY_OPENCODE_HOME = prevHome;
      if (prevSpool === undefined) delete process.env.SPANORY_OPENCODE_SPOOL_DIR;
      else process.env.SPANORY_OPENCODE_SPOOL_DIR = prevSpool;
      if (prevEndpoint === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = prevEndpoint;
      if (prevFlushMode === undefined) delete process.env.SPANORY_OPENCODE_FLUSH_MODE;
      else process.env.SPANORY_OPENCODE_FLUSH_MODE = prevFlushMode;
    }
  });
});
