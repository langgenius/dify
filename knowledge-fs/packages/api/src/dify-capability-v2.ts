import type { AuthSubject } from "@knowledge/core";
import type { MiddlewareHandler } from "hono";
import { type JWK, decodeProtectedHeader, importJWK, jwtVerify } from "jose";
import { z } from "zod";

import type { DifyCapabilityV2SanitizedGrant } from "./dify-capability-v2-grant";
import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
export type { DifyCapabilityV2SanitizedGrant } from "./dify-capability-v2-grant";

const CAPABILITY_ALGORITHM = "RS256";
const DEFAULT_CLOCK_TOLERANCE_SECONDS = 5;
const DEFAULT_MAX_TTL_SECONDS = 60;
const MAX_BODY_BYTES = 64 * 1024;
const RSA_PRIVATE_PARAMETERS = ["d", "p", "q", "dp", "dq", "qi", "oth"] as const;

export const DifyCapabilityV2CallerKindSchema = z.enum([
  "interactive",
  "service",
  "agent",
  "workflow",
  "internal_worker",
  "mcp",
]);
export type DifyCapabilityV2CallerKind = z.infer<typeof DifyCapabilityV2CallerKindSchema>;

export const DifyCapabilityV2ResourceTypeSchema = z.enum([
  "namespace",
  "knowledge_space",
  "document",
  "job",
  "query",
  "research_task",
  "source",
  "upload_session",
]);
export type DifyCapabilityV2ResourceType = z.infer<typeof DifyCapabilityV2ResourceTypeSchema>;

const requiredString = z.string().trim().min(1).max(255);
const revision = z.number().int().nonnegative();

export const DifyCapabilityV2ResourceSchema = z
  .object({
    id: requiredString,
    parent_id: requiredString.nullable(),
    type: DifyCapabilityV2ResourceTypeSchema,
  })
  .strict()
  .superRefine((resource, context) => {
    const isRoot = resource.type === "namespace" || resource.type === "knowledge_space";
    if (isRoot && resource.parent_id !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Root resources cannot have a parent",
      });
    }
    if (!isRoot && resource.parent_id === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Child resources require a parent",
      });
    }
  });

export const DifyCapabilityV2ClaimsSchema = z
  .object({
    action: requiredString,
    actor: requiredString,
    aud: requiredString,
    authz_revision: z
      .object({
        credential_revision: revision.nullable(),
        external_access_epoch: revision,
        membership_epoch: revision,
        space_acl_epoch: revision,
      })
      .strict(),
    azp: requiredString,
    caller_kind: DifyCapabilityV2CallerKindSchema,
    cap_ver: z.literal(2),
    content_policy_revision: revision,
    content_scope_ids: z
      .array(requiredString)
      .max(1_000)
      .refine((ids) => new Set(ids).size === ids.length),
    control_space_id: requiredString,
    exp: z.number().int().positive(),
    grant_id: requiredString,
    iat: revision,
    iss: requiredString,
    jti: requiredString,
    namespace_id: requiredString,
    nbf: revision,
    resource: DifyCapabilityV2ResourceSchema,
    sub: requiredString,
    trace_id: z.string().trim().min(1).max(128),
  })
  .strict()
  .superRefine((claims, context) => {
    if (!(claims.iat <= claims.nbf && claims.nbf < claims.exp)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Capability time claims must satisfy iat <= nbf < exp",
      });
    }
  });
export type DifyCapabilityV2Claims = z.infer<typeof DifyCapabilityV2ClaimsSchema>;

export interface DifyCapabilityV2PublicJwk extends JWK {
  readonly alg: "RS256";
  readonly e: string;
  readonly kid: string;
  readonly kty: "RSA";
  readonly n: string;
  readonly use: "sig";
}

export interface DifyCapabilityV2PublicJwks {
  readonly keys: readonly DifyCapabilityV2PublicJwk[];
}

export interface DifyCapabilityV2JwksProvider {
  getJwks(options: { readonly refresh: boolean }): Promise<{ readonly keys: readonly JWK[] }>;
}

export interface DifyCapabilityV2VerifiedPrincipal {
  readonly callerKind: DifyCapabilityV2CallerKind;
  readonly claims: DifyCapabilityV2Claims;
  readonly subject: AuthSubject;
}

export interface DifyCapabilityV2AuthenticatedPrincipal extends DifyCapabilityV2VerifiedPrincipal {
  readonly grant: DifyCapabilityV2SanitizedGrant;
}

export interface DifyCapabilityV2Verifier {
  verify(token: string): Promise<DifyCapabilityV2VerifiedPrincipal | null>;
}

export interface CreateDifyCapabilityV2VerifierOptions {
  readonly audience: string;
  readonly clockToleranceSeconds?: number | undefined;
  readonly issuer: string;
  readonly jwks: DifyCapabilityV2JwksProvider;
  readonly maxTtlSeconds?: number | undefined;
  readonly now?: (() => number) | undefined;
}

const PROFILE_CLAIMS: Readonly<
  Record<DifyCapabilityV2CallerKind, { readonly azp: string; readonly subjectPrefix: string }>
> = {
  agent: { azp: "dify-agent", subjectPrefix: "dify-app:" },
  interactive: { azp: "dify-console", subjectPrefix: "dify-account:" },
  mcp: { azp: "dify-mcp", subjectPrefix: "dify-mcp-session:" },
  internal_worker: { azp: "dify-worker", subjectPrefix: "dify-worker:" },
  service: { azp: "dify-service-api", subjectPrefix: "dify-kfs-credential:" },
  workflow: { azp: "dify-workflow", subjectPrefix: "dify-app:" },
};

/** Build an immutable current/previous public-key provider. Private RSA parameters are rejected. */
export function createStaticDifyCapabilityV2JwksProvider(jwks: {
  readonly keys: readonly unknown[];
}): DifyCapabilityV2JwksProvider {
  const keys = validatePublicJwks(jwks);

  return {
    getJwks: async () => ({ keys: keys.map((key) => ({ ...key })) }),
  };
}

