import {
  type EvidenceBundle,
  EvidenceBundleSchema,
  validateKnowledgeSpaceRetrievalProfileForMode,
} from "@knowledge/core";

import {
  AUTO_RETRIEVAL_MODE_DECISION_METADATA_KEY,
  AUTO_RETRIEVAL_MODE_PROMPT_VERSION,
} from "./auto-retrieval-mode-resolver";
import {
  type CapabilityGrantProvenanceRepository,
  CapabilityPublicationFencedError,
} from "./capability-grant-provenance";
import {
  DeletionLifecycleFenceActiveError,
  type DeletionLifecycleFenceGuard,
  type DeletionLifecycleFenceToken,
} from "./deletion-lifecycle-fence";
import type {
  QueryGenerationEvent,
  QueryGenerationMode,
  QueryGenerator,
} from "./gateway-sse-responses";
import { isPlainObject } from "./json-utils";
import {
  KnowledgeSpaceAccessError,
  type KnowledgeSpaceAccessService,
  type KnowledgeSpacePermissionSnapshot,
} from "./knowledge-space-access-control";
import type { KnowledgeSpaceManifestRepository } from "./knowledge-space-manifest-repository";
import {
  type DurableTaskOperationalMetrics,
  recordDurableTaskOperationalMetric,
} from "./operational-metrics";
import type { PublishedProjectionReadSnapshotResolver } from "./published-projection-read-snapshot";
import type {
  ResearchTaskDurableRepository,
  ResearchTaskExecutionFence,
} from "./research-task-durable-repository";
import type {
  ResearchTaskJob,
  ResearchTaskJobStage,
  ResearchTaskPartialResultRepository,
} from "./research-task-job";
import type {
  ResearchTaskProgressEventType,
  ResearchTaskProgressPublisher,
} from "./research-task-progress";
import {
  type FrozenResearchTaskRuntimeSnapshot,
  RESEARCH_TASK_RUNTIME_SNAPSHOT_INVALID,
  ResearchTaskRuntimeSnapshotInvalidError,
  researchTaskRuntimeSnapshotFromMetadata,
} from "./research-task-runtime-snapshot";
import { createRetrievalPlanner } from "./retrieval-planner";

export interface ResearchTaskRuntimeOptions {
  readonly access: Pick<KnowledgeSpaceAccessService, "revalidatePermissionSnapshot">;
  /** Explicit compatibility path for pre-snapshot legacy/test jobs. Never enable in production. */
  readonly allowLegacyProfileFallback?: boolean | undefined;
  readonly capabilityGrants?:
    | Pick<CapabilityGrantProvenanceRepository, "assertPublicationAllowed" | "get">
    | undefined;
  readonly generator: QueryGenerator;
  readonly deletionFence?: DeletionLifecycleFenceGuard | undefined;
  readonly heartbeatIntervalMs?: number | undefined;
  readonly intervalMs: number;
  readonly leaseMs: number;
  readonly manifests: KnowledgeSpaceManifestRepository;
  readonly maxBatchSize: number;
  readonly maxRetryDelayMs?: number | undefined;
  readonly metrics?: DurableTaskOperationalMetrics | undefined;
  readonly now?: (() => number) | undefined;
  readonly onError?:
    | ((input: { readonly error: unknown; readonly researchTaskJob?: ResearchTaskJob }) => void)
    | undefined;
  readonly partials: ResearchTaskPartialResultRepository;
  readonly projectionSnapshotResolver?: PublishedProjectionReadSnapshotResolver | undefined;
  readonly progress?: ResearchTaskProgressPublisher | undefined;
  readonly repository: ResearchTaskDurableRepository;
  readonly retryDelayMs?: number | undefined;
  readonly workerId: string;
}

export interface ResearchTaskRuntimeTickResult {
  readonly acknowledgedStale: number;
  readonly acknowledgedTerminal: number;
  readonly deferred: number;
  readonly failed: number;
  readonly leased: number;
  readonly rejected: number;
  readonly retryScheduled: number;
  readonly succeeded: number;
}

export interface ResearchTaskRuntime {
  start(): void;
  stop(): void;
  tick(): Promise<ResearchTaskRuntimeTickResult>;
}

