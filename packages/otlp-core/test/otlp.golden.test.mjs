import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { compileOtlpSpans } from '../dist/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureDir = path.resolve(__dirname, './fixtures/golden/otlp');

const inputFiles = readdirSync(fixtureDir)
  .filter((name) => name.endsWith('.input.json'))
  .sort();

function normalizeForGolden(value) {
  return JSON.parse(JSON.stringify(value));
}

test('otlp golden fixtures are present', () => {
  assert.ok(inputFiles.length > 0);
});

for (const inputFile of inputFiles) {
  test(`otlp payload matches fixture: ${inputFile}`, () => {
    const inputPath = path.join(fixtureDir, inputFile);
    const expectedPath = path.join(fixtureDir, inputFile.replace(/\.input\.json$/, '.expected.json'));

    const input = JSON.parse(readFileSync(inputPath, 'utf-8'));
    const expected = JSON.parse(readFileSync(expectedPath, 'utf-8'));

    const actual = compileOtlpSpans(input.events, input.resource);
    assert.deepEqual(normalizeForGolden(actual), expected);
  });
}
