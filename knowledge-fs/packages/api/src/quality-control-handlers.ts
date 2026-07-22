import { createHash } from "node:crypto";

import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AnswerTrace, EvidenceBundle } from "@knowledge/core";

import type { AnswerTraceRepository } from "./answer-trace-repository";
import { isAuthenticatedApiKeyBoundToKnowledgeSpace } from "./auth";
import {
  candidatePermissionAllowsAsset,
  candidatePermissionAllowsNode,
  currentCandidateGrants,
} from "./candidate-content-authorization";
import type { DocumentAssetRepository } from "./document-asset-repository";
import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import type { GoldenQuestionRepository } from "./golden-question-repository";
import type { KnowledgeNodeRepository } from "./knowledge-node-repository";
import {
  KnowledgeSpaceAccessError,
  type KnowledgeSpaceAccessService,
} from "./knowledge-space-access-control";
import { knowledgeSpaceAccessChannelForCallerKind } from "./knowledge-space-authorization";
import type { KnowledgeSpaceRepository } from "./knowledge-space-repository";
import type { PublishedKnowledgeSpaceRuntimeSnapshotResolver } from "./published-knowledge-space-runtime-snapshot";
import {
  type ProductionBadCase,
  type QualityControlRepository,
  type QualityReplayRun,
  type QualityTrendReport,
  freezeQualityRuntimeSnapshot,
} from "./quality-control";
import {
  QualityControlIdempotencyConflictError,
  QualityControlRevisionConflictError,
} from "./quality-control-database-repository";
import {
  badCaseHistoryRoute,
  cancelQualityReplayRoute,
  createQualityBadCaseRoute,
  createQualityReplayRoute,
  decodeQualityCursor,
  encodeQualityCursor,
  getQualityBadCaseRoute,
  getQualityReplayRoute,
  listQualityBadCasesRoute,
  listQualityReplaysRoute,
  listQualityTracesRoute,
  missingEvidenceHistoryRoute,
  qualityTrendsRoute,
  retryQualityReplayRoute,
  reviewMissingEvidenceRoute,
  updateQualityBadCaseRoute,
} from "./quality-control-routes";
import { evidenceBundleFromAnswerTrace } from "./query-virtual-entries";

export interface RegisterQualityControlHandlersOptions {
  readonly access: Pick<
    KnowledgeSpaceAccessService,
    "createPermissionSnapshot" | "revalidatePermissionSnapshot"
  >;
  readonly answerTraces: AnswerTraceRepository;
  readonly app: OpenAPIHono<KnowledgeGatewayEnv>;
  readonly assets: Pick<DocumentAssetRepository, "get">;
  readonly goldenQuestions: GoldenQuestionRepository;
  readonly nodes: Pick<KnowledgeNodeRepository, "getMany">;
  readonly repository?: QualityControlRepository | undefined;
  readonly runtimeSnapshots?: PublishedKnowledgeSpaceRuntimeSnapshotResolver | undefined;
  readonly spaces: Pick<KnowledgeSpaceRepository, "get">;
  readonly now?: (() => number) | undefined;
}

