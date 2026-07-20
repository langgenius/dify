import { describe, expect, it, vi } from "vitest";

import { AUTO_RETRIEVAL_MODE_DECISION_METADATA_KEY } from "./auto-retrieval-mode-resolver";
import {
  createDeletionLifecycleFenceGuard,
  createInMemoryDeletionLifecycleFenceReader,
} from "./deletion-lifecycle-fence";
import {
  KnowledgeSpaceAccessError,
  type KnowledgeSpacePermissionSnapshot,
} from "./knowledge-space-access-control";
import { createInMemoryKnowledgeSpaceManifestRepository } from "./knowledge-space-manifest-repository";
import type { PublishedKnowledgeSpaceRuntimeSnapshot } from "./published-knowledge-space-runtime-snapshot";
import type {
  ResearchTaskDurableRepository,
  ResearchTaskExecutionFence,
  ResearchTaskOutboxEvent,
} from "./research-task-durable-repository";
import {
  type ResearchTaskJob,
  type ResearchTaskJobStage,
  createInMemoryResearchTaskPartialResultRepository,
} from "./research-task-job";
import {
  createInMemoryResearchTaskProgressRepository,
  createResearchTaskProgressPublisher,
} from "./research-task-progress";
import { createResearchTaskRuntime } from "./research-task-runtime";
import {
  RESEARCH_TASK_RUNTIME_SNAPSHOT_INVALID,
  RESEARCH_TASK_RUNTIME_SNAPSHOT_METADATA_KEY,
  toResearchTaskRuntimeSnapshotPayload,
} from "./research-task-runtime-snapshot";

const JOB_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01";
const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d02";
const SNAPSHOT_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d03";
const EVIDENCE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d04";