type ResearchTaskRuntimeOutcome = Exclude<keyof ResearchTaskRuntimeTickResult, "leased">;

const terminalStages = new Set<ResearchTaskJobStage>(["completed", "failed", "canceled"]);
const modePlanner = createRetrievalPlanner({ maxTopK: 100 });

export function createResearchTaskRuntime({
  access,
  allowLegacyProfileFallback = false,
  capabilityGrants,
  deletionFence,
  generator,
  heartbeatIntervalMs,
  intervalMs,
  leaseMs,
  manifests,
  maxBatchSize,
  maxRetryDelayMs = 5 * 60_000,
  metrics,
  now = Date.now,
  onError,
  partials,
  projectionSnapshotResolver,
  progress,
  repository,
  retryDelayMs = 1_000,
  workerId,
}: ResearchTaskRuntimeOptions): ResearchTaskRuntime {
  for (const [field, value] of [
    ["intervalMs", intervalMs],
    ["leaseMs", leaseMs],
    ["maxBatchSize", maxBatchSize],
    ["maxRetryDelayMs", maxRetryDelayMs],
    ["retryDelayMs", retryDelayMs],
  ] as const) {
    positiveInteger(value, field);
  }
  const effectiveHeartbeatIntervalMs = heartbeatIntervalMs ?? Math.max(1, Math.floor(leaseMs / 3));
  positiveInteger(effectiveHeartbeatIntervalMs, "heartbeatIntervalMs");
  if (effectiveHeartbeatIntervalMs >= leaseMs) {
    throw new Error("Research task heartbeatIntervalMs must be less than leaseMs");
  }
  if (!workerId.trim()) {
    throw new Error("Research task workerId must not be empty");
  }

  let activeTick: Promise<ResearchTaskRuntimeTickResult> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  const publishProgress = async (
    job: ResearchTaskJob,
    type: ResearchTaskProgressEventType,
    payload?: Record<string, unknown>,
  ): Promise<void> => {
    try {
      await progress?.publish(job, type, payload);
    } catch (error) {
      // Progress is durable observability, not the execution fence. A transient append failure
      // must not roll back or duplicate an already durable stage transition.
      onError?.({ error, researchTaskJob: job });
    }
  };

  const processClaimedJob = async (
    claimed: ResearchTaskJob,
  ): Promise<ResearchTaskRuntimeOutcome> => {
    recordDurableTaskOperationalMetric(metrics, {
      lifecycle: "running",
      taskKind: "research",
    });
    let current = claimed;
    const leaseToken = claimed.leaseToken;
    if (!leaseToken) {
      onError?.({
        error: new Error("Research task durable claim has no execution lease token"),
        researchTaskJob: claimed,
      });
      return "rejected";
    }
    let deletionToken: DeletionLifecycleFenceToken | undefined;
    try {
      deletionToken = await deletionFence?.captureDeletionFence({
        knowledgeSpaceId: claimed.knowledgeSpaceId,
        tenantId: claimed.tenantId,
      });
    } catch (error) {
      if (error instanceof DeletionLifecycleFenceActiveError) {
        const canceled = await repository.cancelExecution({
          ...fence(current, now()),
          reason: "RESEARCH_TASK_DELETION_FENCE_ACTIVE",
        });
        if (canceled) {
          current = canceled;
          recordDurableTaskOperationalMetric(metrics, {
            lifecycle: "terminal",
            outcome: "canceled",
            taskKind: "research",
          });
        }
        return "acknowledgedStale";
      }
      throw error;
    }
    const assertWritable = async (): Promise<void> => {
      if (deletionToken) {
        await deletionFence?.assertDeletionFenceUnchanged(deletionToken);
      }
    };

    const abortController = new AbortController();
    await assertWritable();
    await publishProgress(current, "research_task.stage_changed", {
      executionAttempt: current.executionAttempts,
      workerClaimed: true,
    });
    let lane: Promise<void> = Promise.resolve();
    const serialize = async <T>(operation: () => Promise<T>): Promise<T> => {
      const run = lane.then(operation);
      lane = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    };

    const heartbeat = async (): Promise<void> => {
      await serialize(async () => {
        if (abortController.signal.aborted) {
          return;
        }
        const heartbeatAt = now();
        try {
          await assertWritable();
          const updated = await repository.heartbeatExecution({
            ...fence(current, heartbeatAt),
            leaseExpiresAt: heartbeatAt + leaseMs,
            workerId,
          });
          if (!updated) {
            throw new Error("Research task database heartbeat lost its lease fence");
          }
          current = updated;
        } catch (error) {
          abortController.abort(error);
          throw error;
        }
      });
    };

    const heartbeatTimer = setInterval(() => {
      void heartbeat().catch((error) => onError?.({ error, researchTaskJob: current }));
    }, effectiveHeartbeatIntervalMs);
    heartbeatTimer.unref?.();

    try {
      const authorizationContext = await resolveResearchTaskAuthorization(
        access,
        capabilityGrants,
        current,
      );
      current = await runResearchTask({
        access,
        allowLegacyProfileFallback,
        authorizationContext,
        abortSignal: abortController.signal,
        capabilityGrants,
        current,
        deletionFence,
        deletionToken,
        generator,
        manifests,
        now,
        partials,
        projectionSnapshotResolver,
        publishProgress,
        repository,
        serialize,
      });
      await assertWritable();
      const completed = await serialize(() => repository.completeExecution(fence(current, now())));
      if (!completed) {
        throw new Error("Research task completion lost its lease fence");
      }
      current = completed;
      recordDurableTaskOperationalMetric(metrics, {
        lifecycle: "terminal",
        outcome: "completed",
        taskKind: "research",
      });
      await assertWritable();
      await publishProgress(completed, "research_task.stage_changed", {
        previousStage: "generating",
      });
      return "succeeded";
    } catch (error) {
      if (error instanceof DeletionLifecycleFenceActiveError) {
        const refreshed = await repository.get(current.id);
        if (
          refreshed &&
          refreshed.queueJobId === current.queueJobId &&
          refreshed.leaseToken === leaseToken &&
          !terminalStages.has(refreshed.stage)
        ) {
          current = refreshed;
        }
        const canceled = await serialize(() =>
          repository.cancelExecution({
            ...fence(current, now()),
            reason: "RESEARCH_TASK_DELETION_FENCE_ACTIVE",
          }),
        );
        if (canceled) {
          current = canceled;
          recordDurableTaskOperationalMetric(metrics, {
            lifecycle: "terminal",
            outcome: "canceled",
            taskKind: "research",
          });
        }
        return "acknowledgedStale";
      }
      onError?.({ error, researchTaskJob: current });
      // The processor may have durably advanced checkpoints before throwing. Refresh the fence
      // instead of attempting terminal/retry mutation with the claim-time rowVersion.
      const refreshed = await repository.get(current.id);
      if (
        refreshed &&
        refreshed.queueJobId === current.queueJobId &&
        refreshed.leaseToken === leaseToken &&
        !terminalStages.has(refreshed.stage)
      ) {
        current = refreshed;
      }
      if (isPermissionSnapshotInvalid(error) || error instanceof CapabilityPublicationFencedError) {
        const authorizationError =
          error instanceof CapabilityPublicationFencedError
            ? "RESEARCH_TASK_CAPABILITY_REVOKED"
            : "RESEARCH_TASK_PERMISSION_SNAPSHOT_INVALID";
        const failed = await serialize(() =>
          repository.failExecution({
            ...fence(current, now()),
            error: authorizationError,
          }),
        );
        if (failed) {
          recordDurableTaskOperationalMetric(metrics, {
            lifecycle: "terminal",
            outcome: "failed",
            taskKind: "research",
          });
          await publishProgress(failed, "research_task.failed", {
            error: authorizationError,
          });
          return "failed";
        }
        return "deferred";
      }
      if (error instanceof ResearchTaskRuntimeSnapshotInvalidError) {
        const failed = await serialize(() =>
          repository.failExecution({
            ...fence(current, now()),
            error: RESEARCH_TASK_RUNTIME_SNAPSHOT_INVALID,
          }),
        );
        if (failed) {
          recordDurableTaskOperationalMetric(metrics, {
            lifecycle: "terminal",
            outcome: "failed",
            taskKind: "research",
          });
          await publishProgress(failed, "research_task.failed", {
            error: RESEARCH_TASK_RUNTIME_SNAPSHOT_INVALID,
          });
          return "failed";
        }
        return "deferred";
      }

      if (current.executionAttempts >= current.maxExecutionAttempts) {
        const failed = await serialize(() =>
          repository.failExecution({
            ...fence(current, now()),
            error: "RESEARCH_TASK_EXECUTION_ATTEMPTS_EXHAUSTED",
          }),
        );
        if (failed) {
          recordDurableTaskOperationalMetric(metrics, {
            lifecycle: "terminal",
            outcome: "failed",
            taskKind: "research",
          });
          await publishProgress(failed, "research_task.failed", {
            error: "RESEARCH_TASK_EXECUTION_ATTEMPTS_EXHAUSTED",
          });
          return "failed";
        }
      } else {
        const retryAt =
          now() + retryDelay(current.executionAttempts, retryDelayMs, maxRetryDelayMs);
        const released = await serialize(() =>
          repository.releaseExecutionForRetry({
            ...fence(current, now()),
            error: errorMessage(error),
            retryAt,
          }),
        );
        if (released) {
          current = released;
          recordDurableTaskOperationalMetric(metrics, {
            lifecycle: "retry",
            taskKind: "research",
          });
          return "retryScheduled";
        }
      }
      return "deferred";
    } finally {
      abortController.abort();
      clearInterval(heartbeatTimer);
      await lane;
    }
  };

  const tick = async (): Promise<ResearchTaskRuntimeTickResult> => {
    if (activeTick) {
      return activeTick;
    }
    activeTick = (async () => {
      const claimedJobs = await repository.claimExecutions({
        leaseExpiresAt: now() + leaseMs,
        limit: maxBatchSize,
        now: now(),
        workerId,
      });
      const counts: Record<ResearchTaskRuntimeOutcome, number> = {
        acknowledgedStale: 0,
        acknowledgedTerminal: 0,
        deferred: 0,
        failed: 0,
        rejected: 0,
        retryScheduled: 0,
        succeeded: 0,
      };
      const outcomes = await Promise.all(claimedJobs.map(processClaimedJob));
      for (const outcome of outcomes) {
        counts[outcome] += 1;
      }
      return { ...counts, leased: claimedJobs.length };
    })().finally(() => {
      activeTick = undefined;
    });
    return activeTick;
  };

  return {
    start() {
      if (timer) {
        return;
      }
      void tick().catch((error) => onError?.({ error }));
      timer = setInterval(() => {
        void tick().catch((error) => onError?.({ error }));
      }, intervalMs);
      timer.unref?.();
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
    },
    tick,
  };
}