export function createDifyCapabilityV2Verifier({
  audience,
  clockToleranceSeconds = DEFAULT_CLOCK_TOLERANCE_SECONDS,
  issuer,
  jwks,
  maxTtlSeconds = DEFAULT_MAX_TTL_SECONDS,
  now = () => Math.floor(Date.now() / 1_000),
}: CreateDifyCapabilityV2VerifierOptions): DifyCapabilityV2Verifier {
  const expectedAudience = requireNonBlank(audience, "audience");
  const expectedIssuer = requireNonBlank(issuer, "issuer");
  requireNonNegativeInteger(clockToleranceSeconds, "clockToleranceSeconds");
  requirePositiveInteger(maxTtlSeconds, "maxTtlSeconds");
  if (maxTtlSeconds > DEFAULT_MAX_TTL_SECONDS) {
    throw new RangeError("maxTtlSeconds cannot exceed 60");
  }

  return {
    async verify(token) {
      try {
        const currentTime = now();
        if (!Number.isSafeInteger(currentTime) || currentTime < 0) return null;
        const header = decodeProtectedHeader(token);
        if (
          header.alg !== CAPABILITY_ALGORITHM ||
          header.typ !== "JWT" ||
          typeof header.kid !== "string" ||
          header.kid.trim().length === 0
        ) {
          return null;
        }

        const selectedKey = await resolveVerificationKey(jwks, header.kid);
        if (!selectedKey) return null;
        const verificationKey = await importJWK(selectedKey, CAPABILITY_ALGORITHM);
        const { payload } = await jwtVerify(token, verificationKey, {
          algorithms: [CAPABILITY_ALGORITHM],
          audience: expectedAudience,
          clockTolerance: clockToleranceSeconds,
          currentDate: new Date(currentTime * 1_000),
          issuer: expectedIssuer,
        });
        const parsed = DifyCapabilityV2ClaimsSchema.safeParse(payload);
        if (!parsed.success) return null;
        const claims = parsed.data;
        if (
          claims.aud !== expectedAudience ||
          claims.iss !== expectedIssuer ||
          claims.exp - claims.iat > maxTtlSeconds ||
          claims.iat > currentTime + clockToleranceSeconds ||
          (claims.resource.type === "namespace" && claims.resource.id !== claims.namespace_id) ||
          !hasValidProfileClaims(claims)
        ) {
          return null;
        }

        return {
          callerKind: claims.caller_kind,
          claims,
          subject: {
            scopes: [scopeForAction(claims.action)],
            subjectId: claims.sub,
            tenantId: claims.namespace_id,
          },
        };
      } catch {
        return null;
      }
    },
  };
}

async function resolveVerificationKey(
  provider: DifyCapabilityV2JwksProvider,
  kid: string,
): Promise<DifyCapabilityV2PublicJwk | null> {
  const initial = validatePublicJwks(await provider.getJwks({ refresh: false }));
  const initialMatch = initial.find((key) => key.kid === kid);
  if (initialMatch) return initialMatch;
  const refreshed = validatePublicJwks(await provider.getJwks({ refresh: true }));
  return refreshed.find((key) => key.kid === kid) ?? null;
}

function validatePublicJwks(jwks: {
  readonly keys: readonly unknown[];
}): DifyCapabilityV2PublicJwk[] {
  if (!Array.isArray(jwks.keys) || jwks.keys.length === 0 || jwks.keys.length > 3) {
    throw new TypeError(
      "Capability JWKS must contain one current and at most two previous public keys",
    );
  }
  const keys = jwks.keys.map((rawKey): DifyCapabilityV2PublicJwk => {
    if (!rawKey || typeof rawKey !== "object" || Array.isArray(rawKey)) {
      throw new TypeError("Capability JWKS must contain only RS256 public keys");
    }
    const key = rawKey as JWK;
    if (
      key.kty !== "RSA" ||
      key.alg !== CAPABILITY_ALGORITHM ||
      key.use !== "sig" ||
      typeof key.kid !== "string" ||
      key.kid.trim().length === 0 ||
      key.kid !== key.kid.trim() ||
      typeof key.n !== "string" ||
      key.n.length === 0 ||
      typeof key.e !== "string" ||
      key.e.length === 0 ||
      (key.key_ops !== undefined &&
        (!Array.isArray(key.key_ops) || key.key_ops.length !== 1 || key.key_ops[0] !== "verify")) ||
      RSA_PRIVATE_PARAMETERS.some((parameter) => parameter in key)
    ) {
      throw new TypeError("Capability JWKS must contain only RS256 public keys");
    }
    return { ...key, alg: "RS256", e: key.e, kid: key.kid, kty: "RSA", n: key.n, use: "sig" };
  });
  if (new Set(keys.map((key) => key.kid)).size !== keys.length) {
    throw new TypeError("Capability JWKS key ids must be unique");
  }
  return keys;
}

function hasValidProfileClaims(claims: DifyCapabilityV2Claims): boolean {
  const profile = PROFILE_CLAIMS[claims.caller_kind];
  return (
    claims.azp === profile.azp &&
    claims.sub.startsWith(profile.subjectPrefix) &&
    claims.sub.length > profile.subjectPrefix.length &&
    (claims.caller_kind !== "interactive" || claims.actor === claims.sub)
  );
}

function scopeForAction(action: string): "knowledge-spaces:read" | "knowledge-spaces:write" {
  return READ_ACTIONS.has(action) ? "knowledge-spaces:read" : "knowledge-spaces:write";
}

const READ_ACTIONS: ReadonlySet<string> = new Set([
  "background_tasks.list",
  "bulk_jobs.read",
  "document_jobs.read",
  "documents.chunks.list",
  "documents.chunks.read",
  "documents.list",
  "documents.outline.read",
  "documents.read",
  "documents.revisions.list",
  "knowledge_spaces.list",
  "knowledge_spaces.read",
  "knowledge_spaces.overview.health.read",
  "knowledge_spaces.overview.inventory.read",
  "knowledge_spaces.overview.query_outcomes.read",
  "knowledge_spaces.overview.stats.read",
  "knowledge_spaces.settings.read",
  "knowledge_spaces.status.batch",
  "quality.traces.list",
  "queries.conflicts.list",
  "queries.create",
  "queries.evidence.list",
  "queries.missing.list",
  "queries.read",
  "research_tasks.partials.list",
  "research_tasks.read",
  "research_tasks.list",
  "research_tasks.stream",
  "sources.files.list",
  "sources.list",
  "sources.pages.list",
  "sources.read",
]);

