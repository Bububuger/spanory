import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createOpenclawSpanoryPluginRuntime } from '../../../openclaw-plugin/src/index.js';

describe('openclaw plugin runtime', () => {
  it('handles llm/tool/session hooks without endpoint and writes status', async () => {
    const prevHome = process.env.SPANORY_OPENCLAW_HOME;
    const prevSpool = process.env.SPANORY_OPENCLAW_SPOOL_DIR;
    const prevEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'spanory-openclaw-plugin-'));
    process.env.SPANORY_OPENCLAW_HOME = tempRoot;
    process.env.SPANORY_OPENCLAW_SPOOL_DIR = path.join(tempRoot, 'state', 'spanory', 'spool');
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

    try {
      const runtime = createOpenclawSpanoryPluginRuntime({
        warn: () => {},
      });

      runtime.onLlmInput(
        { prompt: 'hello' },
        { sessionKey: 'agent:main:test-session', agentId: 'main', sessionId: 'test-session' },
      );
      runtime.onLlmOutput(
        {
          model: 'openclaw-pro',
          assistantTexts: ['hi'],
          usage: { input: 5, output: 3, total: 8 },
        },
        { sessionKey: 'agent:main:test-session', agentId: 'main', sessionId: 'test-session' },
      );
      runtime.onAfterToolCall(
        {
          toolName: 'Bash',
          params: { command: 'pwd' },
          result: { stdout: '/tmp' },
        },
        { sessionKey: 'agent:main:test-session', agentId: 'main', sessionId: 'test-session' },
      );

      await runtime.onSessionEnd(
        {},
        { sessionKey: 'agent:main:test-session', agentId: 'main', sessionId: 'test-session' },
      );
      await runtime.onGatewayStop();

      const statusPath = path.join(tempRoot, 'state', 'spanory', 'plugin-status.json');
      const raw = await readFile(statusPath, 'utf-8');
      const status = JSON.parse(raw);
      expect(status.pluginId).toBe('spanory-openclaw-plugin');
      expect(status.lastSuccessAt).toBeTruthy();
    } finally {
      if (prevHome === undefined) delete process.env.SPANORY_OPENCLAW_HOME;
      else process.env.SPANORY_OPENCLAW_HOME = prevHome;
      if (prevSpool === undefined) delete process.env.SPANORY_OPENCLAW_SPOOL_DIR;
      else process.env.SPANORY_OPENCLAW_SPOOL_DIR = prevSpool;
      if (prevEndpoint === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = prevEndpoint;
    }
  });
});
