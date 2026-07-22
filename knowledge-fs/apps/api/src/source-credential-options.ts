import type { SourceCredentialTester } from "@knowledge/api";

import type { ApiDatasourceInvocationClient } from "./datasource-invocation-client";

/**
 * Validates a source's deployment-owned datasource credential binding. Configuration and transport errors
 * are reported as `{valid: false, error}` rather than thrown.
 */
export function createApiSourceCredentialTester(input: {
  readonly client: ApiDatasourceInvocationClient;
}): SourceCredentialTester {
  return {
    test: async ({ signal, source, tenantId, userId }) => {
      try {
        let valid = false;

        for await (const raw of input.client.dispatch({
          operation: "validate_credentials",
          source,
          tenantId,
          ...(userId ? { userId } : {}),
          ...(signal ? { signal } : {}),
        })) {
          if (raw && typeof raw === "object") {
            const result = (raw as Record<string, unknown>).result;

            if (typeof result === "boolean") {
              valid = result;
            }
          }
        }

        return { valid };
      } catch (error) {
        return {
          valid: false,
          error: error instanceof Error ? error.message : "validation failed",
        };
      }
    },
  };
}

export function createApiSourceCredentialTesterOptions(input: {
  readonly client: ApiDatasourceInvocationClient;
}): {
  readonly sourceCredentialTester: SourceCredentialTester;
} {
  return {
    sourceCredentialTester: createApiSourceCredentialTester(input),
  };
}
