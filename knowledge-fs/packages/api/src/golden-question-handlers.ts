import type { OpenAPIHono } from "@hono/zod-openapi";
import type { EvidenceBundle, GoldenQuestion } from "@knowledge/core";

import { getTenantScopedAnswerTrace } from "./answer-trace-access";
import type { AnswerTraceRepository } from "./answer-trace-repository";
import { uniqueStrings } from "./api-shared-utils";
import { isAuthenticatedApiKeyBoundToKnowledgeSpace } from "./auth";
import {
  candidatePermissionAllowsAsset,
  candidatePermissionAllowsNode,
  candidatePermissionScopeSnapshot,
  currentCandidateGrants,
} from "./candidate-content-authorization";
import { decodeGoldenQuestionCursor, encodeGoldenQuestionCursor } from "./cursor-utils";
import { issueKnowledgeSpaceDurablePermission } from "./derived-result-authorization";
import type { DocumentAssetRepository } from "./document-asset-repository";
import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import { annotatedGoldenQuestionMetadata } from "./golden-question-annotation";
import {
  GoldenQuestionCapacityExceededError,
  GoldenQuestionListLimitExceededError,
  type GoldenQuestionRepository,
} from "./golden-question-repository";
import {
  annotateGoldenQuestionRoute,
  createGoldenQuestionRoute,
  createProductionBadCaseRoute,
  deleteGoldenQuestionRoute,
  getGoldenQuestionRoute,
  listGoldenQuestionsRoute,
  updateGoldenQuestionRoute,
} from "./golden-question-routes";
import { KnowledgeFsValidationError } from "./knowledge-fs-errors";
import type { KnowledgeNodeRepository } from "./knowledge-node-repository";
import type { KnowledgeSpaceAccessService } from "./knowledge-space-access-control";
import { KnowledgeSpaceAccessError } from "./knowledge-space-access-control";
import {
  KnowledgeSpaceAuthorizationError,
  type KnowledgeSpaceAuthorizationGuard,
  revalidateKnowledgeSpaceDurablePermission,
} from "./knowledge-space-authorization";
import type { KnowledgeSpaceRepository } from "./knowledge-space-repository";
import {
  evidenceBundleFromAnswerTrace,
  productionBadCaseGoldenQuestionInput,
} from "./query-virtual-entries";

export interface RegisterGoldenQuestionHandlersOptions {
  readonly access: Pick<
    KnowledgeSpaceAccessService,
    "createPermissionSnapshot" | "revalidatePermissionSnapshot"
  >;
  readonly answerTraceRepository: AnswerTraceRepository;
  readonly app: OpenAPIHono<KnowledgeGatewayEnv>;
  readonly assets: Pick<DocumentAssetRepository, "get">;
  readonly authorization: KnowledgeSpaceAuthorizationGuard;
  readonly nodes: Pick<KnowledgeNodeRepository, "getMany">;
  readonly now: () => string;
  readonly questions: GoldenQuestionRepository;
  readonly spaces: KnowledgeSpaceRepository;
}

