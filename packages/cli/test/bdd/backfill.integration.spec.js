import { mkdtempSync, cpSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

const entry = path.resolve('src/index.js');

describe('BDD backfill replay', () => {
  it('Given project transcripts under ~/.claude/projects, When backfill dry-run runs, Then selected sessions are listed', () => {
    const fakeHome = mkdtempSync(path.join(tmpdir(), 'spanory-home-'));
    const projectRoot = path.join(fakeHome, '.claude', 'projects', 'test-project');
    mkdirSync(projectRoot, { recursive: true });

    const fixtureRoot = path.resolve('test/fixtures/claude/projects/test-project');
    cpSync(path.join(fixtureRoot, 'session-a.jsonl'), path.join(projectRoot, 'session-a.jsonl'));
    cpSync(path.join(fixtureRoot, 'session-b.jsonl'), path.join(projectRoot, 'session-b.jsonl'));

    const output = execFileSync(
      'node',
      [
        entry,
        'runtime',
        'claude-code',
        'backfill',
        '--project-id',
        'test-project',
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
});
