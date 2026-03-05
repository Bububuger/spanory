import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { compileOtlp } from '../../src/otlp.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureDir = path.resolve(__dirname, '../fixtures/golden/otlp');

const inputFiles = readdirSync(fixtureDir)
  .filter((name) => name.endsWith('.input.json'))
  .sort();

describe('otlp golden fixtures', () => {
  it('has golden fixture inputs', () => {
    expect(inputFiles.length).toBeGreaterThan(0);
  });

  for (const inputFile of inputFiles) {
    it(`matches expected payload: ${inputFile}`, () => {
      const inputPath = path.join(fixtureDir, inputFile);
      const expectedPath = path.join(fixtureDir, inputFile.replace(/\.input\.json$/, '.expected.json'));

      const input = JSON.parse(readFileSync(inputPath, 'utf-8'));
      const expected = JSON.parse(readFileSync(expectedPath, 'utf-8'));

      const actual = compileOtlp(input.events, input.resource);
      expect(actual).toEqual(expected);
    });
  }
});
