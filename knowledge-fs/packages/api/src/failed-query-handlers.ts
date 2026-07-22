import type { OpenAPIHono } from "@hono/zod-openapi";

import { isAuthenticatedApiKeyBoundToKnowledgeSpace } from "./auth";
import { currentCandidateGrants } from "./candidate-content-authorization";
import { toFailedQueryResponse } from "./core-resource-response-schemas";
import type { DocumentAssetRepository } from "./document-asset-repository";
import { clusterFailedQueries } from "./failed-query-clustering";
import {
  FailedQueryPromotionConflictError,
  type FailedQueryRepository,
} from "./failed-query-repository";
import {
  annotateFailedQueryRoute,
  clusterFailedQueriesRoute,
  listFailedQueriesRoute,
  metricsFailedQueriesRoute,
  triageFailedQueriesRoute,
} from "./failed-query-routes";
import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import { goldenQuestionEvidencePermissionScope } from "./golden-question-handlers";
import type { KnowledgeNodeRepository } from "./knowledge-node-repository";
import {
  KnowledgeSpaceAccessError,
  type KnowledgeSpaceAccessService,
} from "./knowledge-space-access-control";
import { knowledgeSpaceAccessChannelForCallerKind } from "./knowledge-space-authorization";
import type { KnowledgeSpaceRepository } from "./knowledge-space-repository";
import type { FailedQueryTriageRunner } from "./relevance-triage";

export interface RegisterFailedQueryHandlersOptions {
  readonly access: Pick<KnowledgeSpaceAccessService, "createPermissionSnapshot">;
  readonly app: OpenAPIHono<KnowledgeGatewayEnv>;
  readonly assets: Pick<DocumentAssetRepository, "get">;
  readonly failedQueries: FailedQueryRepository;
  readonly failedQueryTriageRunner?: FailedQueryTriageRunner | undefined;
  readonly now?: () => string;
  readonly nodes: Pick<KnowledgeNodeRepository, "getMany">;
  readonly spaces: KnowledgeSpaceRepository;
}

