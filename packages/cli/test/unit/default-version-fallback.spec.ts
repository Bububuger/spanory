import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildResource } from '../../../otlp-core/src/index.ts';

describe('version fallback defaults', () => {
  it('uses unknown as serviceVersion fallback in source defaults', async () => {
    const targets = [
      {
        file: path.resolve('src/index.ts'),
        expected: "const DEFAULT_VERSION = 'unknown';",
      },
      {
        file: path.resolve('src/index.ts'),
        expected: 'const CLI_VERSION = process.env.SPANORY_VERSION ?? DEFAULT_VERSION;',
      },
      {
        file: path.resolve('src/index.ts'),
        unexpected: 'readVersionFromPackageJson()',
      },
      {
        file: path.resolve('../opencode-plugin/src/index.ts'),
        expected: "const DEFAULT_SPANORY_VERSION = 'unknown';",
      },
      {
        file: path.resolve('../openclaw-plugin/src/index.ts'),
        expected: "const DEFAULT_SPANORY_VERSION = 'unknown';",
      },
      {
        file: path.resolve('../alipay-cli/openclaw-plugin/src/index.ts'),
        expected: "const DEFAULT_SPANORY_VERSION = 'unknown';",
      },
      {
        file: path.resolve('../otlp-core/src/index.ts'),
        expected: "serviceVersion: input.serviceVersion ?? process.env.SPANORY_VERSION ?? 'unknown',",
      },
    ];

    for (const target of targets) {
      const source = await readFile(target.file, 'utf-8');
      if ('expected' in target) expect(source).toContain(target.expected);
      if ('unexpected' in target) expect(source).not.toContain(target.unexpected);
    }
  });

  it('build script injects SPANORY_VERSION at bundle time', async () => {
    const cliPackageJson = JSON.parse(await readFile(path.resolve('package.json'), 'utf-8'));
    expect(String(cliPackageJson.scripts?.build ?? '')).toContain(
      '--define:process.env.SPANORY_VERSION=\\\"$npm_package_version\\\"',
    );
  });

  it('buildResource falls back to unknown when version is absent', () => {
    const previousVersion = process.env.SPANORY_VERSION;
    delete process.env.SPANORY_VERSION;

    try {
      const resource = buildResource({
        serviceName: 'spanory',
        environment: 'test',
      });
      expect(resource.serviceVersion).toBe('unknown');
    } finally {
      if (previousVersion === undefined) {
        delete process.env.SPANORY_VERSION;
      } else {
        process.env.SPANORY_VERSION = previousVersion;
      }
    }
  });
});