export function registerQualityControlHandlers({
  access,
  answerTraces,
  app,
  assets,
  goldenQuestions,
  nodes,
  repository,
  runtimeSnapshots,
  spaces,
  now = Date.now,
}: RegisterQualityControlHandlersOptions): void {
  app.openapi(listQualityTracesRoute, async (context) => {
    const scope = await requestScope(context, spaces);
    if (!scope) return context.json({ error: "Knowledge space not found" }, 404);
    if (!repository) return context.json({ error: "Quality runtime unavailable" }, 503);
    const query = context.req.valid("query");
    try {
      const result = await repository.listTraces({
        candidateGrants: scope.candidateGrants,
        ...(scope.capabilityRequester ? { capabilityRequester: scope.capabilityRequester } : {}),
        ...(query.cursor ? { cursor: decodeQualityCursor(query.cursor) } : {}),
        ...(query.from ? { from: query.from } : {}),
        knowledgeSpaceId: scope.knowledgeSpaceId,
        limit: query.limit,
        ...(query.mode ? { mode: query.mode } : {}),
        ...(query.query ? { query: query.query } : {}),
        ...(query.status ? { status: query.status } : {}),
        subjectId: scope.subject.subjectId,
        tenantId: scope.subject.tenantId,
        ...(query.to ? { to: query.to } : {}),
      });
      return context.json(
        {
          items: result.items.map((item) => ({
            ...item,
            stages: item.stages.map((stage) => ({ ...stage })),
          })),
          ...(result.nextCursor ? { nextCursor: encodeQualityCursor(result.nextCursor) } : {}),
        },
        200,
      );
    } catch (error) {
      return context.json({ error: publicQualityError(error) }, 400);
    }
  });

  app.openapi(reviewMissingEvidenceRoute, async (context) => {
    const scope = await requestScope(context, spaces);
    if (!scope) return context.json({ error: "Knowledge space not found" }, 404);
    if (!repository) return context.json({ error: "Quality runtime unavailable" }, 503);
    const params = context.req.valid("param");
    const body = context.req.valid("json");
    const trace = await subjectOwnedVisibleTrace({
      access,
      answerTraces,
      assets,
      candidateGrants: scope.candidateGrants,
      context,
      knowledgeSpaceId: scope.knowledgeSpaceId,
      nodes,
      traceId: params.traceId,
    });
    if (!trace || !missingEvidenceItem(trace, params.itemKey)) {
      return context.json({ error: "Missing evidence not found" }, 404);
    }
    try {
      const permission = await issueReplayPermission(context, access, scope, now);
      const review = await repository.upsertMissingReview({
        actorSubjectId: scope.subject.subjectId,
        candidateGrants: scope.candidateGrants,
        expectedRevision: body.expectedRevision,
        itemKey: params.itemKey,
        knowledgeSpaceId: scope.knowledgeSpaceId,
        permission,
        ...(body.reason ? { reason: body.reason } : {}),
        status: body.status,
        tenantId: scope.subject.tenantId,
        traceId: params.traceId,
      });
      return review
        ? context.json(review, 200)
        : context.json({ error: "Missing evidence not found" }, 404);
    } catch (error) {
      if (error instanceof QualityControlRevisionConflictError) {
        return context.json({ error: error.message }, 409);
      }
      if (error instanceof KnowledgeSpaceAccessError) {
        return context.json({ error: publicQualityError(error) }, 403);
      }
      return context.json({ error: publicQualityError(error) }, 503);
    }
  });

  app.openapi(missingEvidenceHistoryRoute, async (context) => {
    const scope = await requestScope(context, spaces);
    if (!scope) return context.json({ error: "Knowledge space not found" }, 404);
    if (!repository) return context.json({ error: "Quality runtime unavailable" }, 503);
    const params = context.req.valid("param");
    const trace = await subjectOwnedVisibleTrace({
      access,
      answerTraces,
      assets,
      candidateGrants: scope.candidateGrants,
      context,
      knowledgeSpaceId: scope.knowledgeSpaceId,
      nodes,
      traceId: params.traceId,
    });
    if (!trace || !missingEvidenceItem(trace, params.itemKey)) {
      return context.json({ error: "Missing evidence not found" }, 404);
    }
    const review = await repository.getMissingReview({
      candidateGrants: scope.candidateGrants,
      itemKey: params.itemKey,
      knowledgeSpaceId: scope.knowledgeSpaceId,
      subjectId: scope.subject.subjectId,
      tenantId: scope.subject.tenantId,
      traceId: params.traceId,
    });
    if (!review) return context.json({ error: "Missing evidence not found" }, 404);
    return context.json(
      {
        items: [
          ...(await repository.listHistory({
            aggregateId: review.id,
            aggregateType: "missing-evidence",
            candidateGrants: scope.candidateGrants,
            knowledgeSpaceId: scope.knowledgeSpaceId,
            limit: 100,
            subjectId: scope.subject.subjectId,
            tenantId: scope.subject.tenantId,
          })),
        ],
      },
      200,
    );
  });

  app.openapi(createQualityBadCaseRoute, async (context) => {
    const scope = await requestScope(context, spaces);
    if (!scope) return context.json({ error: "Knowledge space not found" }, 404);
    if (!repository) return context.json({ error: "Quality runtime unavailable" }, 503);
    const body = context.req.valid("json");
    const trace = await subjectOwnedVisibleTrace({
      access,
      answerTraces,
      assets,
      candidateGrants: scope.candidateGrants,
      context,
      knowledgeSpaceId: scope.knowledgeSpaceId,
      nodes,
      traceId: body.traceId,
    });
    if (!trace) return context.json({ error: "Answer trace not found" }, 404);
    try {
      const permission = await issueReplayPermission(context, access, scope, now);
      const badCase = await repository.createBadCase({
        actorSubjectId: scope.subject.subjectId,
        candidateGrants: scope.candidateGrants,
        knowledgeSpaceId: scope.knowledgeSpaceId,
        permission,
        reason: body.reason,
        tags: body.tags ?? [],
        tenantId: scope.subject.tenantId,
        traceId: body.traceId,
      });
      return context.json(publicBadCase(badCase), 201);
    } catch (error) {
      if (error instanceof KnowledgeSpaceAccessError) {
        return context.json({ error: publicQualityError(error) }, 403);
      }
      return context.json({ error: publicQualityError(error) }, 503);
    }
  });

  app.openapi(listQualityBadCasesRoute, async (context) => {
    const scope = await requestScope(context, spaces);
    if (!scope) return context.json({ error: "Knowledge space not found" }, 404);
    if (!repository) return context.json({ error: "Quality runtime unavailable" }, 503);
    const query = context.req.valid("query");
    try {
      const result = await repository.listBadCases({
        candidateGrants: scope.candidateGrants,
        ...(query.cursor ? { cursor: decodeQualityCursor(query.cursor) } : {}),
        knowledgeSpaceId: scope.knowledgeSpaceId,
        limit: query.limit,
        ...(query.status ? { status: query.status } : {}),
        subjectId: scope.subject.subjectId,
        tenantId: scope.subject.tenantId,
      });
      return context.json(
        {
          items: result.items.map(publicBadCase),
          ...(result.nextCursor ? { nextCursor: encodeQualityCursor(result.nextCursor) } : {}),
        },
        200,
      );
    } catch (error) {
      return context.json({ error: publicQualityError(error) }, 400);
    }
  });

  app.openapi(getQualityBadCaseRoute, async (context) => {
    const scope = await requestScope(context, spaces);
    if (!scope) return context.json({ error: "Knowledge space not found" }, 404);
    if (!repository) return context.json({ error: "Quality runtime unavailable" }, 503);
    const badCase = await repository.getBadCase({
      candidateGrants: scope.candidateGrants,
      id: context.req.valid("param").badCaseId,
      knowledgeSpaceId: scope.knowledgeSpaceId,
      subjectId: scope.subject.subjectId,
      tenantId: scope.subject.tenantId,
    });
    return badCase
      ? context.json(publicBadCase(badCase), 200)
      : context.json({ error: "Production bad case not found" }, 404);
  });

  app.openapi(updateQualityBadCaseRoute, async (context) => {
    const scope = await requestScope(context, spaces);
    if (!scope) return context.json({ error: "Knowledge space not found" }, 404);
    if (!repository) return context.json({ error: "Quality runtime unavailable" }, 503);
    const params = context.req.valid("param");
    const existing = await repository.getBadCase({
      candidateGrants: scope.candidateGrants,
      id: params.badCaseId,
      knowledgeSpaceId: scope.knowledgeSpaceId,
      subjectId: scope.subject.subjectId,
      tenantId: scope.subject.tenantId,
    });
    if (!existing) return context.json({ error: "Production bad case not found" }, 404);
    const body = context.req.valid("json");
    try {
      const permission = await issueReplayPermission(context, access, scope, now);
      const updated = await repository.updateBadCase({
        actorSubjectId: scope.subject.subjectId,
        candidateGrants: scope.candidateGrants,
        expectedRevision: body.expectedRevision,
        id: params.badCaseId,
        knowledgeSpaceId: scope.knowledgeSpaceId,
        permission,
        ...(body.reason ? { reason: body.reason } : {}),
        ...(body.replayRunId ? { replayRunId: body.replayRunId } : {}),
        status: body.status,
        ...(body.tags ? { tags: body.tags } : {}),
        tenantId: scope.subject.tenantId,
      });
      return updated
        ? context.json(publicBadCase(updated), 200)
        : context.json({ error: "Production bad case not found" }, 404);
    } catch (error) {
      if (error instanceof QualityControlRevisionConflictError) {
        return context.json({ error: error.message }, 409);
      }
      if (error instanceof KnowledgeSpaceAccessError) {
        return context.json({ error: publicQualityError(error) }, 403);
      }
      return context.json({ error: publicQualityError(error) }, 503);
    }
  });

  app.openapi(badCaseHistoryRoute, async (context) => {
    const scope = await requestScope(context, spaces);
    if (!scope) return context.json({ error: "Knowledge space not found" }, 404);
    if (!repository) return context.json({ error: "Quality runtime unavailable" }, 503);
    const id = context.req.valid("param").badCaseId;
    const visible = await repository.getBadCase({
      candidateGrants: scope.candidateGrants,
      id,
      knowledgeSpaceId: scope.knowledgeSpaceId,
      subjectId: scope.subject.subjectId,
      tenantId: scope.subject.tenantId,
    });
    if (!visible) return context.json({ error: "Production bad case not found" }, 404);
    return context.json(
      {
        items: [
          ...(await repository.listHistory({
            aggregateId: id,
            aggregateType: "bad-case",
            candidateGrants: scope.candidateGrants,
            knowledgeSpaceId: scope.knowledgeSpaceId,
            limit: 100,
            subjectId: scope.subject.subjectId,
            tenantId: scope.subject.tenantId,
          })),
        ],
      },
      200,
    );
  });

  app.openapi(createQualityReplayRoute, async (context) => {
    const scope = await requestScope(context, spaces);
    if (!scope) return context.json({ error: "Knowledge space not found" }, 404);
    if (!repository || !runtimeSnapshots) {
      return context.json({ error: "Quality runtime unavailable" }, 503);
    }
    const body = context.req.valid("json");
    const questions = await loadVisibleGoldenQuestions({
      assets,
      candidateGrants: scope.candidateGrants,
      goldenQuestionIds: body.goldenQuestionIds,
      knowledgeSpaceId: scope.knowledgeSpaceId,
      nodes,
      questions: goldenQuestions,
      tenantId: scope.subject.tenantId,
    });
    if (!questions) return context.json({ error: "Golden question not found" }, 404);
    try {
      const frozen = freezeQualityRuntimeSnapshot(
        await runtimeSnapshots.resolve({
          knowledgeSpaceId: scope.knowledgeSpaceId,
          tenantId: scope.subject.tenantId,
        }),
      );
      const mode = body.mode ?? frozen.retrievalProfile.defaultMode;
      await runtimeSnapshots.assertReady({
        knowledgeSpaceId: scope.knowledgeSpaceId,
        resolvedMode: mode,
        tenantId: scope.subject.tenantId,
      });
      const permission = scope.capabilityGrantId
        ? undefined
        : await issueReplayPermission(context, access, scope, now);
      const requestFingerprint = qualityReplayRequestFingerprint({
        candidateGrants: scope.candidateGrants,
        callerKind: context.get("callerKind") ?? "interactive",
        frozen,
        mode,
        questions,
        subjectId: scope.subject.subjectId,
      });
      const run = await repository.createReplay({
        ...(scope.capabilityGrantId
          ? { capabilityGrantId: scope.capabilityGrantId }
          : permission
            ? { permission }
            : {}),
        frozenSnapshot: frozen,
        idempotencyKey: context.req.valid("header")["idempotency-key"],
        knowledgeSpaceId: scope.knowledgeSpaceId,
        mode,
        questions,
        requestFingerprint,
        tenantId: scope.subject.tenantId,
      });
      return context.json(publicReplay(run), 202);
    } catch (error) {
      if (error instanceof QualityControlIdempotencyConflictError) {
        return context.json({ error: error.message }, 409);
      }
      if (error instanceof KnowledgeSpaceAccessError) {
        return context.json({ error: publicQualityError(error) }, 403);
      }
      return context.json({ error: publicQualityError(error) }, 503);
    }
  });

  app.openapi(getQualityReplayRoute, async (context) => {
    const scope = await requestScope(context, spaces);
    if (!scope) return context.json({ error: "Knowledge space not found" }, 404);
    if (!repository) return context.json({ error: "Quality runtime unavailable" }, 503);
    const run = await repository.getReplay({
      ...(scope.capabilityGrantId ? { capabilityGrantId: scope.capabilityGrantId } : {}),
      candidateGrants: scope.candidateGrants,
      id: context.req.valid("param").runId,
      knowledgeSpaceId: scope.knowledgeSpaceId,
      subjectId: scope.subject.subjectId,
      tenantId: scope.subject.tenantId,
    });
    return run
      ? context.json(publicReplay(run), 200)
      : context.json({ error: "Replay run not found" }, 404);
  });

  app.openapi(listQualityReplaysRoute, async (context) => {
    const scope = await requestScope(context, spaces);
    if (!scope) return context.json({ error: "Knowledge space not found" }, 404);
    if (!repository) return context.json({ error: "Quality runtime unavailable" }, 503);
    const query = context.req.valid("query");
    try {
      const result = await repository.listReplays({
        ...(scope.capabilityGrantId ? { capabilityGrantId: scope.capabilityGrantId } : {}),
        candidateGrants: scope.candidateGrants,
        ...(query.cursor ? { cursor: decodeQualityCursor(query.cursor) } : {}),
        ...(query.from ? { from: query.from } : {}),
        knowledgeSpaceId: scope.knowledgeSpaceId,
        limit: query.limit,
        ...(query.mode ? { mode: query.mode } : {}),
        ...(query.state ? { state: query.state } : {}),
        subjectId: scope.subject.subjectId,
        tenantId: scope.subject.tenantId,
        ...(query.to ? { to: query.to } : {}),
      });
      return context.json(
        {
          items: result.items.map(publicReplay),
          ...(result.nextCursor ? { nextCursor: encodeQualityCursor(result.nextCursor) } : {}),
        },
        200,
      );
    } catch (error) {
      return context.json({ error: publicQualityError(error) }, 400);
    }
  });

  app.openapi(cancelQualityReplayRoute, async (context) => {
    const scope = await requestScope(context, spaces);
    if (!scope) return context.json({ error: "Knowledge space not found" }, 404);
    if (!repository) return context.json({ error: "Quality runtime unavailable" }, 503);
    const params = context.req.valid("param");
    const visible = await repository.getReplay({
      ...(scope.capabilityGrantId ? { capabilityGrantId: scope.capabilityGrantId } : {}),
      candidateGrants: scope.candidateGrants,
      id: params.runId,
      knowledgeSpaceId: scope.knowledgeSpaceId,
      subjectId: scope.subject.subjectId,
      tenantId: scope.subject.tenantId,
    });
    if (!visible) return context.json({ error: "Replay run not found" }, 404);
    try {
      const permission = scope.capabilityGrantId
        ? undefined
        : await issueReplayPermission(context, access, scope, now);
      const run = await repository.cancelReplay({
        actorSubjectId: scope.subject.subjectId,
        ...(scope.capabilityGrantId
          ? { capabilityGrantId: scope.capabilityGrantId }
          : permission
            ? { permission }
            : {}),
        expectedRevision: context.req.valid("json").expectedRevision,
        id: params.runId,
        knowledgeSpaceId: scope.knowledgeSpaceId,
        tenantId: scope.subject.tenantId,
      });
      return run
        ? context.json(publicReplay(run), 200)
        : context.json({ error: "Replay run not found" }, 404);
    } catch (error) {
      if (error instanceof QualityControlRevisionConflictError) {
        return context.json({ error: error.message }, 409);
      }
      if (error instanceof KnowledgeSpaceAccessError) {
        return context.json({ error: publicQualityError(error) }, 403);
      }
      return context.json({ error: publicQualityError(error) }, 503);
    }
  });

  app.openapi(retryQualityReplayRoute, async (context) => {
    const scope = await requestScope(context, spaces);
    if (!scope) return context.json({ error: "Knowledge space not found" }, 404);
    if (!repository || !runtimeSnapshots) {
      return context.json({ error: "Quality runtime unavailable" }, 503);
    }
    const params = context.req.valid("param");
    const visible = await repository.getReplay({
      ...(scope.capabilityGrantId ? { capabilityGrantId: scope.capabilityGrantId } : {}),
      candidateGrants: scope.candidateGrants,
      id: params.runId,
      knowledgeSpaceId: scope.knowledgeSpaceId,
      subjectId: scope.subject.subjectId,
      tenantId: scope.subject.tenantId,
    });
    if (!visible) return context.json({ error: "Replay run not found" }, 404);
    try {
      const frozen = freezeQualityRuntimeSnapshot(
        await runtimeSnapshots.resolve({
          knowledgeSpaceId: scope.knowledgeSpaceId,
          tenantId: scope.subject.tenantId,
        }),
      );
      await runtimeSnapshots.assertReady({
        knowledgeSpaceId: scope.knowledgeSpaceId,
        resolvedMode: visible.mode,
        tenantId: scope.subject.tenantId,
      });
      const permission = scope.capabilityGrantId
        ? undefined
        : await issueReplayPermission(context, access, scope, now);
      const run = await repository.retryReplay({
        actorSubjectId: scope.subject.subjectId,
        ...(scope.capabilityGrantId
          ? { capabilityGrantId: scope.capabilityGrantId }
          : permission
            ? { permission }
            : {}),
        expectedRevision: context.req.valid("json").expectedRevision,
        frozenSnapshot: frozen,
        id: params.runId,
        knowledgeSpaceId: scope.knowledgeSpaceId,
        tenantId: scope.subject.tenantId,
      });
      return run
        ? context.json(publicReplay(run), 202)
        : context.json({ error: "Replay run not found" }, 404);
    } catch (error) {
      if (error instanceof QualityControlRevisionConflictError) {
        return context.json({ error: error.message }, 409);
      }
      if (error instanceof KnowledgeSpaceAccessError) {
        return context.json({ error: publicQualityError(error) }, 403);
      }
      return context.json({ error: publicQualityError(error) }, 503);
    }
  });

  app.openapi(qualityTrendsRoute, async (context) => {
    const scope = await requestScope(context, spaces);
    if (!scope) return context.json({ error: "Knowledge space not found" }, 404);
    if (!repository) return context.json({ error: "Quality runtime unavailable" }, 503);
    const query = context.req.valid("query");
    const to = query.to ?? new Date(now()).toISOString();
    const windowMs =
      query.window === "24h" ? 86_400_000 : query.window === "7d" ? 604_800_000 : 2_592_000_000;
    const from = query.from ?? new Date(Date.parse(to) - windowMs).toISOString();
    try {
      return context.json(
        publicTrends(
          await repository.trends({
            candidateGrants: scope.candidateGrants,
            from,
            knowledgeSpaceId: scope.knowledgeSpaceId,
            subjectId: scope.subject.subjectId,
            tenantId: scope.subject.tenantId,
            to,
            topLimit: 20,
          }),
        ),
        200,
      );
    } catch (error) {
      return context.json({ error: publicQualityError(error) }, 400);
    }
  });
}

