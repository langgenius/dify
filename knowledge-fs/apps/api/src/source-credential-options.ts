import { type SourceCredentialTester, readSourceCredentialConfig } from "@knowledge/api";
import type { PluginDaemonClient } from "@knowledge/plugin-daemon-client";

import { type PluginDaemonClientEnv, createApiPluginDaemonClient } from "./plugin-daemon-options";

/**
 * Validates a source's credentials via the plugin-daemon `validate_credentials` datasource method
 * (data `{provider, credentials}`, response `{result: boolean}`). Configuration and transport errors
 * are reported as `{valid: false, error}` rather than thrown.
 */
export function createApiSourceCredentialTester(input: {
  readonly client: PluginDaemonClient;
}): SourceCredentialTester {
  return {
    test: async ({ signal, source, tenantId, userId }) => {
      let config: ReturnType<typeof readSourceCredentialConfig>;

      try {
        config = readSourceCredentialConfig(source);
      } catch (error) {
        return { valid: false, error: error instanceof Error ? error.message : "invalid source config" };
      }

      try {
        let valid = false;

        for await (const raw of input.client.dispatchDatasourceStream({
          data: { credentials: config.credentials, provider: config.provider },
          method: "validate_credentials",
          pluginId: config.pluginId,
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
        return { valid: false, error: error instanceof Error ? error.message : "validation failed" };
      }
    },
  };
}

export function createApiSourceCredentialTesterOptions(
  env: PluginDaemonClientEnv = process.env,
): { readonly sourceCredentialTester: SourceCredentialTester } {
  return {
    sourceCredentialTester: createApiSourceCredentialTester({
      client: createApiPluginDaemonClient(env),
    }),
  };
}
