import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AnswerTrace } from "@knowledge/core";

import { getTenantScopedAnswerTrace } from "./answer-trace-access";
import { projectAnswerTraceEvidence } from "./answer-trace-evidence-projection";
import type { AnswerTraceRepository } from "./answer-trace-repository";
import {
  getAnswerTraceRoute,
  listQueryConflictsRoute,
  listQueryEvidenceRoute,
  listQueryMissingRoute,
} from "./answer-trace-routes";
import { isAuthenticatedApiKeyBoundToKnowledgeSpace } from "./auth";
import type { DocumentAssetRepository } from "./document-asset-repository";
import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import { KnowledgeFsValidationError } from "./knowledge-fs-errors";
import type { KnowledgeNodeRepository } from "./knowledge-node-repository";
import type { KnowledgeSpaceAccessService } from "./knowledge-space-access-control";
import {
  KnowledgeSpaceAuthorizationError,
  type KnowledgeSpaceAuthorizationGuard,
  revalidateKnowledgeSpaceDurablePermission,
} from "./knowledge-space-authorization";
import type { KnowledgeSpaceRepository } from "./knowledge-space-repository";
import {
  paginateQueryVirtualEntries,
  queryConflictEntries,
  queryEvidenceEntries,
  queryMissingEntries,
} from "./query-virtual-entries";

export interface RegisterAnswerTraceHandlersOptions {
  readonly access: Pick<KnowledgeSpaceAccessService, "revalidatePermissionSnapshot">;
  readonly answerTraceRepository: AnswerTraceRepository;
  readonly app: OpenAPIHono<KnowledgeGatewayEnv>;
  readonly authorization: KnowledgeSpaceAuthorizationGuard;
  readonly assets: Pick<DocumentAssetRepository, "get" | "getManyByIds">;
  readonly nodes: Pick<KnowledgeNodeRepository, "getManyByIdsAcrossGenerations">;
  readonly spaces: KnowledgeSpaceRepository;
}

