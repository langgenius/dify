import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AnswerTrace } from "@knowledge/core";

import { getTenantScopedAnswerTrace } from "./answer-trace-access";
import type { AnswerTraceRepository } from "./answer-trace-repository";
import {
  getAnswerTraceRoute,
  listQueryConflictsRoute,
  listQueryEvidenceRoute,
  listQueryMissingRoute,
} from "./answer-trace-routes";
import { isAuthenticatedApiKeyBoundToKnowledgeSpace } from "./auth";
import {
  candidatePermissionAllowsAsset,
  candidatePermissionAllowsNode,
} from "./candidate-content-authorization";
import type { DocumentAssetRepository } from "./document-asset-repository";
import { evidenceBundlesHaveActiveDocuments } from "./evidence-bundle-visibility";
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
  evidenceBundleFromAnswerTrace,
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
  readonly assets: Pick<DocumentAssetRepository, "get">;
  readonly nodes: Pick<KnowledgeNodeRepository, "getMany">;
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

    if (!(await traceEvidenceIsCurrentlyVisible(assets, nodes, trace, candidateGrants))) {
      return context.json({ error: "Answer trace not found" }, 404);
    }

    return context.json(toAnswerTraceResponse(trace), 200);
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

      const bundle = evidenceBundleFromAnswerTrace(trace);
      if (!(await traceEvidenceIsCurrentlyVisible(assets, nodes, trace, candidateGrants))) {
        return context.json({ error: "Answer trace not found" }, 404);
      }

      return context.json(
        paginateQueryVirtualEntries({
          cursor: query.cursor,
          entries: bundle ? queryEvidenceEntries(params.traceId, bundle) : [],
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

      const bundle = evidenceBundleFromAnswerTrace(trace);
      if (!(await traceEvidenceIsCurrentlyVisible(assets, nodes, trace, candidateGrants))) {
        return context.json({ error: "Answer trace not found" }, 404);
      }

      return context.json(
        paginateQueryVirtualEntries({
          cursor: query.cursor,
          entries: bundle ? queryConflictEntries(params.traceId, bundle) : [],
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

      const bundle = evidenceBundleFromAnswerTrace(trace);
      if (!(await traceEvidenceIsCurrentlyVisible(assets, nodes, trace, candidateGrants))) {
        return context.json({ error: "Answer trace not found" }, 404);
      }

      return context.json(
        paginateQueryVirtualEntries({
          cursor: query.cursor,
          entries: bundle ? queryMissingEntries(params.traceId, bundle) : [],
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

async function traceEvidenceIsCurrentlyVisible(
  assets: Pick<DocumentAssetRepository, "get">,
  nodes: Pick<KnowledgeNodeRepository, "getMany">,
  trace: AnswerTrace,
  candidateGrants: readonly string[],
): Promise<boolean> {
  const bundle = evidenceBundleFromAnswerTrace(trace);
  if (!bundle) return trace.evidenceBundleId === undefined;
  if (
    !(await evidenceBundlesHaveActiveDocuments({
      assets,
      bundles: [bundle],
      knowledgeSpaceId: trace.knowledgeSpaceId,
    }))
  ) {
    return false;
  }
  const nodeIds = [
    ...new Set([
      ...bundle.items.map((item) => item.nodeId),
      ...bundle.items.flatMap((item) =>
        item.conflicts.flatMap((conflict) => (conflict.withNodeId ? [conflict.withNodeId] : [])),
      ),
      ...bundle.missingEvidence.flatMap((item) =>
        item.expectedEvidenceId ? [item.expectedEvidenceId] : [],
      ),
    ]),
  ];
  const foundNodes = await nodes.getMany({
    ids: nodeIds,
    knowledgeSpaceId: trace.knowledgeSpaceId,
  });
  const foundNodeIds = new Set(foundNodes.map((node) => node.id));
  if (bundle.items.some((item) => !foundNodeIds.has(item.nodeId))) return false;
  if (foundNodes.some((node) => !candidatePermissionAllowsNode(node, candidateGrants))) {
    return false;
  }
  const assetIds = [
    ...new Set([
      ...foundNodes.map((node) => node.documentAssetId),
      ...bundle.items.flatMap((item) => item.citations.map((citation) => citation.documentAssetId)),
    ]),
  ];
  const foundAssets = await Promise.all(
    assetIds.map((id) => assets.get({ id, knowledgeSpaceId: trace.knowledgeSpaceId })),
  );
  return foundAssets.every(
    (asset) => asset !== null && candidatePermissionAllowsAsset(asset, candidateGrants),
  );
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
