import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/index.ts',
        'src/cli/commands.ts',
        'src/codex/watch.ts',
        'src/plugin/openclaw.ts',
        'src/plugin/opencode.ts',
        'src/setup/apply.ts',
        'src/setup/detect.ts',
        'src/setup/teardown.ts',
      ],
      reporter: ['text', 'html', 'json-summary'],
      thresholds: {
        lines: 70,
      },
    },
  },
});
