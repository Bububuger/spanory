import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const entry = path.resolve('dist/index.js');

describe('BDD public help surface', () => {
  it('Given public CLI help, When rendered, Then internal issue command is hidden', () => {
    const output = execFileSync('node', [entry, '--help']).toString('utf8');
    expect(output).not.toMatch(/^\s+issue\s+/m);
  });
});
