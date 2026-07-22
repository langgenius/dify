import type { Source } from "@knowledge/core";

export interface SourceCredentialTestResult {
  readonly error?: string | undefined;
  readonly valid: boolean;
}

export interface SourceCredentialTestInput {
  readonly signal?: AbortSignal | undefined;
  readonly source: Source;
  readonly tenantId: string;
  readonly userId?: string | undefined;
}

/**
 * Validates a data source's credentials against its provider. The concrete implementation dispatches
 * the plugin-daemon `validate_credentials` datasource method (see apps/api); injected as a gateway
 * option so `@knowledge/api` stays free of the plugin-daemon transport dependency.
 */
export interface SourceCredentialTester {
  test(input: SourceCredentialTestInput): Promise<SourceCredentialTestResult>;
}

export class SourceCredentialConfigError extends Error {}

export interface SourceCredentialConfig {
  readonly credentials: Record<string, unknown>;
  readonly pluginId: string;
  readonly provider: string;
}

/** Reads the provider identity + credentials any datasource source carries in its metadata. */
export function readSourceCredentialConfig(source: Source): SourceCredentialConfig {
  const metadata = source.metadata;

  return {
    credentials:
      metadata.credentials !== null &&
      typeof metadata.credentials === "object" &&
      !Array.isArray(metadata.credentials)
        ? { ...(metadata.credentials as Record<string, unknown>) }
        : {},
    pluginId: requiredString(metadata, "pluginId", source.id),
    provider: requiredString(metadata, "provider", source.id),
  };
}

function requiredString(
  metadata: Readonly<Record<string, unknown>>,
  key: string,
  sourceId: string,
): string {
  const value = metadata[key];

  if (typeof value !== "string" || !value.trim()) {
    throw new SourceCredentialConfigError(`Source ${sourceId} metadata.${key} is required`);
  }

  return value.trim();
}
