import { type AuthVerifier, createJwtAuthVerifier, createStaticAuthVerifier } from "@knowledge/api";

const DEFAULT_LOCAL_AUTH_TOKEN = "dev-token";
const DIFY_JWT_AUDIENCE = "knowledge-fs";
const DIFY_JWT_ISSUER = "dify";
const DIFY_JWT_MAX_TTL_SECONDS = 60;

export interface ApiAuthEnv {
  readonly KNOWLEDGE_DEV_AUTH_TOKEN?: string | undefined;
  readonly KNOWLEDGE_DEV_SUBJECT_ID?: string | undefined;
  readonly KNOWLEDGE_DEV_TENANT_ID?: string | undefined;
  readonly KNOWLEDGE_FS_JWT_SECRET?: string | undefined;
  readonly NODE_ENV?: string | undefined;
}

export function createApiAuthVerifier(env: ApiAuthEnv = process.env): AuthVerifier | undefined {
  const difyJwtSecret = env.KNOWLEDGE_FS_JWT_SECRET?.trim();
  const token = getLocalAuthToken(env);
  const difyJwtAuth = difyJwtSecret
    ? createJwtAuthVerifier({
        audience: DIFY_JWT_AUDIENCE,
        issuer: DIFY_JWT_ISSUER,
        maxTtlSeconds: DIFY_JWT_MAX_TTL_SECONDS,
        secret: difyJwtSecret,
      })
    : undefined;

  if (!token) {
    return difyJwtAuth;
  }

  const localAuth = createStaticAuthVerifier({
    subject: {
      scopes: ["knowledge-spaces:*"],
      subjectId: env.KNOWLEDGE_DEV_SUBJECT_ID?.trim() || "dev-user",
      tenantId: env.KNOWLEDGE_DEV_TENANT_ID?.trim() || "tenant-dev",
    },
    token,
  });
  if (!difyJwtAuth) {
    return localAuth;
  }

  return {
    verify: async (candidate) =>
      (await difyJwtAuth.verify(candidate)) ?? localAuth.verify(candidate),
  };
}

function getLocalAuthToken(env: ApiAuthEnv): string | undefined {
  const runtimeMode = env.NODE_ENV?.trim();
  if (runtimeMode !== "development" && runtimeMode !== "test") {
    return undefined;
  }

  const explicit = env.KNOWLEDGE_DEV_AUTH_TOKEN?.trim();
  if (explicit) {
    return explicit;
  }

  return DEFAULT_LOCAL_AUTH_TOKEN;
}
