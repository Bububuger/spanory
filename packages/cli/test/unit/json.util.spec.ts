import { describe, expect, it } from 'vitest';

import { parseJsonObject } from '../../src/utils/json.ts';

describe('parseJsonObject', () => {
  it('parses JSON object strings only', () => {
    expect(parseJsonObject('{"a":1,"b":"x"}')).toEqual({ a: 1, b: 'x' });
    expect(parseJsonObject(' [1,2,3] ')).toBeNull();
    expect(parseJsonObject('')).toBeNull();
    expect(parseJsonObject('{invalid json')).toBeNull();
  });

  it('returns null for non-string inputs', () => {
    const withToString = { toString: () => '{"k":1}' };
    expect(parseJsonObject(withToString)).toBeNull();
  });
});
