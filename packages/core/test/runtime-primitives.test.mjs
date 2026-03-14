import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractToolUses,
  GATEWAY_INPUT_METADATA_BLOCK_RE,
  parseJsonObject,
  toNumber,
} from '../dist/index.js';

test('toNumber returns finite numbers only', () => {
  assert.equal(toNumber('42'), 42);
  assert.equal(toNumber(3.5), 3.5);
  assert.equal(toNumber('abc'), undefined);
  assert.equal(toNumber(Infinity), undefined);
});

test('parseJsonObject returns non-array JSON objects only', () => {
  assert.deepEqual(parseJsonObject('{"a":1,"b":"x"}'), { a: 1, b: 'x' });
  assert.equal(parseJsonObject('[1,2,3]'), null);
  assert.equal(parseJsonObject(''), null);
  assert.equal(parseJsonObject('{invalid json'), null);
});

test('extractToolUses filters tool_use blocks', () => {
  const input = [
    { type: 'text', text: 'hello' },
    { type: 'tool_use', id: 'tool-1', name: 'Task' },
    { type: 'tool_result', tool_use_id: 'tool-1' },
    null,
  ];
  const output = extractToolUses(input);
  assert.deepEqual(output, [{ type: 'tool_use', id: 'tool-1', name: 'Task' }]);
});

test('GATEWAY_INPUT_METADATA_BLOCK_RE matches metadata wrapper', () => {
  const text = `Conversation info (untrusted metadata):\n\`\`\`json\n{\"message_id\":\"m1\"}\n\`\`\`\nhello`;
  const match = text.match(GATEWAY_INPUT_METADATA_BLOCK_RE);
  assert.ok(match);
  assert.equal(match[1].trim(), '{"message_id":"m1"}');
});
