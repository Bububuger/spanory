import path from 'node:path';

import {
  DEFAULT_TELEMETRY_DIR,
  extractSpanoryFields,
  parseArgs,
  sha256Json,
  writeJsonYaml,
} from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const telemetryDir = args['telemetry-dir'] ?? DEFAULT_TELEMETRY_DIR;
const outputPath = args.output ?? path.join(telemetryDir, 'spanory-fields.current.yaml');

const sourceFiles = [
  'packages/cli/src/runtime/shared/normalize.ts',
  'packages/cli/src/runtime/codex/adapter.ts',
  'packages/otlp-core/src/index.ts',
  'packages/backend-langfuse/src/index.ts',
  'packages/opencode-plugin/src/index.ts',
];

const fields = await extractSpanoryFields(sourceFiles);
const payload = {
  spec_version: '1.0.0',
  generated_at: new Date().toISOString(),
  source_files: sourceFiles,
  total_fields: fields.length,
  fields,
};
payload.sha256 = sha256Json(payload);

await writeJsonYaml(outputPath, payload);
console.log(JSON.stringify({ ok: true, output: outputPath, total: fields.length }, null, 2));
