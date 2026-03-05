import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { codexAdapter } from '../../src/runtime/codex/adapter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureDir = path.resolve(__dirname, '../fixtures/golden/codex');
const packageRoot = path.resolve(__dirname, '../..');

const inputFiles = readdirSync(fixtureDir)
  .filter((name) => name.endsWith('.input.json'))
  .sort();

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

describe('codex adapter golden fixtures', () => {
  it('has golden fixture inputs', () => {
    expect(inputFiles.length).toBeGreaterThan(0);
  });

  for (const inputFile of inputFiles) {
    it(`matches expected events: ${inputFile}`, async () => {
      const inputPath = path.join(fixtureDir, inputFile);
      const expectedPath = path.join(fixtureDir, inputFile.replace(/\.input\.json$/, '.expected.json'));

      const input = JSON.parse(readFileSync(inputPath, 'utf-8'));
      const expected = JSON.parse(readFileSync(expectedPath, 'utf-8'));

      const context = {
        ...input.context,
        transcriptPath: path.resolve(packageRoot, input.context.transcriptPath),
      };
      const actual = (await codexAdapter.collectEvents(context)).map(projectEvent);
      expect(actual).toEqual(expected);
    });
  }
});
