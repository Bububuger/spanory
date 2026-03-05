import path from 'node:path';

import {
  DEFAULT_TELEMETRY_DIR,
  fetchOfficialSemconvFields,
  parseArgs,
  sha256Json,
  writeJsonYaml,
} from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const telemetryDir = args['telemetry-dir'] ?? DEFAULT_TELEMETRY_DIR;
const outputPath = args.output ?? path.join(telemetryDir, 'otel-semconv.lock.yaml');
const ref = args.ref ?? 'main';
const concurrency = Number(args.concurrency ?? 10);

const officialFields = await fetchOfficialSemconvFields({ ref, concurrency });
const payload = {
  spec_version: '1.0.0',
  source: {
    registry: 'https://opentelemetry.io/docs/specs/semconv/',
    repository: 'https://github.com/open-telemetry/semantic-conventions',
    ref,
  },
  fetched_at: new Date().toISOString(),
  total_fields: officialFields.length,
  official_fields: officialFields,
  deprecated_fields: [
    {
      field: 'deployment.environment',
      replacement: 'deployment.environment.name',
      reason: 'resource semantic conventions migration',
    },
  ],
};
payload.sha256 = sha256Json(payload);

await writeJsonYaml(outputPath, payload);
console.log(JSON.stringify({ ok: true, output: outputPath, total: officialFields.length, ref }, null, 2));
