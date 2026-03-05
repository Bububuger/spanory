import path from 'node:path';

import {
  DEFAULT_TELEMETRY_DIR,
  ensureReportsDir,
  parseArgs,
  readJsonYaml,
  validateTelemetry,
  writeJsonYaml,
} from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const telemetryDir = args['telemetry-dir'] ?? DEFAULT_TELEMETRY_DIR;
const currentPath = args.current ?? path.join(telemetryDir, 'spanory-fields.current.yaml');
const specPath = args.spec ?? path.join(telemetryDir, 'field-spec.yaml');
const lockPath = args.lock ?? path.join(telemetryDir, 'otel-semconv.lock.yaml');
const platformPath = args.platform ?? path.join(telemetryDir, 'platform-profiles.yaml');
const runtimePath = args.runtime ?? path.join(telemetryDir, 'runtime-mapping.yaml');
const reportsDir = await ensureReportsDir(telemetryDir);
const outputPath = args.output ?? path.join(reportsDir, 'validate.json');

const [current, spec, runtimeMapping, platformProfiles, otelLock] = await Promise.all([
  readJsonYaml(currentPath),
  readJsonYaml(specPath),
  readJsonYaml(runtimePath),
  readJsonYaml(platformPath),
  readJsonYaml(lockPath),
]);

const result = validateTelemetry({
  current,
  spec,
  runtimeMapping,
  platformProfiles,
  otelLock,
});

await writeJsonYaml(outputPath, result);
console.log(JSON.stringify({ ok: result.pass, output: outputPath, summary: result.summary }, null, 2));
if (!result.pass) process.exit(1);
