import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

describe('--last-turn-only defaults', () => {
  it('uses true for all CLI entrypoints to avoid silent divergence', async () => {
    const source = await readFile(path.resolve('src/index.ts'), 'utf-8');
    const trueOption = ".option('--last-turn-only', 'Export only the newest turn and dedupe by turn fingerprint', true)";
    const falseOption = ".option('--last-turn-only', 'Export only the newest turn and dedupe by turn fingerprint', false)";
    const trueMatches = source.match(/\.option\('--last-turn-only', 'Export only the newest turn and dedupe by turn fingerprint', true\)/g) ?? [];

    expect(trueMatches).toHaveLength(3);
    expect(source).toContain(trueOption);
    expect(source).not.toContain(falseOption);
  });
});
