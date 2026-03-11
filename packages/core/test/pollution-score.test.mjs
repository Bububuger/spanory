import test from 'node:test';
import assert from 'node:assert/strict';

import { CONTEXT_SOURCE_KINDS, pollutionScoreV1 } from '../dist/index.js';

test('pollutionScoreV1 returns 0 when delta is non-positive', () => {
  assert.equal(
    pollutionScoreV1({ tokenDelta: 0, windowLimitTokens: 200000, sourceShare: 0.1, repeatCountRecent: 1, sourceKind: 'turn' }),
    0,
  );
  assert.equal(
    pollutionScoreV1({ tokenDelta: -5, windowLimitTokens: 200000, sourceShare: 0.1, repeatCountRecent: 1, sourceKind: 'turn' }),
    0,
  );
});

test('pollutionScoreV1 matches contract formula (no tool_output bias)', () => {
  assert.equal(
    pollutionScoreV1({
      tokenDelta: 5000,
      windowLimitTokens: 200000,
      sourceShare: 0.3,
      repeatCountRecent: 2,
      sourceKind: 'tool_output',
    }),
    68,
  );
});

test('pollutionScoreV1 applies unknown penalty +15 and clamps to [0,100]', () => {
  const base = pollutionScoreV1({
    tokenDelta: 5000,
    windowLimitTokens: 200000,
    sourceShare: 0.3,
    repeatCountRecent: 2,
    sourceKind: 'turn',
  });
  const unknown = pollutionScoreV1({
    tokenDelta: 5000,
    windowLimitTokens: 200000,
    sourceShare: 0.3,
    repeatCountRecent: 2,
    sourceKind: 'unknown',
  });
  assert.equal(unknown - base, 15);
  assert.equal(
    pollutionScoreV1({
      tokenDelta: 999999,
      windowLimitTokens: 1,
      sourceShare: 1,
      repeatCountRecent: 99,
      sourceKind: 'unknown',
    }),
    100,
  );
});

test('exports full context source taxonomy as stable ordered list', () => {
  assert.equal(Array.isArray(CONTEXT_SOURCE_KINDS), true);
  assert.equal(CONTEXT_SOURCE_KINDS.length, 11);
  assert.deepEqual(CONTEXT_SOURCE_KINDS, [
    'turn',
    'tool_input',
    'tool_output',
    'skill',
    'claude_md',
    'memory',
    'mention_file',
    'subagent',
    'system_prompt',
    'team_coordination',
    'unknown',
  ]);
});
