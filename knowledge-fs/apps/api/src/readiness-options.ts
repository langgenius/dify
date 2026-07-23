import type { GatewayReadinessChecks } from "@knowledge/api";

export interface ApiDeploymentReadinessEnv {
  readonly DIFY_INNER_API_KEY?: string | undefined;
  readonly DIFY_INNER_API_URL?: string | undefined;
  readonly NODE_ENV?: string | undefined;
}

export interface CreateApiDeploymentReadinessChecksOptions {
  readonly authVerifierConfigured: boolean;
  readonly env?: ApiDeploymentReadinessEnv | undefined;
}

/**
 * Converts deployment assembly state into explicit package-level readiness checks. Production
 * requires a real auth verifier plus an explicit Dify inner-API transport. Models, datasources,
 * and object storage all use that same dependency.
 */
export function createApiDeploymentReadinessChecks({
  authVerifierConfigured,
  env = process.env,
}: CreateApiDeploymentReadinessChecksOptions): GatewayReadinessChecks {
  const production = env.NODE_ENV?.trim() === "production";
  const difyInnerApiConfigured =
    !production || Boolean(env.DIFY_INNER_API_URL?.trim() && env.DIFY_INNER_API_KEY?.trim());

  return {
    "auth.verifier": () => authVerifierConfigured,
    "dify-model-runtime.configuration": () => difyInnerApiConfigured,
    "dify-datasource-runtime.configuration": () => difyInnerApiConfigured,
    "dify-object-storage.configuration": () => difyInnerApiConfigured,
  };
}
