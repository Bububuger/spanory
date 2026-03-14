import path from 'node:path';
import { stat } from 'node:fs/promises';

export type CodexSessionFile = {
  transcriptPath: string;
  sessionId: string;
  mtimeMs: number;
};

function sessionIdFromFilename(filename: string): string {
  return filename.endsWith('.jsonl') ? filename.slice(0, -6) : filename;
}

export async function mapCodexSessionsWithStat(
  files: string[],
  statFn: (filePath: string) => Promise<{ mtimeMs: number }> = stat,
): Promise<CodexSessionFile[]> {
  const withStat = await Promise.all(
    files.map(async (fullPath) => {
      try {
        const fileStat = await statFn(fullPath);
        return {
          transcriptPath: fullPath,
          sessionId: sessionIdFromFilename(path.basename(fullPath)),
          mtimeMs: fileStat.mtimeMs,
        };
      } catch {
        return null;
      }
    }),
  );

  return withStat.filter((item): item is CodexSessionFile => item !== null);
}
