import { type AuthSubject, AuthSubjectSchema } from "@knowledge/core";
import type { MiddlewareHandler } from "hono";
import { jwtVerify } from "jose";
import {
  KnowledgeSpaceApiKeyAuthenticationError,
  type KnowledgeSpaceApiKeyAuthenticationResult,
  type KnowledgeSpaceApiKeyAuthenticator,
} from "./knowledge-space-api-key-authentication";
import {
  type KnowledgeSpaceAuthorizationDecision,
  KnowledgeSpaceAuthorizationError,
  type KnowledgeSpaceCallerKind,
  KnowledgeSpaceCallerKinds,
} from "./knowledge-space-authorization";

export interface VerifiedAuthPrincipal {
  /** Server-issued transport identity. It is never read from an unsigned request header/body. */
  readonly callerKind: Exclude<KnowledgeSpaceCallerKind, "api_key">;
  readonly subject: AuthSubject;
}

export type AuthVerificationResult = AuthSubject | VerifiedAuthPrincipal;

export interface AuthVerifier {
  verify(token: string): Promise<AuthVerificationResult | null>;
}

export interface JwtAuthVerifierOptions {
  readonly audience?: string;
  readonly issuer?: string;
  readonly secret: string | Uint8Array;
}

export type StaticAuthVerifierOptions =
  | {
      readonly subject: AuthSubject;
      readonly token: string;
    }
  | {
      readonly subjectsByToken: Readonly<Record<string, AuthSubject>>;
    };

export type KnowledgeSpaceScope = "knowledge-spaces:read" | "knowledge-spaces:write";

export interface AuthMiddlewareOptions {
  readonly apiKeys?: KnowledgeSpaceApiKeyAuthenticator | undefined;
}

export function createJwtAuthVerifier({
  audience,
  issuer,
  secret,
}: JwtAuthVerifierOptions): AuthVerifier {
  const key = typeof secret === "string" ? new TextEncoder().encode(secret) : secret;

  return {
    verify: async (token) => {
      try {
        const verifyOptions = {
          ...(audience ? { audience } : {}),
          ...(issuer ? { issuer } : {}),
        };
        const { payload } = await jwtVerify(token, key, verifyOptions);
        const tenantId = getStringClaim(payload.tenant_id ?? payload.tenantId);
        const subjectId = getStringClaim(payload.sub);
        const scopes = getScopesClaim(payload.scopes ?? payload.scope);
        const subject = AuthSubjectSchema.safeParse({ scopes, subjectId, tenantId });
        const callerKind = signedCallerKind(
          payload.knowledge_space_caller_kind ?? payload.caller_kind,
        );

        return subject.success && callerKind
          ? { callerKind, subject: cloneSubject(subject.data) }
          : null;
      } catch {
        return null;
      }
    },
  };
}

export function createStaticAuthVerifier(options: StaticAuthVerifierOptions): AuthVerifier {
  const subjectsByToken =
    "subjectsByToken" in options ? options.subjectsByToken : { [options.token]: options.subject };

  return {
    verify: async (token) => {
      const subject = subjectsByToken[token];

      return subject ? cloneSubject(AuthSubjectSchema.parse(subject)) : null;
    },
  };
}

export function createAuthMiddleware<
  E extends {
    Variables: {
      authenticatedApiKey?: KnowledgeSpaceApiKeyAuthenticationResult["apiKey"] | undefined;
      authenticatedApiKeyKnowledgeSpaceId?: string | undefined;
      authorizationDecision?: KnowledgeSpaceAuthorizationDecision | undefined;
      callerKind?: KnowledgeSpaceCallerKind | undefined;
      subject: AuthSubject;
    };
  },
>(auth: AuthVerifier, options: AuthMiddlewareOptions = {}): MiddlewareHandler<E> {
  return async (context, next) => {
    const token = getBearerToken(context.req.header("authorization"));

    if (!token) {
      return context.json({ error: "Unauthorized" }, 401);
    }

    if (token.startsWith("kfs_") && options.apiKeys) {
      try {
        const targetKnowledgeSpaceId = await readTargetKnowledgeSpaceId(
          context.req.path,
          context.req.raw,
        );
        if (!targetKnowledgeSpaceId && !isDeferredApiKeySpaceResourceRoute(context.req.path)) {
          return context.json({ error: "Forbidden" }, 403);
        }
        const result = await options.apiKeys.authenticate({
          ...(targetKnowledgeSpaceId ? { knowledgeSpaceId: targetKnowledgeSpaceId } : {}),
          requiredAccess:
            getRequiredScope(context.req.method, context.req.path) === "knowledge-spaces:read"
              ? "read"
              : "write",
          token,
        });
        context.set("subject", result.subject);
        context.set("callerKind", "api_key");
        context.set("authenticatedApiKey", result.apiKey);
        context.set(
          "authenticatedApiKeyKnowledgeSpaceId",
          result.authorization.permissionSnapshot.knowledgeSpaceId,
        );
        context.set("authorizationDecision", result.authorization);
        await next();
        return;
      } catch (error) {
        if (error instanceof KnowledgeSpaceApiKeyAuthenticationError) {
          return context.json({ error: "Unauthorized" }, 401);
        }
        if (error instanceof KnowledgeSpaceAuthorizationError) {
          return context.json({ error: error.message }, 403);
        }
        throw error;
      }
    }

    const verified = await auth.verify(token);

    if (!verified) {
      return context.json({ error: "Unauthorized" }, 401);
    }
    const principal = normalizeVerifiedPrincipal(verified);
    const subject = principal.subject;

    const requiredScope = getRequiredScope(context.req.method, context.req.path);

    if (!hasScope(subject, requiredScope)) {
      return context.json({ error: "Forbidden" }, 403);
    }

    context.set("subject", subject);
    context.set("callerKind", principal.callerKind);

    await next();
  };
}