export interface DifyCapabilityV2ResourceBinding {
  readonly bodyField?: string | undefined;
  readonly namespace?: true | undefined;
  readonly pathParameter?: string | undefined;
  readonly queryParameter?: string | undefined;
}

export interface DifyCapabilityV2Operation {
  readonly action: string;
  readonly allowedCallerKinds: readonly DifyCapabilityV2CallerKind[];
  readonly method: "DELETE" | "GET" | "PATCH" | "POST" | "PUT";
  readonly operationId: string;
  readonly parentResource?: DifyCapabilityV2ResourceBinding | undefined;
  readonly pathTemplate: string;
  readonly resource: DifyCapabilityV2ResourceBinding;
  readonly resourceType: DifyCapabilityV2ResourceType;
}

const STANDARD_CALLERS: readonly DifyCapabilityV2CallerKind[] = [
  "interactive",
  "service",
  "agent",
  "workflow",
];
const CONTROL_PLANE_CALLERS: readonly DifyCapabilityV2CallerKind[] = ["interactive", "service"];
const LIST_CALLERS: readonly DifyCapabilityV2CallerKind[] = [
  ...CONTROL_PLANE_CALLERS,
  "internal_worker",
];
const PROVISION_CALLERS: readonly DifyCapabilityV2CallerKind[] = ["service", "internal_worker"];
const INTERNAL_WORKER_CALLERS: readonly DifyCapabilityV2CallerKind[] = ["internal_worker"];