async function runResearchTask({
  access,
  allowLegacyProfileFallback,
  authorizationContext: initialAuthorizationContext,
  abortSignal,
  capabilityGrants,
  current: initial,
  deletionFence,
  deletionToken,
  generator,
  manifests,
  now,
  partials,
  projectionSnapshotResolver,
  publishProgress,
  repository,
  serialize,
}: {
  readonly access: Pick<KnowledgeSpaceAccessService, "revalidatePermissionSnapshot">;
  readonly allowLegacyProfileFallback: boolean;
  readonly authorizationContext: ResearchTaskExecutionAuthorization;
  readonly abortSignal: AbortSignal;
  readonly capabilityGrants?:
    | Pick<CapabilityGrantProvenanceRepository, "assertPublicationAllowed" | "get">
    | undefined;
  readonly current: ResearchTaskJob;
  readonly deletionFence?: DeletionLifecycleFenceGuard | undefined;
  readonly deletionToken?: DeletionLifecycleFenceToken | undefined;
  readonly generator: QueryGenerator;
  readonly manifests: KnowledgeSpaceManifestRepository;
  readonly now: () => number;
  readonly partials: ResearchTaskPartialResultRepository;
  readonly projectionSnapshotResolver?: PublishedProjectionReadSnapshotResolver | undefined;
  readonly publishProgress: (
    job: ResearchTaskJob,
    type: ResearchTaskProgressEventType,
    payload?: Record<string, unknown>,
  ) => Promise<void>;
  readonly repository: ResearchTaskDurableRepository;
  readonly serialize: <T>(operation: () => Promise<T>) => Promise<T>;
}): Promise<ResearchTaskJob> {
  let current = initial;
  let authorizationContext = initialAuthorizationContext;
  const assertWritable = async (): Promise<void> => {
    if (deletionToken) {
      await deletionFence?.assertDeletionFenceUnchanged(deletionToken);
    }
  };
  const revalidate = async () => {
    if (abortSignal.aborted) {
      throw abortSignal.reason ?? new Error("Research task execution lease was lost");
    }
    authorizationContext = await resolveResearchTaskAuthorization(
      access,
      capabilityGrants,
      current,
    );
  };
  const advance = async (nextStage: ResearchTaskJobStage) => {
    const previousStage = current.stage;
    await assertWritable();
    const updated = await serialize(() =>
      repository.advanceExecution({ ...fence(current, now()), nextStage }),
    );
    if (!updated) {
      throw new Error("Research task stage transition lost its lease fence");
    }
    current = updated;
    await assertWritable();
    await publishProgress(updated, "research_task.stage_changed", { previousStage });
  };

  await revalidate();
  if (current.stage === "queued") {
    await advance("planning");
  }

  const frozenRuntime = researchTaskRuntimeSnapshotFromMetadata(current.metadata);
  if (
    frozenRuntime &&
    (frozenRuntime.projectionSnapshot.knowledgeSpaceId !== current.knowledgeSpaceId ||
      frozenRuntime.projectionSnapshot.tenantId !== current.tenantId)
  ) {
    throw new ResearchTaskRuntimeSnapshotInvalidError(
      "Research task runtime snapshot scope mismatch",
    );
  }
  if (!frozenRuntime && !allowLegacyProfileFallback) {
    throw new ResearchTaskRuntimeSnapshotInvalidError(
      "Research task requires a frozen published runtime snapshot",
    );
  }
  const manifest = frozenRuntime
    ? undefined
    : await manifests.get({
        knowledgeSpaceId: current.knowledgeSpaceId,
        tenantId: current.tenantId,
      });
  const retrievalProfile = frozenRuntime?.retrievalProfile ?? manifest?.retrievalProfile;
  assertDurableRetrievalModeDecision(current, frozenRuntime);
  const requestedMode = current.mode ?? retrievalProfile?.defaultMode ?? "research";
  const plan = modePlanner.plan({
    mode: requestedMode,
    query: current.query,
    topK: current.topK ?? retrievalProfile?.topK ?? 10,
  });
  const mode = plan.resolvedMode;
  const profileError = retrievalProfile
    ? validateKnowledgeSpaceRetrievalProfileForMode(retrievalProfile, mode)
    : undefined;
  if (profileError) {
    throw new Error(`${profileError.code}: ${profileError.message}`);
  }
  await revalidate();
  if (current.stage === "planning") {
    await advance("retrieving");
  }

  const projectionSnapshot =
    frozenRuntime?.projectionSnapshot ??
    (projectionSnapshotResolver
      ? await projectionSnapshotResolver.resolve({
          knowledgeSpaceId: current.knowledgeSpaceId,
          resolvedMode: mode,
          tenantId: current.tenantId,
        })
      : undefined);

  let evidenceBundle: EvidenceBundle | undefined;
  const iterator = generator
    .stream({
      ...(frozenRuntime?.embeddingProfile
        ? { embeddingProfile: frozenRuntime.embeddingProfile }
        : {}),
      knowledgeSpaceId: current.knowledgeSpaceId,
      mode,
      permissionScope: [...authorizationContext.permissionScopes],
      ...(projectionSnapshot ? { projectionSnapshot } : {}),
      query: current.query,
      requestedMode: durableRequestedMode(current, mode),
      ...(retrievalProfile ? { retrievalProfile } : {}),
      subject: {
        // Authentication scopes are intentionally absent. Candidate filtering uses only the
        // server-issued, revalidated permission snapshot above.
        scopes: [],
        subjectId: authorizationContext.subjectId,
        tenantId: current.tenantId,
      },
      topK: plan.topK,
      traceId: current.id,
    })
    [Symbol.asyncIterator]();

  while (true) {
    await revalidate();
    await assertWritable();
    const result = await iterator.next();
    if (result.done) {
      break;
    }
    const event = result.value;
    evidenceBundle = evidenceBundleFromEvent(event) ?? evidenceBundle;
    if (
      event.type === "trace-step" &&
      event.step.name === "query.retrieve" &&
      current.stage === "retrieving"
    ) {
      await advance("analyzing");
    }
    if (
      event.type === "trace-step" &&
      event.step.name === "query.answer" &&
      current.stage === "analyzing"
    ) {
      await advance("generating");
    }
  }

  if (current.stage === "retrieving") {
    await advance("analyzing");
  }
  if (current.stage === "analyzing") {
    await advance("generating");
  }
  await revalidate();
  if (evidenceBundle) {
    await assertWritable();
    await partials.append({
      evidenceBundle,
      idempotencyKey: `research-task:${current.id}:final-evidence`,
      knowledgeSpaceId: current.knowledgeSpaceId,
      researchTaskJobId: current.id,
      tenantId: current.tenantId,
    });
  }
  return current;
}