export function registerGoldenQuestionHandlers({
  access,
  answerTraceRepository,
  app,
  assets,
  authorization,
  nodes,
  now,
  questions,
  spaces,
}: RegisterGoldenQuestionHandlersOptions): void {
  app.openapi(createGoldenQuestionRoute, async (context) => {
    try {
      const subject = context.get("subject");
      const knowledgeSpaceId = context.req.valid("param").id;
      const space = await spaces.get({
        id: knowledgeSpaceId,
        tenantId: subject.tenantId,
      });

      if (!space) {
        return context.json({ error: "Knowledge space not found" }, 404);
      }

      const permission = await issueGoldenQuestionWritePermission({
        access,
        authorization,
        context,
        knowledgeSpaceId,
        now,
      });
      const body = context.req.valid("json");
      const requiredPermissionScope = await goldenQuestionEvidencePermissionScope({
        assets,
        candidateGrants: permission.candidateGrants,
        expectedEvidenceIds: body.expectedEvidenceIds ?? [],
        knowledgeSpaceId,
        nodes,
      });
      if (!requiredPermissionScope) {
        return context.json({ error: "Expected evidence not found" }, 404);
      }
      const question = await questions.create({
        ...body,
        knowledgeSpaceId,
        permission,
        requiredPermissionScope,
      });

      return context.json(question, 201);
    } catch (error) {
      if (error instanceof GoldenQuestionCapacityExceededError) {
        return context.json({ error: error.message }, 429);
      }
      if (isGoldenQuestionPermissionError(error)) {
        return context.json({ error: "Knowledge space access denied" }, 403);
      }

      throw error;
    }
  });

  app.openapi(listGoldenQuestionsRoute, async (context) => {
    try {
      const subject = context.get("subject");
      const params = context.req.valid("param");
      const space = await spaces.get({
        id: params.id,
        tenantId: subject.tenantId,
      });

      if (!space) {
        return context.json({ error: "Golden question not found" }, 404);
      }

      const readScope = goldenQuestionReadScope(context, params.id);
      if (!readScope) {
        return context.json({ error: "Knowledge space access denied" }, 403);
      }

      const query = context.req.valid("query");
      const result = await questions.list({
        ...(query.cursor ? { cursor: decodeGoldenQuestionCursor(query.cursor) } : {}),
        ...readScope,
        knowledgeSpaceId: params.id,
        limit: query.limit,
      });

      return context.json(
        {
          items: result.items,
          ...(result.nextCursor
            ? { nextCursor: encodeGoldenQuestionCursor(result.nextCursor) }
            : {}),
        },
        200,
      );
    } catch (error) {
      if (
        error instanceof GoldenQuestionListLimitExceededError ||
        error instanceof KnowledgeFsValidationError
      ) {
        return context.json({ error: error.message }, 400);
      }

      /* v8 ignore next 2 -- unexpected golden-question list failures should escape to Hono. */
      throw error;
    }
  });

  app.openapi(getGoldenQuestionRoute, async (context) => {
    const subject = context.get("subject");
    const params = context.req.valid("param");
    const space = await spaces.get({
      id: params.id,
      tenantId: subject.tenantId,
    });

    if (!space) {
      return context.json({ error: "Golden question not found" }, 404);
    }

    const readScope = goldenQuestionReadScope(context, params.id);
    if (!readScope) {
      return context.json({ error: "Golden question not found" }, 404);
    }

    const question = await questions.get({
      ...readScope,
      id: params.questionId,
      knowledgeSpaceId: params.id,
    });

    if (!question) {
      return context.json({ error: "Golden question not found" }, 404);
    }

    return context.json(question, 200);
  });

  app.openapi(updateGoldenQuestionRoute, async (context) => {
    const subject = context.get("subject");
    const params = context.req.valid("param");
    const space = await spaces.get({
      id: params.id,
      tenantId: subject.tenantId,
    });

    if (!space) {
      return context.json({ error: "Golden question not found" }, 404);
    }

    let question: GoldenQuestion | null = null;
    try {
      const permission = await issueGoldenQuestionWritePermission({
        access,
        authorization,
        context,
        knowledgeSpaceId: params.id,
        now,
      });
      const body = context.req.valid("json");
      const requiredPermissionScope = body.expectedEvidenceIds
        ? await goldenQuestionEvidencePermissionScope({
            assets,
            candidateGrants: permission.candidateGrants,
            expectedEvidenceIds: body.expectedEvidenceIds,
            knowledgeSpaceId: params.id,
            nodes,
          })
        : undefined;
      if (requiredPermissionScope === null) {
        return context.json({ error: "Expected evidence not found" }, 404);
      }
      question = await questions.update({
        ...body,
        id: params.questionId,
        knowledgeSpaceId: params.id,
        permission,
        ...(requiredPermissionScope === undefined ? {} : { requiredPermissionScope }),
      });
    } catch (error) {
      if (isGoldenQuestionPermissionError(error)) {
        return context.json({ error: "Knowledge space access denied" }, 403);
      }
      throw error;
    }

    if (!question) {
      return context.json({ error: "Golden question not found" }, 404);
    }

    return context.json(question, 200);
  });

  app.openapi(annotateGoldenQuestionRoute, async (context) => {
    const subject = context.get("subject");
    const params = context.req.valid("param");
    const space = await spaces.get({
      id: params.id,
      tenantId: subject.tenantId,
    });

    if (!space) {
      return context.json({ error: "Golden question not found" }, 404);
    }

    let annotated: GoldenQuestion | null = null;
    try {
      const permission = await issueGoldenQuestionWritePermission({
        access,
        authorization,
        context,
        knowledgeSpaceId: params.id,
        now,
      });
      const question = await questions.get({
        candidateGrants: permission.candidateGrants,
        id: params.questionId,
        knowledgeSpaceId: params.id,
        tenantId: permission.tenantId,
      });
      if (!question) {
        return context.json({ error: "Golden question not found" }, 404);
      }
      annotated = await questions.update({
        id: params.questionId,
        knowledgeSpaceId: params.id,
        metadata: annotatedGoldenQuestionMetadata({
          annotatedAt: now(),
          input: context.req.valid("json"),
          question,
          subject,
        }),
        permission,
        tags: uniqueStrings([...question.tags, "annotated"]),
      });
    } catch (error) {
      if (isGoldenQuestionPermissionError(error)) {
        return context.json({ error: "Knowledge space access denied" }, 403);
      }
      throw error;
    }

    if (!annotated) {
      return context.json({ error: "Golden question not found" }, 404);
    }

    return context.json(annotated, 200);
  });

  app.openapi(deleteGoldenQuestionRoute, async (context) => {
    const subject = context.get("subject");
    const params = context.req.valid("param");
    const space = await spaces.get({
      id: params.id,
      tenantId: subject.tenantId,
    });

    if (!space) {
      return context.json({ error: "Golden question not found" }, 404);
    }

    let deleted = false;
    try {
      const permission = await issueGoldenQuestionWritePermission({
        access,
        authorization,
        context,
        knowledgeSpaceId: params.id,
        now,
      });
      deleted = await questions.delete({
        id: params.questionId,
        knowledgeSpaceId: params.id,
        permission,
      });
    } catch (error) {
      if (isGoldenQuestionPermissionError(error)) {
        return context.json({ error: "Knowledge space access denied" }, 403);
      }
      throw error;
    }

    if (!deleted) {
      return context.json({ error: "Golden question not found" }, 404);
    }

    return context.body(null, 204);
  });

  app.openapi(createProductionBadCaseRoute, async (context) => {
    try {
      const subject = context.get("subject");
      const params = context.req.valid("param");
      const body = context.req.valid("json");
      const trace = await getTenantScopedAnswerTrace({
        answerTraceRepository,
        spaces,
        subject,
        traceId: body.traceId,
      });

      if (!trace || trace.knowledgeSpaceId !== params.id) {
        return context.json({ error: "Answer trace not found" }, 404);
      }

      if (
        !isAuthenticatedApiKeyBoundToKnowledgeSpace({
          authenticatedApiKeyKnowledgeSpaceId: context.get("authenticatedApiKeyKnowledgeSpaceId"),
          callerKind: context.get("callerKind"),
          knowledgeSpaceId: trace.knowledgeSpaceId,
        })
      ) {
        return context.json({ error: "Knowledge space access denied" }, 403);
      }

      if (trace.subjectId !== subject.subjectId || !trace.permissionSnapshot) {
        return context.json({ error: "Answer trace not found" }, 404);
      }

      const callerKind = context.get("callerKind") ?? "interactive";
      let permissionScopes: readonly string[];
      try {
        const durablePermission = await revalidateKnowledgeSpaceDurablePermission({
          access,
          callerKind,
          currentApiKeyId: context.get("authenticatedApiKey")?.id,
          knowledgeSpaceId: trace.knowledgeSpaceId,
          permissionSnapshot: trace.permissionSnapshot,
          subject,
        });
        await authorization.authorize({
          callerKind,
          knowledgeSpaceId: trace.knowledgeSpaceId,
          requiredAccess: "write",
          subject,
        });
        permissionScopes = durablePermission.permissionScopes;
      } catch (error) {
        if (error instanceof KnowledgeSpaceAuthorizationError) {
          return context.json({ error: "Knowledge space access denied" }, 403);
        }
        throw error;
      }

      const requiredPermissionScope = await productionBadCaseEvidencePermissionScope({
        assets,
        bundle: evidenceBundleFromAnswerTrace(trace),
        knowledgeSpaceId: trace.knowledgeSpaceId,
        nodes,
        permissionScopes,
      });
      if (!requiredPermissionScope) {
        return context.json({ error: "Answer trace not found" }, 404);
      }

      const permission = await issueGoldenQuestionWritePermission({
        access,
        authorization,
        context,
        knowledgeSpaceId: params.id,
        now,
      });
      const captured = await questions.create({
        ...productionBadCaseGoldenQuestionInput({
          reason: body.reason,
          tags: body.tags,
          trace,
        }),
        permission,
        requiredPermissionScope,
      });

      return context.json(captured, 201);
    } catch (error) {
      if (error instanceof GoldenQuestionCapacityExceededError) {
        return context.json({ error: error.message }, 429);
      }
      if (isGoldenQuestionPermissionError(error)) {
        return context.json({ error: "Knowledge space access denied" }, 403);
      }

      throw error;
    }
  });
}

