import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

const entry = path.resolve('dist/index.js');

describe('BDD plugin command hierarchy', () => {
  it('shows install/doctor/uninstall as top-level commands', () => {
    const result = spawnSync(
      process.execPath,
      [entry, '--help'],
      { encoding: 'utf-8' },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('install');
    expect(result.stdout).toContain('doctor');
    expect(result.stdout).toContain('uninstall');
  });
});
