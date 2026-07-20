import { type AuthVerifier, createStaticAuthVerifier } from "@knowledge/api";

const DEFAULT_LOCAL_AUTH_TOKEN = "dev-token";

export interface ApiAuthEnv {
  readonly KNOWLEDGE_DEV_AUTH_TOKEN?: string | undefined;
  readonly KNOWLEDGE_DEV_SUBJECT_ID?: string | undefined;
  readonly KNOWLEDGE_DEV_TENANT_ID?: string | undefined;
  readonly NODE_ENV?: string | undefined;
}

export function createApiAuthVerifier(env: ApiAuthEnv = process.env): AuthVerifier | undefined {
  const token = getLocalAuthToken(env);

  if (!token) {
    return undefined;
  }

  return createStaticAuthVerifier({
    subject: {
      scopes: ["knowledge-spaces:*"],
      subjectId: env.KNOWLEDGE_DEV_SUBJECT_ID?.trim() || "dev-user",
      tenantId: env.KNOWLEDGE_DEV_TENANT_ID?.trim() || "tenant-dev",
    },
    token,
  });
}

function getLocalAuthToken(env: ApiAuthEnv): string | undefined {
  const explicit = env.KNOWLEDGE_DEV_AUTH_TOKEN?.trim();
  if (explicit) {
    return explicit;
  }

  return env.NODE_ENV === "production" ? undefined : DEFAULT_LOCAL_AUTH_TOKEN;
}
