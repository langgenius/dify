import type { OpenAPIHono } from "@hono/zod-openapi";

import type { DurableDeletionJob, DurableDeletionRepository } from "./durable-deletion-repository";
import type { DurableDeletionJobResponse } from "./durable-deletion-response-schemas";
import {
  type DurableDeletionRequestPrincipal,
  type DurableDeletionService,
  DurableDeletionServiceError,
} from "./durable-deletion-service";
import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import {
  type IntegratedKnowledgeSpaceDeletionProgress,
  type IntegratedKnowledgeSpaceDeletionRequest,
  deleteIntegratedKnowledgeSpaceRoute,
} from "./integrated-knowledge-space-deletion-routes";
import type { KnowledgeSpaceRepository } from "./knowledge-space-repository";
import { openApiHandler } from "./openapi-handler-utils";

const IDEMPOTENCY_CONFLICT_CODE = "DURABLE_DELETION_IDEMPOTENCY_CONFLICT";

export interface RegisterIntegratedKnowledgeSpaceDeletionHandlersOptions {
  readonly app: OpenAPIHono<KnowledgeGatewayEnv>;
  readonly durableDeletions: DurableDeletionService;
  readonly jobs: Pick<DurableDeletionRepository, "getJobByIdempotency">;
  readonly spaces: Pick<KnowledgeSpaceRepository, "getForDeletion">;
}

export function registerIntegratedKnowledgeSpaceDeletionHandlers({
  app,
  durableDeletions,
  jobs,
  spaces,
}: RegisterIntegratedKnowledgeSpaceDeletionHandlersOptions): void {
  app.openapi(
    deleteIntegratedKnowledgeSpaceRoute,
    openApiHandler(async (context) => {
      const body = context.req.valid("json") as IntegratedKnowledgeSpaceDeletionRequest;
      const { id: knowledgeSpaceId } = context.req.valid("param") as { readonly id: string };
      const subject = context.get("subject");
      const grant = context.get("capabilityV2Grant");
      if (
        !grant ||
        grant.action !== "knowledge_spaces.delete" ||
        grant.callerKind !== "internal_worker" ||
        grant.controlSpaceId !== body.controlSpaceId ||
        grant.grantId !== body.operationId ||
        grant.namespaceId !== subject.tenantId ||
        grant.resource.id !== knowledgeSpaceId ||
        grant.resource.type !== "knowledge_space"
      ) {
        return context.json({ error: "Forbidden" }, 403);
      }

      const principal: DurableDeletionRequestPrincipal = {
        callerKind: context.get("callerKind") ?? "service_api",
        capability: {
          contentScopeIds: grant.contentScopeIds,
          grantId: grant.grantId,
        },
        subject,
      };
      const replayInput = {
        expectedRevision: body.expectedRevision,
        grantId: grant.grantId,
        idempotencyKey: body.idempotencyKey,
        knowledgeSpaceId,
        tenantId: subject.tenantId,
      };

      let replay = await jobs.getJobByIdempotency({
        idempotencyKey: body.idempotencyKey,
        tenantId: subject.tenantId,
      });
      if (replay) {
        return replayResponse(context, replay, replayInput, durableDeletions, principal);
      }

      const space = await spaces.getForDeletion({
        id: knowledgeSpaceId,
        tenantId: subject.tenantId,
      });
      if (!space) {
        // Close the narrow race where another request commits the durable ledger and removes the
        // primary Space between our first ledger lookup and resource lookup.
        replay = await jobs.getJobByIdempotency({
          idempotencyKey: body.idempotencyKey,
          tenantId: subject.tenantId,
        });
        return replay
          ? replayResponse(context, replay, replayInput, durableDeletions, principal)
          : context.json({ error: "Knowledge space not found" }, 404);
      }

      try {
        // This durable admission is the single deletion mutation: its repository atomically writes
        // the Space-target tombstone, outbox event, job ledger, and `deleting` Space transition.
        const accepted = await durableDeletions.requestKnowledgeSpaceDeletion({
          ...principal,
          challenge: space.name,
          expectedRevision: body.expectedRevision,
          idempotencyKey: body.idempotencyKey,
          knowledgeSpaceId,
        });
        return currentJobResponse(context, accepted.job, body.expectedRevision + 1);
      } catch (error) {
        return durableDeletionErrorResponse(context, error);
      }
    }),
  );
}