export const DIFY_CAPABILITY_V2_OPERATIONS: readonly DifyCapabilityV2Operation[] = [
  {
    action: "knowledge_spaces.list",
    allowedCallerKinds: LIST_CALLERS,
    method: "GET",
    operationId: "listKnowledgeSpaces",
    pathTemplate: "/knowledge-spaces",
    resource: { namespace: true },
    resourceType: "namespace",
  },
  {
    action: "knowledge_spaces.status.batch",
    allowedCallerKinds: CONTROL_PLANE_CALLERS,
    method: "POST",
    operationId: "batchKnowledgeSpaceProductSummaries",
    pathTemplate: "/internal/knowledge-spaces/product-summaries/batch",
    resource: { namespace: true },
    resourceType: "namespace",
  },
  {
    action: "knowledge_spaces.provision",
    allowedCallerKinds: PROVISION_CALLERS,
    method: "POST",
    operationId: "provisionIntegratedKnowledgeSpace",
    pathTemplate: "/internal/knowledge-spaces/provision",
    resource: { namespace: true },
    resourceType: "namespace",
  },
  {
    action: "dify_integration.freeze",
    allowedCallerKinds: INTERNAL_WORKER_CALLERS,
    method: "POST",
    operationId: "freezeDifyWorkspaceIntegration",
    pathTemplate: "/internal/dify-integration/freeze",
    resource: { namespace: true },
    resourceType: "namespace",
  },
  {
    action: "dify_integration.activate",
    allowedCallerKinds: INTERNAL_WORKER_CALLERS,
    method: "POST",
    operationId: "activateDifyWorkspaceIntegration",
    pathTemplate: "/internal/dify-integration/activate",
    resource: { namespace: true },
    resourceType: "namespace",
  },
  {
    action: "capability_grants.revoke",
    allowedCallerKinds: PROVISION_CALLERS,
    method: "POST",
    operationId: "revokeCapabilityGrant",
    pathTemplate: "/internal/capability-grants/{grantId}/revoke",
    resource: { bodyField: "knowledgeSpaceId" },
    resourceType: "knowledge_space",
  },
  {
    action: "knowledge_spaces.fence",
    allowedCallerKinds: PROVISION_CALLERS,
    method: "POST",
    operationId: "fenceCapabilityKnowledgeSpace",
    pathTemplate: "/internal/knowledge-spaces/{id}/capability-fence",
    resource: { pathParameter: "id" },
    resourceType: "knowledge_space",
  },
  {
    action: "knowledge_spaces.delete",
    allowedCallerKinds: INTERNAL_WORKER_CALLERS,
    method: "POST",
    operationId: "deleteIntegratedKnowledgeSpace",
    pathTemplate: "/internal/knowledge-spaces/{id}/delete",
    resource: { pathParameter: "id" },
    resourceType: "knowledge_space",
  },
  {
    action: "knowledge_spaces.read",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "GET",
    operationId: "getKnowledgeSpace",
    pathTemplate: "/knowledge-spaces/{id}",
    resource: { pathParameter: "id" },
    resourceType: "knowledge_space",
  },
  {
    action: "knowledge_spaces.update",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "PATCH",
    operationId: "updateKnowledgeSpace",
    pathTemplate: "/knowledge-spaces/{id}",
    resource: { pathParameter: "id" },
    resourceType: "knowledge_space",
  },
  {
    action: "knowledge_spaces.settings.read",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "GET",
    operationId: "getKnowledgeSpaceProductSettings",
    pathTemplate: "/knowledge-spaces/{id}/product-settings",
    resource: { pathParameter: "id" },
    resourceType: "knowledge_space",
  },
  {
    action: "knowledge_spaces.overview.stats.read",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "GET",
    operationId: "getKnowledgeSpaceOverviewStats",
    pathTemplate: "/knowledge-spaces/{id}/overview/stats",
    resource: { pathParameter: "id" },
    resourceType: "knowledge_space",
  },
  {
    action: "knowledge_spaces.overview.query_outcomes.read",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "GET",
    operationId: "getKnowledgeSpaceOverviewQueryOutcomes",
    pathTemplate: "/knowledge-spaces/{id}/overview/query-outcomes",
    resource: { pathParameter: "id" },
    resourceType: "knowledge_space",
  },
  {
    action: "knowledge_spaces.overview.inventory.read",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "GET",
    operationId: "getKnowledgeSpaceOverviewInventory",
    pathTemplate: "/knowledge-spaces/{id}/overview/inventory",
    resource: { pathParameter: "id" },
    resourceType: "knowledge_space",
  },
  {
    action: "knowledge_spaces.overview.health.read",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "GET",
    operationId: "getKnowledgeSpaceProductHealth",
    pathTemplate: "/knowledge-spaces/{id}/overview/health",
    resource: { pathParameter: "id" },
    resourceType: "knowledge_space",
  },
  {
    action: "knowledge_spaces.settings.update",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "PATCH",
    operationId: "updateKnowledgeSpaceProductSettings",
    pathTemplate: "/knowledge-spaces/{id}/product-settings",
    resource: { pathParameter: "id" },
    resourceType: "knowledge_space",
  },
  {
    action: "documents.list",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "GET",
    operationId: "listDocuments",
    pathTemplate: "/knowledge-spaces/{id}/documents",
    resource: { pathParameter: "id" },
    resourceType: "knowledge_space",
  },
  {
    action: "documents.create",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "POST",
    operationId: "uploadDocument",
    pathTemplate: "/knowledge-spaces/{id}/documents",
    resource: { pathParameter: "id" },
    resourceType: "knowledge_space",
  },
  {
    action: "documents.read",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "GET",
    operationId: "getDocument",
    parentResource: { pathParameter: "id" },
    pathTemplate: "/knowledge-spaces/{id}/documents/{documentId}",
    resource: { pathParameter: "documentId" },
    resourceType: "document",
  },
  {
    action: "documents.outline.read",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "GET",
    operationId: "getDocumentOutline",
    parentResource: { pathParameter: "id" },
    pathTemplate: "/knowledge-spaces/{id}/documents/{documentId}/outline",
    resource: { pathParameter: "documentId" },
    resourceType: "document",
  },
  {
    action: "documents.revisions.list",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "GET",
    operationId: "listDocumentRevisions",
    parentResource: { pathParameter: "id" },
    pathTemplate: "/knowledge-spaces/{id}/documents/{documentId}/revisions",
    resource: { pathParameter: "documentId" },
    resourceType: "document",
  },
  {
    action: "documents.metadata.update",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "PATCH",
    operationId: "patchDocumentMetadata",
    parentResource: { pathParameter: "id" },
    pathTemplate: "/knowledge-spaces/{id}/documents/{documentId}/metadata",
    resource: { pathParameter: "documentId" },
    resourceType: "document",
  },
  {
    action: "documents.chunks.list",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "GET",
    operationId: "listDocumentChunks",
    parentResource: { pathParameter: "id" },
    pathTemplate: "/knowledge-spaces/{id}/documents/{documentId}/revisions/{revision}/chunks",
    resource: { pathParameter: "documentId" },
    resourceType: "document",
  },
  {
    action: "documents.chunks.read",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "GET",
    operationId: "getDocumentChunk",
    parentResource: { pathParameter: "id" },
    pathTemplate:
      "/knowledge-spaces/{id}/documents/{documentId}/revisions/{revision}/chunks/{chunkId}",
    resource: { pathParameter: "documentId" },
    resourceType: "document",
  },
  {
    action: "documents.bulk.delete",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "DELETE",
    operationId: "requestBulkDocumentDeletion",
    pathTemplate: "/knowledge-spaces/{id}/documents/bulk",
    resource: { pathParameter: "id" },
    resourceType: "knowledge_space",
  },
  {
    action: "documents.delete",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "DELETE",
    operationId: "requestDocumentDeletion",
    parentResource: { pathParameter: "id" },
    pathTemplate: "/knowledge-spaces/{id}/documents/{documentId}",
    resource: { pathParameter: "documentId" },
    resourceType: "document",
  },
  {
    action: "documents.bulk.reindex",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "POST",
    operationId: "bulkReindexDocuments",
    pathTemplate: "/knowledge-spaces/{id}/documents/bulk/reindex",
    resource: { pathParameter: "id" },
    resourceType: "knowledge_space",
  },
  {
    action: "document_jobs.read",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "GET",
    operationId: "getDocumentCompilationJob",
    parentResource: { queryParameter: "knowledgeSpaceId" },
    pathTemplate: "/jobs/{id}",
    resource: { pathParameter: "id" },
    resourceType: "job",
  },
  {
    action: "document_jobs.cancel",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "DELETE",
    operationId: "cancelDocumentCompilationJob",
    parentResource: { queryParameter: "knowledgeSpaceId" },
    pathTemplate: "/jobs/{id}",
    resource: { pathParameter: "id" },
    resourceType: "job",
  },
  {
    action: "document_jobs.retry",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "POST",
    operationId: "retryDocumentCompilationJob",
    parentResource: { queryParameter: "knowledgeSpaceId" },
    pathTemplate: "/jobs/{id}/retry",
    resource: { pathParameter: "id" },
    resourceType: "job",
  },
  {
    action: "bulk_jobs.read",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "GET",
    operationId: "getBulkOperation",
    parentResource: { queryParameter: "knowledgeSpaceId" },
    pathTemplate: "/bulk-jobs/{id}",
    resource: { pathParameter: "id" },
    resourceType: "job",
  },
  {
    action: "background_tasks.list",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "GET",
    operationId: "listBackgroundTasks",
    pathTemplate: "/knowledge-spaces/{id}/background-tasks",
    resource: { pathParameter: "id" },
    resourceType: "knowledge_space",
  },
  {
    action: "background_tasks.cancel",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "POST",
    operationId: "cancelBackgroundTask",
    parentResource: { pathParameter: "id" },
    pathTemplate: "/knowledge-spaces/{id}/background-tasks/{taskKind}/{taskId}/cancel",
    resource: { pathParameter: "taskId" },
    resourceType: "job",
  },
  {
    action: "background_tasks.retry",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "POST",
    operationId: "retryBackgroundTask",
    parentResource: { pathParameter: "id" },
    pathTemplate: "/knowledge-spaces/{id}/background-tasks/{taskKind}/{taskId}/retry",
    resource: { pathParameter: "taskId" },
    resourceType: "job",
  },
  {
    action: "sources.list",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "GET",
    operationId: "listKnowledgeSpaceSources",
    pathTemplate: "/knowledge-spaces/{id}/sources",
    resource: { pathParameter: "id" },
    resourceType: "knowledge_space",
  },
  {
    action: "sources.create",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "POST",
    operationId: "createKnowledgeSpaceSource",
    pathTemplate: "/knowledge-spaces/{id}/sources",
    resource: { pathParameter: "id" },
    resourceType: "knowledge_space",
  },
  {
    action: "sources.read",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "GET",
    operationId: "getKnowledgeSpaceSource",
    parentResource: { pathParameter: "id" },
    pathTemplate: "/knowledge-spaces/{id}/sources/{sourceId}",
    resource: { pathParameter: "sourceId" },
    resourceType: "source",
  },
  {
    action: "sources.update",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "PATCH",
    operationId: "updateKnowledgeSpaceSource",
    parentResource: { pathParameter: "id" },
    pathTemplate: "/knowledge-spaces/{id}/sources/{sourceId}",
    resource: { pathParameter: "sourceId" },
    resourceType: "source",
  },
  {
    action: "sources.delete",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "DELETE",
    operationId: "requestSourceDeletion",
    parentResource: { pathParameter: "id" },
    pathTemplate: "/knowledge-spaces/{id}/sources/{sourceId}",
    resource: { pathParameter: "sourceId" },
    resourceType: "source",
  },
  {
    action: "sources.test",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "POST",
    operationId: "testKnowledgeSpaceSource",
    parentResource: { pathParameter: "id" },
    pathTemplate: "/knowledge-spaces/{id}/sources/{sourceId}/test",
    resource: { pathParameter: "sourceId" },
    resourceType: "source",
  },
  {
    action: "sources.crawl",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "POST",
    operationId: "crawlKnowledgeSpaceSource",
    parentResource: { pathParameter: "id" },
    pathTemplate: "/knowledge-spaces/{id}/sources/{sourceId}/crawl",
    resource: { pathParameter: "sourceId" },
    resourceType: "source",
  },
  {
    action: "sources.pages.list",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "GET",
    operationId: "listKnowledgeSpaceSourcePages",
    parentResource: { pathParameter: "id" },
    pathTemplate: "/knowledge-spaces/{id}/sources/{sourceId}/pages",
    resource: { pathParameter: "sourceId" },
    resourceType: "source",
  },
  {
    action: "sources.pages.import",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "POST",
    operationId: "importKnowledgeSpaceSourcePages",
    parentResource: { pathParameter: "id" },
    pathTemplate: "/knowledge-spaces/{id}/sources/{sourceId}/import",
    resource: { pathParameter: "sourceId" },
    resourceType: "source",
  },
  {
    action: "sources.files.list",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "GET",
    operationId: "listKnowledgeSpaceSourceFiles",
    parentResource: { pathParameter: "id" },
    pathTemplate: "/knowledge-spaces/{id}/sources/{sourceId}/files",
    resource: { pathParameter: "sourceId" },
    resourceType: "source",
  },
  {
    action: "sources.files.import",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "POST",
    operationId: "importKnowledgeSpaceSourceFiles",
    parentResource: { pathParameter: "id" },
    pathTemplate: "/knowledge-spaces/{id}/sources/{sourceId}/import-files",
    resource: { pathParameter: "sourceId" },
    resourceType: "source",
  },
  {
    action: "research_tasks.list",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "GET",
    operationId: "listKnowledgeSpaceResearchTasks",
    pathTemplate: "/knowledge-spaces/{id}/research-tasks",
    resource: { pathParameter: "id" },
    resourceType: "knowledge_space",
  },
  {
    action: "quality.traces.list",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "GET",
    operationId: "listKnowledgeSpaceQualityTraces",
    pathTemplate: "/knowledge-spaces/{id}/quality/traces",
    resource: { pathParameter: "id" },
    resourceType: "knowledge_space",
  },
  {
    action: "queries.create",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "POST",
    operationId: "createQuery",
    pathTemplate: "/queries",
    resource: { bodyField: "knowledgeSpaceId" },
    resourceType: "knowledge_space",
  },
  {
    action: "queries.read",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "GET",
    operationId: "getAnswerTrace",
    parentResource: { queryParameter: "knowledgeSpaceId" },
    pathTemplate: "/queries/{traceId}",
    resource: { pathParameter: "traceId" },
    resourceType: "query",
  },
  {
    action: "queries.evidence.list",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "GET",
    operationId: "listQueryEvidence",
    parentResource: { queryParameter: "knowledgeSpaceId" },
    pathTemplate: "/queries/{traceId}/evidence",
    resource: { pathParameter: "traceId" },
    resourceType: "query",
  },
  {
    action: "queries.conflicts.list",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "GET",
    operationId: "listQueryConflicts",
    parentResource: { queryParameter: "knowledgeSpaceId" },
    pathTemplate: "/queries/{traceId}/conflicts",
    resource: { pathParameter: "traceId" },
    resourceType: "query",
  },
  {
    action: "queries.missing.list",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "GET",
    operationId: "listQueryMissing",
    parentResource: { queryParameter: "knowledgeSpaceId" },
    pathTemplate: "/queries/{traceId}/missing",
    resource: { pathParameter: "traceId" },
    resourceType: "query",
  },
  {
    action: "research_tasks.plan",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "POST",
    operationId: "planResearchTask",
    pathTemplate: "/research-tasks/plan",
    resource: { bodyField: "knowledgeSpaceId" },
    resourceType: "knowledge_space",
  },
  {
    action: "research_tasks.create",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "POST",
    operationId: "createResearchTask",
    pathTemplate: "/research-tasks",
    resource: { bodyField: "knowledgeSpaceId" },
    resourceType: "knowledge_space",
  },
  {
    action: "research_tasks.stream",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "GET",
    operationId: "streamResearchTaskProgress",
    parentResource: { queryParameter: "knowledgeSpaceId" },
    pathTemplate: "/research-tasks/{id}/events",
    resource: { pathParameter: "id" },
    resourceType: "research_task",
  },
  {
    action: "research_tasks.read",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "GET",
    operationId: "getResearchTask",
    parentResource: { queryParameter: "knowledgeSpaceId" },
    pathTemplate: "/research-tasks/{id}",
    resource: { pathParameter: "id" },
    resourceType: "research_task",
  },
  {
    action: "research_tasks.partials.list",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "GET",
    operationId: "listResearchTaskPartials",
    parentResource: { queryParameter: "knowledgeSpaceId" },
    pathTemplate: "/research-tasks/{id}/partials",
    resource: { pathParameter: "id" },
    resourceType: "research_task",
  },
  {
    action: "upload_sessions.create",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "POST",
    operationId: "createUploadSession",
    pathTemplate: "/knowledge-spaces/{id}/upload-sessions",
    resource: { pathParameter: "id" },
    resourceType: "knowledge_space",
  },
  {
    action: "upload_sessions.write",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "POST",
    operationId: "presignUploadSessionPart",
    parentResource: { bodyField: "knowledgeSpaceId" },
    pathTemplate: "/upload-sessions/{id}/parts/{partNumber}/presign",
    resource: { pathParameter: "id" },
    resourceType: "upload_session",
  },
  {
    action: "upload_sessions.write",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "POST",
    operationId: "uploadSmallFile",
    parentResource: { queryParameter: "knowledgeSpaceId" },
    pathTemplate: "/upload-sessions/{id}/small-file",
    resource: { pathParameter: "id" },
    resourceType: "upload_session",
  },
  {
    action: "upload_sessions.complete",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "POST",
    operationId: "completeUploadSession",
    parentResource: { bodyField: "knowledgeSpaceId" },
    pathTemplate: "/upload-sessions/{id}/complete",
    resource: { pathParameter: "id" },
    resourceType: "upload_session",
  },
  {
    action: "upload_sessions.abort",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "POST",
    operationId: "abortUploadSession",
    parentResource: { bodyField: "knowledgeSpaceId" },
    pathTemplate: "/upload-sessions/{id}/abort",
    resource: { pathParameter: "id" },
    resourceType: "upload_session",
  },
  {
    action: "research_tasks.cancel",
    allowedCallerKinds: STANDARD_CALLERS,
    method: "DELETE",
    operationId: "cancelResearchTask",
    parentResource: { queryParameter: "knowledgeSpaceId" },
    pathTemplate: "/research-tasks/{id}",
    resource: { pathParameter: "id" },
    resourceType: "research_task",
  },
] as const;

