import { describe, expect, it, vi } from 'vitest';

import { mapCodexSessionsWithStat } from '../../src/runtime/codex/sessions.ts';

describe('mapCodexSessionsWithStat', () => {
  it('skips files whose stat fails and keeps successful files', async () => {
    const files = ['/tmp/session-a.jsonl', '/tmp/session-missing.jsonl', '/tmp/session-b.jsonl'];
    const statFn = vi.fn(async (filePath: string) => {
      if (filePath.endsWith('session-missing.jsonl')) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      }
      if (filePath.endsWith('session-a.jsonl')) return { mtimeMs: 200 };
      return { mtimeMs: 100 };
    });

    const result = await mapCodexSessionsWithStat(files, statFn);

    expect(result).toEqual([
      {
        transcriptPath: '/tmp/session-a.jsonl',
        sessionId: 'session-a',
        mtimeMs: 200,
      },
      {
        transcriptPath: '/tmp/session-b.jsonl',
        sessionId: 'session-b',
        mtimeMs: 100,
      },
    ]);
    expect(statFn).toHaveBeenCalledTimes(3);
  });
});
