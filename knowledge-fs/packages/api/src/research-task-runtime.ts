import {
  type EvidenceBundle,
  EvidenceBundleSchema,
  type JobPayload,
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
  QueryGenerationInput,
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
import { ModelCapabilitySnapshotSchema } from "./model-capability-preflight";
import type { ModelInputModalityResolver } from "./model-input-modality-resolver";
import {
  type DurableTaskOperationalMetrics,
  recordDurableTaskOperationalMetric,
} from "./operational-metrics";
import type {
  PublishedProjectionReadSnapshot,
  PublishedProjectionReadSnapshotResolver,
} from "./published-projection-read-snapshot";
import {
  QUERY_IMAGE_EXPANSION_METADATA_KEY,
  type QueryImageResolver,
  queryImageExpansionFromMetadata,
  queryImageMetadata,
  queryImageReferencesFromMetadata,
} from "./query-images";
import {
  type ResearchModelCallObserver,
  ResearchModelCallObserverError,
  type ResearchModelPricing,
  calculateResearchModelCallCost,
} from "./research-model-usage";
import {
  RESEARCH_RETRIEVAL_DURABLE_CHECKPOINT_METADATA_KEY,
  type ResearchRetrievalDurableCheckpoint,
  researchRetrievalDurableCheckpointFromMetadata,
  toResearchRetrievalDurableCheckpointPayload,
  validateAnyResearchRetrievalSearchCheckpointScope,
  validateResearchRetrievalDurableCheckpoint,
} from "./research-retrieval-checkpoint";
import type {
  ResearchTaskDurableRepository,
  ResearchTaskExecutionFence,
} from "./research-task-durable-repository";
import {
  RESEARCH_TASK_PARTIAL_ANSWER_MAX_CHARS,
  type ResearchTaskJob,
  type ResearchTaskJobStage,
  type ResearchTaskPartialResultRepository,
} from "./research-task-job";
import { DefaultResearchTaskLlmPricing } from "./research-task-planning";
import type {
  ResearchTaskProgressEventType,
  ResearchTaskProgressPublishOptions,
  ResearchTaskProgressPublisher,
} from "./research-task-progress";
import {
  type FrozenResearchTaskRuntimeSnapshot,
  RESEARCH_TASK_RUNTIME_SNAPSHOT_INVALID,
  ResearchTaskRuntimeSnapshotInvalidError,
  researchTaskRuntimeSnapshotFromMetadata,
} from "./research-task-runtime-snapshot";
import { RETRIEVAL_MAX_TOP_K, createRetrievalPlanner } from "./retrieval-planner";

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
  readonly llmPricing?: ResearchModelPricing | undefined;
  readonly maxBatchSize: number;
  readonly maxRetryDelayMs?: number | undefined;
  readonly metrics?: DurableTaskOperationalMetrics | undefined;
  readonly modelInputModalityResolver?: ModelInputModalityResolver | undefined;
  readonly now?: (() => number) | undefined;
  readonly onError?:
    | ((input: {
        readonly error: unknown;
        readonly researchTaskJob?: ResearchTaskJob;
      }) => void)
    | undefined;
  readonly partials: ResearchTaskPartialResultRepository;
  readonly projectionSnapshotResolver?: PublishedProjectionReadSnapshotResolver | undefined;
  readonly progress?: ResearchTaskProgressPublisher | undefined;
  readonly queryImageResolver?: QueryImageResolver | undefined;
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
const modePlanner = createRetrievalPlanner({ maxTopK: RETRIEVAL_MAX_TOP_K });
const RESEARCH_TASK_ANSWER_DELTA_BATCH_CHARS = 128;
const RESEARCH_TASK_MAX_COST_ENTRIES = 1_000;

export class ResearchTaskBudgetExceededError extends Error {
  readonly code = "RESEARCH_TASK_BUDGET_EXHAUSTED";

  constructor(message = "Research task budget exhausted") {
    super(message);
    this.name = "ResearchTaskBudgetExceededError";
  }
}

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
  llmPricing = DefaultResearchTaskLlmPricing,
  maxBatchSize,
  maxRetryDelayMs = 5 * 60_000,
  metrics,
  modelInputModalityResolver,
  now = Date.now,
  onError,
  partials,
  projectionSnapshotResolver,
  progress,
  queryImageResolver,
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
    options?: ResearchTaskProgressPublishOptions,
  ): Promise<void> => {
    try {
      await progress?.publish(job, type, payload, options);
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

    const serializeExecutionMutation = async (
      operation: (job: ResearchTaskJob) => Promise<ResearchTaskJob | null>,
    ): Promise<ResearchTaskJob | null> =>
      serialize(async () => {
        const updated = await operation(current);
        if (updated) {
          // Commit the durable row and the in-memory fence in the same serialized callback.
          // A promise chained on `lane` may start before the caller continuation runs, so updating
          // `current` after `await serialize(...)` lets a queued heartbeat/model observer reuse the
          // previous rowVersion.
          current = updated;
        }
        return updated;
      });

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
      const result = await runResearchTask({
        access,
        allowLegacyProfileFallback,
        authorizationContext,
        abortSignal: abortController.signal,
        capabilityGrants,
        deletionFence,
        deletionToken,
        generator,
        getCurrent: () => current,
        manifests,
        llmPricing,
        modelInputModalityResolver,
        now,
        partials,
        projectionSnapshotResolver,
        publishProgress,
        queryImageResolver,
        repository,
        serialize,
        updateCurrent: (updated) => {
          current = updated;
        },
      });
      current = result.job;
      await assertWritable();
      const completed = await serializeExecutionMutation((job) =>
        repository.completeExecution({
          ...fence(job, now()),
          progressDetails: result.generationDetails,
        }),
      );
      if (!completed) {
        throw new Error("Research task completion lost its lease fence");
      }
      recordDurableTaskOperationalMetric(metrics, {
        lifecycle: "terminal",
        outcome: "completed",
        taskKind: "research",
      });
      await assertWritable();
      await publishProgress(completed, "research_task.stage_changed", {
        details: result.generationDetails,
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
        const canceled = await serializeExecutionMutation((job) =>
          repository.cancelExecution({
            ...fence(job, now()),
            reason: "RESEARCH_TASK_DELETION_FENCE_ACTIVE",
          }),
        );
        if (canceled) {
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
        const failed = await serializeExecutionMutation((job) =>
          repository.failExecution({
            ...fence(job, now()),
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
        const failed = await serializeExecutionMutation((job) =>
          repository.failExecution({
            ...fence(job, now()),
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
      if (researchTaskBudgetExceededError(error)) {
        const canceled = await serializeExecutionMutation((job) =>
          repository.cancelExecution({
            ...fence(job, now()),
            reason: "RESEARCH_TASK_BUDGET_EXHAUSTED",
          }),
        );
        if (canceled) {
          recordDurableTaskOperationalMetric(metrics, {
            lifecycle: "terminal",
            outcome: "canceled",
            taskKind: "research",
          });
          await publishProgress(canceled, "research_task.canceled", {
            reason: "RESEARCH_TASK_BUDGET_EXHAUSTED",
          });
          return "acknowledgedTerminal";
        }
        return "deferred";
      }

      const terminalErrorCode = explicitlyNonRetryableErrorCode(error);
      if (terminalErrorCode) {
        const failed = await serializeExecutionMutation((job) =>
          repository.failExecution({
            ...fence(job, now()),
            error: terminalErrorCode,
          }),
        );
        if (failed) {
          recordDurableTaskOperationalMetric(metrics, {
            lifecycle: "terminal",
            outcome: "failed",
            taskKind: "research",
          });
          await publishProgress(failed, "research_task.failed", {
            error: terminalErrorCode,
          });
          return "failed";
        }
        return "deferred";
      }

      if (current.executionAttempts >= current.maxExecutionAttempts) {
        const failed = await serializeExecutionMutation((job) =>
          repository.failExecution({
            ...fence(job, now()),
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
        let released = await serializeExecutionMutation((job) =>
          repository.releaseExecutionForRetry({
            ...fence(job, now()),
            error: errorMessage(error),
            retryAt,
          }),
        );
        if (!released) {
          // A checkpoint/heartbeat may have committed after the failing operation observed its
          // fence. Reconcile once and retry only while this exact queue execution still owns the
          // lease; a replacement worker must never be mutated by the stale execution.
          const stillOwned = await serialize(async () => {
            const refreshed = await repository.get(current.id);
            if (
              !refreshed ||
              refreshed.queueJobId !== current.queueJobId ||
              refreshed.leaseToken !== leaseToken ||
              terminalStages.has(refreshed.stage)
            ) {
              return false;
            }
            current = refreshed;
            return true;
          });
          if (stillOwned) {
            released = await serializeExecutionMutation((job) =>
              repository.releaseExecutionForRetry({
                ...fence(job, now()),
                error: errorMessage(error),
                retryAt,
              }),
            );
          }
        }
        if (released) {
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
  deletionFence,
  deletionToken,
  generator,
  getCurrent,
  manifests,
  llmPricing,
  modelInputModalityResolver,
  now,
  partials,
  projectionSnapshotResolver,
  publishProgress,
  queryImageResolver,
  repository,
  serialize,
  updateCurrent,
}: {
  readonly access: Pick<KnowledgeSpaceAccessService, "revalidatePermissionSnapshot">;
  readonly allowLegacyProfileFallback: boolean;
  readonly authorizationContext: ResearchTaskExecutionAuthorization;
  readonly abortSignal: AbortSignal;
  readonly capabilityGrants?:
    | Pick<CapabilityGrantProvenanceRepository, "assertPublicationAllowed" | "get">
    | undefined;
  readonly deletionFence?: DeletionLifecycleFenceGuard | undefined;
  readonly deletionToken?: DeletionLifecycleFenceToken | undefined;
  readonly generator: QueryGenerator;
  readonly getCurrent: () => ResearchTaskJob;
  readonly manifests: KnowledgeSpaceManifestRepository;
  readonly llmPricing: ResearchModelPricing;
  readonly modelInputModalityResolver?: ModelInputModalityResolver | undefined;
  readonly now: () => number;
  readonly partials: ResearchTaskPartialResultRepository;
  readonly projectionSnapshotResolver?: PublishedProjectionReadSnapshotResolver | undefined;
  readonly publishProgress: (
    job: ResearchTaskJob,
    type: ResearchTaskProgressEventType,
    payload?: Record<string, unknown>,
    options?: ResearchTaskProgressPublishOptions,
  ) => Promise<void>;
  readonly queryImageResolver?: QueryImageResolver | undefined;
  readonly repository: ResearchTaskDurableRepository;
  readonly serialize: <T>(operation: () => Promise<T>) => Promise<T>;
  readonly updateCurrent: (current: ResearchTaskJob) => void;
}): Promise<{
  readonly generationDetails: Record<string, unknown>;
  readonly job: ResearchTaskJob;
}> {
  let current = getCurrent();
  let authorizationContext = initialAuthorizationContext;
  const assertWritable = async (): Promise<void> => {
    if (deletionToken) {
      await deletionFence?.assertDeletionFenceUnchanged(deletionToken);
    }
  };
  const revalidate = async () => {
    current = getCurrent();
    if (abortSignal.aborted) {
      throw abortSignal.reason ?? new Error("Research task execution lease was lost");
    }
    authorizationContext = await resolveResearchTaskAuthorization(
      access,
      capabilityGrants,
      current,
    );
  };
  const advance = async (nextStage: ResearchTaskJobStage, details?: Record<string, unknown>) => {
    await assertWritable();
    const transition = await serialize(async () => {
      current = getCurrent();
      const previousStage = current.stage;
      const updated = await repository.advanceExecution({
        ...fence(current, now()),
        nextStage,
        ...(details ? { progressDetails: details } : {}),
      });
      if (updated) {
        current = updated;
        updateCurrent(updated);
      }
      return { previousStage, updated };
    });
    const { previousStage, updated } = transition;
    if (!updated) {
      throw new Error("Research task stage transition lost its lease fence");
    }
    await assertWritable();
    await publishProgress(updated, "research_task.stage_changed", {
      ...(details ? { details } : {}),
      previousStage,
    });
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
  let embeddingInputModalities: readonly ("text" | "image")[] | undefined;
  let reasoningInputModalities: readonly ("text" | "image")[] | undefined;
  if (frozenRuntime) {
    if (modelInputModalityResolver) {
      [embeddingInputModalities, reasoningInputModalities] = await Promise.all([
        modelInputModalityResolver.resolve({
          signal: abortSignal,
          snapshot: frozenRuntime.embeddingCapabilitySnapshot,
          tenantId: current.tenantId,
        }),
        modelInputModalityResolver.resolve({
          signal: abortSignal,
          snapshot: frozenRuntime.retrievalCapabilitySnapshot.reasoning,
          tenantId: current.tenantId,
        }),
      ]);
    } else {
      const embeddingCapability = ModelCapabilitySnapshotSchema.safeParse(
        frozenRuntime.embeddingCapabilitySnapshot,
      );
      const reasoningCapability = ModelCapabilitySnapshotSchema.safeParse(
        frozenRuntime.retrievalCapabilitySnapshot.reasoning,
      );
      embeddingInputModalities = embeddingCapability.success
        ? (embeddingCapability.data.inputModalities ?? ["text"])
        : undefined;
      reasoningInputModalities = reasoningCapability.success
        ? (reasoningCapability.data.inputModalities ?? ["text"])
        : undefined;
    }
  }
  const queryImageReferences = queryImageReferencesFromMetadata(current.metadata);
  if (queryImageReferences.length > 0 && !queryImageResolver) {
    throw new Error("Research query images require a configured Dify UploadFile resolver");
  }
  const resolvedQueryImages = queryImageResolver
    ? await queryImageResolver.resolve({
        references: queryImageReferences,
        signal: abortSignal,
        subjectId: authorizationContext.subjectId,
        tenantId: current.tenantId,
      })
    : [];
  assertDurableRetrievalModeDecision(current, frozenRuntime);
  const requestedMode = current.mode ?? retrievalProfile?.defaultMode ?? "research";
  const plan = modePlanner.plan({
    mode: requestedMode,
    hasQueryImages: queryImageReferences.length > 0,
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
  if (current.stage === "planning" && mode !== "research") {
    await advance("retrieving", {
      questions: [researchTaskDisplayQuery(current)],
      topK: plan.topK,
    });
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

  const researchDurableCheckpoint =
    mode === "research"
      ? loadResearchDurableCheckpoint({ job: current, projectionSnapshot })
      : undefined;
  const persistResearchDurableCheckpoint = async (
    checkpoint: Parameters<NonNullable<QueryGenerationInput["onResearchDurableCheckpoint"]>>[0],
  ): Promise<void> => {
    await revalidate();
    await assertWritable();
    if (!projectionSnapshot) {
      throw new Error("Research retrieval durable checkpoint requires a projection snapshot");
    }
    const durable = validateResearchRetrievalDurableCheckpoint(checkpoint);
    const searchState = validateAnyResearchRetrievalSearchCheckpointScope({
      checkpoint: durable.searchState,
      fingerprint: projectionSnapshot.fingerprint,
      knowledgeSpaceId: current.knowledgeSpaceId,
      publicationId: projectionSnapshot.publicationId,
      query: researchTaskRetrievalQuery(current),
      tenantId: current.tenantId,
      traceId: current.id,
    });
    const payload = toResearchRetrievalDurableCheckpointPayload({
      evidenceBundle: durable.evidenceBundle,
      searchState,
    });
    await serialize(async () => {
      current = getCurrent();
      const persisted = await repository.update({
        ...current,
        metadata: {
          ...current.metadata,
          [RESEARCH_RETRIEVAL_DURABLE_CHECKPOINT_METADATA_KEY]: payload,
        },
        updatedAt: now(),
      });
      current = persisted;
      updateCurrent(persisted);
      return persisted;
    });
    if (searchState.phase === "complete" && durable.evidenceBundle.state !== "partial") {
      await revalidate();
      await assertWritable();
      current = getCurrent();
      await partials.append({
        evidenceBundle: { ...durable.evidenceBundle, state: "partial" },
        idempotencyKey: `research-task:${current.id}:retrieval-evidence`,
        knowledgeSpaceId: current.knowledgeSpaceId,
        researchTaskJobId: current.id,
        tenantId: current.tenantId,
      });
    }
  };
  const persistQueryImageExpansion = async (expansion: string): Promise<void> => {
    const normalized = expansion.trim();
    if (!normalized) return;
    await revalidate();
    await assertWritable();
    if (queryImageExpansionFromMetadata(current.metadata) === normalized) return;
    await serialize(async () => {
      current = getCurrent();
      const persisted = await repository.update({
        ...current,
        metadata: {
          ...current.metadata,
          [QUERY_IMAGE_EXPANSION_METADATA_KEY]: normalized,
        },
        updatedAt: now(),
      });
      current = persisted;
      updateCurrent(persisted);
      return persisted;
    });
  };
  const researchModelCallObserver = createResearchTaskModelCallObserver({
    assertWritable,
    executionAttempt: current.executionAttempts,
    getCurrent,
    now,
    pricing: llmPricing,
    repository,
    revalidate,
    serialize,
    updateCurrent,
  });

  let answer = "";
  let pendingAnswerDelta = "";
  let pendingAnswerOffset = 0;
  let publishedAnswerDelta = false;
  let evidenceBundle: EvidenceBundle | undefined;
  let retrievalCandidateCount: number | undefined;
  let retrievedChunkCount: number | undefined;
  const planStageDetails = () => ({
    questions: [researchTaskDisplayQuery(current)],
    topK: plan.topK,
  });
  const retrievalStageDetails = (): Record<string, unknown> | undefined =>
    retrievedChunkCount === undefined
      ? undefined
      : {
          results: [
            { chunkCount: retrievedChunkCount, question: researchTaskDisplayQuery(current) },
          ],
          ...(retrievalCandidateCount === undefined
            ? {}
            : { retrievalCount: retrievalCandidateCount }),
        };
  const analysisStageDetails = (): Record<string, unknown> | undefined =>
    retrievedChunkCount === undefined
      ? undefined
      : {
          chunks: retrievedChunkCount,
          ...(retrievalCandidateCount === undefined
            ? {}
            : { retrievalCount: retrievalCandidateCount }),
        };
  const ensureResearchStage = async (
    target: "retrieving" | "analyzing" | "generating",
    details?: Record<string, unknown>,
  ): Promise<void> => {
    await revalidate();
    if (current.stage === "planning") {
      await advance("retrieving", target === "retrieving" ? details : planStageDetails());
    }
    if ((target === "analyzing" || target === "generating") && current.stage === "retrieving") {
      await advance("analyzing", target === "analyzing" ? details : retrievalStageDetails());
    }
    if (target === "generating" && current.stage === "analyzing") {
      await advance("generating", details ?? analysisStageDetails());
    }
  };
  const flushAnswerDelta = async (): Promise<void> => {
    if (!pendingAnswerDelta) return;
    current = getCurrent();
    const delta = pendingAnswerDelta;
    const offset = pendingAnswerOffset;
    pendingAnswerDelta = "";
    pendingAnswerOffset = answer.length;
    await publishProgress(
      current,
      "research_task.answer_delta",
      {
        delta,
        executionAttempt: current.executionAttempts,
        offset,
      },
      {
        idempotencyKey: `research-task-progress:${current.id}:attempt:${current.executionAttempts}:answer:${offset}`,
      },
    );
    publishedAnswerDelta = true;
  };
  const iterator = generator
    .stream({
      ...(frozenRuntime?.embeddingProfile
        ? { embeddingProfile: frozenRuntime.embeddingProfile }
        : {}),
      ...(embeddingInputModalities ? { embeddingInputModalities } : {}),
      knowledgeSpaceId: current.knowledgeSpaceId,
      mode,
      permissionScope: [...authorizationContext.permissionScopes],
      ...(projectionSnapshot ? { projectionSnapshot } : {}),
      query: current.query,
      ...(queryImageReferences.length > 0 ? { queryImages: queryImageReferences } : {}),
      ...(resolvedQueryImages.length > 0
        ? {
            queryImageMetadata: resolvedQueryImages.map(queryImageMetadata),
            resolvedQueryImages,
          }
        : {}),
      ...(queryImageExpansionFromMetadata(current.metadata)
        ? { queryImageExpansion: queryImageExpansionFromMetadata(current.metadata) }
        : {}),
      ...(queryImageReferences.length > 0
        ? { onQueryImageExpansion: persistQueryImageExpansion }
        : {}),
      researchExecutionKind: "durable",
      researchExecutionAttempt: current.executionAttempts,
      researchModelCallObserver,
      onResearchStageChange: ensureResearchStage,
      ...(mode === "research"
        ? { onResearchDurableCheckpoint: persistResearchDurableCheckpoint }
        : {}),
      ...(researchDurableCheckpoint ? { researchDurableCheckpoint } : {}),
      requestedMode: durableRequestedMode(current, mode),
      ...(reasoningInputModalities ? { reasoningInputModalities } : {}),
      ...(retrievalProfile ? { retrievalProfile } : {}),
      signal: abortSignal,
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
    if (event.type === "delta") {
      if (answer.length + event.delta.length > RESEARCH_TASK_PARTIAL_ANSWER_MAX_CHARS) {
        throw new Error(
          `Research task partial result answer exceeds maxChars=${RESEARCH_TASK_PARTIAL_ANSWER_MAX_CHARS}`,
        );
      }
      if (!pendingAnswerDelta) {
        pendingAnswerOffset = answer.length;
      }
      answer += event.delta;
      pendingAnswerDelta += event.delta;
      if (
        pendingAnswerDelta &&
        (!publishedAnswerDelta ||
          pendingAnswerDelta.length >= RESEARCH_TASK_ANSWER_DELTA_BATCH_CHARS)
      ) {
        await flushAnswerDelta();
      }
    }
    evidenceBundle = evidenceBundleFromEvent(event) ?? evidenceBundle;
    if (event.type === "trace-step" && event.step.name === "query.retrieve") {
      retrievedChunkCount = nonNegativeInteger(event.step.metadata.itemCount);
      retrievalCandidateCount = retrievalCandidateCountFromMetadata(event.step.metadata);
      await ensureResearchStage("analyzing", retrievalStageDetails());
    }
    if (event.type === "trace-step" && event.step.name === "query.answer") {
      await ensureResearchStage("generating", analysisStageDetails());
    }
  }

  await flushAnswerDelta();

  retrievedChunkCount ??= evidenceBundle?.items.length;
  await ensureResearchStage("generating", analysisStageDetails());
  await revalidate();
  const normalizedAnswer = answer.trim();
  if (normalizedAnswer && !evidenceBundle) {
    throw new Error("Research task generated an answer without an evidence bundle");
  }
  if (evidenceBundle) {
    await assertWritable();
    await partials.append({
      ...(normalizedAnswer ? { answer: normalizedAnswer } : {}),
      evidenceBundle,
      idempotencyKey: `research-task:${current.id}:final-evidence`,
      knowledgeSpaceId: current.knowledgeSpaceId,
      researchTaskJobId: current.id,
      tenantId: current.tenantId,
    });
  }
  const evidenceItems = evidenceBundle?.items ?? [];
  const documentIds = new Set(
    evidenceItems.flatMap((item) => item.citations.map((citation) => citation.documentAssetId)),
  );
  return {
    generationDetails: {
      chunks: evidenceItems.length,
      documents: documentIds.size,
      sources: documentIds.size,
    },
    job: getCurrent(),
  };
}

function loadResearchDurableCheckpoint({
  job,
  projectionSnapshot,
}: {
  readonly job: ResearchTaskJob;
  readonly projectionSnapshot: PublishedProjectionReadSnapshot | undefined;
}): ResearchRetrievalDurableCheckpoint | undefined {
  const checkpoint = researchRetrievalDurableCheckpointFromMetadata(job.metadata);
  if (!checkpoint) return undefined;
  if (!projectionSnapshot) {
    throw new Error("Research retrieval durable checkpoint requires a projection snapshot");
  }
  return {
    evidenceBundle: checkpoint.evidenceBundle,
    searchState: validateAnyResearchRetrievalSearchCheckpointScope({
      checkpoint: checkpoint.searchState,
      fingerprint: projectionSnapshot.fingerprint,
      knowledgeSpaceId: job.knowledgeSpaceId,
      publicationId: projectionSnapshot.publicationId,
      query: researchTaskRetrievalQuery(job),
      tenantId: job.tenantId,
      traceId: job.id,
    }),
  };
}

function researchTaskRetrievalQuery(job: ResearchTaskJob): string {
  return [job.query.trim(), queryImageExpansionFromMetadata(job.metadata)]
    .filter(Boolean)
    .join("\n\n");
}

function researchTaskDisplayQuery(job: ResearchTaskJob): string {
  return (
    job.query.trim() || `[${queryImageReferencesFromMetadata(job.metadata).length} query image(s)]`
  );
}

function createResearchTaskModelCallObserver({
  assertWritable,
  executionAttempt,
  getCurrent,
  now,
  pricing,
  repository,
  revalidate,
  serialize,
  updateCurrent,
}: {
  readonly assertWritable: () => Promise<void>;
  readonly executionAttempt: number;
  readonly getCurrent: () => ResearchTaskJob;
  readonly now: () => number;
  readonly pricing: ResearchModelPricing;
  readonly repository: ResearchTaskDurableRepository;
  readonly revalidate: () => Promise<void>;
  readonly serialize: <T>(operation: () => Promise<T>) => Promise<T>;
  readonly updateCurrent: (current: ResearchTaskJob) => void;
}): ResearchModelCallObserver {
  const durableCallId = (callId: string) => `attempt:${executionAttempt}:${callId}`;

  return {
    before: async (input) => {
      await revalidate();
      await assertWritable();
      const reservation = calculateResearchModelCallCost({
        fallback: {
          completionTokens: input.maxOutputTokens,
          promptTokens: input.estimatedPromptTokens,
        },
        metadata: undefined,
        pricing,
      });
      const callId = durableCallId(input.callId);
      await serialize(async () => {
        const job = getCurrent();
        if (findResearchModelCostEntryIndex(job, callId) !== -1) return job;
        if (job.cost.entries.length >= RESEARCH_TASK_MAX_COST_ENTRIES) {
          throw new Error(
            `Research task cost entries exceed maxCostEntries=${RESEARCH_TASK_MAX_COST_ENTRIES}`,
          );
        }
        const projectedTotal = roundCurrency(job.cost.totalUsd + reservation.costUsd);
        if (job.budgetUsd !== undefined && projectedTotal > job.budgetUsd) {
          throw new ResearchTaskBudgetExceededError();
        }
        const persisted = await repository.update({
          ...job,
          cost: {
            ...(job.budgetUsd === undefined ? {} : { budgetUsd: job.budgetUsd }),
            entries: [
              ...job.cost.entries,
              {
                costUsd: reservation.costUsd,
                provider: boundedCostLabel(input.provider, "provider"),
                recordedAt: now(),
                step: boundedCostLabel(input.step, "step"),
                usage: modelCallUsagePayload({
                  callId,
                  estimated: true,
                  reserved: true,
                  status: "reserved",
                  usage: reservation.usage,
                }),
              },
            ],
            totalUsd: projectedTotal,
          },
          updatedAt: now(),
        });
        updateCurrent(persisted);
        return persisted;
      });
    },
    after: async (input) => {
      await revalidate();
      await assertWritable();
      const callId = durableCallId(input.callId);
      const actual = calculateResearchModelCallCost({
        fallback: {
          completionTokens: input.maxOutputTokens,
          promptTokens: input.estimatedPromptTokens,
        },
        metadata: input.metadata,
        pricing,
      });
      const updated = await serialize(async () => {
        const job = getCurrent();
        const index = findResearchModelCostEntryIndex(job, callId);
        if (index === -1) {
          throw new Error(`Research task model call reservation ${callId} was not found`);
        }
        const entries = [...job.cost.entries];
        const reserved = entries[index];
        if (!reserved) {
          throw new Error(`Research task model call reservation ${callId} was not found`);
        }
        entries[index] = {
          costUsd: actual.costUsd,
          provider: boundedCostLabel(input.provider, "provider"),
          recordedAt: reserved.recordedAt,
          step: boundedCostLabel(input.step, "step"),
          usage: modelCallUsagePayload({
            callId,
            estimated: actual.estimated,
            reserved: false,
            status: input.status,
            usage: actual.usage,
          }),
        };
        const totalUsd = roundCurrency(entries.reduce((total, entry) => total + entry.costUsd, 0));
        const budgetExceeded = job.budgetUsd !== undefined && totalUsd > job.budgetUsd;
        const persisted = await repository.update({
          ...job,
          cost: {
            ...(job.budgetUsd === undefined ? {} : { budgetUsd: job.budgetUsd }),
            ...(budgetExceeded ? { budgetExceeded: true } : {}),
            entries,
            totalUsd,
          },
          updatedAt: now(),
        });
        updateCurrent(persisted);
        return persisted;
      });
      // `updateCurrent` already ran inside the serialized mutation before the lane was released.
      if (updated.cost.budgetExceeded) {
        throw new ResearchTaskBudgetExceededError();
      }
    },
  };
}

function findResearchModelCostEntryIndex(job: ResearchTaskJob, callId: string): number {
  return job.cost.entries.findIndex((entry) => entry.usage.researchModelCallId === callId);
}

function modelCallUsagePayload({
  callId,
  estimated,
  reserved,
  status,
  usage,
}: {
  readonly callId: string;
  readonly estimated: boolean;
  readonly reserved: boolean;
  readonly status: "failed" | "reserved" | "succeeded";
  readonly usage: {
    readonly completionTokens: number;
    readonly promptTokens: number;
    readonly totalTokens: number;
  };
}): Record<string, JobPayload> {
  return {
    completionTokens: usage.completionTokens,
    estimated,
    promptTokens: usage.promptTokens,
    researchModelCallId: callId,
    reserved,
    status,
    totalTokens: usage.totalTokens,
  };
}

function boundedCostLabel(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Research task model call ${label} is required`);
  return normalized.slice(0, 200);
}

function roundCurrency(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function researchTaskBudgetExceededError(error: unknown): boolean {
  let candidate: unknown = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (candidate instanceof ResearchTaskBudgetExceededError) return true;
    if (!(candidate instanceof ResearchModelCallObserverError)) return false;
    candidate = candidate.cause;
  }
  return false;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function retrievalCandidateCountFromMetadata(metadata: Record<string, unknown>) {
  if (!isPlainObject(metadata.metrics)) return undefined;
  return (
    nonNegativeInteger(metadata.metrics.fusedCandidates) ??
    nonNegativeInteger(metadata.metrics.rerankCandidates) ??
    nonNegativeInteger(metadata.metrics.denseCandidates) ??
    nonNegativeInteger(metadata.metrics.ftsCandidates)
  );
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

function explicitlyNonRetryableErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("retryable" in error)) return undefined;
  if ((error as { readonly retryable?: unknown }).retryable !== false) return undefined;
  const code = "code" in error ? (error as { readonly code?: unknown }).code : undefined;
  return typeof code === "string" && code.trim() ? code.trim() : "RESEARCH_TASK_EXECUTION_FAILED";
}

function positiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Research task ${field} must be a positive integer`);
  }
}
