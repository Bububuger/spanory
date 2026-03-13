import { createReadStream } from 'node:fs';
import readline from 'node:readline';

type JsonlEntryHandler = (entry: any) => void | Promise<void>;

export async function forEachJsonlEntry(filePath: string, onEntry: JsonlEntryHandler): Promise<void> {
  const stream = createReadStream(filePath, { encoding: 'utf-8' });
  const reader = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  try {
    for await (const line of reader) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let entry;
      try {
        entry = JSON.parse(trimmed);
      } catch {
        continue;
      }

      await onEntry(entry);
    }
  } finally {
    reader.close();
  }
}