describe("research task production runtime", () => {
  it("rejects a half-frozen embedding tuple before it can become durable metadata", () => {
    const { embeddingCapabilitySnapshot: _embeddingCapabilitySnapshot, ...incompleteSnapshot } =
      publishedRuntimeSnapshot(SPACE_ID);

    expect(() => toResearchTaskRuntimeSnapshotPayload(incompleteSnapshot)).toThrow(
      "Embedding profile and capability snapshot must be frozen together",
    );
  });

  it("recovers a persisted job, uses only server snapshot grants, and preserves mode/topK", async () => {
    const repository = new MemoryDurableRepository(baseJob());
    const partials = createInMemoryResearchTaskPartialResultRepository({
      maxListLimit: 10,
      maxResults: 10,
    });
    const progress = createInMemoryResearchTaskProgressRepository({
      maxEvents: 20,
      maxListLimit: 20,
      maxSubscribers: 2,
    });
    const generationInputs: unknown[] = [];
    let validationCount = 0;
    const runtime = createResearchTaskRuntime({
      access: {
        revalidatePermissionSnapshot: async () => {
          validationCount += 1;
          return permissionSnapshot();
        },
      },
      allowLegacyProfileFallback: true,
      generator: {
        stream: async function* (input) {
          generationInputs.push(input);
          yield traceStep("query.retrieve");
          yield traceStep("query.answer");
          yield {
            finishReason: "retrieval-evidence",
            metadata: { evidenceBundle: evidenceBundle() },
            type: "done" as const,
          };
        },
      },
      heartbeatIntervalMs: 5_000,
      intervalMs: 1_000,
      leaseMs: 30_000,
      manifests: createInMemoryKnowledgeSpaceManifestRepository({
        maxListLimit: 10,
        maxManifests: 10,
      }),
      maxBatchSize: 1,
      now: () => 1_000,
      partials,
      progress: createResearchTaskProgressPublisher({ repository: progress }),
      repository,
      workerId: "research-worker-1",
    });

    // The state lives in the repository rather than this runtime instance. A newly constructed
    // consumer can therefore resume after the previous process disappeared.
    await expect(runtime.tick()).resolves.toMatchObject({ leased: 1, succeeded: 1 });

    expect(repository.job).toMatchObject({
      executionAttempts: 1,
      mode: "deep",
      stage: "completed",
      topK: 7,
    });
    expect(generationInputs).toEqual([
      expect.objectContaining({
        mode: "deep",
        permissionScope: ["server:grant"],
        subject: { scopes: [], subjectId: "subject-1", tenantId: "tenant-1" },
        topK: 7,
      }),
    ]);
    expect(validationCount).toBeGreaterThanOrEqual(5);
    await expect(
      partials.list({ limit: 10, researchTaskJobId: JOB_ID, tenantId: "tenant-1" }),
    ).resolves.toMatchObject({ items: [{ sequence: 1 }] });
    await expect(
      progress.list({ limit: 20, researchTaskJobId: JOB_ID, tenantId: "tenant-1" }),
    ).resolves.toMatchObject({
      items: [
        { stage: "queued", type: "research_task.stage_changed" },
        { stage: "planning", type: "research_task.stage_changed" },
        { stage: "retrieving", type: "research_task.stage_changed" },
        { stage: "analyzing", type: "research_task.stage_changed" },
        { stage: "generating", type: "research_task.stage_changed" },
        { stage: "completed", type: "research_task.stage_changed" },
      ],
    });
  });

  it("reuses the frozen publication and profiles across retries without mutable reads", async () => {
    const frozenRuntime = publishedRuntimeSnapshot(SPACE_ID);
    const repository = new MemoryDurableRepository({
      ...baseJob(),
      mode: "deep",
      metadata: {
        [AUTO_RETRIEVAL_MODE_DECISION_METADATA_KEY]: autoModeDecision(frozenRuntime, "deep"),
        [RESEARCH_TASK_RUNTIME_SNAPSHOT_METADATA_KEY]:
          toResearchTaskRuntimeSnapshotPayload(frozenRuntime),
      },
      topK: 37,
    });
    const manifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 10,
      maxManifests: 10,
    });
    const manifestRead = vi.spyOn(manifests, "get");
    const projectionResolve = vi.fn(async () => {
      throw new Error("Frozen task must not resolve the mutable publication head");
    });
    const generationInputs: unknown[] = [];
    let generationAttempt = 0;
    let now = 1_000;
    const runtime = createResearchTaskRuntime({
      access: { revalidatePermissionSnapshot: async () => permissionSnapshot() },
      generator: {
        stream: async function* (input) {
          generationInputs.push(input);
          generationAttempt += 1;
          if (generationAttempt === 1) {
            throw new Error("transient generator failure");
          }
          yield traceStep("query.retrieve");
          yield traceStep("query.answer");
        },
      },
      heartbeatIntervalMs: 5_000,
      intervalMs: 1_000,
      leaseMs: 30_000,
      manifests,
      maxBatchSize: 1,
      maxRetryDelayMs: 1,
      now: () => now,
      partials: createInMemoryResearchTaskPartialResultRepository({
        maxListLimit: 10,
        maxResults: 10,
      }),
      projectionSnapshotResolver: { resolve: projectionResolve },
      repository,
      retryDelayMs: 1,
      workerId: "research-worker-1",
    });

    await expect(runtime.tick()).resolves.toMatchObject({
      leased: 1,
      retryScheduled: 1,
      succeeded: 0,
    });
    expect(repository.job).toMatchObject({
      error: "transient generator failure",
      retryAt: 1_001,
      stage: "retrieving",
    });

    now = 1_002;
    await expect(runtime.tick()).resolves.toMatchObject({
      leased: 1,
      retryScheduled: 0,
      succeeded: 1,
    });
    expect(repository.job.stage).toBe("completed");
    expect(repository.job).toMatchObject({ mode: "deep", topK: 37 });
    expect(manifestRead).not.toHaveBeenCalled();
    expect(projectionResolve).not.toHaveBeenCalled();
    expect(generationInputs).toHaveLength(2);
    for (const input of generationInputs) {
      expect(input).toMatchObject({
        embeddingProfile: frozenRuntime.embeddingProfile,
        mode: "deep",
        projectionSnapshot: frozenRuntime.projectionSnapshot,
        retrievalProfile: frozenRuntime.retrievalProfile,
        topK: 37,
      });
    }
  });

  it.each([
    {
      name: "an unresolved legacy Auto job",
      job: {
        ...baseJob(),
        mode: "auto" as const,
        metadata: {
          [RESEARCH_TASK_RUNTIME_SNAPSHOT_METADATA_KEY]: toResearchTaskRuntimeSnapshotPayload(
            publishedRuntimeSnapshot(SPACE_ID),
          ),
        },
      },
    },
    {
      name: "an Auto decision that disagrees with the durable concrete mode",
      job: (() => {
        const frozenRuntime = publishedRuntimeSnapshot(SPACE_ID);
        return {
          ...baseJob(),
          mode: "deep" as const,
          metadata: {
            [AUTO_RETRIEVAL_MODE_DECISION_METADATA_KEY]: autoModeDecision(frozenRuntime, "fast"),
            [RESEARCH_TASK_RUNTIME_SNAPSHOT_METADATA_KEY]:
              toResearchTaskRuntimeSnapshotPayload(frozenRuntime),
          },
        };
      })(),
    },
    {
      name: "an Auto decision with a tampered retrieval profile revision",
      job: (() => {
        const frozenRuntime = publishedRuntimeSnapshot(SPACE_ID);
        return {
          ...baseJob(),
          mode: "deep" as const,
          metadata: {
            [AUTO_RETRIEVAL_MODE_DECISION_METADATA_KEY]: {
              ...autoModeDecision(frozenRuntime, "deep"),
              retrievalProfileRevision: frozenRuntime.retrievalProfile.revision + 1,
            },
            [RESEARCH_TASK_RUNTIME_SNAPSHOT_METADATA_KEY]:
              toResearchTaskRuntimeSnapshotPayload(frozenRuntime),
          },
        };
      })(),
    },
    {
      name: "an Auto decision with tampered model and publication provenance",
      job: (() => {
        const frozenRuntime = publishedRuntimeSnapshot(SPACE_ID);
        return {
          ...baseJob(),
          mode: "deep" as const,
          metadata: {
            [AUTO_RETRIEVAL_MODE_DECISION_METADATA_KEY]: {
              ...autoModeDecision(frozenRuntime, "deep"),
              publicationFingerprint: "sha256:tampered-publication",
              reasoningModel: {
                ...frozenRuntime.retrievalProfile.reasoningModel,
                model: "tampered-reasoning-model",
              },
            },
            [RESEARCH_TASK_RUNTIME_SNAPSHOT_METADATA_KEY]:
              toResearchTaskRuntimeSnapshotPayload(frozenRuntime),
          },
        };
      })(),
    },
    {
      name: "a degraded fallback that does not use the frozen default mode",
      job: (() => {
        const frozenRuntime = publishedRuntimeSnapshot(SPACE_ID);
        return {
          ...baseJob(),
          mode: "fast" as const,
          metadata: {
            [AUTO_RETRIEVAL_MODE_DECISION_METADATA_KEY]: {
              degraded: true,
              durationMs: 12,
              errorClass: "AutoRetrievalModeResolutionError",
              publicationFingerprint: frozenRuntime.projectionSnapshot.fingerprint,
              publicationId: frozenRuntime.projectionSnapshot.publicationId,
              reasoningModel: frozenRuntime.retrievalProfile.reasoningModel,
              requestedMode: "auto",
              resolvedMode: "fast",
              resolver: "fallback",
              retrievalProfileRevision: frozenRuntime.retrievalProfile.revision,
            },
            [RESEARCH_TASK_RUNTIME_SNAPSHOT_METADATA_KEY]:
              toResearchTaskRuntimeSnapshotPayload(frozenRuntime),
          },
        };
      })(),
    },
  ])("fails closed before retrieval for $name", async ({ job }) => {
    const repository = new MemoryDurableRepository(job);
    const generator = vi.fn();
    const runtime = createResearchTaskRuntime({
      access: { revalidatePermissionSnapshot: async () => permissionSnapshot() },
      generator: {
        stream: async function* (input) {
          generator(input);
          yield traceStep("query.retrieve");
        },
      },
      heartbeatIntervalMs: 5_000,
      intervalMs: 1_000,
      leaseMs: 30_000,
      manifests: createInMemoryKnowledgeSpaceManifestRepository({
        maxListLimit: 10,
        maxManifests: 10,
      }),
      maxBatchSize: 1,
      partials: createInMemoryResearchTaskPartialResultRepository({
        maxListLimit: 10,
        maxResults: 10,
      }),
      repository,
      workerId: "research-worker-1",
    });

    await expect(runtime.tick()).resolves.toMatchObject({ failed: 1, succeeded: 0 });
    expect(repository.job).toMatchObject({
      error: RESEARCH_TASK_RUNTIME_SNAPSHOT_INVALID,
      stage: "failed",
    });
    expect(generator).not.toHaveBeenCalled();
  });

  it("fails closed instead of reading a mutable manifest when frozen metadata is missing", async () => {
    const repository = new MemoryDurableRepository(baseJob());
    const manifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 10,
      maxManifests: 10,
    });
    const manifestRead = vi.spyOn(manifests, "get");
    const generator = vi.fn();
    const runtime = createResearchTaskRuntime({
      access: { revalidatePermissionSnapshot: async () => permissionSnapshot() },
      generator: {
        stream: async function* (input) {
          generator(input);
          yield traceStep("query.retrieve");
        },
      },
      heartbeatIntervalMs: 5_000,
      intervalMs: 1_000,
      leaseMs: 30_000,
      manifests,
      maxBatchSize: 1,
      partials: createInMemoryResearchTaskPartialResultRepository({
        maxListLimit: 10,
        maxResults: 10,
      }),
      repository,
      workerId: "research-worker-1",
    });

    await expect(runtime.tick()).resolves.toMatchObject({ failed: 1, leased: 1, succeeded: 0 });
    expect(repository.job).toMatchObject({
      error: RESEARCH_TASK_RUNTIME_SNAPSHOT_INVALID,
      stage: "failed",
    });
    expect(manifestRead).not.toHaveBeenCalled();
    expect(generator).not.toHaveBeenCalled();
  });

  it("fails a scope-mismatched frozen snapshot terminally without any mutable fallback", async () => {
    const repository = new MemoryDurableRepository({
      ...baseJob(),
      metadata: {
        [RESEARCH_TASK_RUNTIME_SNAPSHOT_METADATA_KEY]: toResearchTaskRuntimeSnapshotPayload(
          publishedRuntimeSnapshot("018f0d60-7a49-7cc2-9c1b-5b36f18f2d99"),
        ),
      },
    });
    const manifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 10,
      maxManifests: 10,
    });
    const manifestRead = vi.spyOn(manifests, "get");
    const projectionResolve = vi.fn(async () => {
      throw new Error("Scope mismatch must not fall back to a mutable publication");
    });
    const generator = vi.fn();
    const errors: unknown[] = [];
    const runtime = createResearchTaskRuntime({
      access: { revalidatePermissionSnapshot: async () => permissionSnapshot() },
      generator: {
        stream: async function* (input) {
          generator(input);
          yield traceStep("query.retrieve");
        },
      },
      heartbeatIntervalMs: 5_000,
      intervalMs: 1_000,
      leaseMs: 30_000,
      manifests,
      maxBatchSize: 1,
      onError: ({ error }) => errors.push(error),
      partials: createInMemoryResearchTaskPartialResultRepository({
        maxListLimit: 10,
        maxResults: 10,
      }),
      projectionSnapshotResolver: { resolve: projectionResolve },
      repository,
      workerId: "research-worker-1",
    });

    await expect(runtime.tick()).resolves.toMatchObject({
      failed: 1,
      leased: 1,
      retryScheduled: 0,
      succeeded: 0,
    });
    expect(repository.job).toMatchObject({
      error: RESEARCH_TASK_RUNTIME_SNAPSHOT_INVALID,
      stage: "failed",
    });
    expect(errors).toEqual([
      expect.objectContaining({ message: "Research task runtime snapshot scope mismatch" }),
    ]);
    expect(manifestRead).not.toHaveBeenCalled();
    expect(projectionResolve).not.toHaveBeenCalled();
    expect(generator).not.toHaveBeenCalled();
  });

  it("revalidates before generator resume and terminates stably after ACL revocation", async () => {
    const repository = new MemoryDurableRepository(baseJob());
    let revoked = false;
    const runtime = createResearchTaskRuntime({
      access: {
        revalidatePermissionSnapshot: async () => {
          if (revoked) {
            throw new KnowledgeSpaceAccessError(
              "space_access_permission_snapshot_invalid",
              "Knowledge-space permission snapshot is invalid",
            );
          }
          return permissionSnapshot();
        },
      },
      allowLegacyProfileFallback: true,
      generator: {
        stream: async function* () {
          revoked = true;
          yield traceStep("query.retrieve");
          throw new Error("Generator must not resume after revocation");
        },
      },
      heartbeatIntervalMs: 5_000,
      intervalMs: 1_000,
      leaseMs: 30_000,
      manifests: createInMemoryKnowledgeSpaceManifestRepository({
        maxListLimit: 10,
        maxManifests: 10,
      }),
      maxBatchSize: 1,
      now: () => 1_000,
      partials: createInMemoryResearchTaskPartialResultRepository({
        maxListLimit: 10,
        maxResults: 10,
      }),
      repository,
      workerId: "research-worker-1",
    });

    const revokedResult = await runtime.tick();
    expect(revokedResult).toEqual({
      acknowledgedStale: 0,
      acknowledgedTerminal: 0,
      deferred: 0,
      failed: 1,
      leased: 1,
      rejected: 0,
      retryScheduled: 0,
      succeeded: 0,
    });
    expect(repository.job).toMatchObject({
      error: "RESEARCH_TASK_PERMISSION_SNAPSHOT_INVALID",
      stage: "failed",
    });
    // ACL revocation is terminal in the durable database and is never retried with stale grants.
  });

  it("rejects a malformed durable claim without a database lease token", async () => {
    const repository = new MemoryDurableRepository(baseJob(), { omitLeaseToken: true });
    const runtime = createResearchTaskRuntime({
      access: { revalidatePermissionSnapshot: async () => permissionSnapshot() },
      allowLegacyProfileFallback: true,
      generator: { stream: async function* () {} },
      heartbeatIntervalMs: 5_000,
      intervalMs: 1_000,
      leaseMs: 30_000,
      manifests: createInMemoryKnowledgeSpaceManifestRepository({
        maxListLimit: 10,
        maxManifests: 10,
      }),
      maxBatchSize: 1,
      partials: createInMemoryResearchTaskPartialResultRepository({
        maxListLimit: 10,
        maxResults: 10,
      }),
      repository,
      workerId: "research-worker-1",
    });

    await expect(runtime.tick()).resolves.toMatchObject({ leased: 1, rejected: 1 });
    expect(repository.job.stage).toBe("queued");
  });

  it("reclaims an expired database execution lease after the previous process disappears", async () => {
    const repository = new MemoryDurableRepository(baseJob());
    await repository.claimExecutions({
      leaseExpiresAt: 2_000,
      limit: 1,
      now: 1_000,
      workerId: "killed-worker",
    });
    const runtime = createResearchTaskRuntime({
      access: { revalidatePermissionSnapshot: async () => permissionSnapshot() },
      allowLegacyProfileFallback: true,
      generator: {
        stream: async function* () {
          yield traceStep("query.retrieve");
          yield traceStep("query.answer");
        },
      },
      heartbeatIntervalMs: 5_000,
      intervalMs: 1_000,
      leaseMs: 30_000,
      manifests: createInMemoryKnowledgeSpaceManifestRepository({
        maxListLimit: 10,
        maxManifests: 10,
      }),
      maxBatchSize: 1,
      now: () => 2_001,
      partials: createInMemoryResearchTaskPartialResultRepository({
        maxListLimit: 10,
        maxResults: 10,
      }),
      repository,
      workerId: "replacement-worker",
    });

    await expect(runtime.tick()).resolves.toMatchObject({ leased: 1, succeeded: 1 });
    expect(repository.job).toMatchObject({
      executionAttempts: 2,
      stage: "completed",
    });
    expect(repository.job).not.toHaveProperty("workerId");
  });

  it("acknowledges a tombstoned space without partial, completion, failure, or retry writes", async () => {
    const repository = new MemoryDurableRepository(baseJob());
    const partials = createInMemoryResearchTaskPartialResultRepository({
      maxListLimit: 10,
      maxResults: 10,
    });
    const fences = createInMemoryDeletionLifecycleFenceReader();
    const runtime = createResearchTaskRuntime({
      access: { revalidatePermissionSnapshot: async () => permissionSnapshot() },
      allowLegacyProfileFallback: true,
      deletionFence: createDeletionLifecycleFenceGuard(fences),
      generator: {
        stream: async function* () {
          await fences.activateFence({
            id: "fence-space-1",
            knowledgeSpaceId: SPACE_ID,
            targetId: SPACE_ID,
            targetType: "space",
            tenantId: "tenant-1",
          });
          yield traceStep("query.retrieve");
        },
      },
      heartbeatIntervalMs: 5_000,
      intervalMs: 1_000,
      leaseMs: 30_000,
      manifests: createInMemoryKnowledgeSpaceManifestRepository({
        maxListLimit: 10,
        maxManifests: 10,
      }),
      maxBatchSize: 1,
      now: () => 1_000,
      partials,
      repository,
      workerId: "research-worker-1",
    });

    await expect(runtime.tick()).resolves.toMatchObject({
      acknowledgedStale: 1,
      failed: 0,
      leased: 1,
      retryScheduled: 0,
      succeeded: 0,
    });
    expect(repository.job).toMatchObject({
      error: "RESEARCH_TASK_DELETION_FENCE_ACTIVE",
      stage: "canceled",
    });
    await expect(runtime.tick()).resolves.toMatchObject({ leased: 0 });
    await expect(
      partials.list({ limit: 10, researchTaskJobId: JOB_ID, tenantId: "tenant-1" }),
    ).resolves.toMatchObject({ items: [] });
  });
});

