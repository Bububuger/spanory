// @ts-nocheck
export const CAPABILITY_KEYS = [
  'turnDetection',
  'toolCallAttribution',
  'toolResultCorrelation',
  'modelName',
  'usageDetails',
  'slashCommandExtraction',
  'mcpServerExtraction',
];

export const RUNTIME_CAPABILITIES = {
  'claude-code': {
    turnDetection: true,
    toolCallAttribution: true,
    toolResultCorrelation: true,
    modelName: true,
    usageDetails: true,
    slashCommandExtraction: true,
    mcpServerExtraction: true,
  },
  openclaw: {
    turnDetection: true,
    toolCallAttribution: true,
    toolResultCorrelation: true,
    modelName: true,
    usageDetails: true,
    slashCommandExtraction: true,
    mcpServerExtraction: true,
  },
  codex: {
    turnDetection: true,
    toolCallAttribution: true,
    toolResultCorrelation: true,
    modelName: true,
    usageDetails: true,
    slashCommandExtraction: true,
    mcpServerExtraction: true,
  },
};