export function registerAnswerTraceHandlers({
  access,
  answerTraceRepository,
  app,
  authorization,
  assets,
  nodes,
  spaces,
}: RegisterAnswerTraceHandlersOptions): void {
  app.openapi(getAnswerTraceRoute, async (context) => {
    const subject = context.get("subject");
    const params = context.req.valid("param");
    const trace = await answerTraceRepository.getById(params.traceId);

    if (!trace) {
      return context.json({ error: "Answer trace not found" }, 404);
    }

    const space = await spaces.get({
      id: trace.knowledgeSpaceId,
      tenantId: subject.tenantId,
    });

    if (!space) {
      return context.json({ error: "Answer trace not found" }, 404);
    }

    if (!apiKeyMatchesTraceSpace(context, trace.knowledgeSpaceId)) {
      return context.json({ error: "Knowledge space access denied" }, 403);
    }

    if (
      !traceHasCurrentCapability(context, trace) &&
      (trace.subjectId !== subject.subjectId || !trace.permissionSnapshot)
    ) {
      return context.json({ error: "Answer trace not found" }, 404);
    }

    const candidateGrants = await authorizeTrace(context, access, authorization, trace);
    if (!candidateGrants) {
      return context.json({ error: "Knowledge space access denied" }, 403);
    }

    const projection = await projectAnswerTraceEvidence({ assets, candidateGrants, nodes, trace });
    if (!projection) {
      return context.json({ error: "Answer trace not found" }, 404);
    }

    return context.json(toAnswerTraceResponse(projection.trace), 200);
  });

  app.openapi(listQueryEvidenceRoute, async (context) => {
    try {
      const subject = context.get("subject");
      const params = context.req.valid("param");
      const query = context.req.valid("query");
      const trace = await getTenantScopedAnswerTrace({
        answerTraceRepository,
        spaces,
        subject,
        traceId: params.traceId,
      });

      if (!trace) {
        return context.json({ error: "Answer trace not found" }, 404);
      }

      if (!apiKeyMatchesTraceSpace(context, trace.knowledgeSpaceId)) {
        return context.json({ error: "Knowledge space access denied" }, 403);
      }

      if (
        !traceHasCurrentCapability(context, trace) &&
        (trace.subjectId !== subject.subjectId || !trace.permissionSnapshot)
      ) {
        return context.json({ error: "Answer trace not found" }, 404);
      }

      const candidateGrants = await authorizeTrace(context, access, authorization, trace);
      if (!candidateGrants) {
        return context.json({ error: "Knowledge space access denied" }, 403);
      }

      const projection = await projectAnswerTraceEvidence({
        assets,
        candidateGrants,
        nodes,
        trace,
      });
      if (!projection) {
        return context.json({ error: "Answer trace not found" }, 404);
      }

      return context.json(
        paginateQueryVirtualEntries({
          cursor: query.cursor,
          entries: projection.bundle ? queryEvidenceEntries(params.traceId, projection.bundle) : [],
          limit: query.limit,
          path: `/queries/${params.traceId}/evidence`,
        }),
        200,
      );
    } catch (error) {
      if (error instanceof KnowledgeFsValidationError) {
        return context.json({ error: error.message }, 400);
      }

      /* v8 ignore next 2 -- unexpected query evidence failures should escape to Hono. */
      throw error;
    }
  });

  app.openapi(listQueryConflictsRoute, async (context) => {
    try {
      const subject = context.get("subject");
      const params = context.req.valid("param");
      const query = context.req.valid("query");
      const trace = await getTenantScopedAnswerTrace({
        answerTraceRepository,
        spaces,
        subject,
        traceId: params.traceId,
      });

      if (!trace) {
        return context.json({ error: "Answer trace not found" }, 404);
      }

      if (!apiKeyMatchesTraceSpace(context, trace.knowledgeSpaceId)) {
        return context.json({ error: "Knowledge space access denied" }, 403);
      }

      if (
        !traceHasCurrentCapability(context, trace) &&
        (trace.subjectId !== subject.subjectId || !trace.permissionSnapshot)
      ) {
        return context.json({ error: "Answer trace not found" }, 404);
      }

      const candidateGrants = await authorizeTrace(context, access, authorization, trace);
      if (!candidateGrants) {
        return context.json({ error: "Knowledge space access denied" }, 403);
      }

      const projection = await projectAnswerTraceEvidence({
        assets,
        candidateGrants,
        nodes,
        trace,
      });
      if (!projection) {
        return context.json({ error: "Answer trace not found" }, 404);
      }

      return context.json(
        paginateQueryVirtualEntries({
          cursor: query.cursor,
          entries: projection.bundle ? queryConflictEntries(params.traceId, projection.bundle) : [],
          limit: query.limit,
          path: `/queries/${params.traceId}/conflicts`,
        }),
        200,
      );
    } catch (error) {
      if (error instanceof KnowledgeFsValidationError) {
        return context.json({ error: error.message }, 400);
      }

      /* v8 ignore next 2 -- unexpected query conflict failures should escape to Hono. */
      throw error;
    }
  });

  app.openapi(listQueryMissingRoute, async (context) => {
    try {
      const subject = context.get("subject");
      const params = context.req.valid("param");
      const query = context.req.valid("query");
      const trace = await getTenantScopedAnswerTrace({
        answerTraceRepository,
        spaces,
        subject,
        traceId: params.traceId,
      });

      if (!trace) {
        return context.json({ error: "Answer trace not found" }, 404);
      }

      if (!apiKeyMatchesTraceSpace(context, trace.knowledgeSpaceId)) {
        return context.json({ error: "Knowledge space access denied" }, 403);
      }

      if (
        !traceHasCurrentCapability(context, trace) &&
        (trace.subjectId !== subject.subjectId || !trace.permissionSnapshot)
      ) {
        return context.json({ error: "Answer trace not found" }, 404);
      }

      const candidateGrants = await authorizeTrace(context, access, authorization, trace);
      if (!candidateGrants) {
        return context.json({ error: "Knowledge space access denied" }, 403);
      }

      const projection = await projectAnswerTraceEvidence({
        assets,
        candidateGrants,
        nodes,
        trace,
      });
      if (!projection) {
        return context.json({ error: "Answer trace not found" }, 404);
      }

      return context.json(
        paginateQueryVirtualEntries({
          cursor: query.cursor,
          entries: projection.bundle ? queryMissingEntries(params.traceId, projection.bundle) : [],
          limit: query.limit,
          path: `/queries/${params.traceId}/missing`,
        }),
        200,
      );
    } catch (error) {
      if (error instanceof KnowledgeFsValidationError) {
        return context.json({ error: error.message }, 400);
      }

      /* v8 ignore next 2 -- unexpected query missing-evidence failures should escape to Hono. */
      throw error;
    }
  });
}