function goldenQuestionReadScope(
  context: Parameters<Parameters<OpenAPIHono<KnowledgeGatewayEnv>["openapi"]>[1]>[0],
  knowledgeSpaceId: string,
) {
  const subject = context.get("subject");
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
  return candidateGrants ? { candidateGrants, tenantId: subject.tenantId } : null;
}

async function issueGoldenQuestionWritePermission(input: {
  readonly access: Pick<KnowledgeSpaceAccessService, "createPermissionSnapshot">;
  readonly authorization: KnowledgeSpaceAuthorizationGuard;
  readonly context: Parameters<Parameters<OpenAPIHono<KnowledgeGatewayEnv>["openapi"]>[1]>[0];
  readonly knowledgeSpaceId: string;
  readonly now: () => string;
}) {
  const subject = input.context.get("subject");
  const callerKind = input.context.get("callerKind") ?? "interactive";
  const apiKey = input.context.get("authenticatedApiKey");
  const currentTime = Date.parse(input.now());
  const expiresAt = Math.min(
    currentTime + 24 * 60 * 60_000,
    apiKey?.expiresAt ? Date.parse(apiKey.expiresAt) : Number.POSITIVE_INFINITY,
  );
  const snapshot = await issueKnowledgeSpaceDurablePermission({
    access: input.access,
    ...(apiKey ? { apiKey } : {}),
    authorization: input.authorization,
    callerKind,
    expiresAt: new Date(expiresAt).toISOString(),
    knowledgeSpaceId: input.knowledgeSpaceId,
    requiredAccess: "write",
    subject,
  });
  return {
    accessChannel: snapshot.accessChannel,
    candidateGrants: [...snapshot.permissionScopes],
    permissionSnapshotId: snapshot.id,
    permissionSnapshotRevision: snapshot.revision,
    requestedBySubjectId: subject.subjectId,
    tenantId: subject.tenantId,
  };
}

