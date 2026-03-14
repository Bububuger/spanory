import { describe, expect, it } from 'vitest';

import { redactSecretText } from '../../src/runtime/shared/redaction.ts';

describe('redactSecretText', () => {
  it('redacts anthropic/github/aws key formats', () => {
    const anthropic = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456';
    const ghp = 'ghp_abcdefghijklmnopqrstuvwxyz1234567890ABCD';
    const ghs = 'ghs_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcd';
    const githubPat = 'github_pat_11ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const aws = 'AKIA1234567890ABCDEF';

    const input = [anthropic, ghp, ghs, githubPat, aws].join(' ');
    const output = redactSecretText(input);

    expect(output).toContain('[REDACTED]');
    expect(output).not.toContain(anthropic);
    expect(output).not.toContain(ghp);
    expect(output).not.toContain(ghs);
    expect(output).not.toContain(githubPat);
    expect(output).not.toContain(aws);
    expect(output.match(/\[REDACTED\]/g)).toHaveLength(5);
  });

  it('keeps existing auth/sk/pk redaction behavior', () => {
    const input = [
      'authorization=Bearer bearer-secret',
      'authorization: Basic basic-secret',
      'key=sk_test_12345678',
      'key=pk_live_12345678',
      'harmless=text',
    ].join(' ');

    const output = redactSecretText(input);

    expect(output).toContain('authorization=[REDACTED]');
    expect(output).toContain('authorization: [REDACTED]');
    expect(output).toContain('key=[REDACTED]');
    expect(output).toContain('harmless=text');
    expect(output.match(/\[REDACTED\]/g)).toHaveLength(4);
  });
});
