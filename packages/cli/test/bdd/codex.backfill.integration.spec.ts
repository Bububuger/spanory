import { mkdtempSync, cpSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

const entry = path.resolve('dist/index.js');

describe('BDD codex backfill', () => {
  it('Given codex sessions under ~/.codex/sessions, When backfill dry-run runs, Then selected sessions are listed', () => {
    const fakeHome = mkdtempSync(path.join(tmpdir(), 'spanory-codex-home-'));
    const sessionRoot = path.join(fakeHome, '.codex', 'sessions', '2026', '03', '03');
    mkdirSync(sessionRoot, { recursive: true });

    const fixtureRoot = path.resolve('test/fixtures/codex/sessions');
    cpSync(path.join(fixtureRoot, 'session-a.jsonl'), path.join(sessionRoot, 'session-a.jsonl'));
    cpSync(path.join(fixtureRoot, 'session-b.jsonl'), path.join(sessionRoot, 'session-b.jsonl'));

    const output = execFileSync(
      'node',
      [
        entry,
        'runtime',
        'codex',
        'backfill',
        '--project-id',
        'codex',
        '--limit',
        '2',
        '--dry-run',
      ],
      { env: { ...process.env, HOME: fakeHome } },
    ).toString('utf8');

    expect(output).toContain('backfill=selected count=2');
    expect(output).toContain('dry-run sessionId=session-a');
    expect(output).toContain('dry-run sessionId=session-b');
  });

  it('Given one missing session and one valid session, When backfill runs, Then it logs error and continues exporting remaining sessions', () => {
    const fakeHome = mkdtempSync(path.join(tmpdir(), 'spanory-codex-home-'));
    const codexHome = path.join(fakeHome, '.codex');
    const sessionRoot = path.join(codexHome, 'sessions', '2026', '03', '03');
    const exportDir = path.join(fakeHome, 'out');
    mkdirSync(sessionRoot, { recursive: true });

    const fixtureRoot = path.resolve('test/fixtures/codex/sessions');
    cpSync(path.join(fixtureRoot, 'session-a.jsonl'), path.join(sessionRoot, 'session-a.jsonl'));

    const output = execFileSync(
      'node',
      [
        entry,
        'runtime',
        'codex',
        'backfill',
        '--project-id',
        'codex',
        '--session-ids',
        'missing,session-a',
        '--runtime-home',
        codexHome,
        '--export-json-dir',
        exportDir,
      ],
      { env: process.env },
    ).toString('utf8');

    expect(output).toContain('backfill=selected count=2');
    expect(output).toContain('backfill=error sessionId=missing');
    expect(output).toContain('runtime=codex projectId=codex sessionId=session-a');
    expect(output).toContain('backfill=done selected=2 exported=1 skipped=1');
    expect(existsSync(path.join(exportDir, 'session-a.json'))).toBe(true);
  });
});
