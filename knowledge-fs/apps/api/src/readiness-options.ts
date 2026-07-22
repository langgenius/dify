import type { GatewayReadinessChecks } from "@knowledge/api";

export interface ApiDeploymentReadinessEnv {
  readonly DIFY_INNER_API_KEY?: string | undefined;
  readonly DIFY_INNER_API_URL?: string | undefined;
  readonly KNOWLEDGE_INTEGRATED_MODE_ENABLED?: string | undefined;
  readonly NODE_ENV?: string | undefined;
  readonly PLUGIN_DAEMON_KEY?: string | undefined;
  readonly PLUGIN_DAEMON_URL?: string | undefined;
}

export interface CreateApiDeploymentReadinessChecksOptions {
  readonly authVerifierConfigured: boolean;
  readonly env?: ApiDeploymentReadinessEnv | undefined;
}

/**
 * Converts deployment assembly state into explicit package-level readiness checks. Production
 * requires a real auth verifier plus explicit Dify model-runtime transport. Datasources use the
 * same Dify inner API in integrated mode and retain plugin-daemon only for standalone mode.
 */
export function createApiDeploymentReadinessChecks({
  authVerifierConfigured,
  env = process.env,
}: CreateApiDeploymentReadinessChecksOptions): GatewayReadinessChecks {
  const production = env.NODE_ENV?.trim() === "production";
  const integratedModeEnabled =
    env.KNOWLEDGE_INTEGRATED_MODE_ENABLED?.trim().toLowerCase() === "true";
  const pluginDaemonConfigured =
    !production || Boolean(env.PLUGIN_DAEMON_URL?.trim() && env.PLUGIN_DAEMON_KEY?.trim());
  const difyModelRuntimeConfigured =
    !production || Boolean(env.DIFY_INNER_API_URL?.trim() && env.DIFY_INNER_API_KEY?.trim());

  return {
    "auth.verifier": () => authVerifierConfigured,
    "dify-model-runtime.configuration": () => difyModelRuntimeConfigured,
    ...(integratedModeEnabled
      ? { "dify-datasource-runtime.configuration": () => difyModelRuntimeConfigured }
      : { "plugin-daemon.configuration": () => pluginDaemonConfigured }),
  };
}
