import type { OpenAPIHono } from "@hono/zod-openapi";
import { validateKnowledgeSpaceRetrievalProfileForMode } from "@knowledge/core";

import type { AnswerTraceRecorder } from "./answer-trace-recorder";
import {
  type AutoRetrievalModeResolver,
  resolveRetrievalModeRequest,
} from "./auto-retrieval-mode-resolver";
import type { FailedQueryRecorder } from "./failed-query-recorder";
import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import {
  type QueryGenerator,
  type QueryTraceStep,
  createQuerySseResponse,
} from "./gateway-sse-responses";
import type {
  KnowledgeSpaceAccessService,
  KnowledgeSpacePermissionSnapshot,
} from "./knowledge-space-access-control";
import {
  KnowledgeSpaceAuthorizationError,
  type KnowledgeSpaceAuthorizationGuard,
  knowledgeSpaceAccessChannelForCallerKind,
} from "./knowledge-space-authorization";
import type { KnowledgeSpaceManifestRepository } from "./knowledge-space-manifest-repository";
import {
  type KnowledgeSpaceOverviewRepository,
  deterministicKnowledgeSpaceActivityId,
} from "./knowledge-space-overview";
import type { KnowledgeSpaceRepository } from "./knowledge-space-repository";
import type { PublishedKnowledgeSpaceRuntimeSnapshotResolver } from "./published-knowledge-space-runtime-snapshot";
import {
  type PublishedProjectionReadSnapshot,
  type PublishedProjectionReadSnapshotResolver,
  PublishedProjectionReadUnavailableError,
} from "./published-projection-read-snapshot";
import { streamQueryRoute } from "./query-routes";
import {
  type ActiveRetrievalExecutionLease,
  RetrievalExecutionAdmissionError,
  type RetrievalExecutionLeaseCoordinator,
  RetrievalExecutionLeaseLostError,
} from "./retrieval-execution-lease";
import { createRetrievalPlanner } from "./retrieval-planner";
import type { SessionContextRepository } from "./session-context-repository";
import {
  TidbFtsPostingBackfillNotReadyError,
  type TidbFtsPostingReadinessGate,
} from "./tidb-fts-posting-backfill";

const readinessModePlanner = createRetrievalPlanner({ maxTopK: 1 });

export interface RegisterQueryHandlersOptions {
  readonly access: KnowledgeSpaceAccessService;
  readonly answerTraceRecorder?: AnswerTraceRecorder | undefined;
  readonly app: OpenAPIHono<KnowledgeGatewayEnv>;
  readonly autoRetrievalModeResolver?: AutoRetrievalModeResolver | undefined;
  readonly authorization: KnowledgeSpaceAuthorizationGuard;
  readonly failedQueryLowConfidenceScoreFloor?: number | undefined;
  readonly failedQueryRecorder?: FailedQueryRecorder | undefined;
  readonly generateQueryRunId: () => string;
  readonly manifests: KnowledgeSpaceManifestRepository;
  readonly queryGenerator: QueryGenerator | undefined;
  readonly retrievalExecutionLeases?: RetrievalExecutionLeaseCoordinator | undefined;
  readonly projectionSnapshotResolver?: PublishedProjectionReadSnapshotResolver | undefined;
  readonly runtimeSnapshotResolver?: PublishedKnowledgeSpaceRuntimeSnapshotResolver | undefined;
  readonly sessionRepository: SessionContextRepository;
  readonly spaces: KnowledgeSpaceRepository;
  readonly tidbFtsPostingReadiness?: TidbFtsPostingReadinessGate | undefined;
  readonly permissionSnapshotTtlMs?: number | undefined;
  readonly now?: (() => number) | undefined;
  readonly overview?: Pick<KnowledgeSpaceOverviewRepository, "appendActivity"> | undefined;
}

