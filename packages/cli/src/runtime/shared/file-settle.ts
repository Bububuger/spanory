import { stat } from 'node:fs/promises';

type FileStat = {
  mtimeMs: number;
};

type WaitForFileSettleOptions = {
  filePath: string;
  stableWindowMs?: number;
  timeoutMs?: number;
  pollMs?: number;
  statFn?: (filePath: string) => Promise<FileStat>;
  sleepFn?: (ms: number) => Promise<void>;
  nowFn?: () => number;
};

type WaitForFileSettleResult = {
  settled: boolean;
  lastMtimeMs?: number;
  waitedMs: number;
};

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export async function waitForFileMtimeToSettle(
  options: WaitForFileSettleOptions,
): Promise<WaitForFileSettleResult> {
  const stableWindowMs = options.stableWindowMs ?? 400;
  const timeoutMs = options.timeoutMs ?? 2500;
  const pollMs = options.pollMs ?? 100;
  const statFn = options.statFn ?? (async (filePath: string) => stat(filePath));
  const sleepFn = options.sleepFn ?? sleep;
  const nowFn = options.nowFn ?? Date.now;

  const startedAt = nowFn();
  const deadline = startedAt + timeoutMs;
  let lastMtimeMs: number | undefined;
  let unchangedSinceMs: number | undefined;

  while (nowFn() <= deadline) {
    const current = await statFn(options.filePath);
    const mtimeMs = Number(current.mtimeMs);

    if (lastMtimeMs === mtimeMs) {
      if (unchangedSinceMs === undefined) unchangedSinceMs = nowFn();
      if (nowFn() - unchangedSinceMs >= stableWindowMs) {
        return {
          settled: true,
          lastMtimeMs: mtimeMs,
          waitedMs: nowFn() - startedAt,
        };
      }
    } else {
      lastMtimeMs = mtimeMs;
      unchangedSinceMs = undefined;
    }

    const remainingMs = deadline - nowFn();
    if (remainingMs <= 0) break;
    await sleepFn(Math.min(pollMs, remainingMs));
  }

  return {
    settled: false,
    lastMtimeMs,
    waitedMs: nowFn() - startedAt,
  };
}