class MemoryDurableRepository implements ResearchTaskDurableRepository {
  job: ResearchTaskJob;
  private readonly omitLeaseToken: boolean;

  constructor(job: ResearchTaskJob, options: { readonly omitLeaseToken?: boolean } = {}) {
    this.job = structuredClone(job);
    this.omitLeaseToken = options.omitLeaseToken ?? false;
  }

  async get(id: string): Promise<ResearchTaskJob | null> {
    return id === this.job.id ? structuredClone(this.job) : null;
  }

  async getMany(ids: readonly string[]): Promise<ResearchTaskJob[]> {
    return ids.includes(this.job.id) ? [structuredClone(this.job)] : [];
  }

  async create(job: ResearchTaskJob): Promise<ResearchTaskJob> {
    this.job = structuredClone(job);
    return structuredClone(this.job);
  }

  async start(job: ResearchTaskJob): Promise<ResearchTaskJob> {
    return this.create(job);
  }

  async requestResume(): Promise<ResearchTaskJob> {
    throw new Error("Not used");
  }

  async update(job: ResearchTaskJob): Promise<ResearchTaskJob> {
    this.job = { ...structuredClone(job), rowVersion: job.rowVersion + 1 };
    return structuredClone(this.job);
  }

  async claimExecution(input: {
    readonly expectedRowVersion: number;
    readonly leaseExpiresAt: number;
    readonly leaseToken: string;
    readonly now: number;
    readonly queueJobId: string;
    readonly researchTaskJobId: string;
    readonly workerId: string;
  }): Promise<ResearchTaskJob | null> {
    if (
      input.researchTaskJobId !== this.job.id ||
      input.expectedRowVersion !== this.job.rowVersion ||
      input.queueJobId !== this.job.queueJobId
    ) {
      return null;
    }
    this.job = {
      ...this.job,
      executionAttempts: this.job.executionAttempts + 1,
      heartbeatAt: input.now,
      leaseExpiresAt: input.leaseExpiresAt,
      leaseToken: input.leaseToken,
      rowVersion: this.job.rowVersion + 1,
      workerId: input.workerId,
    };
    return structuredClone(this.job);
  }