function isGoldenQuestionPermissionError(error: unknown): boolean {
  return (
    error instanceof KnowledgeSpaceAccessError || error instanceof KnowledgeSpaceAuthorizationError
  );
}

/**
 * A trace is only promotable when every concrete evidence reference is still visible through the
 * durable candidate grant that produced it. Missing-evidence ids are allowed to remain absent, but
 * an id that now resolves to hidden content also fails closed.
 */
async function productionBadCaseEvidencePermissionScope(input: {
  readonly assets: Pick<DocumentAssetRepository, "get">;
  readonly bundle: EvidenceBundle | null;
  readonly knowledgeSpaceId: string;
  readonly nodes: Pick<KnowledgeNodeRepository, "getMany">;
  readonly permissionScopes: readonly string[];
}): Promise<readonly string[] | null> {
  if (!input.bundle) {
    return [];
  }

  const requiredNodeIds = uniqueStrings([
    ...input.bundle.items.map((item) => item.nodeId),
    ...input.bundle.items.flatMap((item) =>
      item.conflicts
        .map((conflict) => conflict.withNodeId)
        .filter((id): id is string => id !== undefined),
    ),
  ]);
  const optionalMissingNodeIds = uniqueStrings(
    input.bundle.missingEvidence
      .map((missing) => missing.expectedEvidenceId)
      .filter((id): id is string => id !== undefined),
  );
  const referencedNodes = await input.nodes.getMany({
    ids: uniqueStrings([...requiredNodeIds, ...optionalMissingNodeIds]),
    knowledgeSpaceId: input.knowledgeSpaceId,
  });
  const nodesById = new Map(referencedNodes.map((node) => [node.id, node]));

  if (requiredNodeIds.some((nodeId) => !nodesById.has(nodeId))) {
    return null;
  }
  if (
    referencedNodes.some((node) => !candidatePermissionAllowsNode(node, input.permissionScopes))
  ) {
    return null;
  }

  const referencedAssetIds = uniqueStrings([
    ...referencedNodes.map((node) => node.documentAssetId),
    ...input.bundle.items.flatMap((item) =>
      item.citations.map((citation) => citation.documentAssetId),
    ),
  ]);
  const referencedAssets = await Promise.all(
    referencedAssetIds.map((id) =>
      input.assets.get({ id, knowledgeSpaceId: input.knowledgeSpaceId }),
    ),
  );

  if (
    referencedAssets.some(
      (asset) => asset === null || !candidatePermissionAllowsAsset(asset, input.permissionScopes),
    )
  ) {
    return null;
  }
  const requiredPermissionScope = new Set<string>();
  for (const node of referencedNodes) {
    const scope = candidatePermissionScopeSnapshot(node.permissionScope);
    if (!scope) return null;
    for (const grant of scope) requiredPermissionScope.add(grant);
  }
  for (const asset of referencedAssets) {
    const scope = candidatePermissionScopeSnapshot(asset?.metadata.permissionScope);
    if (!scope) return null;
    for (const grant of scope) requiredPermissionScope.add(grant);
  }
  if (optionalMissingNodeIds.some((id) => !nodesById.has(id))) {
    const fallback = candidatePermissionScopeSnapshot(input.permissionScopes);
    if (!fallback) return null;
    for (const grant of fallback) requiredPermissionScope.add(grant);
  }
  return [...requiredPermissionScope].sort();
}