async function requestScope(
  context: Parameters<Parameters<OpenAPIHono<KnowledgeGatewayEnv>["openapi"]>[1]>[0],
  spaces: Pick<KnowledgeSpaceRepository, "get">,
) {
  const subject = context.get("subject");
  const capabilityGrant = context.get("capabilityV2Grant");
  const knowledgeSpaceId = context.req.param("id");
  if (!knowledgeSpaceId) return null;
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
  const candidateGrants =
    capabilityGrant?.contentScopeIds ??
    currentCandidateGrants({
      decision: context.get("authorizationDecision"),
      knowledgeSpaceId,
      subject,
    });
  return candidateGrants
    ? {
        candidateGrants,
        ...(capabilityGrant
          ? {
              capabilityGrantId: capabilityGrant.grantId,
              capabilityRequester: {
                callerKind: capabilityGrant.callerKind,
                subjectId: capabilityGrant.subject,
              },
            }
          : {}),
        knowledgeSpaceId,
        subject,
      }
    : null;
}

async function subjectOwnedVisibleTrace(input: {
  readonly access: Pick<KnowledgeSpaceAccessService, "revalidatePermissionSnapshot">;
  readonly answerTraces: AnswerTraceRepository;
  readonly assets: Pick<DocumentAssetRepository, "get">;
  readonly candidateGrants: readonly string[];
  readonly context: Parameters<Parameters<OpenAPIHono<KnowledgeGatewayEnv>["openapi"]>[1]>[0];
  readonly knowledgeSpaceId: string;
  readonly nodes: Pick<KnowledgeNodeRepository, "getMany">;
  readonly traceId: string;
}): Promise<AnswerTrace | null> {
  const trace = await input.answerTraces.get({
    id: input.traceId,
    knowledgeSpaceId: input.knowledgeSpaceId,
  });
  const subject = input.context.get("subject");
  if (!trace || trace.subjectId !== subject.subjectId || !trace.permissionSnapshot) return null;
  try {
    const permission = await input.access.revalidatePermissionSnapshot({
      expectedAccessChannel: trace.permissionSnapshot.accessChannel,
      id: trace.permissionSnapshot.id,
      knowledgeSpaceId: input.knowledgeSpaceId,
      subjectId: subject.subjectId,
      tenantId: subject.tenantId,
    });
    if (permission.revision !== trace.permissionSnapshot.revision) return null;
  } catch {
    return null;
  }
  return (await traceEvidenceVisible(input.assets, input.nodes, trace, input.candidateGrants))
    ? trace
    : null;
}

