import { mkdtempSync, readFileSync, existsSync, mkdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

const entry = path.resolve('src/index.js');
const cleanEnv = {
  ...process.env,
  OTEL_EXPORTER_OTLP_ENDPOINT: '',
  OTEL_EXPORTER_OTLP_HEADERS: '',
  SPANORY_OTLP_ENDPOINT: '',
  SPANORY_OTLP_HEADERS: '',
};

describe('BDD hook ingestion', () => {
  it('Given SessionEnd payload, When hook command runs, Then session json is exported', () => {
    const fakeHome = mkdtempSync(path.join(tmpdir(), 'spanory-home-'));
    const projectDir = path.join(fakeHome, '.claude', 'projects', 'test-project');
    mkdirSync(projectDir, { recursive: true });
    const fixture = path.resolve('test/fixtures/claude/projects/test-project/session-a.jsonl');
    const transcript = path.join(projectDir, 'session-a.jsonl');
    cpSync(fixture, transcript);

    const exportDir = mkdtempSync(path.join(tmpdir(), 'spanory-hook-'));

    const payload = JSON.stringify({
      hook_event_name: 'SessionEnd',
      session_id: 'session-a',
      transcript_path: transcript,
    });

    execFileSync(
      'node',
      [entry, 'runtime', 'claude-code', 'hook', '--export-json-dir', exportDir],
      { input: payload, env: { ...cleanEnv, HOME: fakeHome } },
    );

    const outFile = path.join(exportDir, 'session-a.json');
    expect(existsSync(outFile)).toBe(true);
    const data = JSON.parse(readFileSync(outFile, 'utf8'));
    expect(data.context.sessionId).toBe('session-a');
  });

  it('Given malformed payload, When hook command runs, Then process fails', () => {
    expect(() => {
      execFileSync('node', [entry, 'runtime', 'claude-code', 'hook'], { input: '{not-json', env: cleanEnv });
    }).toThrowError();
  });
});
