import { describe, expect, it } from 'vitest';

import {
  computeDiffReport,
  extractSemconvIdsFromText,
  validateTelemetry,
} from '../../../../scripts/telemetry/lib.mjs';

describe('telemetry governance helpers', () => {
  it('extracts semconv ids from YAML text', () => {
    const text = `
attributes:
  - id: gen_ai.request.model
  - id: "deployment.environment.name"
  - id: not_a_field
`;
    const ids = [...extractSemconvIdsFromText(text)].sort();
    expect(ids).toEqual(['deployment.environment.name', 'gen_ai.request.model']);
  });

  it('classifies added/removed/deprecated changes', () => {
    const current = { fields: ['gen_ai.request.model', 'deployment.environment'] };
    const spec = {
      fields: [{ field: 'gen_ai.request.model', stability: 'official' }],
      deprecated_fields: [
        {
          field: 'deployment.environment',
          replacement: 'deployment.environment.name',
          policy: 'forbidden',
          reason: 'deprecated',
        },
      ],
    };
    const otelLock = { official_fields: ['gen_ai.request.model', 'deployment.environment.name'] };
    const platformProfiles = { platforms: { langfuse: { required_private_fields: [], projection_rules: [] } } };

    const diff = computeDiffReport({ current, spec, otelLock, platformProfiles });
    expect(diff.changes.added).toContain('deployment.environment');
    expect(diff.changes.deprecated).toHaveLength(1);
    expect(diff.changes.deprecated[0].field).toBe('deployment.environment');
  });

  it('fails validation when forbidden deprecated field is used', () => {
    const current = { fields: ['deployment.environment', 'session.id'] };
    const spec = {
      required_field_properties: [
        'namespace',
        'source',
        'stability',
        'target_platform',
        'emit_when',
        'source_path',
        'runtime_support',
        'category_scope',
        'example_value',
      ],
      deprecated_fields: [
        {
          field: 'deployment.environment',
          replacement: 'deployment.environment.name',
          policy: 'forbidden',
        },
      ],
      fields: [
        {
          field: 'session.id',
          namespace: 'session',
          source: 'test',
          stability: 'official',
          target_platform: ['otel'],
          emit_when: 'always',
          source_path: ['test'],
          runtime_support: ['claude-code', 'codex', 'openclaw', 'opencode'],
          category_scope: ['all'],
          example_value: 's1',
        },
      ],
    };
    const runtimeMapping = {
      runtimes: {
        'claude-code': { field_overrides: [] },
        codex: { field_overrides: [] },
        openclaw: { field_overrides: [] },
        opencode: { field_overrides: [] },
      },
    };
    const platformProfiles = {
      platforms: {
        langfuse: {
          required_private_fields: [],
          projection_rules: [],
        },
      },
    };
    const otelLock = { official_fields: ['session.id'] };

    const result = validateTelemetry({
      current,
      spec,
      runtimeMapping,
      platformProfiles,
      otelLock,
    });

    expect(result.pass).toBe(false);
    expect(result.errors.some((error) => error.includes('deprecated forbidden field'))).toBe(true);
  });
});
