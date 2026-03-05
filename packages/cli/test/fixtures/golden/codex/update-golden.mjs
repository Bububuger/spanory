import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { codexAdapter } from '../../../../dist/runtime/codex/adapter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '../../../..');

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = stableObject(value[key]);
  }
  return out;
}

function projectEvent(event) {
  return {
    runtime: event.runtime,
    projectId: event.projectId,
    sessionId: event.sessionId,
    turnId: event.turnId ?? null,
    category: event.category,
    name: event.name,
    input: event.input ?? '',
    output: event.output ?? '',
    attributes: stableObject(event.attributes ?? {}),
  };
}

const files = (await readdir(__dirname))
  .filter((name) => name.endsWith('.input.json'))
  .sort();

for (const name of files) {
  const inputPath = path.join(__dirname, name);
  const expectedPath = path.join(__dirname, name.replace(/\.input\.json$/, '.expected.json'));
  const parsed = JSON.parse(await readFile(inputPath, 'utf-8'));
  const context = {
    ...parsed.context,
    transcriptPath: path.resolve(packageRoot, parsed.context.transcriptPath),
  };
  const events = await codexAdapter.collectEvents(context);
  const projected = events.map(projectEvent);
  await writeFile(expectedPath, `${JSON.stringify(projected, null, 2)}\n`, 'utf-8');
  console.log(`updated ${path.basename(expectedPath)}`);
}