export async function goldenQuestionEvidencePermissionScope(input: {
  readonly assets: Pick<DocumentAssetRepository, "get">;
  readonly candidateGrants: readonly string[];
  readonly expectedEvidenceIds: readonly string[];
  readonly knowledgeSpaceId: string;
  readonly nodes: Pick<KnowledgeNodeRepository, "getMany">;
}): Promise<readonly string[] | null> {
  const evidenceIds = uniqueStrings(input.expectedEvidenceIds);
  if (evidenceIds.length !== input.expectedEvidenceIds.length) return null;
  if (evidenceIds.length === 0) return [];
  const nodes = await input.nodes.getMany({
    ids: evidenceIds,
    knowledgeSpaceId: input.knowledgeSpaceId,
  });
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const directAssetIds = evidenceIds.filter((id) => !nodesById.has(id));
  const directAssets = await Promise.all(
    directAssetIds.map((id) => input.assets.get({ id, knowledgeSpaceId: input.knowledgeSpaceId })),
  );
  if (directAssets.some((asset) => !asset)) return null;
  const backingAssetIds = uniqueStrings(nodes.map((node) => node.documentAssetId));
  const backingAssets = await Promise.all(
    backingAssetIds.map((id) => input.assets.get({ id, knowledgeSpaceId: input.knowledgeSpaceId })),
  );
  if (backingAssets.some((asset) => !asset)) return null;

  const requiredPermissionScope = new Set<string>();
  for (const node of nodes) {
    if (!candidatePermissionAllowsNode(node, input.candidateGrants)) return null;
    const scope = candidatePermissionScopeSnapshot(node.permissionScope);
    if (!scope) return null;
    for (const grant of scope) requiredPermissionScope.add(grant);
  }
  for (const asset of [...directAssets, ...backingAssets]) {
    if (!asset || !candidatePermissionAllowsAsset(asset, input.candidateGrants)) return null;
    const scope = candidatePermissionScopeSnapshot(asset.metadata.permissionScope);
    if (!scope) return null;
    for (const grant of scope) requiredPermissionScope.add(grant);
  }
  return [...requiredPermissionScope].sort();
}
