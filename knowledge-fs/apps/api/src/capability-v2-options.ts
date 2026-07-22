import {
  type DifyCapabilityV2Auditor,
  type DifyCapabilityV2GatewayAuthenticator,
  type DifyCapabilityV2OperationalMetrics,
  createDifyCapabilityV2GatewayAuthenticator,
  createDifyCapabilityV2RequestGuard,
  createDifyCapabilityV2Verifier,
  createStaticDifyCapabilityV2JwksProvider,
} from "@knowledge/api";

export interface ApiCapabilityV2Env {
  readonly KNOWLEDGE_FS_CAPABILITY_V2_AUDIENCE?: string | undefined;
  readonly KNOWLEDGE_FS_CAPABILITY_V2_ENABLED?: string | undefined;
  readonly KNOWLEDGE_FS_CAPABILITY_V2_ISSUER?: string | undefined;
  readonly KNOWLEDGE_FS_CAPABILITY_V2_PUBLIC_JWKS?: string | undefined;
}

export interface ApiCapabilityV2Assembly {
  readonly authenticator?: DifyCapabilityV2GatewayAuthenticator | undefined;
  /** True only when the deployment explicitly selected the v2 profile, even if config is invalid. */
  readonly selected: boolean;
}

/**
 * Parse the explicitly selected production profile without throwing at process start. Invalid or
 * private JWKS stays unassembled so the deployment readiness check returns 503.
 */
export function createApiCapabilityV2Assembly(options: {
  readonly audit: DifyCapabilityV2Auditor;
  readonly env?: ApiCapabilityV2Env | undefined;
  readonly metrics?: DifyCapabilityV2OperationalMetrics | undefined;
}): ApiCapabilityV2Assembly {
  const env = options.env ?? process.env;
  const selected = env.KNOWLEDGE_FS_CAPABILITY_V2_ENABLED?.trim().toLowerCase() === "true";
  if (!selected) return { selected: false };

  const rawJwks = env.KNOWLEDGE_FS_CAPABILITY_V2_PUBLIC_JWKS?.trim();
  if (!rawJwks) return { selected: true };
  try {
    const decoded: unknown = JSON.parse(rawJwks);
    if (!isJwksObject(decoded)) return { selected: true };
    const jwks = createStaticDifyCapabilityV2JwksProvider(decoded);
    const verifier = createDifyCapabilityV2Verifier({
      audience: env.KNOWLEDGE_FS_CAPABILITY_V2_AUDIENCE?.trim() || "knowledge-fs",
      issuer: env.KNOWLEDGE_FS_CAPABILITY_V2_ISSUER?.trim() || "dify-control-plane",
      jwks,
    });
    return {
      authenticator: createDifyCapabilityV2GatewayAuthenticator({
        audit: options.audit,
        guard: createDifyCapabilityV2RequestGuard(),
        ...(options.metrics ? { metrics: options.metrics } : {}),
        verifier,
      }),
      selected: true,
    };
  } catch {
    return { selected: true };
  }
}

function isJwksObject(
  value: unknown,
): value is { readonly keys: readonly Record<string, unknown>[] } {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === 1 &&
      Array.isArray((value as { readonly keys?: unknown }).keys),
  );
}