function toAnswerTraceResponse(
  trace: AnswerTrace,
): Omit<AnswerTrace, "capabilityGrantId" | "permissionSnapshot" | "subjectId" | "tenantId"> {
  const {
    capabilityGrantId: _capabilityGrantId,
    permissionSnapshot: _permissionSnapshot,
    subjectId: _subjectId,
    tenantId: _tenantId,
    ...response
  } = trace;
  return response;
}

function traceHasCurrentCapability(
  context: Parameters<Parameters<OpenAPIHono<KnowledgeGatewayEnv>["openapi"]>[1]>[0],
  trace: AnswerTrace,
): boolean {
  const grant = context.get("capabilityV2Grant");
  const subject = context.get("subject");
  return Boolean(
    grant?.resource.type === "query" &&
      grant.resource.id === trace.id &&
      grant.resource.parent_id === trace.knowledgeSpaceId &&
      grant.namespaceId === subject.tenantId &&
      grant.subject === subject.subjectId,
  );
}

function apiKeyMatchesTraceSpace(
  context: Parameters<Parameters<OpenAPIHono<KnowledgeGatewayEnv>["openapi"]>[1]>[0],
  knowledgeSpaceId: string,
): boolean {
  return isAuthenticatedApiKeyBoundToKnowledgeSpace({
    authenticatedApiKeyKnowledgeSpaceId: context.get("authenticatedApiKeyKnowledgeSpaceId"),
    callerKind: context.get("callerKind"),
    knowledgeSpaceId,
  });
}

async function authorizeTrace(
  context: Parameters<Parameters<OpenAPIHono<KnowledgeGatewayEnv>["openapi"]>[1]>[0],
  access: Pick<KnowledgeSpaceAccessService, "revalidatePermissionSnapshot">,
  authorization: KnowledgeSpaceAuthorizationGuard,
  trace: AnswerTrace,
): Promise<readonly string[] | null> {
  const capabilityGrant = context.get("capabilityV2Grant");
  if (traceHasCurrentCapability(context, trace) && capabilityGrant) {
    return [...capabilityGrant.contentScopeIds];
  }
  if (!trace.permissionSnapshot) {
    return null;
  }
  try {
    const permission = await revalidateKnowledgeSpaceDurablePermission({
      access,
      callerKind: context.get("callerKind") ?? "interactive",
      currentApiKeyId: context.get("authenticatedApiKey")?.id,
      knowledgeSpaceId: trace.knowledgeSpaceId,
      permissionSnapshot: trace.permissionSnapshot,
      subject: context.get("subject"),
    });
    await authorization.authorize({
      callerKind: context.get("callerKind") ?? "interactive",
      knowledgeSpaceId: trace.knowledgeSpaceId,
      requiredAccess: "read",
      subject: context.get("subject"),
    });
    return [...permission.permissionScopes];
  } catch (error) {
    if (error instanceof KnowledgeSpaceAuthorizationError) {
      return null;
    }
    throw error;
  }
}