async function traceEvidenceVisible(
  assets: Pick<DocumentAssetRepository, "get">,
  nodes: Pick<KnowledgeNodeRepository, "getMany">,
  trace: AnswerTrace,
  candidateGrants: readonly string[],
) {
  const bundle = evidenceBundleFromAnswerTrace(trace);
  if (!bundle) return trace.evidenceBundleId === undefined;
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
  const byId = new Map(foundNodes.map((node) => [node.id, node]));
  const requiredIds = new Set(bundle.items.map((item) => item.nodeId));
  if ([...requiredIds].some((id) => !byId.has(id))) return false;
  if (foundNodes.some((node) => !candidatePermissionAllowsNode(node, candidateGrants)))
    return false;
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
    (asset) => asset && candidatePermissionAllowsAsset(asset, candidateGrants),
  );
}

function missingEvidenceItem(trace: AnswerTrace, itemKey: string) {
  const bundle = evidenceBundleFromAnswerTrace(trace);
  return bundle?.missingEvidence.find((item) => missingEvidenceItemKey(item) === itemKey);
}

export function missingEvidenceItemKey(item: EvidenceBundle["missingEvidence"][number]) {
  return `sha256:${createHash("sha256")
    .update(
      JSON.stringify({
        expectedEvidenceId: item.expectedEvidenceId ?? null,
        metadata: item.metadata,
        reason: item.reason,
        text: item.text,
      }),
    )
    .digest("hex")}`;
}

