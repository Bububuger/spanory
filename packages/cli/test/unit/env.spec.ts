import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import { loadUserEnv, parseSimpleDotEnv } from '../../src/env.ts';

describe('env helpers', () => {
  it('parses plain and export-prefixed .env lines', () => {
    const parsed = parseSimpleDotEnv(`
# comment
OTEL_EXPORTER_OTLP_ENDPOINT=https://cloud.langfuse.com/api/public/otel/v1/traces
export OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic abc123
SPANORY_ENV="production"
KEY_WITH_COMMENT=value # trailing comment
`);

    expect(parsed.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(
      'https://cloud.langfuse.com/api/public/otel/v1/traces',
    );
    expect(parsed.OTEL_EXPORTER_OTLP_HEADERS).toBe('Authorization=Basic abc123');
    expect(parsed.SPANORY_ENV).toBe('production');
    expect(parsed.KEY_WITH_COMMENT).toBe('value');
  });

  it('loads ~/.spanory/.env without overriding already-defined process env', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'spanory-env-'));
    try {
      await writeFile(path.join(tmp, '.env'), 'OTEL_EXPORTER_OTLP_ENDPOINT=https://legacy-ignored\n', 'utf-8');
      const spanoryRoot = path.join(tmp, '.spanory');
      await mkdir(spanoryRoot, { recursive: true });
      await writeFile(
        path.join(spanoryRoot, '.env'),
        [
          'export OTEL_EXPORTER_OTLP_ENDPOINT=https://from-env-file',
          'OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic from-file',
        ].join('\n'),
        'utf-8',
      );

      const oldHome = process.env.HOME;
      const oldHeaders = process.env.OTEL_EXPORTER_OTLP_HEADERS;
      const oldEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      try {
        process.env.HOME = tmp;
        process.env.OTEL_EXPORTER_OTLP_HEADERS = 'Authorization=Basic existing';
        delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

        await loadUserEnv();

        expect(process.env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe('https://from-env-file');
        expect(process.env.OTEL_EXPORTER_OTLP_HEADERS).toBe('Authorization=Basic existing');
      } finally {
        if (oldHome === undefined) delete process.env.HOME;
        else process.env.HOME = oldHome;
        if (oldHeaders === undefined) delete process.env.OTEL_EXPORTER_OTLP_HEADERS;
        else process.env.OTEL_EXPORTER_OTLP_HEADERS = oldHeaders;
        if (oldEndpoint === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
        else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = oldEndpoint;
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
      vi.unstubAllEnvs();
    }
  });

  it('does not load legacy ~/.env by default when ~/.spanory/.env is empty', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'spanory-env-'));
    try {
      await writeFile(path.join(tmp, '.env'), 'OTEL_EXPORTER_OTLP_ENDPOINT=https://legacy-fallback\n', 'utf-8');

      const oldHome = process.env.HOME;
      const oldSpanoryHome = process.env.SPANORY_HOME;
      const oldEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      try {
        process.env.HOME = tmp;
        delete process.env.SPANORY_HOME;
        delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

        await loadUserEnv();

        expect(process.env.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
      } finally {
        if (oldHome === undefined) delete process.env.HOME;
        else process.env.HOME = oldHome;
        if (oldSpanoryHome === undefined) delete process.env.SPANORY_HOME;
        else process.env.SPANORY_HOME = oldSpanoryHome;
        if (oldEndpoint === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
        else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = oldEndpoint;
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
      vi.unstubAllEnvs();
    }
  });

  it('loads legacy ~/.env only when explicit fallback opt-in is enabled', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'spanory-env-'));
    try {
      await writeFile(path.join(tmp, '.env'), 'OTEL_EXPORTER_OTLP_ENDPOINT=https://legacy-fallback\n', 'utf-8');

      const oldHome = process.env.HOME;
      const oldSpanoryHome = process.env.SPANORY_HOME;
      const oldLegacyFallback = process.env.SPANORY_LEGACY_USER_ENV_FALLBACK;
      const oldEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      try {
        process.env.HOME = tmp;
        delete process.env.SPANORY_HOME;
        process.env.SPANORY_LEGACY_USER_ENV_FALLBACK = '1';
        delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

        await loadUserEnv();

        expect(process.env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe('https://legacy-fallback');
      } finally {
        if (oldHome === undefined) delete process.env.HOME;
        else process.env.HOME = oldHome;
        if (oldSpanoryHome === undefined) delete process.env.SPANORY_HOME;
        else process.env.SPANORY_HOME = oldSpanoryHome;
        if (oldLegacyFallback === undefined) delete process.env.SPANORY_LEGACY_USER_ENV_FALLBACK;
        else process.env.SPANORY_LEGACY_USER_ENV_FALLBACK = oldLegacyFallback;
        if (oldEndpoint === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
        else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = oldEndpoint;
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
      vi.unstubAllEnvs();
    }
  });
});
