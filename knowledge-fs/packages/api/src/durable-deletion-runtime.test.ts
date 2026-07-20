import { describe, expect, it, vi } from "vitest";

import type { DurableDeletionJob } from "./durable-deletion-repository";
import {
  type DurableDeletionRuntimeRepository,
  DurableDeletionStepTimeoutError,
  createDurableDeletionRuntime,
} from "./durable-deletion-runtime";
import type { DurableDeletionTargetProcessors } from "./durable-deletion-target-processors";

describe("durable deletion runtime", () => {
  it("counts an atomically persisted dead item without failing the parent job twice", async () => {
    const claimed = job();
    const heartbeat = { ...claimed, rowVersion: claimed.rowVersion + 1 };
    const repository = repositoryFixture({
      claimJobs: vi.fn(async () => [claimed]),
      heartbeatJob: vi.fn(async () => heartbeat),
    });
    const processor: DurableDeletionTargetProcessors = {
      process: vi.fn(async () => ({
        disposition: "failed_persisted" as const,
        error: { code: "ITEM_DEAD", message: "dead", retryable: false },
        job: heartbeat,
      })),
    };

    await expect(runtimeFor(repository, processor).tick()).resolves.toEqual({
      completed: 0,
      deferred: 0,
      failed: 1,
      leased: 1,
      retryScheduled: 0,
    });
    expect(repository.failJob).not.toHaveBeenCalled();
    expect(repository.scheduleJobRetry).not.toHaveBeenCalled();
  });

  it("reports a waiting job as failed when retry scheduling atomically exhausts it", async () => {
    const claimed = job({ executionAttempts: 3, maxExecutionAttempts: 3 });
    const heartbeat = { ...claimed, rowVersion: claimed.rowVersion + 1 };
    const failed = {
      ...heartbeat,
      leaseExpiresAt: undefined,
      leaseToken: undefined,
      runState: "failed" as const,
      workerId: undefined,
    };
    const repository = repositoryFixture({
      claimJobs: vi.fn(async () => [claimed]),
      heartbeatJob: vi.fn(async () => heartbeat),
      scheduleJobRetry: vi.fn(async () => failed),
    });
    const processor: DurableDeletionTargetProcessors = {
      process: vi.fn(async () => ({
        attemptBudget: "failure" as const,
        disposition: "waiting" as const,
        job: heartbeat,
        retryAt: "2026-07-14T12:00:01.000Z",
      })),
    };

    const result = await runtimeFor(repository, processor).tick();

    expect(result.failed).toBe(1);
    expect(result.retryScheduled).toBe(0);
    expect(repository.failJob).not.toHaveBeenCalled();
  });

  it("heartbeats before every bounded processor step", async () => {
    const claimed = job();
    const firstHeartbeat = { ...claimed, rowVersion: 9 };
    const secondHeartbeat = { ...claimed, rowVersion: 10 };
    const completed = {
      ...secondHeartbeat,
      checkpoint: "completed" as const,
      leaseExpiresAt: undefined,
      leaseToken: undefined,
      runState: "succeeded" as const,
      workerId: undefined,
    };
    const heartbeatJob = vi
      .fn<DurableDeletionRuntimeRepository["heartbeatJob"]>()
      .mockResolvedValueOnce(firstHeartbeat)
      .mockResolvedValueOnce(secondHeartbeat);
    const repository = repositoryFixture({
      claimJobs: vi.fn(async () => [claimed]),
      heartbeatJob,
    });
    const process = vi
      .fn<DurableDeletionTargetProcessors["process"]>()
      .mockResolvedValueOnce({ disposition: "progressed", job: firstHeartbeat })
      .mockResolvedValueOnce({ disposition: "completed", job: completed });

    const result = await runtimeFor(repository, { process }).tick();

    expect(result.completed).toBe(1);
    expect(heartbeatJob).toHaveBeenCalledTimes(2);
    expect(process).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ job: secondHeartbeat, signal: expect.any(AbortSignal) }),
    );
  });

  it("aborts a timed-out step and schedules a fenced retry", async () => {
    const claimed = job();
    const heartbeat = { ...claimed, rowVersion: 9 };
    let observedSignal: AbortSignal | undefined;
    const processor: DurableDeletionTargetProcessors = {
      process: vi.fn<DurableDeletionTargetProcessors["process"]>(
        ({ signal }) =>
          new Promise<never>((_, reject) => {
            observedSignal = signal;
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          }),
      ),
    };
    const retry = {
      ...heartbeat,
      leaseExpiresAt: undefined,
      leaseToken: undefined,
      retryAt: "2026-07-14T12:00:01.000Z",
      runState: "retry_wait" as const,
      workerId: undefined,
    };
    const scheduleJobRetry = vi.fn(async () => retry);
    const repository = repositoryFixture({
      claimJobs: vi.fn(async () => [claimed]),
      heartbeatJob: vi.fn(async () => heartbeat),
      scheduleJobRetry,
    });
    const onError = vi.fn();

    const result = await runtimeFor(repository, processor, { onError, stepTimeoutMs: 5 }).tick();

    expect(result.retryScheduled).toBe(1);
    expect(observedSignal?.aborted).toBe(true);
    expect(observedSignal?.reason).toBeInstanceOf(DurableDeletionStepTimeoutError);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(DurableDeletionStepTimeoutError) }),
    );
    expect(scheduleJobRetry).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "DURABLE_DELETION_PROCESSING_FAILED" }),
    );
  });

  it("continues successful bounded work across more leases than the consecutive error budget", async () => {
    let stored = job({ executionAttempts: 0, maxExecutionAttempts: 2, runState: "queued" });
    let steps = 0;
    const scheduleInputs: unknown[] = [];
    const repository: DurableDeletionRuntimeRepository = {
      claimJobs: vi.fn(async () => {
        if (stored.runState !== "queued" && stored.runState !== "retry_wait") return [];
        stored = {
          ...stored,
          executionAttempts: stored.executionAttempts + 1,
          leaseExpiresAt: "2026-07-14T12:05:00.000Z",
          leaseToken: `lease-${steps}`,
          rowVersion: stored.rowVersion + 1,
          runState: "running",
          workerId: "deletion-worker-a",
        };
        return [stored];
      }),
      failJob: vi.fn(async () => null),
      heartbeatJob: vi.fn(async () => {
        stored = { ...stored, rowVersion: stored.rowVersion + 1 };
        return stored;
      }),
      scheduleJobRetry: vi.fn(async (input) => {
        scheduleInputs.push(input);
        stored = {
          ...stored,
          executionAttempts: input.resetExecutionAttempts ? 0 : stored.executionAttempts,
          leaseExpiresAt: undefined,
          leaseToken: undefined,
          rowVersion: stored.rowVersion + 1,
          runState: "retry_wait",
          workerId: undefined,
        };
        return stored;
      }),
    };
    const processor: DurableDeletionTargetProcessors = {
      process: vi.fn(async ({ job: current }) => {
        steps += 1;
        if (steps === 6) {
          stored = {
            ...current,
            checkpoint: "completed",
            leaseExpiresAt: undefined,
            leaseToken: undefined,
            runState: "succeeded",
            workerId: undefined,
          };
          return { disposition: "completed" as const, job: stored };
        }
        return { disposition: "progressed" as const, job: current };
      }),
    };
    const runtime = createDurableDeletionRuntime({
      heartbeatIntervalMs: 20,
      initialRetryDelayMs: 100,
      intervalMs: 1_000,
      leaseMs: 50,
      maxBatchSize: 1,
      maxStepsPerLease: 1,
      now: () => Date.parse("2026-07-14T12:00:00.000Z"),
      processor,
      repository,
      stepTimeoutMs: 10,
      workerId: "deletion-worker-a",
    });

    const ticks = [];
    for (let index = 0; index < 6; index += 1) ticks.push(await runtime.tick());

    expect(ticks.at(-1)?.completed).toBe(1);
    expect(ticks.every((result) => result.failed === 0)).toBe(true);
    expect(repository.failJob).not.toHaveBeenCalled();
    expect(scheduleInputs).toHaveLength(5);
    expect(scheduleInputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          errorCode: "DURABLE_DELETION_COOPERATIVE_YIELD",
          resetExecutionAttempts: true,
        }),
      ]),
    );
  });
});

