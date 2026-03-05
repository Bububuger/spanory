import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileOtlp } from '../../../../src/otlp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const files = (await readdir(__dirname))
  .filter((name) => name.endsWith('.input.json'))
  .sort();

for (const name of files) {
  const inputPath = path.join(__dirname, name);
  const expectedPath = path.join(__dirname, name.replace(/\.input\.json$/, '.expected.json'));
  const content = await readFile(inputPath, 'utf-8');
  const parsed = JSON.parse(content);
  const payload = compileOtlp(parsed.events, parsed.resource);
  await writeFile(expectedPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
  console.log(`updated ${path.basename(expectedPath)}`);
}