  async claimExecutions(input: {
    readonly leaseExpiresAt: number;
    readonly limit: number;
    readonly now: number;
    readonly workerId: string;
  }): Promise<readonly ResearchTaskJob[]> {
    if (
      input.limit < 1 ||
      ["canceled", "completed", "failed", "paused"].includes(this.job.stage) ||
      (this.job.retryAt ?? 0) > input.now ||
      (this.job.leaseExpiresAt ?? 0) > input.now
    ) {
      return [];
    }
    const { retryAt: _retryAt, ...claimable } = this.job;
    this.job = {
      ...claimable,
      executionAttempts: this.job.executionAttempts + 1,
      heartbeatAt: input.now,
      leaseExpiresAt: input.leaseExpiresAt,
      ...(this.omitLeaseToken
        ? { leaseToken: undefined }
        : { leaseToken: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d05" }),
      rowVersion: this.job.rowVersion + 1,
      workerId: input.workerId,
    };
    return [structuredClone(this.job)];
  }

  async heartbeatExecution(): Promise<ResearchTaskJob | null> {
    throw new Error("Unexpected heartbeat in a sub-interval test");
  }

  async advanceExecution(
    input: ResearchTaskExecutionFence & { readonly nextStage: ResearchTaskJobStage },
  ): Promise<ResearchTaskJob | null> {
    if (!this.matchesFence(input)) {
      return null;
    }
    this.job = {
      ...this.job,
      rowVersion: this.job.rowVersion + 1,
      stage: input.nextStage,
      updatedAt: input.now,
    };
    return structuredClone(this.job);
  }

  async completeExecution(input: ResearchTaskExecutionFence): Promise<ResearchTaskJob | null> {
    return this.terminal(input, "completed");
  }

  async cancelExecution(
    input: ResearchTaskExecutionFence & { readonly reason: string },
  ): Promise<ResearchTaskJob | null> {
    return this.terminal(input, "canceled", input.reason);
  }

  async failExecution(
    input: ResearchTaskExecutionFence & { readonly error: string },
  ): Promise<ResearchTaskJob | null> {
    return this.terminal(input, "failed", input.error);
  }

  async releaseExecutionForRetry(
    input: ResearchTaskExecutionFence & {
      readonly error: string;
      readonly retryAt: number;
    },
  ): Promise<ResearchTaskJob | null> {
    if (!this.matchesFence(input)) {
      return null;
    }
    const {
      heartbeatAt: _heartbeatAt,
      leaseExpiresAt: _leaseExpiresAt,
      leaseToken: _leaseToken,
      workerId: _workerId,
      ...base
    } = this.job;
    this.job = {
      ...base,
      error: input.error,
      retryAt: input.retryAt,
      rowVersion: this.job.rowVersion + 1,
      updatedAt: input.now,
    };
    return structuredClone(this.job);
  }

  async claimOutbox(): Promise<readonly ResearchTaskOutboxEvent[]> {
    return [];
  }

  async markOutboxDispatched(): Promise<ResearchTaskOutboxEvent | null> {
    return null;
  }

  async releaseOutbox(): Promise<ResearchTaskOutboxEvent | null> {
    return null;
  }

  private matchesFence(input: ResearchTaskExecutionFence): boolean {
    return (
      input.researchTaskJobId === this.job.id &&
      input.expectedRowVersion === this.job.rowVersion &&
      input.leaseToken === this.job.leaseToken &&
      (this.job.leaseExpiresAt ?? 0) > input.now
    );
  }

  private async terminal(
    input: ResearchTaskExecutionFence,
    stage: "canceled" | "completed" | "failed",
    error?: string,
  ): Promise<ResearchTaskJob | null> {
    if (!this.matchesFence(input)) {
      return null;
    }
    const {
      heartbeatAt: _heartbeatAt,
      leaseExpiresAt: _leaseExpiresAt,
      leaseToken: _leaseToken,
      workerId: _workerId,
      ...base
    } = this.job;
    this.job = {
      ...base,
      completedAt: input.now,
      ...(error ? { error } : {}),
      rowVersion: this.job.rowVersion + 1,
      stage,
      updatedAt: input.now,
    };
    return structuredClone(this.job);
  }
}

function baseJob(): ResearchTaskJob {
  return {
    cost: { entries: [], totalUsd: 0 },
    createdAt: 1,
    executionAttempts: 0,
    id: JOB_ID,
    knowledgeSpaceId: SPACE_ID,
    maxExecutionAttempts: 3,
    metadata: {},
    mode: "deep",
    permissionSnapshot: { accessChannel: "interactive", id: SNAPSHOT_ID, revision: 1 },
    query: "Compare reliability findings",
    queueJobId: "queue-1",
    rowVersion: 1,
    stage: "queued",
    subjectId: "subject-1",
    tenantId: "tenant-1",
    topK: 7,
    updatedAt: 1,
  };
}

function permissionSnapshot(): KnowledgeSpacePermissionSnapshot {
  return {
    accessChannel: "interactive",
    accessPolicyRevision: 1,
    apiAccessRevision: 1,
    createdAt: "2026-07-14T00:00:00.000Z",
    expiresAt: "2026-07-15T00:00:00.000Z",
    id: SNAPSHOT_ID,
    knowledgeSpaceId: SPACE_ID,
    memberRevision: 1,
    permissionScopes: ["server:grant"],
    revision: 1,
    role: "owner",
    status: "active",
    subjectId: "subject-1",
    tenantId: "tenant-1",
    updatedAt: "2026-07-14T00:00:00.000Z",
    visibility: "only_me",
  };
}

function traceStep(name: string) {
  return {
    step: {
      endedAt: "2026-07-14T00:00:01.000Z",
      metadata: {},
      name,
      startedAt: "2026-07-14T00:00:00.000Z",
      status: "ok" as const,
    },
    type: "trace-step" as const,
  };
}

function evidenceBundle() {
  return {
    createdAt: "2026-07-14T00:00:00.000Z",
    id: EVIDENCE_ID,
    items: [],
    query: "Compare reliability findings",
    state: "not-enough-evidence" as const,
  };
}

function publishedRuntimeSnapshot(
  knowledgeSpaceId: string,
): PublishedKnowledgeSpaceRuntimeSnapshot {
  return {
    embeddingCapabilitySnapshot: {
      capabilityDigest: `sha256:${"a".repeat(64)}`,
      pluginUniqueIdentifier: "embedding-install-v3",
    },
    embeddingProfile: {
      dimension: 2_048,
      model: "embed-v3",
      pluginId: "plugin-embedding",
      provider: "provider-a",
      revision: 3,
      vectorSpaceId: `embedding-space-sha256:${"b".repeat(64)}`,
    },
    projectionSnapshot: {
      fingerprint: "sha256:publication-v8",
      headRevision: 8,
      knowledgeSpaceId,
      projectionVersion: 8,
      publicationId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d61",
      tenantId: "tenant-1",
    },
    retrievalCapabilitySnapshot: {
      reasoning: { pluginUniqueIdentifier: "reasoning-install-v5" },
    },
    retrievalProfile: {
      defaultMode: "deep",
      reasoningModel: {
        model: "reason-v5",
        pluginId: "plugin-reasoning",
        provider: "provider-a",
      },
      rerank: {
        enabled: true,
        model: {
          model: "rerank-v2",
          pluginId: "plugin-rerank",
          provider: "provider-a",
        },
      },
      revision: 5,
      scoreThreshold: { enabled: true, stage: "mode-final", value: 0.42 },
      topK: 37,
    },
  };
}

function autoModeDecision(
  snapshot: PublishedKnowledgeSpaceRuntimeSnapshot,
  resolvedMode: "deep" | "fast" | "research",
) {
  return {
    degraded: false,
    durationMs: 12,
    generationModel: snapshot.retrievalProfile.reasoningModel.model,
    promptVersion: "auto-retrieval-mode-router-v1",
    publicationFingerprint: snapshot.projectionSnapshot.fingerprint,
    publicationId: snapshot.projectionSnapshot.publicationId,
    reasoningModel: snapshot.retrievalProfile.reasoningModel,
    reasonCode:
      resolvedMode === "fast"
        ? "direct_lookup"
        : resolvedMode === "deep"
          ? "relationship_exploration"
          : "structured_research",
    requestedMode: "auto",
    resolvedMode,
    resolver: "llm",
    retrievalProfileRevision: snapshot.retrievalProfile.revision,
  };
}