/**
 * API keys are capabilities for exactly one persisted knowledge space. Identifier-only routes
 * cannot bind the target during authentication, so their handlers must call this after resolving
 * the resource owner and before returning or mutating it.
 */
export function isAuthenticatedApiKeyBoundToKnowledgeSpace(input: {
  readonly authenticatedApiKeyKnowledgeSpaceId?: string | undefined;
  readonly callerKind?: KnowledgeSpaceCallerKind | undefined;
  readonly knowledgeSpaceId: string;
}): boolean {
  return (
    input.callerKind !== "api_key" ||
    input.authenticatedApiKeyKnowledgeSpaceId === input.knowledgeSpaceId
  );
}

/**
 * These identifier routes resolve their owning knowledge space inside the handler before returning
 * data. Every other API-key request must carry an explicit space id in its path or request body;
 * this prevents a key for one space from reaching tenant-wide control-plane routes.
 */
function isDeferredApiKeySpaceResourceRoute(path: string): boolean {
  return [
    /^\/queries\/[^/]+(?:\/(?:evidence|conflicts|missing))?$/u,
    /^\/jobs\/[^/]+(?:\/retry)?$/u,
    /^\/research-tasks\/[^/]+(?:\/(?:partials|events))?$/u,
    /^\/agent-workspace-snapshots\/[^/]+(?:\/replay)?$/u,
    /^\/bulk-jobs\/[^/]+$/u,
    /^\/deletion-jobs\/[^/]+(?:\/retry)?$/u,
  ].some((pattern) => pattern.test(path));
}

async function readTargetKnowledgeSpaceId(
  path: string,
  request: Request,
): Promise<string | undefined> {
  const pathMatch = path.match(/^\/knowledge-spaces\/([^/]+)(?:\/|$)/u);
  if (pathMatch?.[1]) {
    try {
      return decodeURIComponent(pathMatch[1]);
    } catch {
      return undefined;
    }
  }
  if (
    request.method !== "GET" &&
    (path === "/queries" ||
      path === "/research-tasks" ||
      path === "/research-tasks/plan" ||
      path === "/agent-workspace-snapshots" ||
      path === "/bulk-jobs")
  ) {
    try {
      const body = (await request.clone().json()) as { readonly knowledgeSpaceId?: unknown };
      return typeof body.knowledgeSpaceId === "string" && body.knowledgeSpaceId.trim()
        ? body.knowledgeSpaceId.trim()
        : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function getRequiredScope(method: string, path: string): KnowledgeSpaceScope {
  if (
    method === "GET" ||
    (method === "POST" &&
      (path === "/queries" ||
        path === "/research-tasks/plan" ||
        /^\/agent-workspace-snapshots\/[^/]+\/replay$/.test(path)))
  ) {
    return "knowledge-spaces:read";
  }

  return "knowledge-spaces:write";
}

export function getBearerToken(authorization: string | undefined): string | null {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);

  return match?.[1]?.trim() || null;
}

export function hasScope(subject: AuthSubject, scope: KnowledgeSpaceScope): boolean {
  return subject.scopes.includes(scope) || subject.scopes.includes("knowledge-spaces:*");
}

function getStringClaim(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function getScopesClaim(value: unknown): string[] {
  if (typeof value === "string") {
    return value.split(/\s+/).filter(Boolean);
  }

  if (Array.isArray(value) && value.every((scope) => typeof scope === "string")) {
    return value;
  }

  return [];
}

function cloneSubject(subject: AuthSubject): AuthSubject {
  return {
    scopes: [...subject.scopes],
    subjectId: subject.subjectId,
    tenantId: subject.tenantId,
  };
}

function normalizeVerifiedPrincipal(result: AuthVerificationResult): VerifiedAuthPrincipal {
  return "subject" in result
    ? { callerKind: result.callerKind, subject: cloneSubject(result.subject) }
    : { callerKind: "interactive", subject: cloneSubject(result) };
}

function signedCallerKind(value: unknown): Exclude<KnowledgeSpaceCallerKind, "api_key"> | null {
  if (value === undefined) {
    return "interactive";
  }
  if (
    typeof value !== "string" ||
    value === "api_key" ||
    !KnowledgeSpaceCallerKinds.includes(value as KnowledgeSpaceCallerKind)
  ) {
    return null;
  }
  return value as Exclude<KnowledgeSpaceCallerKind, "api_key">;
}