async function loadVisibleGoldenQuestions(input: {
  readonly assets: Pick<DocumentAssetRepository, "get">;
  readonly candidateGrants: readonly string[];
  readonly goldenQuestionIds: readonly string[];
  readonly knowledgeSpaceId: string;
  readonly nodes: Pick<KnowledgeNodeRepository, "getMany">;
  readonly questions: GoldenQuestionRepository;
  readonly tenantId: string;
}) {
  const uniqueIds = [...new Set(input.goldenQuestionIds)];
  if (uniqueIds.length !== input.goldenQuestionIds.length) return null;
  const questions = await Promise.all(
    uniqueIds.map((id) =>
      input.questions.get({
        candidateGrants: input.candidateGrants,
        id,
        knowledgeSpaceId: input.knowledgeSpaceId,
        tenantId: input.tenantId,
      }),
    ),
  );
  if (questions.some((question) => !question)) return null;
  const resolved = questions.filter((question): question is NonNullable<typeof question> =>
    Boolean(question),
  );
  const evidenceIds = [...new Set(resolved.flatMap((question) => question.expectedEvidenceIds))];
  const nodes = await input.nodes.getMany({
    ids: evidenceIds,
    knowledgeSpaceId: input.knowledgeSpaceId,
  });
  if (nodes.some((node) => !candidatePermissionAllowsNode(node, input.candidateGrants)))
    return null;
  const unresolved = evidenceIds.filter((id) => !nodes.some((node) => node.id === id));
  const assets = await Promise.all(
    unresolved.map((id) => input.assets.get({ id, knowledgeSpaceId: input.knowledgeSpaceId })),
  );
  if (
    assets.some((asset) => asset && !candidatePermissionAllowsAsset(asset, input.candidateGrants))
  )
    return null;
  return resolved.map((question) => ({
    expectedEvidenceIds: [...question.expectedEvidenceIds],
    id: question.id,
    question: question.question,
  }));
}