function durableRequestedMode(
  job: Pick<ResearchTaskJob, "metadata">,
  resolvedMode: "deep" | "fast" | "research",
): "auto" | "deep" | "fast" | "research" {
  const decision = job.metadata[AUTO_RETRIEVAL_MODE_DECISION_METADATA_KEY];
  return isPlainObject(decision) && decision.requestedMode === "auto" ? "auto" : resolvedMode;
}

function assertDurableRetrievalModeDecision(
  job: Pick<ResearchTaskJob, "metadata" | "mode">,
  frozenRuntime: FrozenResearchTaskRuntimeSnapshot | undefined,
): void {
  if (job.mode === "auto") {
    throw new ResearchTaskRuntimeSnapshotInvalidError(
      "Research task contains an unresolved legacy auto mode",
    );
  }
  const value = job.metadata[AUTO_RETRIEVAL_MODE_DECISION_METADATA_KEY];
  if (value === undefined) return;
  const profile = frozenRuntime?.retrievalProfile;
  if (
    !isPlainObject(value) ||
    (job.mode !== "deep" && job.mode !== "fast" && job.mode !== "research") ||
    value.requestedMode !== "auto" ||
    value.resolvedMode !== job.mode ||
    (value.resolver !== "llm" && value.resolver !== "fallback") ||
    typeof value.degraded !== "boolean" ||
    typeof value.durationMs !== "number" ||
    !Number.isFinite(value.durationMs) ||
    value.durationMs < 0
  ) {
    throw new ResearchTaskRuntimeSnapshotInvalidError(
      "Research task auto routing decision does not match its durable mode",
    );
  }
  if (!frozenRuntime || !profile) {
    throw new ResearchTaskRuntimeSnapshotInvalidError(
      "Research task auto routing decision requires a frozen runtime snapshot",
    );
  }
  if (value.retrievalProfileRevision !== profile.revision) {
    throw new ResearchTaskRuntimeSnapshotInvalidError(
      "Research task auto routing decision profile revision mismatch",
    );
  }
  const selection = value.reasoningModel;
  if (
    !isPlainObject(selection) ||
    selection.model !== profile.reasoningModel.model ||
    selection.pluginId !== profile.reasoningModel.pluginId ||
    selection.provider !== profile.reasoningModel.provider
  ) {
    throw new ResearchTaskRuntimeSnapshotInvalidError(
      "Research task auto routing decision reasoning model mismatch",
    );
  }
  if (
    value.publicationId !== frozenRuntime.projectionSnapshot.publicationId ||
    value.publicationFingerprint !== frozenRuntime.projectionSnapshot.fingerprint
  ) {
    throw new ResearchTaskRuntimeSnapshotInvalidError(
      "Research task auto routing decision publication mismatch",
    );
  }

  const expectedReasonCode =
    job.mode === "fast"
      ? "direct_lookup"
      : job.mode === "deep"
        ? "relationship_exploration"
        : "structured_research";
  const validLlmDecision =
    value.resolver === "llm" &&
    value.degraded === false &&
    value.promptVersion === AUTO_RETRIEVAL_MODE_PROMPT_VERSION &&
    value.reasonCode === expectedReasonCode &&
    value.generationModel === profile.reasoningModel.model &&
    value.errorClass === undefined;
  const validFallbackDecision =
    value.resolver === "fallback" &&
    value.degraded === true &&
    job.mode === profile.defaultMode &&
    typeof value.errorClass === "string" &&
    value.errorClass.trim().length > 0 &&
    value.generationModel === undefined &&
    value.promptVersion === undefined &&
    value.reasonCode === undefined;
  if (!validLlmDecision && !validFallbackDecision) {
    throw new ResearchTaskRuntimeSnapshotInvalidError(
      "Research task auto routing decision provenance is inconsistent",
    );
  }
}