export function registerQueryHandlers({
  access,
  answerTraceRecorder,
  app,
  autoRetrievalModeResolver,
  authorization,
  failedQueryLowConfidenceScoreFloor,
  failedQueryRecorder,
  generateQueryRunId,
  manifests,
  queryGenerator,
  retrievalExecutionLeases,
  projectionSnapshotResolver,
  runtimeSnapshotResolver,
  sessionRepository,
  spaces,
  tidbFtsPostingReadiness,
  permissionSnapshotTtlMs = 60 * 60_000,
  now = Date.now,
  overview,
}: RegisterQueryHandlersOptions): void {
  if (!Number.isSafeInteger(permissionSnapshotTtlMs) || permissionSnapshotTtlMs < 1) {
    throw new Error("Query permissionSnapshotTtlMs must be a positive integer");
  }
  app.openapi(streamQueryRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const query = body.query.trim();

    if (!query) {
      return context.json({ error: "Invalid query request" }, 400);
    }

    const space = await spaces.get({
      id: body.knowledgeSpaceId,
      tenantId: subject.tenantId,
    });

    if (!space) {
      return context.json({ error: "Knowledge space not found" }, 404);
    }

    let permissionScope: string[];
    let permissionSnapshot: KnowledgeSpacePermissionSnapshot;
    try {
      const callerKind = context.get("callerKind") ?? "interactive";
      const decision = await authorization.authorize({
        callerKind,
        knowledgeSpaceId: space.id,
        requiredAccess: "read",
        subject,
      });
      const authenticatedApiKey = context.get("authenticatedApiKey");
      if (callerKind === "api_key" && !authenticatedApiKey) {
        throw new KnowledgeSpaceAuthorizationError(
          "KNOWLEDGE_SPACE_ACCESS_DENIED",
          "Knowledge space access denied",
        );
      }
      const expiresAt = Math.min(
        now() + permissionSnapshotTtlMs,
        authenticatedApiKey?.expiresAt
          ? Date.parse(authenticatedApiKey.expiresAt)
          : Number.POSITIVE_INFINITY,
      );
      permissionSnapshot = await access.createPermissionSnapshot({
        accessChannel: knowledgeSpaceAccessChannelForCallerKind(callerKind),
        ...(authenticatedApiKey ? { apiKey: authenticatedApiKey } : {}),
        expiresAt: new Date(expiresAt).toISOString(),
        knowledgeSpaceId: space.id,
        subjectId: subject.subjectId,
        tenantId: subject.tenantId,
      });
      permissionScope = [...permissionSnapshot.permissionScopes];
      context.set("authorizationDecision", decision);
    } catch (error) {
      if (error instanceof KnowledgeSpaceAuthorizationError) {
        return context.json({ error: error.message }, 403);
      }
      throw error;
    }

    let runtimeSnapshot:
      | Awaited<ReturnType<PublishedKnowledgeSpaceRuntimeSnapshotResolver["resolve"]>>
      | undefined;
    try {
      runtimeSnapshot = runtimeSnapshotResolver
        ? await runtimeSnapshotResolver.resolve({
            knowledgeSpaceId: space.id,
            tenantId: subject.tenantId,
          })
        : undefined;
    } catch (error) {
      if (error instanceof PublishedProjectionReadUnavailableError) {
        return context.json({ error: "Published runtime snapshot unavailable" }, 503);
      }
      throw error;
    }
    const manifest = runtimeSnapshot
      ? undefined
      : await manifests.get({
          knowledgeSpaceId: space.id,
          tenantId: subject.tenantId,
        });
    const retrievalProfile = runtimeSnapshot?.retrievalProfile ?? manifest?.retrievalProfile;
    const fallbackMode = retrievalProfile?.defaultMode ?? "fast";
    const requestedMode = body.mode ?? fallbackMode;
    const queryRunId = generateQueryRunId();
    // Auto routing is a billed model call and therefore belongs inside the same admission/deletion
    // fence as embedding, retrieval, rerank, and answer generation.
    let executionLease: ActiveRetrievalExecutionLease | undefined;
    try {
      executionLease = await retrievalExecutionLeases?.acquire({
        knowledgeSpaceId: space.id,
        subjectId: subject.subjectId,
        tenantId: subject.tenantId,
        traceId: queryRunId,
      });
    } catch (error) {
      if (error instanceof RetrievalExecutionAdmissionError) {
        return context.json({ code: error.code, error: error.message }, 409);
      }
      throw error;
    }
    const releaseEarlyExecutionLease = async (): Promise<void> => {
      await executionLease?.release().catch(() => undefined);
    };
    const routeStartedAt = Date.now();
    let modeResolution: Awaited<ReturnType<typeof resolveRetrievalModeRequest>>;
    try {
      modeResolution = await resolveRetrievalModeRequest({
        fallbackMode,
        query,
        reasoningModel: retrievalProfile?.reasoningModel,
        requestedMode,
        resolver: autoRetrievalModeResolver,
        ...(executionLease ? { signal: executionLease.signal } : {}),
        tenantId: subject.tenantId,
        traceId: queryRunId,
      });
    } catch (error) {
      await releaseEarlyExecutionLease();
      if (executionLease?.signal.aborted) {
        const leaseLost = new RetrievalExecutionLeaseLostError();
        return context.json({ code: leaseLost.code, error: leaseLost.message }, 409);
      }
      throw error;
    }
    const routeEndedAt = Date.now();
    const resolvedMode = modeResolution.resolvedMode;
    const routeStep: QueryTraceStep = {
      endedAt: new Date(routeEndedAt).toISOString(),
      metadata: {
        degraded: modeResolution.degraded,
        durationMs: modeResolution.durationMs,
        ...(modeResolution.errorClass ? { errorClass: modeResolution.errorClass } : {}),
        ...(modeResolution.finishReason ? { finishReason: modeResolution.finishReason } : {}),
        ...(modeResolution.generationModel
          ? { generationModel: modeResolution.generationModel }
          : {}),
        ...(modeResolution.promptVersion ? { promptVersion: modeResolution.promptVersion } : {}),
        ...(modeResolution.provider ? { provider: modeResolution.provider } : {}),
        ...(modeResolution.reasonCode ? { reasonCode: modeResolution.reasonCode } : {}),
        ...(modeResolution.requestedMode === "auto" && retrievalProfile
          ? {
              reasoningModel: { ...retrievalProfile.reasoningModel },
              retrievalProfileRevision: retrievalProfile.revision,
            }
          : {}),
        requestedMode: modeResolution.requestedMode,
        resolvedMode,
        resolver: modeResolution.resolver,
        selectionSource: body.mode
          ? "request"
          : retrievalProfile
            ? "profile-default"
            : "legacy-default",
        ...(modeResolution.usage ? { usage: modeResolution.usage } : {}),
      },
      name: "query.route",
      startedAt: new Date(routeStartedAt).toISOString(),
      status: "ok",
    };
    try {
      readinessModePlanner.plan({
        mode: requestedMode,
        query,
        resolvedMode,
        topK: 1,
      });
    } catch (error) {
      await releaseEarlyExecutionLease();
      throw error;
    }
    const profileValidationError = retrievalProfile
      ? validateKnowledgeSpaceRetrievalProfileForMode(retrievalProfile, resolvedMode)
      : undefined;
    if (profileValidationError) {
      await releaseEarlyExecutionLease();
      return context.json(
        {
          code: profileValidationError.code,
          error: profileValidationError.message,
          mode: profileValidationError.mode,
        },
        400,
      );
    }
    if (runtimeSnapshot && resolvedMode !== "research" && !runtimeSnapshot.embeddingProfile) {
      await releaseEarlyExecutionLease();
      return context.json({ error: "Embedding profile snapshot unavailable" }, 503);
    }

    if (!queryGenerator) {
      await releaseEarlyExecutionLease();
      return context.json({ error: "Query generation unavailable" }, 503);
    }

    if (tidbFtsPostingReadiness && resolvedMode !== "research") {
      try {
        await tidbFtsPostingReadiness.assertReady({
          knowledgeSpaceId: space.id,
          tenantId: subject.tenantId,
        });
      } catch (error) {
        if (error instanceof TidbFtsPostingBackfillNotReadyError) {
          await releaseEarlyExecutionLease();
          return context.json(
            { error: error.message, code: error.code, runState: error.runState },
            503,
          );
        }
        await releaseEarlyExecutionLease();
        throw error;
      }
    }

    let projectionSnapshot: PublishedProjectionReadSnapshot | undefined;
    try {
      if (runtimeSnapshot) {
        await runtimeSnapshotResolver?.assertReady({
          knowledgeSpaceId: space.id,
          resolvedMode,
          tenantId: subject.tenantId,
        });
        projectionSnapshot = runtimeSnapshot.projectionSnapshot;
      } else {
        projectionSnapshot = projectionSnapshotResolver
          ? await projectionSnapshotResolver.resolve({
              knowledgeSpaceId: space.id,
              resolvedMode,
              tenantId: subject.tenantId,
            })
          : undefined;
      }
    } catch (error) {
      if (error instanceof PublishedProjectionReadUnavailableError) {
        await releaseEarlyExecutionLease();
        return context.json({ error: "Published projection snapshot unavailable" }, 503);
      }
      await releaseEarlyExecutionLease();
      throw error;
    }

    const appendTerminalActivity = async (status: "canceled" | "failed" | "succeeded") => {
      if (!overview) return;
      const occurredAt = new Date(now()).toISOString();
      await overview.appendActivity({
        action: status === "succeeded" ? "query.completed" : "query.failed",
        actor: { id: subject.subjectId, type: "member" },
        details: { mode: resolvedMode },
        id: deterministicKnowledgeSpaceActivityId(
          `query.${status}`,
          subject.tenantId,
          space.id,
          queryRunId,
        ),
        knowledgeSpaceId: space.id,
        occurredAt,
        requiredPermissionScope: [],
        resource: { id: queryRunId, type: "query" },
        result: status === "succeeded" ? "success" : status === "canceled" ? "canceled" : "failure",
        tenantId: subject.tenantId,
      });
    };
    let requestedActivityPersisted = false;
    try {
      if (overview) {
        const occurredAt = new Date(now()).toISOString();
        await overview.appendActivity({
          action: "query.requested",
          actor: { id: subject.subjectId, type: "member" },
          details: { mode: resolvedMode },
          id: deterministicKnowledgeSpaceActivityId(
            "query.requested",
            subject.tenantId,
            space.id,
            queryRunId,
          ),
          knowledgeSpaceId: space.id,
          occurredAt,
          requiredPermissionScope: [],
          resource: { id: queryRunId, type: "query" },
          result: "pending",
          tenantId: subject.tenantId,
        });
        requestedActivityPersisted = true;
      }
      const session = await sessionRepository.recordQuery({
        activeDocumentIds: body.activeDocumentIds,
        activeEntityIds: body.activeEntityIds,
        knowledgeSpaceId: space.id,
        permissionSnapshot: permissionScope,
        query,
        ...(executionLease ? { retrievalExecution: executionLease } : {}),
        ...(body.sessionId ? { sessionId: body.sessionId } : {}),
        subjectId: subject.subjectId,
        tenantId: subject.tenantId,
        traceId: queryRunId,
      });

      return createQuerySseResponse({
        answerTraceRecorder,
        ...(executionLease ? { executionLease } : {}),
        ...((retrievalProfile?.scoreThreshold.enabled
          ? retrievalProfile.scoreThreshold.value
          : retrievalProfile
            ? undefined
            : failedQueryLowConfidenceScoreFloor) !== undefined
          ? {
              // Low-confidence triage uses the same mode-final threshold that filtered the
              // published retrieval result. The deployment-wide floor remains legacy-only for a
              // space that has not yet published a versioned retrieval profile.
              failedQueryLowConfidenceScoreFloor: retrievalProfile?.scoreThreshold.enabled
                ? retrievalProfile.scoreThreshold.value
                : failedQueryLowConfidenceScoreFloor,
            }
          : {}),
        ...(failedQueryRecorder ? { failedQueryRecorder } : {}),
        generator: queryGenerator,
        initialTraceSteps: [routeStep],
        input: {
          knowledgeSpaceId: space.id,
          ...(runtimeSnapshot?.embeddingProfile
            ? { embeddingProfile: runtimeSnapshot.embeddingProfile }
            : {}),
          mode: resolvedMode,
          permissionSnapshot: {
            accessChannel: permissionSnapshot.accessChannel,
            id: permissionSnapshot.id,
            revision: permissionSnapshot.revision,
          },
          permissionScope,
          ...(projectionSnapshot ? { projectionSnapshot } : {}),
          query,
          ...(retrievalProfile ? { retrievalProfile } : {}),
          sessionContext: session.context,
          subject,
          traceId: queryRunId,
        },
        ...(overview
          ? {
              onTerminal: appendTerminalActivity,
            }
          : {}),
        sessionId: session.context.sessionId,
        traceId: queryRunId,
      });
    } catch (error) {
      if (requestedActivityPersisted) {
        await appendTerminalActivity("failed").catch(() => undefined);
      }
      await executionLease?.release().catch(() => undefined);
      throw error;
    }
  });
}
