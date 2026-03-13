import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { forEachJsonlEntry } from '../../src/runtime/shared/jsonl.ts';

describe('forEachJsonlEntry', () => {
  it('streams JSONL line by line and skips blank/malformed rows', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'spanory-jsonl-'));
    try {
      const filePath = path.join(tempRoot, 'sample.jsonl');
      await writeFile(
        filePath,
        `${JSON.stringify({ id: 1, text: 'a' })}\n\nnot-json\n${JSON.stringify({ id: 2, text: 'b' })}\n`,
        'utf-8',
      );

      const rows = [];
      await forEachJsonlEntry(filePath, (entry) => {
        rows.push(entry);
      });

      expect(rows).toEqual([
        { id: 1, text: 'a' },
        { id: 2, text: 'b' },
      ]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('keeps callback errors visible to callers', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'spanory-jsonl-callback-'));
    try {
      const filePath = path.join(tempRoot, 'sample.jsonl');
      await writeFile(filePath, `${JSON.stringify({ id: 1 })}\n`, 'utf-8');

      await expect(
        forEachJsonlEntry(filePath, () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
