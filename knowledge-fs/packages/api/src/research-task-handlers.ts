import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  KnowledgeSpaceRetrievalProfileModeError,
  validateKnowledgeSpaceRetrievalProfileForMode,
} from "@knowledge/core";

import { isAuthenticatedApiKeyBoundToKnowledgeSpace } from "./auth";
import {
  AUTO_RETRIEVAL_MODE_DECISION_METADATA_KEY,
  type AutoRetrievalModeResolver,
  type RetrievalModeRequestResolution,
  resolveRetrievalModeRequest,
} from "./auto-retrieval-mode-resolver";
import type { CapabilityGrantProvenanceRepository } from "./capability-grant-provenance";
import {
  DerivedResultOwnerMismatchError,
  authorizeResearchTaskDerivedResult,
  issueKnowledgeSpaceDurablePermission,
  toPublicResearchTaskJob,
} from "./derived-result-authorization";
import type { DocumentAssetRepository } from "./document-asset-repository";
import { evidenceBundlesHaveActiveDocuments } from "./evidence-bundle-visibility";
import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import type { ResearchTaskDirectStreamOptions } from "./gateway-options";
import { createResearchTaskProgressSseResponse } from "./gateway-sse-responses";
import { toJobPayloadRecord } from "./job-payload-utils";
import { omitKnowledgeFsReservedMetadata } from "./knowledge-fs-reserved-metadata";
import type { KnowledgeSpaceAccessService } from "./knowledge-space-access-control";
import {
  KnowledgeSpaceAuthorizationError,
  type KnowledgeSpaceAuthorizationGuard,
  type KnowledgeSpaceCallerKind,
} from "./knowledge-space-authorization";
import type { KnowledgeSpaceRepository } from "./knowledge-space-repository";
import { type LooseOpenApiContext, openApiHandler } from "./openapi-handler-utils";
import type { PublishedKnowledgeSpaceRuntimeSnapshotResolver } from "./published-knowledge-space-runtime-snapshot";
import { PublishedProjectionReadUnavailableError } from "./published-projection-read-snapshot";
import type { ResearchTaskDeletionVisibility } from "./research-task-deletion-visibility";
import type {
  ResearchTaskJob,
  ResearchTaskJobStateMachine,
  ResearchTaskPartialResultRepository,
} from "./research-task-job";
import {
  type ResearchTaskDryRunPlanner,
  evaluateResearchTaskLimits,
} from "./research-task-planning";
import type { ResearchTaskProgressRepository } from "./research-task-progress";
import type {
  CreateResearchTaskBody,
  ListResearchTaskPartialsQuery,
  ListResearchTaskProgressQuery,
  ListResearchTasksQuery,
  PlanResearchTaskBody,
  ResearchTaskJobParams,
} from "./research-task-request-schemas";
import {
  cancelResearchTaskRoute,
  createResearchTaskRoute,
  getResearchTaskRoute,
  listKnowledgeSpaceResearchTasksRoute,
  listResearchTaskPartialsRoute,
  planResearchTaskRoute,
  streamResearchTaskProgressRoute,
} from "./research-task-routes";
import {
  RESEARCH_TASK_RUNTIME_SNAPSHOT_METADATA_KEY,
  researchTaskRuntimeSnapshotFromMetadata,
  toResearchTaskRuntimeSnapshotPayload,
} from "./research-task-runtime-snapshot";

export interface RegisterResearchTaskHandlersOptions {
  readonly access: KnowledgeSpaceAccessService;
  /**
   * Allows deployment-level Research defaults only for explicitly opted-in legacy/test gateways.
   * Production gateways must resolve the immutable published knowledge-space profile instead.
   */
  readonly allowLegacyProfileFallback?: boolean | undefined;
  /** Emergency rollback only. Capability requests never use this path or create snapshots. */
  readonly allowLegacyPermissionSnapshotAdmission?: boolean | undefined;
  readonly app: OpenAPIHono<KnowledgeGatewayEnv>;
  readonly autoRetrievalModeResolver?: AutoRetrievalModeResolver | undefined;
  readonly authorization: KnowledgeSpaceAuthorizationGuard;
  readonly capabilityGrants?:
    | Pick<CapabilityGrantProvenanceRepository, "assertPublicationAllowed">
    | undefined;
  readonly directStream?: ResearchTaskDirectStreamOptions | undefined;
  readonly assets: Pick<DocumentAssetRepository, "get">;
  readonly dryRunResearchPlanner: ResearchTaskDryRunPlanner;
  readonly deletionVisibility?: ResearchTaskDeletionVisibility | undefined;
  readonly researchTaskJobs: ResearchTaskJobStateMachine;
  readonly researchTaskPartialResults: ResearchTaskPartialResultRepository;
  readonly researchTaskProgressEvents: ResearchTaskProgressRepository;
  readonly runtimeSnapshotResolver?: PublishedKnowledgeSpaceRuntimeSnapshotResolver | undefined;
  readonly spaces: KnowledgeSpaceRepository;
  readonly permissionSnapshotTtlMs?: number | undefined;
  readonly now?: (() => number) | undefined;
}