const DIFY_CAPABILITY_V2_METRIC_ACTIONS: ReadonlySet<string> = new Set(
  DIFY_CAPABILITY_V2_OPERATIONS.map((operation) => operation.action),
);

export type DifyCapabilityV2GuardErrorCode =
  | "ACTION_MISMATCH"
  | "AUTHENTICATION_FAILED"
  | "CALLER_KIND_NOT_ALLOWED"
  | "INVALID_REQUEST"
  | "NAMESPACE_MISMATCH"
  | "OPERATION_NOT_ALLOWED"
  | "PARENT_RESOURCE_MISMATCH"
  | "RESOURCE_MISMATCH"
  | "RESOURCE_TYPE_MISMATCH"
  | "TRACE_MISMATCH";

export class DifyCapabilityV2GuardError extends Error {
  readonly code: DifyCapabilityV2GuardErrorCode;

  constructor(code: DifyCapabilityV2GuardErrorCode, message: string) {
    super(message);
    this.name = "DifyCapabilityV2GuardError";
    this.code = code;
  }
}

export interface DifyCapabilityV2RequestGuard {
  authorize(input: {
    readonly claims: DifyCapabilityV2Claims;
    readonly request: Request;
  }): Promise<void>;
}

export function createDifyCapabilityV2RequestGuard(
  options: {
    readonly operations?: readonly DifyCapabilityV2Operation[] | undefined;
  } = {},
): DifyCapabilityV2RequestGuard {
  const operations = [...(options.operations ?? DIFY_CAPABILITY_V2_OPERATIONS)];
  validateOperationRegistry(operations);

  return {
    async authorize({ claims, request }) {
      const requestUrl = new URL(request.url);
      const match = matchOperation(operations, request.method, requestUrl.pathname);
      if (!match) {
        throw new DifyCapabilityV2GuardError(
          "OPERATION_NOT_ALLOWED",
          "The request is not registered for Capability v2",
        );
      }
      const { operation, pathParameters } = match;
      if (!operation.allowedCallerKinds.includes(claims.caller_kind)) {
        throw new DifyCapabilityV2GuardError(
          "CALLER_KIND_NOT_ALLOWED",
          "The caller profile is not allowed for this operation",
        );
      }
      if (claims.action !== operation.action) {
        throw new DifyCapabilityV2GuardError(
          "ACTION_MISMATCH",
          "Capability action does not match request",
        );
      }
      if (claims.resource.type !== operation.resourceType) {
        throw new DifyCapabilityV2GuardError(
          "RESOURCE_TYPE_MISMATCH",
          "Capability resource type does not match request",
        );
      }
      if (claims.namespace_id.trim().length === 0) {
        throw new DifyCapabilityV2GuardError(
          "NAMESPACE_MISMATCH",
          "Capability namespace is invalid",
        );
      }
      if (claims.resource.type === "namespace" && claims.resource.id !== claims.namespace_id) {
        throw new DifyCapabilityV2GuardError(
          "NAMESPACE_MISMATCH",
          "Namespace resource does not match capability namespace",
        );
      }

      const needsBody = Boolean(
        operation.resource.bodyField ||
          operation.parentResource?.bodyField ||
          Object.values(pathParameters).length > 0,
      );
      const body = needsBody ? await readBoundedJsonBody(request) : null;
      const resourceId = resolveResourceBinding(
        operation.resource,
        pathParameters,
        body,
        requestUrl.searchParams,
        claims.namespace_id,
      );
      if (resourceId !== claims.resource.id) {
        throw new DifyCapabilityV2GuardError(
          "RESOURCE_MISMATCH",
          "Capability resource does not match request",
        );
      }
      if (operation.parentResource) {
        const parentId = resolveResourceBinding(
          operation.parentResource,
          pathParameters,
          body,
          requestUrl.searchParams,
          claims.namespace_id,
        );
        if (parentId !== claims.resource.parent_id) {
          throw new DifyCapabilityV2GuardError(
            "PARENT_RESOURCE_MISMATCH",
            "Capability parent resource does not match request",
          );
        }
      }

      const routeSpaceId =
        pathParameters.spaceId ??
        pathParameters.knowledgeSpaceId ??
        (operation.resourceType === "knowledge_space" ? pathParameters.id : undefined);
      const bodySpaceId = getBodyString(body, "knowledgeSpaceId", false);
      if (routeSpaceId && bodySpaceId && routeSpaceId !== bodySpaceId) {
        throw new DifyCapabilityV2GuardError(
          "RESOURCE_MISMATCH",
          "Request body knowledgeSpaceId does not match its route",
        );
      }
    },
  };
}

