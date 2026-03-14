import assert from 'node:assert/strict';
import test from 'node:test';

import { langfuseObservationTypeForCategory } from '../dist/index.js';

test('langfuseObservationTypeForCategory maps known categories', () => {
  assert.equal(langfuseObservationTypeForCategory('turn'), 'agent');
  assert.equal(langfuseObservationTypeForCategory('shell_command'), 'tool');
  assert.equal(langfuseObservationTypeForCategory('mcp'), 'tool');
  assert.equal(langfuseObservationTypeForCategory('tool'), 'tool');
  assert.equal(langfuseObservationTypeForCategory('agent_command'), 'event');
  assert.equal(langfuseObservationTypeForCategory('agent_task'), 'agent');
});

test('langfuseObservationTypeForCategory falls back to span', () => {
  assert.equal(langfuseObservationTypeForCategory('reasoning'), 'span');
  assert.equal(langfuseObservationTypeForCategory(undefined), 'span');
});