export function registerFailedQueryHandlers({
  access,
  app,
  assets,
  failedQueries,
  failedQueryTriageRunner,
  now = () => new Date().toISOString(),
  nodes,
  spaces,
}: RegisterFailedQueryHandlersOptions): void {
  app.openapi(listFailedQueriesRoute, async (context) => {
    const params = context.req.valid("param");
    const query = context.req.valid("query");
    const scope = await failedQueryRequestScope(context, spaces, params.id);
    if (!scope) {
      return context.json({ error: "Knowledge space not found" }, 404);
    }

    const result = await failedQueries.list({
      candidateGrants: scope.candidateGrants,
      ...(query.cursor ? { cursor: { id: query.cursor } } : {}),
      knowledgeSpaceId: params.id,
      limit: query.limit,
      ...(query.status ? { status: query.status } : {}),
      subjectId: scope.subject.subjectId,
      tenantId: scope.subject.tenantId,
    });

    return context.json(
      {
        items: result.items.map(toFailedQueryResponse),
        ...(result.nextCursor ? { nextCursor: result.nextCursor.id } : {}),
      },
      200,
    );
  });

  app.openapi(metricsFailedQueriesRoute, async (context) => {
    const params = context.req.valid("param");
    const scope = await failedQueryRequestScope(context, spaces, params.id);
    if (!scope) {
      return context.json({ error: "Knowledge space not found" }, 404);
    }

    const counts = await failedQueries.countByStatus({
      candidateGrants: scope.candidateGrants,
      knowledgeSpaceId: params.id,
      subjectId: scope.subject.subjectId,
      tenantId: scope.subject.tenantId,
    });
    const byStatus = {
      annotated: counts.annotated ?? 0,
      dismissed: counts.dismissed ?? 0,
      "pending-annotation": counts["pending-annotation"] ?? 0,
      "pending-triage": counts["pending-triage"] ?? 0,
      promoted: counts.promoted ?? 0,
      triaged: counts.triaged ?? 0,
    };
    const total = Object.values(byStatus).reduce((sum, value) => sum + value, 0);

    return context.json(
      { byStatus, promotionRate: total > 0 ? byStatus.promoted / total : 0, total },
      200,
    );
  });

  app.openapi(triageFailedQueriesRoute, async (context) => {
    const params = context.req.valid("param");
    const query = context.req.valid("query");
    const scope = await failedQueryRequestScope(context, spaces, params.id);
    if (!scope) {
      return context.json({ error: "Knowledge space not found" }, 404);
    }

    if (!failedQueryTriageRunner) {
      return context.json({ error: "Relevance triage is not configured" }, 501);
    }

    try {
      const permission = await issueFailedQueryPermission(context, access, scope, now);
      const result = await failedQueryTriageRunner.run({
        candidateGrants: scope.candidateGrants,
        knowledgeSpaceId: params.id,
        tenantId: scope.subject.tenantId,
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        permission,
        subjectId: scope.subject.subjectId,
      });
      return context.json(result, 200);
    } catch (error) {
      if (error instanceof KnowledgeSpaceAccessError) {
        return context.json({ error: "Knowledge space access denied" }, 403);
      }
      throw error;
    }
  });

  app.openapi(clusterFailedQueriesRoute, async (context) => {
    const params = context.req.valid("param");
    const query = context.req.valid("query");
    const scope = await failedQueryRequestScope(context, spaces, params.id);
    if (!scope) {
      return context.json({ error: "Knowledge space not found" }, 404);
    }

    const result = await failedQueries.list({
      candidateGrants: scope.candidateGrants,
      knowledgeSpaceId: params.id,
      limit: query.limit,
      ...(query.status ? { status: query.status } : {}),
      subjectId: scope.subject.subjectId,
      tenantId: scope.subject.tenantId,
    });

    return context.json(
      {
        clusters: clusterFailedQueries(result.items).map((cluster) => ({
          clusterKey: cluster.clusterKey,
          count: cluster.count,
          failedQueryIds: [...cluster.failedQueryIds],
          representative: toFailedQueryResponse(cluster.representative),
        })),
      },
      200,
    );
  });

  app.openapi(annotateFailedQueryRoute, async (context) => {
    const params = context.req.valid("param");
    const body = context.req.valid("json");
    const scope = await failedQueryRequestScope(context, spaces, params.id);
    if (!scope) {
      return context.json({ error: "Failed query not found" }, 404);
    }

    const existing = await failedQueries.get({
      candidateGrants: scope.candidateGrants,
      id: params.failedQueryId,
      knowledgeSpaceId: params.id,
      subjectId: scope.subject.subjectId,
      tenantId: scope.subject.tenantId,
    });

    if (!existing) {
      return context.json({ error: "Failed query not found" }, 404);
    }

    // retrieval-miss -> the answer exists in the corpus; promote to a golden question so retrieval is
    // regression-tested. coverage-gap -> a known gap (no golden question). irrelevant -> dismissed.
    try {
      const permission = await issueFailedQueryPermission(context, access, scope, now);
      if (body.verdict === "retrieval-miss") {
        const expectedEvidencePermissionScope =
          existing.status === "promoted"
            ? []
            : await goldenQuestionEvidencePermissionScope({
                assets,
                candidateGrants: permission.candidateGrants,
                expectedEvidenceIds: body.expectedEvidenceIds ?? [],
                knowledgeSpaceId: params.id,
                nodes,
              });
        if (!expectedEvidencePermissionScope) {
          return context.json({ error: "Expected evidence not found" }, 404);
        }
        const promoted = await failedQueries.promote({
          candidateGrants: scope.candidateGrants,
          ...(body.expectedEvidenceIds ? { expectedEvidenceIds: body.expectedEvidenceIds } : {}),
          expectedEvidencePermissionScope,
          id: existing.id,
          knowledgeSpaceId: params.id,
          ...(body.note ? { note: body.note } : {}),
          permission,
          promotedAt: now(),
          subjectId: scope.subject.subjectId,
          tenantId: scope.subject.tenantId,
        });
        return promoted
          ? context.json(toFailedQueryResponse(promoted.failedQuery), 200)
          : context.json({ error: "Failed query not found" }, 404);
      }

      const annotatedAt = now();
      const updated = await failedQueries.update({
        candidateGrants: scope.candidateGrants,
        id: existing.id,
        knowledgeSpaceId: params.id,
        metadata: {
          ...existing.metadata,
          annotation: {
            annotatedAt,
            annotatedBy: scope.subject.subjectId,
            verdict: body.verdict,
            ...(body.expectedEvidenceIds ? { expectedEvidenceIds: body.expectedEvidenceIds } : {}),
            ...(body.note ? { note: body.note } : {}),
          },
        },
        permission,
        status: body.verdict === "coverage-gap" ? "annotated" : "dismissed",
        subjectId: scope.subject.subjectId,
        tenantId: scope.subject.tenantId,
      });

      if (!updated) {
        return context.json({ error: "Failed query not found" }, 404);
      }

      return context.json(toFailedQueryResponse(updated), 200);
    } catch (error) {
      if (error instanceof FailedQueryPromotionConflictError) {
        return context.json({ error: error.message }, 409);
      }
      if (error instanceof KnowledgeSpaceAccessError) {
        return context.json({ error: "Knowledge space access denied" }, 403);
      }
      throw error;
    }
  });
}

