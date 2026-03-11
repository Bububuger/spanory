import { mkdtempSync, readFileSync, existsSync, mkdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

const entry = path.resolve('dist/index.js');
const cleanEnv = {
  ...process.env,
  OTEL_EXPORTER_OTLP_ENDPOINT: '',
  OTEL_EXPORTER_OTLP_HEADERS: '',
};

describe('BDD codex hook ingestion', () => {
  it('Given codex notify payload, When hook runs in last-turn-only mode, Then the notify turn is exported', () => {
    const fakeHome = mkdtempSync(path.join(tmpdir(), 'spanory-codex-home-'));
    const sessionRoot = path.join(fakeHome, '.codex', 'sessions', '2026', '03', '03');
    mkdirSync(sessionRoot, { recursive: true });
    const fixture = path.resolve('test/fixtures/codex/sessions/session-a.jsonl');
    const transcript = path.join(sessionRoot, 'session-a.jsonl');
    cpSync(fixture, transcript);

    const exportDir = mkdtempSync(path.join(tmpdir(), 'spanory-codex-hook-'));
    const payload = JSON.stringify({
      type: 'agent-turn-complete',
      thread_id: 'session-a',
      turn_id: 'turn-codex-2',
      cwd: '/Users/me/workspace/demo',
    });

    execFileSync(
      'node',
      [entry, 'runtime', 'codex', 'hook', '--last-turn-only', '--export-json-dir', exportDir],
      { input: payload, env: { ...cleanEnv, HOME: fakeHome } },
    );

    const outFile = path.join(exportDir, 'session-a.json');
    expect(existsSync(outFile)).toBe(true);
    const data = JSON.parse(readFileSync(outFile, 'utf8'));
    expect(data.context.sessionId).toBe('session-a');
    expect(data.context.projectId).toBe('demo-3278dbdbc4');
    expect(new Set(data.events.map((event) => event.turnId))).toEqual(new Set(['turn-codex-2']));
    const turn = data.events.find((event) => event.category === 'turn');
    expect(turn.input).toContain('第二轮问题');
  });
});
