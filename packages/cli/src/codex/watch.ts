// @ts-nocheck
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

export const CODEX_WATCH_DEFAULT_POLL_MS = 1200;
export const CODEX_WATCH_DEFAULT_SETTLE_MS = 250;

export function sessionIdFromFilename(filename) {
  return filename.endsWith('.jsonl') ? filename.slice(0, -6) : filename;
}

async function listJsonlFilesRecursively(rootDir) {
  const out = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    let names = [];
    try {
      names = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const name of names) {
      const fullPath = path.join(dir, name.name);
      if (name.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (name.isFile() && name.name.endsWith('.jsonl')) {
        out.push(fullPath);
      }
    }
  }
  return out;
}

function normalizePositiveInt(raw, fallback, label) {
  const value = raw ?? fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`invalid ${label}: ${value}`);
  }
  return Math.floor(parsed);
}

export async function listCodexSessions(runtimeHome, options = {}) {
  const sessionsRoot = path.join(runtimeHome, 'sessions');
  const files = await listJsonlFilesRecursively(sessionsRoot);
  const withStat = await Promise.all(
    files.map(async (fullPath) => {
      const fileStat = await stat(fullPath);
      return {
        transcriptPath: fullPath,
        sessionId: sessionIdFromFilename(path.basename(fullPath)),
        mtimeMs: fileStat.mtimeMs,
      };
    }),
  );

  const sinceMs = options.since ? new Date(options.since).getTime() : undefined;
  const untilMs = options.until ? new Date(options.until).getTime() : undefined;
  const filtered = withStat.filter((item) => {
    if (Number.isFinite(sinceMs) && item.mtimeMs < sinceMs) return false;
    if (Number.isFinite(untilMs) && item.mtimeMs > untilMs) return false;
    return true;
  });

  const sorted = filtered.sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (!Number.isFinite(options.limit)) return sorted;
  return sorted.slice(0, Number(options.limit));
}

export async function runCodexWatch(options, deps) {
  const runtimeName = 'codex';
  const runtimeHome = deps.resolveRuntimeHome(runtimeName, options.runtimeHome);
  const pollMs = normalizePositiveInt(options.pollMs, CODEX_WATCH_DEFAULT_POLL_MS, '--poll-ms');
  const settleMs = normalizePositiveInt(options.settleMs, CODEX_WATCH_DEFAULT_SETTLE_MS, '--settle-ms');
  const includeExisting = Boolean(options.includeExisting);
  const processedMtimeByPath = new Map();

  if (!includeExisting) {
    const baseline = await listCodexSessions(runtimeHome);
    for (const session of baseline) {
      processedMtimeByPath.set(session.transcriptPath, session.mtimeMs);
    }
    console.log(`watch=baseline files=${baseline.length}`);
  }

  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  try {
    do {
      const nowMs = Date.now();
      const sessions = await listCodexSessions(runtimeHome);
      let exportedCount = 0;
      let skippedCount = 0;

      for (const session of sessions) {
        const prevProcessedMtime = processedMtimeByPath.get(session.transcriptPath);
        if (prevProcessedMtime !== undefined && session.mtimeMs <= prevProcessedMtime) {
          continue;
        }
        if (nowMs - session.mtimeMs < settleMs) {
          continue;
        }

        const context = {
          projectId: options.projectId ?? 'codex',
          sessionId: session.sessionId,
          transcriptPath: session.transcriptPath,
          runtimeHome,
        };

        try {
          const result = await deps.runContextExportMode({
            runtimeName,
            context,
            runtimeHome,
            endpoint: options.endpoint,
            headers: options.headers,
            exportJsonDir: options.exportJsonDir,
            force: options.force,
            lastTurnOnly: options.lastTurnOnly,
          });
          if (result?.status === 'sent') exportedCount += 1;
          else skippedCount += 1;
        } catch (error) {
          skippedCount += 1;
          const message = error?.message ? String(error.message).replace(/\s+/g, ' ') : 'unknown-error';
          console.log(`watch=error sessionId=${session.sessionId} error=${message}`);
        } finally {
          processedMtimeByPath.set(session.transcriptPath, session.mtimeMs);
        }
      }

      console.log(`watch=scan files=${sessions.length} exported=${exportedCount} skipped=${skippedCount}`);
      if (options.once) break;
      if (!stopped) await deps.sleep(pollMs);
    } while (!stopped);
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
}