function runtimeFor(
  repository: DurableDeletionRuntimeRepository,
  processor: DurableDeletionTargetProcessors,
  overrides: { readonly onError?: ReturnType<typeof vi.fn>; readonly stepTimeoutMs?: number } = {},
) {
  return createDurableDeletionRuntime({
    heartbeatIntervalMs: 20,
    initialRetryDelayMs: 100,
    intervalMs: 1_000,
    leaseMs: 50,
    maxBatchSize: 5,
    maxStepsPerLease: 5,
    now: () => Date.parse("2026-07-14T12:00:00.000Z"),
    ...(overrides.onError ? { onError: overrides.onError } : {}),
    processor,
    repository,
    stepTimeoutMs: overrides.stepTimeoutMs ?? 10,
    workerId: "deletion-worker-a",
  });
}

function repositoryFixture(
  overrides: Partial<DurableDeletionRuntimeRepository> = {},
): DurableDeletionRuntimeRepository {
  return {
    claimJobs: vi.fn(async () => []),
    failJob: vi.fn(async () => null),
    heartbeatJob: vi.fn(async () => null),
    scheduleJobRetry: vi.fn(async () => null),
    ...overrides,
  };
}

function job(overrides: Partial<DurableDeletionJob> = {}): DurableDeletionJob {
  return {
    accessChannel: "interactive",
    checkpoint: "quiescing",
    createdAt: "2026-07-14T12:00:00.000Z",
    deleteMode: "cascade",
    executionAttempts: 1,
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
    idempotencyKey: "delete-a",
    inventoryComplete: false,
    knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
    leaseExpiresAt: "2026-07-14T12:05:00.000Z",
    leaseToken: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d00",
    maxExecutionAttempts: 10,
    permissionSnapshotId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01",
    permissionSnapshotRevision: 1,
    requestFingerprint: "a".repeat(64),
    requestedBySubjectId: "user-a",
    rowVersion: 8,
    runState: "running",
    targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d02",
    targetRevision: 3,
    targetType: "document_asset",
    tenantId: "tenant-a",
    updatedAt: "2026-07-14T12:00:00.000Z",
    workerId: "worker-a",
    ...overrides,
  };
}
