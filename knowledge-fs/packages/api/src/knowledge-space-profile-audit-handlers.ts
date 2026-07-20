import type { OpenAPIHono } from "@hono/zod-openapi";

import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import { listKnowledgeSpaceProfileRevisionsRoute } from "./knowledge-space-profile-audit-routes";
import {
  KnowledgeSpaceProfileAuditListResponseSchema,
  type KnowledgeSpaceProfileAuditRevision,
  KnowledgeSpaceProfileAuditRevisionSchema,
} from "./knowledge-space-profile-audit-schemas";
import type {
  KnowledgeSpaceProfileHead,
  KnowledgeSpaceProfileRepository,
  KnowledgeSpaceProfileRevision,
  ListKnowledgeSpaceProfileRevisionsResult,
} from "./knowledge-space-profile-repository";
import type { KnowledgeSpaceRepository } from "./knowledge-space-repository";

export interface RegisterKnowledgeSpaceProfileAuditHandlersOptions {
  readonly app: OpenAPIHono<KnowledgeGatewayEnv>;
  readonly profiles?:
    | Pick<KnowledgeSpaceProfileRepository, "getHead" | "listRevisions">
    | undefined;
  readonly spaces: Pick<KnowledgeSpaceRepository, "get">;
}

export function registerKnowledgeSpaceProfileAuditHandlers({
  app,
  profiles,
  spaces,
}: RegisterKnowledgeSpaceProfileAuditHandlersOptions): void {
  app.openapi(listKnowledgeSpaceProfileRevisionsRoute, async (context) => {
    const subject = context.get("subject");
    const params = context.req.valid("param");
    const space = await spaces.get({ id: params.id, tenantId: subject.tenantId });
    if (!space) {
      return context.json({ error: "Knowledge space not found" }, 404);
    }
    if (!profiles) {
      return context.json(profileAuditUnavailableResponse(), 503);
    }

    const query = context.req.valid("query");
    const scope = {
      kind: params.kind,
      knowledgeSpaceId: params.id,
      tenantId: subject.tenantId,
    } as const;
    try {
      const [head, page] = await Promise.all([
        profiles.getHead(scope),
        profiles.listRevisions({
          ...(query.afterRevision === undefined ? {} : { afterRevision: query.afterRevision }),
          ...scope,
          limit: query.limit,
        }),
      ]);
      return context.json(
        validateAndSanitizeAuditPage({
          afterRevision: query.afterRevision,
          head,
          limit: query.limit,
          page,
          scope,
        }),
        200,
      );
    } catch {
      return context.json(profileAuditUnavailableResponse(), 503);
    }
  });
}

function validateAndSanitizeAuditPage({
  afterRevision,
  head,
  limit,
  page,
  scope,
}: {
  readonly afterRevision?: number | undefined;
  readonly head: KnowledgeSpaceProfileHead | null;
  readonly limit: number;
  readonly page: ListKnowledgeSpaceProfileRevisionsResult;
  readonly scope: {
    readonly kind: "embedding" | "retrieval";
    readonly knowledgeSpaceId: string;
    readonly tenantId: string;
  };
}) {
  if (page.items.length > limit) {
    throw new Error("Profile audit repository exceeded the requested page limit");
  }

  let previousRevision = afterRevision ?? 0;
  const items: KnowledgeSpaceProfileAuditRevision[] = [];
  for (const revision of page.items) {
    if (
      revision.kind !== scope.kind ||
      revision.knowledgeSpaceId !== scope.knowledgeSpaceId ||
      revision.tenantId !== scope.tenantId ||
      revision.revision <= previousRevision
    ) {
      throw new Error("Profile audit repository returned an invalid scoped revision page");
    }
    items.push(toAuditRevision(revision));
    previousRevision = revision.revision;
  }

  if (
    page.nextRevision !== undefined &&
    (items.length !== limit || page.nextRevision !== items.at(-1)?.revision)
  ) {
    throw new Error("Profile audit repository returned an invalid revision cursor");
  }
  if (
    head &&
    (head.kind !== scope.kind ||
      head.knowledgeSpaceId !== scope.knowledgeSpaceId ||
      head.tenantId !== scope.tenantId ||
      head.profile.kind !== scope.kind ||
      head.profile.knowledgeSpaceId !== scope.knowledgeSpaceId ||
      head.profile.tenantId !== scope.tenantId ||
      head.profile.revision !== head.activeRevision ||
      head.profile.state !== "active")
  ) {
    throw new Error("Profile audit repository returned an invalid active head");
  }

  return KnowledgeSpaceProfileAuditListResponseSchema.parse({
    activeRevision: head?.activeRevision ?? null,
    items,
    ...(page.nextRevision === undefined ? {} : { nextRevision: page.nextRevision }),
  });
}

function toAuditRevision(
  revision: KnowledgeSpaceProfileRevision,
): KnowledgeSpaceProfileAuditRevision {
  return KnowledgeSpaceProfileAuditRevisionSchema.parse({
    ...(revision.activatedAt === undefined ? {} : { activatedAt: revision.activatedAt }),
    capabilitySnapshotDigest: revision.capabilitySnapshotDigest,
    createdAt: revision.createdAt,
    createdBySubjectId: revision.createdBySubjectId,
    ...(revision.dimension === undefined ? {} : { dimension: revision.dimension }),
    ...(revision.failedAt === undefined ? {} : { failedAt: revision.failedAt }),
    ...(revision.failureCode === undefined ? {} : { failureCode: revision.failureCode }),
    kind: revision.kind,
    model: revision.model,
    pluginId: revision.pluginId,
    provider: revision.provider,
    revision: revision.revision,
    snapshotDigest: revision.snapshotDigest,
    state: revision.state,
    ...(revision.supersededAt === undefined ? {} : { supersededAt: revision.supersededAt }),
    updatedAt: revision.updatedAt,
    ...(revision.vectorSpaceId === undefined ? {} : { vectorSpaceId: revision.vectorSpaceId }),
  });
}

function profileAuditUnavailableResponse() {
  return {
    code: "KNOWLEDGE_SPACE_PROFILE_AUDIT_UNAVAILABLE" as const,
    error: "Knowledge-space profile audit is unavailable" as const,
    retryable: true as const,
  };
}
