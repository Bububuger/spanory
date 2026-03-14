import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const entry = path.resolve('dist/index.js');

describe('BDD public help surface', () => {
  it('Given public CLI help, When rendered, Then internal issue command is hidden', () => {
    const output = execFileSync('node', [entry, '--help']).toString('utf8');
    expect(output).not.toMatch(/^\s+issue\s+/m);
  });

  it('Given version flags, When calling short options, Then -V works and -v is rejected', () => {
    const newFlagResult = spawnSync(process.execPath, [entry, '-V'], { encoding: 'utf-8' });
    const oldFlagResult = spawnSync(process.execPath, [entry, '-v'], { encoding: 'utf-8' });

    expect(newFlagResult.status).toBe(0);
    expect(newFlagResult.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    expect(oldFlagResult.status).toBe(1);
    expect(`${oldFlagResult.stdout}${oldFlagResult.stderr}`).toContain("unknown option '-v'");
  });
});