interface ReplayIdentity {
  readonly expectedRevision: number;
  readonly grantId: string;
  readonly idempotencyKey: string;
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;
}

async function replayResponse(
  context: { json(body: unknown, status?: number): Response },
  job: DurableDeletionJob,
  identity: ReplayIdentity,
  durableDeletions: DurableDeletionService,
  principal: DurableDeletionRequestPrincipal,
): Promise<Response> {
  if (!matchesReplay(job, identity)) {
    return context.json(
      {
        code: IDEMPOTENCY_CONFLICT_CODE,
        error: "Deletion idempotency key is already bound to another request",
      },
      409,
    );
  }
  if (job.runState === "failed") {
    try {
      const retried = await durableDeletions.retry({
        ...principal,
        idempotencyKey: `${identity.idempotencyKey}:retry:${job.rowVersion}`,
        jobId: job.id,
      });
      return retried
        ? currentJobResponse(context, retried.job, identity.expectedRevision + 1)
        : context.json(
            {
              code: "DURABLE_DELETION_STATE_CONFLICT",
              error: "Durable deletion retry is no longer authorized",
            },
            409,
          );
    } catch (error) {
      return durableDeletionErrorResponse(context, error);
    }
  }
  return currentJobResponse(context, job, identity.expectedRevision + 1);
}

function matchesReplay(job: DurableDeletionJob, identity: ReplayIdentity): boolean {
  return (
    job.capabilityGrantId === identity.grantId &&
    job.idempotencyKey === identity.idempotencyKey &&
    job.knowledgeSpaceId === identity.knowledgeSpaceId &&
    job.targetId === identity.knowledgeSpaceId &&
    job.targetRevision === identity.expectedRevision &&
    job.targetType === "knowledge_space" &&
    job.tenantId === identity.tenantId
  );
}

type DeletionProgressSource = DurableDeletionJob | DurableDeletionJobResponse;

function deletionProgress(
  job: DeletionProgressSource,
  revision: number,
): IntegratedKnowledgeSpaceDeletionProgress {
  if (
    job.checkpoint === "completed" &&
    (job.runState === "succeeded" || job.runState === "completed")
  ) {
    return {
      irreversibleAt: job.completedAt ?? job.updatedAt,
      phase: "completed",
      revision,
    };
  }
  if (
    ["deleting_objects", "deleting_derived_data", "deleting_primary_data"].includes(
      job.checkpoint,
    ) ||
    ("scanPhase" in job && job.scanPhase === "reconcile-after-dirty-primary")
  ) {
    return { irreversibleAt: job.updatedAt, phase: "irreversible", revision };
  }
  return { phase: "accepted", revision };
}

function progressResponse(
  context: { json(body: unknown, status?: number): Response },
  progress: IntegratedKnowledgeSpaceDeletionProgress,
): Response {
  return context.json(progress, progress.phase === "completed" ? 200 : 202);
}

function currentJobResponse(
  context: { json(body: unknown, status?: number): Response },
  job: DeletionProgressSource,
  revision: number,
): Response {
  if (job.runState === "failed") {
    return context.json(
      { code: "DURABLE_DELETION_FAILED", error: "Durable deletion requires operator retry" },
      503,
    );
  }
  if (job.runState === "canceled") {
    return context.json(
      { code: "DURABLE_DELETION_STATE_CONFLICT", error: "Durable deletion was canceled" },
      409,
    );
  }
  return progressResponse(context, deletionProgress(job, revision));
}

function durableDeletionErrorResponse(
  context: { json(body: unknown, status?: number): Response },
  error: unknown,
): Response {
  if (!(error instanceof DurableDeletionServiceError)) throw error;
  const status =
    error.code === "DURABLE_DELETION_UNAVAILABLE"
      ? 503
      : error.code === "DURABLE_DELETION_FORBIDDEN"
        ? 403
        : error.code === "DURABLE_DELETION_NOT_FOUND"
          ? 404
          : 409;
  return context.json({ code: error.code, error: error.message }, status);
}