export function registerResearchTaskHandlers({
  access,
  allowLegacyProfileFallback = false,
  allowLegacyPermissionSnapshotAdmission = true,
  app,
  autoRetrievalModeResolver,
  authorization,
  capabilityGrants,
  assets,
  dryRunResearchPlanner,
  deletionVisibility,
  directStream,
  researchTaskJobs,
  researchTaskPartialResults,
  researchTaskProgressEvents,
  runtimeSnapshotResolver,
  spaces,
  permissionSnapshotTtlMs = 60 * 60_000,
  now = Date.now,
}: RegisterResearchTaskHandlersOptions): void {
  if (!Number.isSafeInteger(permissionSnapshotTtlMs) || permissionSnapshotTtlMs < 1) {
    throw new Error("Research task permissionSnapshotTtlMs must be a positive integer");
  }
  if (allowLegacyProfileFallback && process.env.NODE_ENV === "production") {
    throw new Error("Legacy Research profile fallback is forbidden in production");
  }
  app.openapi(
    listKnowledgeSpaceResearchTasksRoute,
    openApiHandler(async (context) => {
      const subject = context.get("subject");
      const params = context.req.valid("param") as { readonly id: string };
      const query = context.req.valid("query") as ListResearchTasksQuery;
      const capabilityGrant = context.get("capabilityV2Grant");
      if (
        !capabilityGrant ||
        capabilityGrant.action !== "research_tasks.list" ||
        capabilityGrant.namespaceId !== subject.tenantId ||
        capabilityGrant.subject !== subject.subjectId ||
        capabilityGrant.resource.type !== "knowledge_space" ||
        capabilityGrant.resource.id !== params.id ||
        capabilityGrant.resource.parent_id !== null
      ) {
        return context.json({ error: "Forbidden" }, 403);
      }
      const space = await spaces.get({ id: params.id, tenantId: subject.tenantId });
      if (!space) {
        return context.json({ error: "Knowledge space not found" }, 404);
      }
      try {
        const page = await researchTaskJobs.listBySpace({
          capabilityRequester: {
            callerKind: capabilityGrant.callerKind,
            grantId: capabilityGrant.grantId,
            subjectId: capabilityGrant.subject,
          },
          ...(query.cursor ? { cursor: decodeResearchTaskListCursor(query.cursor) } : {}),
          knowledgeSpaceId: params.id,
          limit: query.limit,
          tenantId: subject.tenantId,
        });
        return context.json(
          {
            items: page.items.map(toPublicResearchTaskJob),
            ...(page.nextCursor
              ? { nextCursor: encodeResearchTaskListCursor(page.nextCursor) }
              : {}),
          },
          200,
        );
      } catch (error) {
        return error instanceof ResearchTaskListCursorError
          ? context.json({ error: error.message }, 400)
          : context.json({ error: "Research task listing is unavailable" }, 503);
      }
    }),
  );
  app.openapi(
    planResearchTaskRoute,
    openApiHandler(async (context) => {
      const subject = context.get("subject");
      const callerKind = context.get("callerKind") ?? "interactive";
      const capabilityGrant = context.get("capabilityV2Grant");
      const body = context.req.valid("json") as PlanResearchTaskBody;
      const space = await spaces.get({
        id: body.knowledgeSpaceId,
        tenantId: subject.tenantId,
      });

      if (!space) {
        return context.json({ error: "Knowledge space not found" }, 404);
      }

      try {
        if (capabilityGrant) {
          if (
            capabilityGrant.action !== "research_tasks.plan" ||
            capabilityGrant.namespaceId !== subject.tenantId ||
            capabilityGrant.subject !== subject.subjectId ||
            capabilityGrant.resource.type !== "knowledge_space" ||
            capabilityGrant.resource.id !== space.id ||
            capabilityGrant.resource.parent_id !== null
          ) {
            return context.json({ error: "Forbidden" }, 403);
          }
        } else {
          await authorization.authorize({
            callerKind,
            knowledgeSpaceId: space.id,
            requiredAccess: "read",
            subject,
          });
        }
      } catch (error) {
        if (error instanceof KnowledgeSpaceAuthorizationError) {
          return context.json({ code: error.code, error: error.message }, 403);
        }
        throw error;
      }

      try {
        const resolved = await resolveResearchTaskPlan({
          allowLegacyProfileFallback,
          body,
          autoRetrievalModeResolver,
          dryRunResearchPlanner,
          knowledgeSpaceId: space.id,
          runtimeSnapshotResolver,
          tenantId: subject.tenantId,
          traceId: context.get("traceId"),
        });
        return context.json(resolved.plan, 200);
      } catch (error) {
        if (error instanceof KnowledgeSpaceRetrievalProfileModeError) {
          return context.json({ code: error.code, error: error.message, mode: error.mode }, 400);
        }
        if (error instanceof PublishedProjectionReadUnavailableError) {
          return context.json({ error: "Published runtime snapshot unavailable" }, 503);
        }
        return context.json(
          {
            error: error instanceof Error ? error.message : "Invalid research task plan request",
          },
          400,
        );
      }
    }),
  );

  app.openapi(
    createResearchTaskRoute,
    openApiHandler(async (context) => {
      const subject = context.get("subject");
      const callerKind = context.get("callerKind") ?? "interactive";
      const capabilityGrant = context.get("capabilityV2Grant");
      const body = context.req.valid("json") as CreateResearchTaskBody;
      const space = await spaces.get({
        id: body.knowledgeSpaceId,
        tenantId: subject.tenantId,
      });

      if (!space) {
        return context.json({ error: "Knowledge space not found" }, 404);
      }

      try {
        if (!capabilityGrant) {
          if (!allowLegacyPermissionSnapshotAdmission) {
            return context.json({ error: "Capability v2 is required for Research admission" }, 403);
          }
          await authorization.authorize({
            callerKind,
            knowledgeSpaceId: space.id,
            requiredAccess: "read",
            subject,
          });
        }
        const resolved = await resolveResearchTaskPlan({
          allowLegacyProfileFallback,
          body,
          autoRetrievalModeResolver,
          dryRunResearchPlanner,
          knowledgeSpaceId: space.id,
          runtimeSnapshotResolver,
          tenantId: subject.tenantId,
          traceId: context.get("traceId"),
        });
        const plan = resolved.plan;
        const limitEvaluation = evaluateResearchTaskLimits(plan, body.limits);

        if (!limitEvaluation.allowed) {
          return context.json(
            {
              error: "Research task limits exceeded",
              violations: limitEvaluation.violations,
            },
            422,
          );
        }

        const authenticatedApiKey = context.get("authenticatedApiKey");
        const permissionSnapshot = capabilityGrant
          ? undefined
          : await issueKnowledgeSpaceDurablePermission({
              access,
              ...(authenticatedApiKey ? { apiKey: authenticatedApiKey } : {}),
              authorization,
              callerKind,
              expiresAt: new Date(
                Math.min(
                  now() + permissionSnapshotTtlMs,
                  authenticatedApiKey?.expiresAt
                    ? Date.parse(authenticatedApiKey.expiresAt)
                    : Number.POSITIVE_INFINITY,
                ),
              ).toISOString(),
              knowledgeSpaceId: space.id,
              requiredAccess: "read",
              subject,
            });
        const job = await researchTaskJobs.start({
          budgetUsd: body.budgetUsd,
          knowledgeSpaceId: space.id,
          limits: body.limits,
          metadata: toJobPayloadRecord({
            ...omitKnowledgeFsReservedMetadata(toJobPayloadRecord(body.metadata)),
            ...(resolved.modeResolution.requestedMode === "auto"
              ? {
                  [AUTO_RETRIEVAL_MODE_DECISION_METADATA_KEY]: {
                    degraded: resolved.modeResolution.degraded,
                    durationMs: resolved.modeResolution.durationMs,
                    ...(resolved.modeResolution.errorClass
                      ? { errorClass: resolved.modeResolution.errorClass }
                      : {}),
                    ...(resolved.modeResolution.finishReason
                      ? { finishReason: resolved.modeResolution.finishReason }
                      : {}),
                    ...(resolved.modeResolution.generationModel
                      ? { generationModel: resolved.modeResolution.generationModel }
                      : {}),
                    ...(resolved.modeResolution.promptVersion
                      ? { promptVersion: resolved.modeResolution.promptVersion }
                      : {}),
                    ...(resolved.modeResolution.provider
                      ? { provider: resolved.modeResolution.provider }
                      : {}),
                    ...(resolved.modeResolution.reasonCode
                      ? { reasonCode: resolved.modeResolution.reasonCode }
                      : {}),
                    requestedMode: resolved.modeResolution.requestedMode,
                    resolvedMode: resolved.modeResolution.resolvedMode,
                    resolver: resolved.modeResolution.resolver,
                    ...(resolved.frozenRuntime
                      ? {
                          publicationFingerprint:
                            resolved.frozenRuntime.projectionSnapshot.fingerprint,
                          publicationId: resolved.frozenRuntime.projectionSnapshot.publicationId,
                          reasoningModel: {
                            ...resolved.frozenRuntime.retrievalProfile.reasoningModel,
                          },
                        }
                      : {}),
                    retrievalProfileRevision:
                      resolved.frozenRuntime?.retrievalProfile.revision ?? null,
                    ...(resolved.modeResolution.usage
                      ? { usage: resolved.modeResolution.usage }
                      : {}),
                  },
                }
              : {}),
            ...(resolved.runtimeSnapshotPayload
              ? {
                  [RESEARCH_TASK_RUNTIME_SNAPSHOT_METADATA_KEY]: resolved.runtimeSnapshotPayload,
                }
              : {}),
          }),
          mode: plan.retrievalPlan.resolvedMode,
          ...(capabilityGrant
            ? { capabilityGrantId: capabilityGrant.grantId }
            : permissionSnapshot
              ? {
                  permissionSnapshot: {
                    accessChannel: permissionSnapshot.accessChannel,
                    id: permissionSnapshot.id,
                    revision: permissionSnapshot.revision,
                  },
                  subjectId: subject.subjectId,
                }
              : {}),
          query: body.query,
          tenantId: subject.tenantId,
          topK: plan.retrievalPlan.topK,
        });

        return context.json(toPublicResearchTaskJob(job), 201);
      } catch (error) {
        if (error instanceof KnowledgeSpaceAuthorizationError) {
          return context.json({ code: error.code, error: error.message }, 403);
        }
        if (error instanceof KnowledgeSpaceRetrievalProfileModeError) {
          return context.json({ code: error.code, error: error.message, mode: error.mode }, 400);
        }
        if (error instanceof PublishedProjectionReadUnavailableError) {
          return context.json({ error: "Published runtime snapshot unavailable" }, 503);
        }
        return context.json(
          {
            error: error instanceof Error ? error.message : "Invalid research task request",
          },
          400,
        );
      }
    }),
  );

  app.openapi(
    getResearchTaskRoute,
    openApiHandler(async (context) => {
      const subject = context.get("subject");
      const params = context.req.valid("param") as ResearchTaskJobParams;
      const job = await researchTaskJobs.get(params.id);

      if (!job || job.tenantId !== subject.tenantId) {
        return context.json({ error: "Research task job not found" }, 404);
      }
      if (!(await isResearchHistoryVisible(deletionVisibility, job))) {
        return context.json({ error: "Research task job not found" }, 404);
      }

      if (!apiKeyMatchesResearchSpace(context, job.knowledgeSpaceId)) {
        return context.json({ error: "Knowledge space access denied" }, 403);
      }

      const denied = await authorizeJobAccess({
        access,
        authorization,
        capabilityGrant: context.get("capabilityV2Grant"),
        callerKind: context.get("callerKind") ?? "interactive",
        currentApiKeyId: context.get("authenticatedApiKey")?.id,
        job,
        requiredAccess: "read",
        subject,
      });
      if (denied) {
        return context.json(denied, 403);
      }

      if (!(await isResearchHistoryVisible(deletionVisibility, job))) {
        return context.json({ error: "Research task job not found" }, 404);
      }

      return context.json(toPublicResearchTaskJob(job), 200);
    }),
  );

  app.openapi(
    listResearchTaskPartialsRoute,
    openApiHandler(async (context) => {
      const subject = context.get("subject");
      const params = context.req.valid("param") as ResearchTaskJobParams;
      const query = context.req.valid("query") as ListResearchTaskPartialsQuery;
      const job = await researchTaskJobs.get(params.id);

      if (!job || job.tenantId !== subject.tenantId) {
        return context.json({ error: "Research task job not found" }, 404);
      }
      if (!(await isResearchHistoryVisible(deletionVisibility, job))) {
        return context.json({ error: "Research task job not found" }, 404);
      }

      if (!apiKeyMatchesResearchSpace(context, job.knowledgeSpaceId)) {
        return context.json({ error: "Knowledge space access denied" }, 403);
      }

      const denied = await authorizeJobAccess({
        access,
        authorization,
        capabilityGrant: context.get("capabilityV2Grant"),
        callerKind: context.get("callerKind") ?? "interactive",
        currentApiKeyId: context.get("authenticatedApiKey")?.id,
        job,
        requiredAccess: "read",
        subject,
      });
      if (denied) {
        return context.json(denied, 403);
      }

      const page = await researchTaskPartialResults.list({
        cursor: query.cursor,
        limit: query.limit,
        researchTaskJobId: params.id,
        tenantId: subject.tenantId,
      });
      const readable = await Promise.all(
        page.items.map((partial) =>
          evidenceBundlesHaveActiveDocuments({
            assets,
            bundles: [partial.evidenceBundle],
            knowledgeSpaceId: partial.knowledgeSpaceId,
          }),
        ),
      );

      if (!(await isResearchHistoryVisible(deletionVisibility, job))) {
        return context.json({ error: "Research task job not found" }, 404);
      }

      return context.json(
        {
          items: page.items.filter((_partial, index) => readable[index] === true),
          ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
        },
        200,
      );
    }),
  );

  app.openapi(
    streamResearchTaskProgressRoute,
    openApiHandler(async (context) => {
      const subject = context.get("subject");
      const params = context.req.valid("param") as ResearchTaskJobParams;
      const query = context.req.valid("query") as ListResearchTaskProgressQuery;
      const job = await researchTaskJobs.get(params.id);

      if (!job || job.tenantId !== subject.tenantId) {
        return context.json({ error: "Research task job not found" }, 404);
      }
      if (!(await isResearchHistoryVisible(deletionVisibility, job))) {
        return context.json({ error: "Research task job not found" }, 404);
      }

      const headerCursor = context.req.header("last-event-id");
      if (query.cursor && headerCursor && query.cursor !== headerCursor) {
        return context.json({ error: "Research task progress cursor is ambiguous" }, 400);
      }
      const cursor = query.cursor ?? headerCursor;
      const capabilityGrant = context.get("capabilityV2Grant");
      if (capabilityGrant) {
        if (
          !directStream ||
          !capabilityGrants ||
          capabilityGrant.action !== "research_tasks.stream" ||
          capabilityGrant.resource.type !== "research_task" ||
          capabilityGrant.resource.id !== params.id ||
          capabilityGrant.resource.parent_id !== job.knowledgeSpaceId ||
          query.knowledgeSpaceId !== job.knowledgeSpaceId
        ) {
          return context.json({ error: "Forbidden" }, 403);
        }
        const grantScope = {
          grantId: capabilityGrant.grantId,
          knowledgeSpaceId: job.knowledgeSpaceId,
          tenantId: subject.tenantId,
        };
        await capabilityGrants.assertPublicationAllowed(grantScope);
        return createResearchTaskProgressSseResponse({
          authorizationFailureEvent: true,
          authorizationRecheckIntervalMs: 250,
          authorize: async () => {
            if (!(await isResearchHistoryVisible(deletionVisibility, job))) {
              throw new Error("Research task progress was invalidated by durable deletion");
            }
            await capabilityGrants.assertPublicationAllowed(grantScope);
          },
          ...(cursor === undefined ? {} : { cursor }),
          limit: query.limit,
          maxConnectionMs: directStream.maxConnectionMs,
          onClose: (reason) =>
            directStream.observer?.onClose?.({
              reason,
              researchTaskJobId: job.id,
              tenantId: job.tenantId,
            }),
          onOpen: () =>
            directStream.observer?.onOpen?.({
              reconnected: cursor !== undefined,
              researchTaskJobId: job.id,
              tenantId: job.tenantId,
            }),
          repository: researchTaskProgressEvents,
          researchTaskJobId: params.id,
          tenantId: subject.tenantId,
        });
      }

      if (!apiKeyMatchesResearchSpace(context, job.knowledgeSpaceId)) {
        return context.json({ error: "Knowledge space access denied" }, 403);
      }

      const denied = await authorizeJobAccess({
        access,
        authorization,
        capabilityGrant: context.get("capabilityV2Grant"),
        callerKind: context.get("callerKind") ?? "interactive",
        currentApiKeyId: context.get("authenticatedApiKey")?.id,
        job,
        requiredAccess: "read",
        subject,
      });
      if (denied) {
        return context.json(denied, 403);
      }

      return createResearchTaskProgressSseResponse({
        authorizationRecheckIntervalMs: 250,
        authorize: async () => {
          if (!(await isResearchHistoryVisible(deletionVisibility, job))) {
            throw new Error("Research task progress was invalidated by durable deletion");
          }
          const currentDenied = await authorizeJobAccess({
            access,
            authorization,
            capabilityGrant: context.get("capabilityV2Grant"),
            callerKind: context.get("callerKind") ?? "interactive",
            currentApiKeyId: context.get("authenticatedApiKey")?.id,
            job,
            requiredAccess: "read",
            subject,
          });
          if (currentDenied) {
            throw new Error("Research task progress access was revoked");
          }
        },
        ...(cursor === undefined ? {} : { cursor }),
        limit: query.limit,
        repository: researchTaskProgressEvents,
        researchTaskJobId: params.id,
        tenantId: subject.tenantId,
      });
    }),
  );

  app.openapi(
    cancelResearchTaskRoute,
    openApiHandler(async (context) => {
      const subject = context.get("subject");
      const params = context.req.valid("param") as ResearchTaskJobParams;
      const job = await researchTaskJobs.get(params.id);

      if (!job || job.tenantId !== subject.tenantId) {
        return context.json({ error: "Research task job not found" }, 404);
      }
      if (!(await isResearchHistoryVisible(deletionVisibility, job))) {
        return context.json({ error: "Research task job not found" }, 404);
      }

      if (!apiKeyMatchesResearchSpace(context, job.knowledgeSpaceId)) {
        return context.json({ error: "Knowledge space access denied" }, 403);
      }

      const denied = await authorizeJobAccess({
        access,
        authorization,
        capabilityGrant: context.get("capabilityV2Grant"),
        callerKind: context.get("callerKind") ?? "interactive",
        currentApiKeyId: context.get("authenticatedApiKey")?.id,
        job,
        requiredAccess: "write",
        subject,
      });
      if (denied) {
        return context.json(denied, 403);
      }

      if (!(await isResearchHistoryVisible(deletionVisibility, job))) {
        return context.json({ error: "Research task job not found" }, 404);
      }

      try {
        const canceled = await researchTaskJobs.cancel(params.id, "Canceled by request");
        return context.json(toPublicResearchTaskJob(canceled), 200);
      } catch {
        return context.json({ error: "Research task job cannot be canceled" }, 409);
      }
    }),
  );
}