async function revalidateResearchTaskPermission(
  access: Pick<KnowledgeSpaceAccessService, "revalidatePermissionSnapshot">,
  job: ResearchTaskJob,
): Promise<KnowledgeSpacePermissionSnapshot> {
  if (!job.permissionSnapshot || !job.subjectId) {
    throw new KnowledgeSpaceAccessError(
      "space_access_permission_snapshot_invalid",
      "Knowledge-space permission snapshot is invalid",
    );
  }
  const snapshot = await access.revalidatePermissionSnapshot({
    expectedAccessChannel: job.permissionSnapshot.accessChannel,
    id: job.permissionSnapshot.id,
    knowledgeSpaceId: job.knowledgeSpaceId,
    subjectId: job.subjectId,
    tenantId: job.tenantId,
  });
  if (snapshot.revision !== job.permissionSnapshot.revision) {
    throw new KnowledgeSpaceAccessError(
      "space_access_permission_snapshot_invalid",
      "Knowledge-space permission snapshot is invalid",
    );
  }
  return snapshot;
}

interface ResearchTaskExecutionAuthorization {
  readonly permissionScopes: readonly string[];
  readonly subjectId: string;
}

async function resolveResearchTaskAuthorization(
  access: Pick<KnowledgeSpaceAccessService, "revalidatePermissionSnapshot">,
  capabilityGrants:
    | Pick<CapabilityGrantProvenanceRepository, "assertPublicationAllowed" | "get">
    | undefined,
  job: ResearchTaskJob,
): Promise<ResearchTaskExecutionAuthorization> {
  if (job.capabilityGrantId) {
    if (!capabilityGrants) throw new CapabilityPublicationFencedError();
    const scope = {
      grantId: job.capabilityGrantId,
      knowledgeSpaceId: job.knowledgeSpaceId,
      tenantId: job.tenantId,
    };
    await capabilityGrants.assertPublicationAllowed(scope);
    const grant = await capabilityGrants.get(scope);
    if (!grant || grant.state !== "active") throw new CapabilityPublicationFencedError();
    return {
      permissionScopes: [...grant.contentScopeIds],
      subjectId: grant.subjectId,
    };
  }
  const snapshot = await revalidateResearchTaskPermission(access, job);
  if (!job.subjectId) {
    throw new KnowledgeSpaceAccessError(
      "space_access_permission_snapshot_invalid",
      "Knowledge-space permission snapshot is invalid",
    );
  }
  return {
    permissionScopes: [...snapshot.permissionScopes],
    subjectId: job.subjectId,
  };
}

function evidenceBundleFromEvent(event: QueryGenerationEvent): EvidenceBundle | undefined {
  if (event.type !== "done" || !event.metadata) {
    return undefined;
  }
  const parsed = EvidenceBundleSchema.safeParse(event.metadata.evidenceBundle);
  return parsed.success ? parsed.data : undefined;
}

function fence(job: ResearchTaskJob, timestamp: number): ResearchTaskExecutionFence {
  if (!job.leaseToken) {
    throw new Error("Research task execution has no lease token");
  }
  return {
    expectedRowVersion: job.rowVersion,
    leaseToken: job.leaseToken,
    now: timestamp,
    researchTaskJobId: job.id,
  };
}

function isPermissionSnapshotInvalid(error: unknown): boolean {
  return (
    error instanceof KnowledgeSpaceAccessError &&
    error.code === "space_access_permission_snapshot_invalid"
  );
}

function retryDelay(attempt: number, initial: number, maximum: number): number {
  return Math.min(maximum, initial * 2 ** Math.max(0, attempt - 1));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Research task execution failed";
}

function positiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Research task ${field} must be a positive integer`);
  }
}
