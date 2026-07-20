import type { MiddlewareHandler } from "hono";

import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import {
  KnowledgeSpaceAuthorizationError,
  type KnowledgeSpaceAuthorizationGuard,
  type KnowledgeSpaceRequiredAccess,
} from "./knowledge-space-authorization";
import type { KnowledgeSpaceRepository } from "./knowledge-space-repository";

export interface KnowledgeSpaceAuthorizationMiddlewareOptions {
  readonly authorization: KnowledgeSpaceAuthorizationGuard;
  readonly spaces: Pick<KnowledgeSpaceRepository, "get">;
}

const adminPathSegments = new Set([
  "access-policy",
  "api-access",
  "api-keys",
  "embedding-profile",
  "fsck",
  "gc",
  "legacy-publication-bootstrap",
  "leases",
  "members",
  "model-preflights",
  "pageindex-upgrade-backfill",
  "profiles",
  "retrieval-profile",
  "retrieval-tests",
  "staged-commits",
  "status",
  "tidb-fts-posting-backfill",
]);

const writePathSegments = new Set(["failed-queries"]);

/**
 * Enforces the second (space membership) authorization boundary for every resource nested below
 * `/knowledge-spaces/:id`. Route handlers keep their tenant-scoped lookups, while this middleware
 * consistently applies visibility, role and API-access policy before source/document/index work.
 */
export function createKnowledgeSpaceAuthorizationMiddleware({
  authorization,
  spaces,
}: KnowledgeSpaceAuthorizationMiddlewareOptions): MiddlewareHandler<KnowledgeGatewayEnv> {
  return async (context, next) => {
    const target = parseKnowledgeSpaceTarget(context.req.path);
    if (!target) {
      await next();
      return;
    }

    // Durable deletion owns a stronger replay-aware authorization path. It must consult its
    // idempotency ledger before ordinary resource repositories because targets are hidden while
    // deleting and absent after successful completion. Fresh requests are still fully authorized
    // by DurableDeletionService.
    if (isDurableDeletionRequest(context.req.method, target.nestedSegments)) {
      await next();
      return;
    }

    const subject = context.get("subject");
    const space = await spaces.get({
      id: target.knowledgeSpaceId,
      tenantId: subject.tenantId,
    });
    if (!space) {
      return context.json({ error: "Knowledge space not found" }, 404);
    }

    // Existing spaces predate the access aggregate. Their explicit recovery endpoint cannot be
    // authorized through an aggregate that does not exist yet; the handler instead requires the
    // separately signed deployment-admin scope and performs an atomic initialize-only write.
    if (target.nestedSegments.length === 1 && target.nestedSegments[0] === "access-bootstrap") {
      await next();
      return;
    }

    try {
      const decision = await authorization.authorize({
        callerKind: context.get("callerKind") ?? "interactive",
        knowledgeSpaceId: target.knowledgeSpaceId,
        requiredAccess: requiredAccess(context.req.method, target.nestedSegments),
        subject,
      });
      context.set("authorizationDecision", decision);
      await next();
    } catch (error) {
      if (error instanceof KnowledgeSpaceAuthorizationError) {
        return context.json({ code: error.code, error: error.message }, 403);
      }
      throw error;
    }
  };
}

function isDurableDeletionRequest(method: string, nestedSegments: readonly string[]): boolean {
  if (method !== "DELETE") return false;
  if (nestedSegments.length === 0) return true;
  return (
    nestedSegments.length === 2 &&
    (nestedSegments[0] === "sources" || nestedSegments[0] === "documents")
  );
}

export function parseKnowledgeSpaceTarget(
  path: string,
): { readonly knowledgeSpaceId: string; readonly nestedSegments: readonly string[] } | null {
  const segments = path.split("/").filter(Boolean);
  if (segments[0] !== "knowledge-spaces" || !segments[1]) {
    return null;
  }
  let knowledgeSpaceId: string;
  try {
    knowledgeSpaceId = decodeURIComponent(segments[1]);
  } catch {
    return null;
  }
  return { knowledgeSpaceId, nestedSegments: segments.slice(2) };
}

function requiredAccess(
  method: string,
  nestedSegments: readonly string[],
): KnowledgeSpaceRequiredAccess {
  if (
    (method === "DELETE" && nestedSegments.length === 0) ||
    nestedSegments.some((segment) => adminPathSegments.has(segment))
  ) {
    return "admin";
  }
  if (nestedSegments.some((segment) => writePathSegments.has(segment))) {
    return "write";
  }
  return method === "GET" || method === "HEAD" ? "read" : "write";
}
