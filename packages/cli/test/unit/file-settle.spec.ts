import { describe, expect, it } from 'vitest';

import { waitForFileMtimeToSettle } from '../../src/runtime/shared/file-settle.js';

describe('waitForFileMtimeToSettle', () => {
  it('returns settled after mtime stops changing for the stable window', async () => {
    const mtimes = [1000, 1000, 1100, 1100, 1100, 1100];
    let index = 0;
    let nowMs = 0;

    const result = await waitForFileMtimeToSettle({
      filePath: '/tmp/transcript.jsonl',
      stableWindowMs: 200,
      timeoutMs: 1000,
      pollMs: 100,
      statFn: async () => ({ mtimeMs: mtimes[Math.min(index++, mtimes.length - 1)] }),
      sleepFn: async (ms) => {
        nowMs += ms;
      },
      nowFn: () => nowMs,
    });

    expect(result.settled).toBe(true);
    expect(result.lastMtimeMs).toBe(1100);
    expect(result.waitedMs).toBeGreaterThanOrEqual(400);
  });

  it('returns unsettled when mtime keeps changing until timeout', async () => {
    let mtimeMs = 1000;
    let nowMs = 0;

    const result = await waitForFileMtimeToSettle({
      filePath: '/tmp/transcript.jsonl',
      stableWindowMs: 300,
      timeoutMs: 500,
      pollMs: 100,
      statFn: async () => ({ mtimeMs: (mtimeMs += 10) }),
      sleepFn: async (ms) => {
        nowMs += ms;
      },
      nowFn: () => nowMs,
    });

    expect(result.settled).toBe(false);
    expect(result.lastMtimeMs).toBeGreaterThan(1000);
    expect(result.waitedMs).toBeGreaterThanOrEqual(500);
  });
});