class ResearchTaskListCursorError extends Error {}

export function encodeResearchTaskListCursor(value: {
  readonly createdAt: number;
  readonly id: string;
}): string {
  return `${value.createdAt}|${encodeURIComponent(value.id)}`;
}

export function decodeResearchTaskListCursor(value: string): {
  readonly createdAt: number;
  readonly id: string;
} {
  const [createdAtValue, encodedId, ...extra] = value.split("|");
  const createdAt = Number(createdAtValue);
  let id = "";
  try {
    id = encodedId ? decodeURIComponent(encodedId) : "";
  } catch {
    throw new ResearchTaskListCursorError("Research task list cursor is invalid");
  }
  if (
    extra.length > 0 ||
    !createdAtValue ||
    !Number.isSafeInteger(createdAt) ||
    createdAt < 0 ||
    !id
  ) {
    throw new ResearchTaskListCursorError("Research task list cursor is invalid");
  }
  return { createdAt, id };
}

async function resolveResearchTaskPlan({
  allowLegacyProfileFallback,
  autoRetrievalModeResolver,
  body,
  dryRunResearchPlanner,
  knowledgeSpaceId,
  runtimeSnapshotResolver,
  tenantId,
  traceId,
}: {
  readonly allowLegacyProfileFallback: boolean;
  readonly autoRetrievalModeResolver?: AutoRetrievalModeResolver | undefined;
  readonly body: Pick<PlanResearchTaskBody, "budgetUsd" | "mode" | "query" | "topK">;
  readonly dryRunResearchPlanner: ResearchTaskDryRunPlanner;
  readonly knowledgeSpaceId: string;
  readonly runtimeSnapshotResolver?: PublishedKnowledgeSpaceRuntimeSnapshotResolver | undefined;
  readonly tenantId: string;
  readonly traceId?: string | undefined;
}): Promise<{
  readonly frozenRuntime?: ReturnType<typeof researchTaskRuntimeSnapshotFromMetadata>;
  readonly modeResolution: RetrievalModeRequestResolution;
  readonly plan: ReturnType<ResearchTaskDryRunPlanner["plan"]>;
  readonly runtimeSnapshotPayload?: ReturnType<typeof toResearchTaskRuntimeSnapshotPayload>;
}> {
  if (!runtimeSnapshotResolver) {
    if (!allowLegacyProfileFallback) {
      throw new PublishedProjectionReadUnavailableError({ knowledgeSpaceId, tenantId });
    }
    const requestedMode = body.mode ?? "research";
    // Durable Auto must bind its LLM decision to the same immutable publication/model tuple that
    // the worker will replay. The legacy path has no such tuple, so admitting Auto here would
    // create a job that necessarily fails the runtime integrity check.
    if (requestedMode === "auto") {
      throw new PublishedProjectionReadUnavailableError({ knowledgeSpaceId, tenantId });
    }
    const modeResolution = await resolveRetrievalModeRequest({
      fallbackMode: "research",
      query: body.query,
      requestedMode,
      resolver: autoRetrievalModeResolver,
      tenantId,
      ...(traceId ? { traceId } : {}),
    });
    return {
      modeResolution,
      plan: dryRunResearchPlanner.plan({
        budgetUsd: body.budgetUsd,
        knowledgeSpaceId,
        mode: requestedMode,
        query: body.query,
        resolvedMode: modeResolution.resolvedMode,
        topK: body.topK,
        traceId,
      }),
    };
  }

  let snapshot: Awaited<ReturnType<PublishedKnowledgeSpaceRuntimeSnapshotResolver["resolve"]>>;
  try {
    snapshot = await runtimeSnapshotResolver.resolve({ knowledgeSpaceId, tenantId });
  } catch (error) {
    if (error instanceof PublishedProjectionReadUnavailableError) {
      throw error;
    }
    throw new PublishedProjectionReadUnavailableError({ knowledgeSpaceId, tenantId });
  }
  let runtimeSnapshotPayload: ReturnType<typeof toResearchTaskRuntimeSnapshotPayload>;
  try {
    runtimeSnapshotPayload = toResearchTaskRuntimeSnapshotPayload(snapshot);
  } catch {
    throw new PublishedProjectionReadUnavailableError({ knowledgeSpaceId, tenantId });
  }
  const frozenRuntime = researchTaskRuntimeSnapshotFromMetadata({
    [RESEARCH_TASK_RUNTIME_SNAPSHOT_METADATA_KEY]: runtimeSnapshotPayload,
  });
  if (
    !frozenRuntime ||
    frozenRuntime.projectionSnapshot.knowledgeSpaceId !== knowledgeSpaceId ||
    frozenRuntime.projectionSnapshot.tenantId !== tenantId
  ) {
    throw new PublishedProjectionReadUnavailableError({ knowledgeSpaceId, tenantId });
  }

  // Request fields are bounded at the HTTP schema. The space profile may legitimately carry a
  // larger Top K (up to 100), so merge defaults only after capturing the immutable tuple.
  const requestedMode = body.mode ?? frozenRuntime.retrievalProfile.defaultMode;
  const modeResolution = await resolveRetrievalModeRequest({
    fallbackMode: frozenRuntime.retrievalProfile.defaultMode,
    query: body.query,
    reasoningModel: frozenRuntime.retrievalProfile.reasoningModel,
    requestedMode,
    resolver: autoRetrievalModeResolver,
    tenantId,
    ...(traceId ? { traceId } : {}),
  });
  const plan = dryRunResearchPlanner.plan({
    budgetUsd: body.budgetUsd,
    knowledgeSpaceId,
    mode: requestedMode,
    query: body.query,
    resolvedMode: modeResolution.resolvedMode,
    topK: body.topK ?? frozenRuntime.retrievalProfile.topK,
    traceId,
  });
  const profileError = validateKnowledgeSpaceRetrievalProfileForMode(
    frozenRuntime.retrievalProfile,
    plan.retrievalPlan.resolvedMode,
  );
  if (profileError) {
    throw new KnowledgeSpaceRetrievalProfileModeError(profileError.mode);
  }
  if (plan.retrievalPlan.resolvedMode !== "research" && !frozenRuntime.embeddingProfile) {
    throw new PublishedProjectionReadUnavailableError({ knowledgeSpaceId, tenantId });
  }
  try {
    await runtimeSnapshotResolver.assertReady({
      knowledgeSpaceId,
      resolvedMode: plan.retrievalPlan.resolvedMode,
      tenantId,
    });
  } catch (error) {
    if (error instanceof PublishedProjectionReadUnavailableError) {
      throw error;
    }
    throw new PublishedProjectionReadUnavailableError({ knowledgeSpaceId, tenantId });
  }

  return { frozenRuntime, modeResolution, plan, runtimeSnapshotPayload };
}