async function issueReplayPermission(
  context: Parameters<Parameters<OpenAPIHono<KnowledgeGatewayEnv>["openapi"]>[1]>[0],
  access: Pick<KnowledgeSpaceAccessService, "createPermissionSnapshot">,
  scope: NonNullable<Awaited<ReturnType<typeof requestScope>>>,
  now: () => number,
) {
  const callerKind = context.get("callerKind") ?? "interactive";
  const apiKey = context.get("authenticatedApiKey");
  const expiresAt = Math.min(
    now() + 24 * 60 * 60_000,
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

function publicQualityError(error: unknown) {
  if (error instanceof QualityControlRevisionConflictError) return error.message;
  return "Quality operation failed";
}

function qualityReplayRequestFingerprint(input: {
  readonly candidateGrants: readonly string[];
  readonly callerKind: string;
  readonly frozen: ReturnType<typeof freezeQualityRuntimeSnapshot>;
  readonly mode: string;
  readonly questions: readonly {
    readonly expectedEvidenceIds: readonly string[];
    readonly id: string;
    readonly question: string;
  }[];
  readonly subjectId: string;
}) {
  return `sha256:${createHash("sha256")
    .update(
      JSON.stringify({
        candidateGrants: [...input.candidateGrants].sort(),
        callerKind: input.callerKind,
        mode: input.mode,
        projection: input.frozen.projectionSnapshot,
        questions: input.questions.map((question) => ({
          expectedEvidenceIds: [...question.expectedEvidenceIds].sort(),
          id: question.id,
          question: question.question,
        })),
        retrievalProfile: input.frozen.retrievalProfile,
        subjectId: input.subjectId,
        ...(input.frozen.embeddingProfile
          ? { embeddingProfile: input.frozen.embeddingProfile }
          : {}),
      }),
    )
    .digest("hex")}`;
}

function publicBadCase(value: ProductionBadCase) {
  const { traceId: _traceCapability, ...safe } = value;
  return { ...safe, tags: [...value.tags] };
}

function publicReplay(run: QualityReplayRun) {
  const embedding = run.frozenSnapshot.embeddingProfile;
  const retrieval = run.frozenSnapshot.retrievalProfile;
  return {
    attempt: run.attempt,
    createdAt: run.createdAt,
    ...(run.error ? { error: publicReplayErrorCode(run.error) } : {}),
    id: run.id,
    items: run.items.map((item) => ({
      goldenQuestionId: item.goldenQuestionId,
      id: item.id,
      ordinal: item.ordinal,
      question: item.question,
      ...(item.result
        ? { result: publicReplayResult(item.result, item.expectedEvidenceIds.length) }
        : {}),
      state: item.state,
    })),
    knowledgeSpaceId: run.knowledgeSpaceId,
    mode: run.mode,
    provenance: {
      ...(embedding && embedding.dimension !== undefined
        ? {
            embedding: {
              dimension: embedding.dimension,
              model: embedding.model,
              vectorSpaceId: embedding.vectorSpaceId,
            },
          }
        : {}),
      projection: {
        projectionVersion: run.frozenSnapshot.projectionSnapshot.projectionVersion,
      },
      retrieval: {
        profileRevision: retrieval.revision,
        reasoningModel: retrieval.reasoningModel.model,
        ...(retrieval.rerank.enabled && retrieval.rerank.model
          ? { rerankModel: retrieval.rerank.model.model }
          : {}),
      },
    },
    revision: run.revision,
    state: run.state,
    updatedAt: run.updatedAt,
  };
}

function publicReplayErrorCode(error: string) {
  return error === "PERMISSION_REVOKED" ? "PERMISSION_REVOKED" : "REPLAY_EXECUTION_FAILED";
}

function publicReplayResult(value: Readonly<Record<string, unknown>>, expectedCount: number) {
  const diff = isPlainRecord(value.evidenceDiff) ? value.evidenceDiff : {};
  const metrics = isPlainRecord(value.metrics) ? value.metrics : {};
  const missingCount = Array.isArray(diff.missingEvidenceIds) ? diff.missingEvidenceIds.length : 0;
  const retrievedCount = Array.isArray(diff.retrievedEvidenceIds)
    ? diff.retrievedEvidenceIds.length
    : 0;
  const allowedMetricNames = [
    "denseCandidates",
    "ftsCandidates",
    "fusedCandidates",
    "graphExpansionCandidates",
    "pageIndexMatchedNodes",
    "permissionFilteredCandidates",
    "rerankCandidates",
    "scoreThresholdFilteredCandidates",
    "summaryCandidates",
    "totalMs",
  ] as const;
  const safeMetrics: Record<string, number> = {};
  for (const name of allowedMetricNames) {
    const candidate = metrics[name];
    if (typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0) {
      safeMetrics[name] = candidate;
    }
  }
  return {
    evidenceDiff: { expectedCount, missingCount, retrievedCount },
    metrics: safeMetrics,
    passed: missingCount === 0,
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function publicTrends(report: QualityTrendReport) {
  return {
    baseline: { ...report.baseline },
    current: { ...report.current, badCases: { ...report.current.badCases } },
    from: report.from,
    slices: report.slices.map((slice) => ({ ...slice })),
    to: report.to,
    topUnanswered: report.topUnanswered.map((item) => ({ ...item })),
  };
}