function validateOperationRegistry(operations: readonly DifyCapabilityV2Operation[]): void {
  const ids = new Set<string>();
  const routes = new Set<string>();
  for (const operation of operations) {
    if (ids.has(operation.operationId))
      throw new TypeError("Capability operation ids must be unique");
    const route = `${operation.method} ${operation.pathTemplate}`;
    if (routes.has(route)) throw new TypeError("Capability operation routes must be unique");
    if (operation.allowedCallerKinds.length === 0) {
      throw new TypeError("Capability operations require at least one caller profile");
    }
    validateResourceBinding(operation.resource);
    if (operation.parentResource) validateResourceBinding(operation.parentResource);
    ids.add(operation.operationId);
    routes.add(route);
  }
}

function matchOperation(
  operations: readonly DifyCapabilityV2Operation[],
  method: string,
  pathname: string,
): {
  readonly operation: DifyCapabilityV2Operation;
  readonly pathParameters: Record<string, string>;
} | null {
  const requestSegments = splitPath(pathname);
  for (const operation of operations) {
    if (operation.method !== method.toUpperCase()) continue;
    const templateSegments = splitPath(operation.pathTemplate);
    if (templateSegments.length !== requestSegments.length) continue;
    const parameters: Record<string, string> = {};
    let matches = true;
    for (let index = 0; index < templateSegments.length; index += 1) {
      const template = templateSegments[index];
      const actual = requestSegments[index];
      if (!template || !actual) {
        matches = false;
        break;
      }
      const parameter = /^\{([A-Za-z][A-Za-z0-9_]*)\}$/.exec(template)?.[1];
      if (parameter) parameters[parameter] = actual;
      else if (template !== actual) matches = false;
    }
    if (matches) return { operation, pathParameters: parameters };
  }
  return null;
}