async function failedQueryRequestScope(
  context: Parameters<Parameters<OpenAPIHono<KnowledgeGatewayEnv>["openapi"]>[1]>[0],
  spaces: KnowledgeSpaceRepository,
  knowledgeSpaceId: string,
) {
  const subject = context.get("subject");
  const space = await spaces.get({ id: knowledgeSpaceId, tenantId: subject.tenantId });
  if (!space) return null;
  if (
    !isAuthenticatedApiKeyBoundToKnowledgeSpace({
      authenticatedApiKeyKnowledgeSpaceId: context.get("authenticatedApiKeyKnowledgeSpaceId"),
      callerKind: context.get("callerKind"),
      knowledgeSpaceId,
    })
  ) {
    return null;
  }
  const candidateGrants = currentCandidateGrants({
    decision: context.get("authorizationDecision"),
    knowledgeSpaceId,
    subject,
  });
  return candidateGrants ? { candidateGrants, knowledgeSpaceId, subject } : null;
}

async function issueFailedQueryPermission(
  context: Parameters<Parameters<OpenAPIHono<KnowledgeGatewayEnv>["openapi"]>[1]>[0],
  access: Pick<KnowledgeSpaceAccessService, "createPermissionSnapshot">,
  scope: NonNullable<Awaited<ReturnType<typeof failedQueryRequestScope>>>,
  now: () => string,
) {
  const callerKind = context.get("callerKind") ?? "interactive";
  const apiKey = context.get("authenticatedApiKey");
  const currentTime = Date.parse(now());
  const expiresAt = Math.min(
    currentTime + 24 * 60 * 60_000,
    apiKey?.expiresAt ? Date.parse(apiKey.expiresAt) : Number.POSITIVE_INFINITY,
  );
  const snapshot = await access.createPermissionSnapshot({
    accessChannel: knowledgeSpaceAccessChannelForCallerKind(callerKind),
    ...(apiKey ? { apiKey } : {}),
    expiresAt: new Date(expiresAt).toISOString(),
    knowledgeSpaceId: scope.knowledgeSpaceId,
    subjectId: scope.subject.subjectId,
    tenantId: scope.subject.tenantId,
  });
  return {
    accessChannel: snapshot.accessChannel,
    candidateGrants: [...snapshot.permissionScopes],
    permissionSnapshotId: snapshot.id,
    permissionSnapshotRevision: snapshot.revision,
    requestedBySubjectId: scope.subject.subjectId,
  };
}