async function isResearchHistoryVisible(
  visibility: ResearchTaskDeletionVisibility | undefined,
  job: Pick<ResearchTaskJob, "knowledgeSpaceId" | "tenantId">,
): Promise<boolean> {
  if (!visibility) return true;
  try {
    return await visibility.isSpaceReadable({
      knowledgeSpaceId: job.knowledgeSpaceId,
      tenantId: job.tenantId,
    });
  } catch {
    // Visibility is a security boundary. Database/readiness failures must not expose stale
    // Research queries, progress, or evidence while deletion state is unknown.
    return false;
  }
}

function apiKeyMatchesResearchSpace(
  context: Pick<LooseOpenApiContext, "get">,
  knowledgeSpaceId: string,
): boolean {
  return isAuthenticatedApiKeyBoundToKnowledgeSpace({
    authenticatedApiKeyKnowledgeSpaceId: context.get("authenticatedApiKeyKnowledgeSpaceId"),
    callerKind: context.get("callerKind"),
    knowledgeSpaceId,
  });
}

async function authorizeJobAccess(input: {
  readonly access: Pick<KnowledgeSpaceAccessService, "revalidatePermissionSnapshot">;
  readonly authorization: KnowledgeSpaceAuthorizationGuard;
  readonly capabilityGrant?:
    | NonNullable<KnowledgeGatewayEnv["Variables"]["capabilityV2Grant"]>
    | undefined;
  readonly callerKind: KnowledgeSpaceCallerKind;
  readonly currentApiKeyId?: string | undefined;
  readonly job: ResearchTaskJob;
  readonly requiredAccess: "read" | "write";
  readonly subject: Parameters<KnowledgeSpaceAuthorizationGuard["authorize"]>[0]["subject"];
}): Promise<{ readonly code: string; readonly error: string } | null> {
  if (
    input.capabilityGrant?.resource.type === "research_task" &&
    input.capabilityGrant.resource.id === input.job.id &&
    input.capabilityGrant.resource.parent_id === input.job.knowledgeSpaceId &&
    input.capabilityGrant.namespaceId === input.subject.tenantId &&
    input.capabilityGrant.subject === input.subject.subjectId
  ) {
    return null;
  }
  try {
    await authorizeResearchTaskDerivedResult({
      access: input.access,
      authorization: input.authorization,
      callerKind: input.callerKind,
      currentApiKeyId: input.currentApiKeyId,
      job: input.job,
      requiredAccess: input.requiredAccess,
      subject: input.subject,
    });
    return null;
  } catch (error) {
    if (error instanceof DerivedResultOwnerMismatchError) {
      return {
        code: "KNOWLEDGE_SPACE_ACCESS_DENIED",
        error: "Knowledge space access denied",
      };
    }
    if (error instanceof KnowledgeSpaceAuthorizationError) {
      return { code: error.code, error: error.message };
    }
    throw error;
  }
}