function splitPath(pathname: string): string[] {
  if (
    !pathname.startsWith("/") ||
    (pathname.length > 1 && pathname.endsWith("/")) ||
    pathname.includes("//")
  ) {
    throw new DifyCapabilityV2GuardError("INVALID_REQUEST", "Invalid capability route path");
  }
  return (pathname === "/" ? [] : pathname.slice(1).split("/")).map((segment) => {
    const decoded = decodeURIComponent(segment);
    if (
      !decoded ||
      decoded === "." ||
      decoded === ".." ||
      decoded.includes("/") ||
      decoded.includes("\\")
    ) {
      throw new DifyCapabilityV2GuardError("INVALID_REQUEST", "Invalid capability route segment");
    }
    return decoded;
  });
}

function resolveResourceBinding(
  binding: DifyCapabilityV2ResourceBinding,
  pathParameters: Readonly<Record<string, string>>,
  body: Readonly<Record<string, unknown>> | null,
  query: URLSearchParams,
  namespaceId: string,
): string {
  if (binding.namespace) return namespaceId;
  if (binding.pathParameter) {
    const value = pathParameters[binding.pathParameter];
    if (value) return value;
  }
  if (binding.bodyField) {
    const value = getBodyString(body, binding.bodyField, true);
    if (value) return value;
  }
  if (binding.queryParameter) {
    const values = query.getAll(binding.queryParameter);
    if (values.length === 1 && values[0]?.trim()) return values[0].trim();
    throw new DifyCapabilityV2GuardError(
      "INVALID_REQUEST",
      `Request query requires one ${binding.queryParameter}`,
    );
  }
  throw new DifyCapabilityV2GuardError("INVALID_REQUEST", "Capability resource binding is absent");
}

function validateResourceBinding(binding: DifyCapabilityV2ResourceBinding): void {
  const bindingCount = [
    binding.bodyField !== undefined,
    binding.namespace === true,
    binding.pathParameter !== undefined,
    binding.queryParameter !== undefined,
  ].filter(Boolean).length;
  if (bindingCount !== 1) {
    throw new TypeError("Capability resource bindings must declare exactly one source");
  }
}

async function readBoundedJsonBody(
  request: Request,
): Promise<Readonly<Record<string, unknown>> | null> {
  if (request.method === "GET" || request.method === "DELETE" || request.body === null) return null;
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") return null;
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new DifyCapabilityV2GuardError("INVALID_REQUEST", "Capability request body is too large");
  }
  const reader = request.clone().body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new DifyCapabilityV2GuardError(
        "INVALID_REQUEST",
        "Capability request body is too large",
      );
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || Array.isArray(value) || typeof value !== "object") {
      throw new Error("not an object");
    }
    return value as Readonly<Record<string, unknown>>;
  } catch {
    throw new DifyCapabilityV2GuardError("INVALID_REQUEST", "Capability request body must be JSON");
  }
}

function getBodyString(
  body: Readonly<Record<string, unknown>> | null,
  field: string,
  required: boolean,
): string | undefined {
  const value = body?.[field];
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (required) {
    throw new DifyCapabilityV2GuardError("INVALID_REQUEST", `Request body requires ${field}`);
  }
  return undefined;
}

export interface DifyCapabilityV2AuditEvent {
  readonly action: string;
  readonly callerKind: DifyCapabilityV2CallerKind;
  readonly jtiHash: string;
  readonly resourceId: string;
  readonly resourceType: DifyCapabilityV2ResourceType;
  readonly subject: string;
  readonly traceId: string;
}

export interface DifyCapabilityV2Auditor {
  record(event: DifyCapabilityV2AuditEvent): Promise<void> | void;
}

export type DifyCapabilityV2OperationalMetric = {
  readonly action?: string | undefined;
  readonly callerKind?: DifyCapabilityV2CallerKind | undefined;
  readonly outcome: "failure" | "success";
  readonly reason: DifyCapabilityV2GuardErrorCode | "AUDIT_FAILED" | "AUTHORIZED" | "GUARD_FAILED";
  readonly stage: "audit" | "authorization" | "guard" | "verify";
};

export interface DifyCapabilityV2OperationalMetrics {
  /** Best-effort, low-cardinality metrics; implementations must not receive request identifiers. */
  record(event: DifyCapabilityV2OperationalMetric): Promise<void> | void;
}

