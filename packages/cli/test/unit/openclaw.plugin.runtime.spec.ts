import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createOpenclawSpanoryPluginRuntime } from '../../../openclaw-plugin/src/index.ts';

describe('openclaw plugin runtime', () => {
  it('logs and drops unreadable spool files during flush', async () => {
    const prevHome = process.env.SPANORY_OPENCLAW_HOME;
    const prevSpool = process.env.SPANORY_OPENCLAW_SPOOL_DIR;
    const prevEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const prevFlushDelay = process.env.SPANORY_OPENCLAW_FLUSH_DELAY_MS;
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'spanory-openclaw-plugin-spool-parse-failure-'));
    const spoolDir = path.join(tempRoot, 'state', 'spanory', 'spool');
    process.env.SPANORY_OPENCLAW_HOME = tempRoot;
    process.env.SPANORY_OPENCLAW_SPOOL_DIR = spoolDir;
    process.env.SPANORY_OPENCLAW_FLUSH_DELAY_MS = '20';

    try {
      await mkdir(spoolDir, { recursive: true });
      const badSpoolName = 'bad-spool.json';
      await writeFile(path.join(spoolDir, badSpoolName), '{ bad json', 'utf-8');

      const payloads = [];
      const warnings = [];
      const server = createServer((req, res) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
          payloads.push(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
          res.statusCode = 200;
          res.end('ok');
        });
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const addr = server.address();
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `http://127.0.0.1:${addr.port}/otel`;

      const runtime = createOpenclawSpanoryPluginRuntime({
        warn: (message) => warnings.push(String(message)),
      });

      const ctx = {
        sessionKey: 'agent:main:spool-parse-failure-session',
        agentId: 'main',
        sessionId: 'spool-parse-failure-session',
      };
      runtime.onLlmInput({ prompt: 'flush spool' }, ctx);
      runtime.onLlmOutput(
        {
          model: 'openclaw-pro',
          assistantTexts: ['ok'],
          usage: { input: 1, output: 1, total: 2 },
        },
        ctx,
      );

      await new Promise((resolve) => setTimeout(resolve, 80));
      await runtime.onGatewayStop();
      await new Promise((resolve) => server.close(resolve));

      expect(payloads.length).toBeGreaterThan(0);
      expect(warnings.some((warn) => warn.includes('bad-spool.json'))).toBe(true);
      expect(warnings.some((warn) => warn.includes('SyntaxError'))).toBe(true);

      const spoolFiles = await readdir(spoolDir);
      expect(spoolFiles).not.toContain(badSpoolName);
    } finally {
      if (prevHome === undefined) delete process.env.SPANORY_OPENCLAW_HOME;
      else process.env.SPANORY_OPENCLAW_HOME = prevHome;
      if (prevSpool === undefined) delete process.env.SPANORY_OPENCLAW_SPOOL_DIR;
      else process.env.SPANORY_OPENCLAW_SPOOL_DIR = prevSpool;
      if (prevEndpoint === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = prevEndpoint;
      if (prevFlushDelay === undefined) delete process.env.SPANORY_OPENCLAW_FLUSH_DELAY_MS;
      else process.env.SPANORY_OPENCLAW_FLUSH_DELAY_MS = prevFlushDelay;
    }
  });

  it('flushes per turn without waiting for session_end and writes success status', async () => {
    const prevHome = process.env.SPANORY_OPENCLAW_HOME;
    const prevSpool = process.env.SPANORY_OPENCLAW_SPOOL_DIR;
    const prevEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const prevFlushDelay = process.env.SPANORY_OPENCLAW_FLUSH_DELAY_MS;
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'spanory-openclaw-plugin-'));
    process.env.SPANORY_OPENCLAW_HOME = tempRoot;
    process.env.SPANORY_OPENCLAW_SPOOL_DIR = path.join(tempRoot, 'state', 'spanory', 'spool');
    process.env.SPANORY_OPENCLAW_FLUSH_DELAY_MS = '20';

    try {
      let receivedPayload = null;
      const server = createServer((req, res) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
          receivedPayload = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
          res.statusCode = 200;
          res.end('ok');
        });
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const addr = server.address();
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `http://127.0.0.1:${addr.port}/otel`;

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
          toolCallId: 'call-basic-1',
          params: { command: 'pwd' },
          result: { stdout: '/tmp' },
        },
        { sessionKey: 'agent:main:test-session', agentId: 'main', sessionId: 'test-session' },
      );

      await new Promise((resolve) => setTimeout(resolve, 80));
      await runtime.onGatewayStop(); // keep deterministic queue drain
      await new Promise((resolve) => server.close(resolve));

      const statusPath = path.join(tempRoot, 'state', 'spanory', 'plugin-status.json');
      const raw = await readFile(statusPath, 'utf-8');
      const status = JSON.parse(raw);
      expect(status.pluginId).toBe('spanory-openclaw-plugin');
      expect(status.lastSuccessAt).toBeTruthy();
      expect(receivedPayload).toBeTruthy();
      const spans = receivedPayload.resourceSpans?.[0]?.scopeSpans?.[0]?.spans ?? [];
      expect(spans.length).toBeGreaterThanOrEqual(2);
    } finally {
      if (prevHome === undefined) delete process.env.SPANORY_OPENCLAW_HOME;
      else process.env.SPANORY_OPENCLAW_HOME = prevHome;
      if (prevSpool === undefined) delete process.env.SPANORY_OPENCLAW_SPOOL_DIR;
      else process.env.SPANORY_OPENCLAW_SPOOL_DIR = prevSpool;
      if (prevEndpoint === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = prevEndpoint;
      if (prevFlushDelay === undefined) delete process.env.SPANORY_OPENCLAW_FLUSH_DELAY_MS;
      else process.env.SPANORY_OPENCLAW_FLUSH_DELAY_MS = prevFlushDelay;
    }
  });

  it('keeps late tool callbacks on the originating turn after turn flush', async () => {
    const prevHome = process.env.SPANORY_OPENCLAW_HOME;
    const prevSpool = process.env.SPANORY_OPENCLAW_SPOOL_DIR;
    const prevEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const prevFlushDelay = process.env.SPANORY_OPENCLAW_FLUSH_DELAY_MS;
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'spanory-openclaw-plugin-late-tool-'));
    process.env.SPANORY_OPENCLAW_HOME = tempRoot;
    process.env.SPANORY_OPENCLAW_SPOOL_DIR = path.join(tempRoot, 'state', 'spanory', 'spool');
    process.env.SPANORY_OPENCLAW_FLUSH_DELAY_MS = '10';

    try {
      const payloads = [];
      const server = createServer((req, res) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
          payloads.push(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
          res.statusCode = 200;
          res.end('ok');
        });
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const addr = server.address();
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `http://127.0.0.1:${addr.port}/otel`;

      const runtime = createOpenclawSpanoryPluginRuntime({
        warn: () => {},
      });

      const ctx = {
        sessionKey: 'agent:main:late-tool-session',
        agentId: 'main',
        sessionId: 'late-tool-session',
      };

      runtime.onLlmInput({ prompt: 'first prompt' }, ctx);
      runtime.onLlmOutput(
        {
          model: 'openclaw-pro',
          assistantTexts: ['first answer'],
          usage: { input: 10, output: 5, total: 15 },
        },
        ctx,
      );

      await new Promise((resolve) => setTimeout(resolve, 40));

      runtime.onAfterToolCall(
        {
          toolName: 'Bash',
          toolCallId: 'call-late-1',
          params: { command: 'echo late-tool' },
          result: { stdout: 'late-tool' },
        },
        ctx,
      );

      runtime.onLlmInput({ prompt: 'second prompt' }, ctx);
      runtime.onLlmOutput(
        {
          model: 'openclaw-pro',
          assistantTexts: ['second answer'],
          usage: { input: 8, output: 4, total: 12 },
        },
        ctx,
      );

      await new Promise((resolve) => setTimeout(resolve, 60));
      await runtime.onGatewayStop();
      await new Promise((resolve) => server.close(resolve));

      const spans = payloads.flatMap((payload) => payload.resourceSpans?.[0]?.scopeSpans?.[0]?.spans ?? []);
      const toAttrMap = (span) => Object.fromEntries((span.attributes ?? []).map((a) => [a.key, a.value?.stringValue ?? a.value?.doubleValue ?? a.value?.boolValue]));

      const turnSpans = spans.filter((span) => span.name.startsWith('openclaw - Turn'));
      expect(turnSpans.length).toBeGreaterThanOrEqual(2);

      const firstTurnAttrs = toAttrMap(turnSpans[0]);
      const secondTurnAttrs = toAttrMap(turnSpans[1]);
      const firstTurnId = firstTurnAttrs['agentic.turn.id'];
      const secondTurnId = secondTurnAttrs['agentic.turn.id'];

      const bashSpan = spans.find((span) => span.name === 'Tool: Bash');
      expect(bashSpan).toBeTruthy();
      const bashAttrs = toAttrMap(bashSpan);
      expect(bashAttrs['agentic.turn.id']).toBe(firstTurnId);
      expect(bashAttrs['agentic.turn.id']).not.toBe(secondTurnId);
    } finally {
      if (prevHome === undefined) delete process.env.SPANORY_OPENCLAW_HOME;
      else process.env.SPANORY_OPENCLAW_HOME = prevHome;
      if (prevSpool === undefined) delete process.env.SPANORY_OPENCLAW_SPOOL_DIR;
      else process.env.SPANORY_OPENCLAW_SPOOL_DIR = prevSpool;
      if (prevEndpoint === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = prevEndpoint;
      if (prevFlushDelay === undefined) delete process.env.SPANORY_OPENCLAW_FLUSH_DELAY_MS;
      else process.env.SPANORY_OPENCLAW_FLUSH_DELAY_MS = prevFlushDelay;
    }
  });

  it('correlates tool callbacks by sessionId when hook sessionKey differs', async () => {
    const prevHome = process.env.SPANORY_OPENCLAW_HOME;
    const prevSpool = process.env.SPANORY_OPENCLAW_SPOOL_DIR;
    const prevEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const prevFlushDelay = process.env.SPANORY_OPENCLAW_FLUSH_DELAY_MS;
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'spanory-openclaw-plugin-sessionid-key-'));
    process.env.SPANORY_OPENCLAW_HOME = tempRoot;
    process.env.SPANORY_OPENCLAW_SPOOL_DIR = path.join(tempRoot, 'state', 'spanory', 'spool');
    process.env.SPANORY_OPENCLAW_FLUSH_DELAY_MS = '20';

    try {
      const payloads = [];
      const server = createServer((req, res) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
          payloads.push(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
          res.statusCode = 200;
          res.end('ok');
        });
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const addr = server.address();
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `http://127.0.0.1:${addr.port}/otel`;

      const runtime = createOpenclawSpanoryPluginRuntime({
        warn: () => {},
      });

      const ctxLlm = {
        sessionKey: 'agent:main:lane-llm',
        agentId: 'main',
        sessionId: 'sessionid-correlation',
      };
      const ctxTool = {
        sessionKey: 'agent:main:lane-tool',
        agentId: 'main',
        sessionId: 'sessionid-correlation',
      };

      runtime.onLlmInput({ prompt: 'prompt with key mismatch' }, ctxLlm);
      runtime.onAfterToolCall(
        {
          toolName: 'Bash',
          toolCallId: 'call-key-mismatch-1',
          params: { command: 'pwd' },
          result: { stdout: '/tmp' },
        },
        ctxTool,
      );
      runtime.onLlmOutput(
        {
          model: 'openclaw-pro',
          assistantTexts: ['done'],
          usage: { input: 6, output: 2, total: 8 },
        },
        ctxLlm,
      );

      await new Promise((resolve) => setTimeout(resolve, 60));
      await runtime.onGatewayStop();
      await new Promise((resolve) => server.close(resolve));

      const spans = payloads.flatMap((payload) => payload.resourceSpans?.[0]?.scopeSpans?.[0]?.spans ?? []);
      const toAttrMap = (span) => Object.fromEntries((span.attributes ?? []).map((a) => [a.key, a.value?.stringValue ?? a.value?.doubleValue ?? a.value?.boolValue]));

      const turnSpan = spans.find((span) => span.name.startsWith('openclaw - Turn'));
      const bashSpan = spans.find((span) => span.name === 'Tool: Bash');

      expect(turnSpan).toBeTruthy();
      expect(bashSpan).toBeTruthy();

      const turnAttrs = toAttrMap(turnSpan);
      const bashAttrs = toAttrMap(bashSpan);
      expect(bashAttrs['agentic.turn.id']).toBe(turnAttrs['agentic.turn.id']);
    } finally {
      if (prevHome === undefined) delete process.env.SPANORY_OPENCLAW_HOME;
      else process.env.SPANORY_OPENCLAW_HOME = prevHome;
      if (prevSpool === undefined) delete process.env.SPANORY_OPENCLAW_SPOOL_DIR;
      else process.env.SPANORY_OPENCLAW_SPOOL_DIR = prevSpool;
      if (prevEndpoint === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = prevEndpoint;
      if (prevFlushDelay === undefined) delete process.env.SPANORY_OPENCLAW_FLUSH_DELAY_MS;
      else process.env.SPANORY_OPENCLAW_FLUSH_DELAY_MS = prevFlushDelay;
    }
  });

  it('captures tool detail from tool_result_persist when after_tool_call lacks session context', async () => {
    const prevHome = process.env.SPANORY_OPENCLAW_HOME;
    const prevSpool = process.env.SPANORY_OPENCLAW_SPOOL_DIR;
    const prevEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const prevFlushDelay = process.env.SPANORY_OPENCLAW_FLUSH_DELAY_MS;
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'spanory-openclaw-plugin-tool-persist-'));
    process.env.SPANORY_OPENCLAW_HOME = tempRoot;
    process.env.SPANORY_OPENCLAW_SPOOL_DIR = path.join(tempRoot, 'state', 'spanory', 'spool');
    process.env.SPANORY_OPENCLAW_FLUSH_DELAY_MS = '20';

    try {
      const payloads = [];
      const server = createServer((req, res) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
          payloads.push(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
          res.statusCode = 200;
          res.end('ok');
        });
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const addr = server.address();
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `http://127.0.0.1:${addr.port}/otel`;

      const runtime = createOpenclawSpanoryPluginRuntime({
        warn: () => {},
      });

      const ctxLlm = {
        sessionKey: 'agent:main:persist-lane',
        agentId: 'main',
        sessionId: 'tool-persist-session',
      };

      runtime.onLlmInput({ prompt: 'run pwd' }, ctxLlm);
      runtime.onToolResultPersist(
        {
          toolName: 'exec',
          toolCallId: 'persist-call-1',
          message: {
            role: 'toolResult',
            content: [{ type: 'text', text: '/Users/javis/Documents/workspace/openclaw' }],
            details: { status: 'completed', exitCode: 0 },
          },
        },
        {
          sessionKey: 'agent:main:persist-lane',
          toolName: 'exec',
          toolCallId: 'persist-call-1',
          agentId: 'main',
        },
      );
      runtime.onLlmOutput(
        {
          model: 'openclaw-pro',
          assistantTexts: ['/Users/javis/Documents/workspace/openclaw'],
          usage: { input: 5, output: 2, total: 7 },
        },
        ctxLlm,
      );

      await new Promise((resolve) => setTimeout(resolve, 80));
      await runtime.onGatewayStop();
      await new Promise((resolve) => server.close(resolve));

      const spans = payloads.flatMap((payload) => payload.resourceSpans?.[0]?.scopeSpans?.[0]?.spans ?? []);
      const toAttrMap = (span) => Object.fromEntries((span.attributes ?? []).map((a) => [a.key, a.value?.stringValue ?? a.value?.doubleValue ?? a.value?.boolValue]));

      const turnSpan = spans.find((span) => span.name.startsWith('openclaw - Turn'));
      const bashSpan = spans.find((span) => span.name === 'Tool: Bash');

      expect(turnSpan).toBeTruthy();
      expect(bashSpan).toBeTruthy();

      const turnAttrs = toAttrMap(turnSpan);
      const bashAttrs = toAttrMap(bashSpan);
      expect(bashAttrs['agentic.turn.id']).toBe(turnAttrs['agentic.turn.id']);
    } finally {
      if (prevHome === undefined) delete process.env.SPANORY_OPENCLAW_HOME;
      else process.env.SPANORY_OPENCLAW_HOME = prevHome;
      if (prevSpool === undefined) delete process.env.SPANORY_OPENCLAW_SPOOL_DIR;
      else process.env.SPANORY_OPENCLAW_SPOOL_DIR = prevSpool;
      if (prevEndpoint === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = prevEndpoint;
      if (prevFlushDelay === undefined) delete process.env.SPANORY_OPENCLAW_FLUSH_DELAY_MS;
      else process.env.SPANORY_OPENCLAW_FLUSH_DELAY_MS = prevFlushDelay;
    }
  });

  it('captures tool detail via before_message_write when after_tool_call has no session context', async () => {
    const prevHome = process.env.SPANORY_OPENCLAW_HOME;
    const prevSpool = process.env.SPANORY_OPENCLAW_SPOOL_DIR;
    const prevEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const prevFlushDelay = process.env.SPANORY_OPENCLAW_FLUSH_DELAY_MS;
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'spanory-openclaw-plugin-before-write-'));
    process.env.SPANORY_OPENCLAW_HOME = tempRoot;
    process.env.SPANORY_OPENCLAW_SPOOL_DIR = path.join(tempRoot, 'state', 'spanory', 'spool');
    process.env.SPANORY_OPENCLAW_FLUSH_DELAY_MS = '20';

    try {
      const payloads = [];
      const server = createServer((req, res) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
          payloads.push(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
          res.statusCode = 200;
          res.end('ok');
        });
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const addr = server.address();
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `http://127.0.0.1:${addr.port}/otel`;

      const runtime = createOpenclawSpanoryPluginRuntime({
        warn: () => {},
      });

      const ctxLlm = {
        sessionKey: 'agent:main:before-write-main',
        agentId: 'main',
        sessionId: 'before-write-session',
      };
      const ctxWrite = {
        sessionKey: 'agent:main:before-write-detached',
        agentId: 'main',
      };

      runtime.onLlmInput({ prompt: 'run pwd' }, ctxLlm);
      runtime.onLlmOutput(
        {
          model: 'openclaw-pro',
          assistantTexts: ['running'],
          usage: { input: 5, output: 2, total: 7 },
        },
        ctxLlm,
      );

      runtime.onBeforeMessageWrite(
        {
          message: {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'call-before-write-1',
                name: 'exec',
                arguments: { command: 'pwd' },
              },
            ],
          },
        },
        ctxWrite,
      );
      runtime.onBeforeMessageWrite(
        {
          message: {
            role: 'toolResult',
            toolCallId: 'call-before-write-1',
            toolName: 'exec',
            content: [{ type: 'text', text: '/tmp' }],
            details: { aggregated: '/tmp' },
          },
        },
        ctxWrite,
      );

      await new Promise((resolve) => setTimeout(resolve, 80));
      await runtime.onGatewayStop();
      await new Promise((resolve) => server.close(resolve));

      const spans = payloads.flatMap((payload) => payload.resourceSpans?.[0]?.scopeSpans?.[0]?.spans ?? []);
      const toAttrMap = (span) => Object.fromEntries((span.attributes ?? []).map((a) => [a.key, a.value?.stringValue ?? a.value?.doubleValue ?? a.value?.boolValue]));

      const turnSpan = spans.find((span) => span.name.startsWith('openclaw - Turn'));
      const bashSpan = spans.find((span) => span.name === 'Tool: Bash');

      expect(turnSpan).toBeTruthy();
      expect(bashSpan).toBeTruthy();
      expect(bashSpan.attributes).toBeTruthy();
      expect(bashSpan.name).toBe('Tool: Bash');

      const turnAttrs = toAttrMap(turnSpan);
      const bashAttrs = toAttrMap(bashSpan);
      expect(bashAttrs['agentic.turn.id']).toBe(turnAttrs['agentic.turn.id']);
      expect(bashAttrs['gen_ai.tool.call.id']).toBe('call-before-write-1');
    } finally {
      if (prevHome === undefined) delete process.env.SPANORY_OPENCLAW_HOME;
      else process.env.SPANORY_OPENCLAW_HOME = prevHome;
      if (prevSpool === undefined) delete process.env.SPANORY_OPENCLAW_SPOOL_DIR;
      else process.env.SPANORY_OPENCLAW_SPOOL_DIR = prevSpool;
      if (prevEndpoint === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = prevEndpoint;
      if (prevFlushDelay === undefined) delete process.env.SPANORY_OPENCLAW_FLUSH_DELAY_MS;
      else process.env.SPANORY_OPENCLAW_FLUSH_DELAY_MS = prevFlushDelay;
    }
  });

  it('merges tool-loop llm outputs into one turn to keep input/output aligned', async () => {
    const prevHome = process.env.SPANORY_OPENCLAW_HOME;
    const prevSpool = process.env.SPANORY_OPENCLAW_SPOOL_DIR;
    const prevEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const prevFlushDelay = process.env.SPANORY_OPENCLAW_FLUSH_DELAY_MS;
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'spanory-openclaw-plugin-turn-merge-'));
    process.env.SPANORY_OPENCLAW_HOME = tempRoot;
    process.env.SPANORY_OPENCLAW_SPOOL_DIR = path.join(tempRoot, 'state', 'spanory', 'spool');
    process.env.SPANORY_OPENCLAW_FLUSH_DELAY_MS = '20';

    try {
      const payloads = [];
      const server = createServer((req, res) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
          payloads.push(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
          res.statusCode = 200;
          res.end('ok');
        });
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const addr = server.address();
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `http://127.0.0.1:${addr.port}/otel`;

      const runtime = createOpenclawSpanoryPluginRuntime({
        warn: () => {},
      });

      const ctx = {
        sessionKey: 'agent:main:turn-merge-session',
        agentId: 'main',
        sessionId: 'turn-merge-session',
      };

      runtime.onLlmInput({ prompt: '请执行 pwd 并告诉我结果' }, ctx);
      runtime.onLlmOutput(
        {
          model: 'openclaw-pro',
          assistantTexts: [],
          usage: { input: 6, output: 1, total: 7 },
        },
        ctx,
      );
      runtime.onAfterToolCall(
        {
          toolName: 'Bash',
          toolCallId: 'call-turn-merge-1',
          params: { command: 'pwd' },
          result: { stdout: '/tmp' },
        },
        ctx,
      );
      runtime.onLlmOutput(
        {
          model: 'openclaw-pro',
          assistantTexts: ['/tmp'],
          usage: { input: 2, output: 2, total: 4 },
        },
        ctx,
      );

      await new Promise((resolve) => setTimeout(resolve, 80));
      await runtime.onGatewayStop();
      await new Promise((resolve) => server.close(resolve));

      const spans = payloads.flatMap((payload) => payload.resourceSpans?.[0]?.scopeSpans?.[0]?.spans ?? []);
      const toAttrMap = (span) => Object.fromEntries((span.attributes ?? []).map((a) => [a.key, a.value?.stringValue ?? a.value?.doubleValue ?? a.value?.boolValue]));
      const turnSpans = spans.filter((span) => span.name.startsWith('openclaw - Turn'));
      const bashSpan = spans.find((span) => span.name === 'Tool: Bash');

      expect(turnSpans.length).toBe(1);
      expect(bashSpan).toBeTruthy();

      const turnAttrs = toAttrMap(turnSpans[0]);
      const bashAttrs = toAttrMap(bashSpan);
      expect(turnAttrs['langfuse.observation.input']).toBe('请执行 pwd 并告诉我结果');
      expect(turnAttrs['langfuse.observation.output']).toBe('/tmp');
      expect(bashAttrs['agentic.turn.id']).toBe(turnAttrs['agentic.turn.id']);
    } finally {
      if (prevHome === undefined) delete process.env.SPANORY_OPENCLAW_HOME;
      else process.env.SPANORY_OPENCLAW_HOME = prevHome;
      if (prevSpool === undefined) delete process.env.SPANORY_OPENCLAW_SPOOL_DIR;
      else process.env.SPANORY_OPENCLAW_SPOOL_DIR = prevSpool;
      if (prevEndpoint === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = prevEndpoint;
      if (prevFlushDelay === undefined) delete process.env.SPANORY_OPENCLAW_FLUSH_DELAY_MS;
      else process.env.SPANORY_OPENCLAW_FLUSH_DELAY_MS = prevFlushDelay;
    }
  });

  it('falls back to lastAssistant content when assistantTexts is empty', async () => {
    const prevHome = process.env.SPANORY_OPENCLAW_HOME;
    const prevSpool = process.env.SPANORY_OPENCLAW_SPOOL_DIR;
    const prevEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const prevFlushDelay = process.env.SPANORY_OPENCLAW_FLUSH_DELAY_MS;
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'spanory-openclaw-plugin-last-assistant-'));
    process.env.SPANORY_OPENCLAW_HOME = tempRoot;
    process.env.SPANORY_OPENCLAW_SPOOL_DIR = path.join(tempRoot, 'state', 'spanory', 'spool');
    process.env.SPANORY_OPENCLAW_FLUSH_DELAY_MS = '20';

    try {
      const payloads = [];
      const server = createServer((req, res) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
          payloads.push(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
          res.statusCode = 200;
          res.end('ok');
        });
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const addr = server.address();
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `http://127.0.0.1:${addr.port}/otel`;

      const runtime = createOpenclawSpanoryPluginRuntime({
        warn: () => {},
      });

      const ctx = {
        sessionKey: 'agent:main:last-assistant-session',
        agentId: 'main',
        sessionId: 'last-assistant-session',
      };

      runtime.onLlmInput({ prompt: '请告诉我当前目录' }, ctx);
      runtime.onLlmOutput(
        {
          model: 'openclaw-pro',
          assistantTexts: [],
          lastAssistant: {
            content: [
              { type: 'text', text: '当前目录是 /tmp' },
            ],
          },
          usage: { input: 4, output: 2, total: 6 },
        },
        ctx,
      );

      await new Promise((resolve) => setTimeout(resolve, 80));
      await runtime.onGatewayStop();
      await new Promise((resolve) => server.close(resolve));

      const spans = payloads.flatMap((payload) => payload.resourceSpans?.[0]?.scopeSpans?.[0]?.spans ?? []);
      const toAttrMap = (span) => Object.fromEntries((span.attributes ?? []).map((a) => [a.key, a.value?.stringValue ?? a.value?.doubleValue ?? a.value?.boolValue]));
      const turnSpans = spans.filter((span) => span.name.startsWith('openclaw - Turn'));

      expect(turnSpans.length).toBe(1);
      const turnAttrs = toAttrMap(turnSpans[0]);
      expect(turnAttrs['langfuse.observation.input']).toBe('请告诉我当前目录');
      expect(turnAttrs['langfuse.observation.output']).toBe('当前目录是 /tmp');
    } finally {
      if (prevHome === undefined) delete process.env.SPANORY_OPENCLAW_HOME;
      else process.env.SPANORY_OPENCLAW_HOME = prevHome;
      if (prevSpool === undefined) delete process.env.SPANORY_OPENCLAW_SPOOL_DIR;
      else process.env.SPANORY_OPENCLAW_SPOOL_DIR = prevSpool;
      if (prevEndpoint === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = prevEndpoint;
      if (prevFlushDelay === undefined) delete process.env.SPANORY_OPENCLAW_FLUSH_DELAY_MS;
      else process.env.SPANORY_OPENCLAW_FLUSH_DELAY_MS = prevFlushDelay;
    }
  });

  it('sanitizes gateway metadata wrapper from input and attaches runtime/input metadata attributes', async () => {
    const prevHome = process.env.SPANORY_OPENCLAW_HOME;
    const prevSpool = process.env.SPANORY_OPENCLAW_SPOOL_DIR;
    const prevEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const prevFlushDelay = process.env.SPANORY_OPENCLAW_FLUSH_DELAY_MS;
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'spanory-openclaw-plugin-input-metadata-'));
    process.env.SPANORY_OPENCLAW_HOME = tempRoot;
    process.env.SPANORY_OPENCLAW_SPOOL_DIR = path.join(tempRoot, 'state', 'spanory', 'spool');
    process.env.SPANORY_OPENCLAW_FLUSH_DELAY_MS = '20';

    try {
      const payloads = [];
      const server = createServer((req, res) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
          payloads.push(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
          res.statusCode = 200;
          res.end('ok');
        });
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const addr = server.address();
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `http://127.0.0.1:${addr.port}/otel`;

      const runtime = createOpenclawSpanoryPluginRuntime({
        warn: () => {},
      });

      const ctx = {
        sessionKey: 'agent:main:input-metadata-session',
        agentId: 'main',
        sessionId: 'input-metadata-session',
      };

      runtime.onLlmInput(
        {
          runtimeVersion: '2026.2.19-2',
          prompt: 'Conversation info (untrusted metadata):\n```json\n{\n  "message_id": "bdb36354-f616-480e-999f-eac0adff9729",\n  "sender": "gateway-client"\n}\n```\n\n[Tue 2026-03-03 04:29 GMT+8] 真实用户输入文本',
        },
        ctx,
      );
      runtime.onLlmOutput(
        {
          model: 'openclaw-pro',
          assistantTexts: ['收到'],
          usage: { input: 4, output: 1, total: 5 },
        },
        ctx,
      );

      await new Promise((resolve) => setTimeout(resolve, 80));
      await runtime.onGatewayStop();
      await new Promise((resolve) => server.close(resolve));

      const spans = payloads.flatMap((payload) => payload.resourceSpans?.[0]?.scopeSpans?.[0]?.spans ?? []);
      const toAttrMap = (span) => Object.fromEntries((span.attributes ?? []).map((a) => [a.key, a.value?.stringValue ?? a.value?.doubleValue ?? a.value?.boolValue]));
      const turnSpans = spans.filter((span) => span.name.startsWith('openclaw - Turn'));

      expect(turnSpans.length).toBe(1);
      const turnAttrs = toAttrMap(turnSpans[0]);
      expect(turnAttrs['langfuse.observation.input']).toBe('[Tue 2026-03-03 04:29 GMT+8] 真实用户输入文本');
      expect(turnAttrs['agentic.input.message_id']).toBe('bdb36354-f616-480e-999f-eac0adff9729');
      expect(turnAttrs['agentic.input.sender']).toBe('gateway-client');
      expect(turnAttrs['agentic.runtime.version']).toBe('2026.2.19-2');
    } finally {
      if (prevHome === undefined) delete process.env.SPANORY_OPENCLAW_HOME;
      else process.env.SPANORY_OPENCLAW_HOME = prevHome;
      if (prevSpool === undefined) delete process.env.SPANORY_OPENCLAW_SPOOL_DIR;
      else process.env.SPANORY_OPENCLAW_SPOOL_DIR = prevSpool;
      if (prevEndpoint === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = prevEndpoint;
      if (prevFlushDelay === undefined) delete process.env.SPANORY_OPENCLAW_FLUSH_DELAY_MS;
      else process.env.SPANORY_OPENCLAW_FLUSH_DELAY_MS = prevFlushDelay;
    }
  });
});
