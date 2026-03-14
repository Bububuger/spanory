export function resolveUserHome(): string;
export function resolveSpanoryHome(): string;
export function resolveSpanoryEnvPath(): string;
export function resolveLegacyUserEnvPath(): string;
export function parseSimpleDotEnv(raw: string): Record<string, string>;
export function loadUserEnv(): Promise<void>;