export interface DifyCapabilityV2GatewayAuthenticator {
  authenticate(input: {
    readonly request: Request;
    readonly token: string;
    readonly traceId: string;
  }): Promise<DifyCapabilityV2AuthenticatedPrincipal>;
}

export function createDifyCapabilityV2GatewayAuthenticator(options: {
  readonly audit: DifyCapabilityV2Auditor;
  readonly guard: DifyCapabilityV2RequestGuard;
  readonly metrics?: DifyCapabilityV2OperationalMetrics | undefined;
  readonly verifier: DifyCapabilityV2Verifier;
}): DifyCapabilityV2GatewayAuthenticator {
  return {
    async authenticate({ request, token, traceId }) {
      const verified = await options.verifier.verify(token);
      if (!verified) {
        safelyRecordCapabilityMetric(options.metrics, {
          outcome: "failure",
          reason: "AUTHENTICATION_FAILED",
          stage: "verify",
        });
        throw new DifyCapabilityV2GuardError(
          "AUTHENTICATION_FAILED",
          "Capability verification failed",
        );
      }
      if (verified.claims.trace_id !== traceId) {
        safelyRecordCapabilityMetric(
          options.metrics,
          capabilityMetric(verified, {
            outcome: "failure",
            reason: "TRACE_MISMATCH",
            stage: "guard",
          }),
        );
        throw new DifyCapabilityV2GuardError(
          "TRACE_MISMATCH",
          "Capability trace does not match request",
        );
      }
      try {
        await options.guard.authorize({ claims: verified.claims, request });
      } catch (error) {
        safelyRecordCapabilityMetric(
          options.metrics,
          capabilityMetric(verified, {
            outcome: "failure",
            reason: error instanceof DifyCapabilityV2GuardError ? error.code : "GUARD_FAILED",
            stage: "guard",
          }),
        );
        throw error;
      }
      const jtiHash = await hashDifyCapabilityJti(verified.claims.jti);
      const grant = sanitizeCapabilityGrant(verified.claims, jtiHash);
      try {
        await options.audit.record({
          action: grant.action,
          callerKind: grant.callerKind,
          jtiHash: grant.jtiHash,
          resourceId: grant.resource.id,
          resourceType: grant.resource.type,
          subject: grant.subject,
          traceId: grant.traceId,
        });
      } catch (error) {
        safelyRecordCapabilityMetric(
          options.metrics,
          capabilityMetric(verified, {
            outcome: "failure",
            reason: "AUDIT_FAILED",
            stage: "audit",
          }),
        );
        throw error;
      }
      safelyRecordCapabilityMetric(
        options.metrics,
        capabilityMetric(verified, {
          outcome: "success",
          reason: "AUTHORIZED",
          stage: "authorization",
        }),
      );
      return { ...verified, grant };
    },
  };
}

function capabilityMetric(
  verified: DifyCapabilityV2VerifiedPrincipal,
  metric: Omit<DifyCapabilityV2OperationalMetric, "action" | "callerKind">,
): DifyCapabilityV2OperationalMetric {
  return {
    action: DIFY_CAPABILITY_V2_METRIC_ACTIONS.has(verified.claims.action)
      ? verified.claims.action
      : "unknown",
    callerKind: verified.callerKind,
    ...metric,
  };
}

function safelyRecordCapabilityMetric(
  metrics: DifyCapabilityV2OperationalMetrics | undefined,
  event: DifyCapabilityV2OperationalMetric,
): void {
  try {
    const result = metrics?.record(event);
    if (result) void result.catch(() => undefined);
  } catch {
    // Telemetry must never own authentication or authorization outcomes.
  }
}

/** Install Capability v2 as an alternate gateway auth profile behind explicit deployment wiring. */
export function createDifyCapabilityV2GatewayMiddleware(
  authenticator: DifyCapabilityV2GatewayAuthenticator,
): MiddlewareHandler<KnowledgeGatewayEnv> {
  return async (context, next) => {
    const token = readBearerToken(context.req.header("authorization"));
    if (!token) return context.json({ error: "Unauthorized" }, 401);
    let principal: DifyCapabilityV2AuthenticatedPrincipal;
    try {
      principal = await authenticator.authenticate({
        request: context.req.raw,
        token,
        traceId: context.get("traceId"),
      });
    } catch (error) {
      if (error instanceof DifyCapabilityV2GuardError && error.code !== "AUTHENTICATION_FAILED") {
        return context.json({ error: "Forbidden" }, 403);
      }
      return context.json({ error: "Unauthorized" }, 401);
    }
    context.set("subject", principal.subject);
    context.set("callerKind", toGatewayCallerKind(principal.callerKind));
    context.set("capabilityV2Grant", principal.grant);
    await next();
  };
}

export async function hashDifyCapabilityJti(jti: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(jti));
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function sanitizeCapabilityGrant(
  claims: DifyCapabilityV2Claims,
  jtiHash: string,
): DifyCapabilityV2SanitizedGrant {
  return {
    action: claims.action,
    actor: claims.actor,
    authzRevision: { ...claims.authz_revision },
    azp: claims.azp,
    callerKind: claims.caller_kind,
    capVersion: claims.cap_ver,
    contentPolicyRevision: claims.content_policy_revision,
    contentScopeIds: [...claims.content_scope_ids],
    controlSpaceId: claims.control_space_id,
    expiresAt: claims.exp,
    grantId: claims.grant_id,
    issuedAt: claims.iat,
    jtiHash,
    namespaceId: claims.namespace_id,
    notBefore: claims.nbf,
    resource: { ...claims.resource },
    subject: claims.sub,
    traceId: claims.trace_id,
  };
}

function requireNonBlank(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${name} must be non-empty`);
  return normalized;
}

function readBearerToken(authorization: string | undefined): string | null {
  return authorization?.match(/^Bearer\s+(.+)$/iu)?.[1]?.trim() || null;
}

function toGatewayCallerKind(
  callerKind: DifyCapabilityV2CallerKind,
): "agent" | "interactive" | "mcp" | "service_api" {
  if (callerKind === "service" || callerKind === "internal_worker") return "service_api";
  if (callerKind === "workflow") return "agent";
  return callerKind;
}

function requireNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError(`${name} must be non-negative`);
}

function requirePositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be positive`);
}
