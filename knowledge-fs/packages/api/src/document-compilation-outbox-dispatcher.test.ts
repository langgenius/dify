import { createInlineJobQueueAdapter } from "@knowledge/adapters";
import type { EnqueueJobInput } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { createInMemoryDocumentCompilationAttemptRepository } from "./document-compilation-attempt-repository";
import { createDocumentCompilationOutboxDispatcher } from "./document-compilation-outbox-dispatcher";

const attemptId = "018f0d60-7a49-7cc2-9c1b-5b36f18fa001";
const secondAttemptId = "018f0d60-7a49-7cc2-9c1b-5b36f18fa002";
const outboxId = "018f0d60-7a49-7cc2-9c1b-5b36f18fb001";
const secondOutboxId = "018f0d60-7a49-7cc2-9c1b-5b36f18fb002";
const spaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18fc001";
const assetId = "018f0d60-7a49-7cc2-9c1b-5b36f18fd001";
const secondAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18fd002";
const generationId = "018f0d60-7a49-7cc2-9c1b-5b36f18fe001";
const secondGenerationId = "018f0d60-7a49-7cc2-9c1b-5b36f18fe002";
const lockToken = "018f0d60-7a49-7cc2-9c1b-5b36f18ff001";
const leaseToken = "018f0d60-7a49-7cc2-9c1b-5b36f18ff002";
const startedAt = Date.parse("2026-07-13T04:00:00.000Z");

describe("createDocumentCompilationOutboxDispatcher", () => {
  it("publishes only the durable attempt locator and marks the outbox after enqueue", async () => {
    const attempts = createInMemoryDocumentCompilationAttemptRepository();
    await startAttempt(attempts);
    const queue = createInlineJobQueueAdapter({ maxBatchSize: 10, maxQueuedJobs: 10 });
    const enqueued: EnqueueJobInput[] = [];
    const dispatcher = createDocumentCompilationOutboxDispatcher({
      attempts,
      generateLockToken: () => lockToken,
      intervalMs: 60_000,
      jobs: {
        enqueue: async (input) => {
          enqueued.push(input);
          return queue.enqueue(input);
        },
      },
      lockMs: 5_000,
      maxBatchSize: 10,
      now: () => startedAt,
      workerId: "dispatcher-1",
    });

    await expect(dispatcher.tick()).resolves.toEqual({
      claimed: 1,
      deadLettered: 0,
      dispatched: 1,
      released: 0,
      unconfirmed: 0,
    });

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toEqual({
      idempotencyKey: `document.compile:${attemptId}`,
      payload: { attemptId },
      type: "document.compile",
    });
    expect(Object.keys((enqueued[0]?.payload ?? {}) as object)).toEqual(["attemptId"]);
    await expect(attempts.get(attemptId)).resolves.toMatchObject({
      queueJobId: "job-1",
      runState: "queued",
    });
  });

  it("releases enqueue failures with exponential backoff and later retries", async () => {
    const attempts = createInMemoryDocumentCompilationAttemptRepository();
    await startAttempt(attempts);
    const queue = createInlineJobQueueAdapter({ maxBatchSize: 10, maxQueuedJobs: 10 });
    let currentTime = startedAt;
    let enqueueAttempts = 0;
    const dispatcher = createDocumentCompilationOutboxDispatcher({
      attempts,
      generateLockToken: () => lockToken,
      initialRetryDelayMs: 2_000,
      intervalMs: 60_000,
      jobs: {
        enqueue: async (input) => {
          enqueueAttempts += 1;
          if (enqueueAttempts === 1) {
            throw new Error("broker unavailable");
          }
          return queue.enqueue(input);
        },
      },
      lockMs: 5_000,
      maxBatchSize: 10,
      maxRetryDelayMs: 10_000,
      now: () => currentTime,
      workerId: "dispatcher-1",
    });

    await expect(dispatcher.tick()).resolves.toMatchObject({ claimed: 1, released: 1 });
    await expect(dispatcher.tick()).resolves.toMatchObject({ claimed: 0 });

    currentTime += 2_000;
    await expect(dispatcher.tick()).resolves.toMatchObject({ claimed: 1, dispatched: 1 });
    expect(enqueueAttempts).toBe(2);
    await expect(attempts.get(attemptId)).resolves.toMatchObject({ runState: "queued" });
  });

  it("allows an enqueue to be delivered again when marking it dispatched loses the fence", async () => {
    const repository = createInMemoryDocumentCompilationAttemptRepository();
    await startAttempt(repository);
    const queue = createInlineJobQueueAdapter({ maxBatchSize: 10, maxQueuedJobs: 10 });
    let currentTime = startedAt;
    let enqueueCalls = 0;
    let loseFirstMark = true;
    const dispatcher = createDocumentCompilationOutboxDispatcher({
      attempts: {
        claimOutbox: (input) => repository.claimOutbox(input),
        markOutboxDispatched: (input) => {
          if (loseFirstMark) {
            loseFirstMark = false;
            return Promise.resolve(null);
          }
          return repository.markOutboxDispatched(input);
        },
        releaseOutbox: (input) => repository.releaseOutbox(input),
      },
      generateLockToken: () => lockToken,
      intervalMs: 60_000,
      jobs: {
        enqueue: async (input) => {
          enqueueCalls += 1;
          return queue.enqueue(input);
        },
      },
      lockMs: 5_000,
      maxBatchSize: 10,
      now: () => currentTime,
      workerId: "dispatcher-1",
    });

    await expect(dispatcher.tick()).resolves.toMatchObject({ unconfirmed: 1 });
    await expect(repository.get(attemptId)).resolves.toMatchObject({
      runState: "dispatch_pending",
    });

    currentTime += 5_001;
    await expect(dispatcher.tick()).resolves.toMatchObject({ dispatched: 1 });
    expect(enqueueCalls).toBe(2);
    // The persistent idempotency key collapses both enqueue calls to one active broker job.
    await expect(queue.stats()).resolves.toMatchObject({ queued: 1 });
    await expect(repository.get(attemptId)).resolves.toMatchObject({
      queueJobId: "job-1",
      runState: "queued",
    });
  });

  it("dead-letters an outbox event after its configured delivery budget", async () => {
    const attempts = createInMemoryDocumentCompilationAttemptRepository();
    await startAttempt(attempts);
    const dispatcher = createDocumentCompilationOutboxDispatcher({
      attempts,
      generateLockToken: () => lockToken,
      intervalMs: 60_000,
      jobs: {
        enqueue: async () => {
          throw new Error("permanent broker rejection");
        },
      },
      lockMs: 5_000,
      maxBatchSize: 10,
      maxDispatchAttempts: 1,
      now: () => startedAt,
      workerId: "dispatcher-1",
    });

    await expect(dispatcher.tick()).resolves.toMatchObject({ deadLettered: 1 });
    await expect(attempts.get(attemptId)).resolves.toMatchObject({
      lastErrorCode: "OUTBOX_DEAD",
      runState: "failed",
    });
  });

  it("re-publishes a leased event only after both delivery visibility and execution lease expire", async () => {
    const attempts = createInMemoryDocumentCompilationAttemptRepository();
    await startAttempt(attempts);
    let currentTime = startedAt;
    const queue = createInlineJobQueueAdapter({
      maxBatchSize: 10,
      maxLeaseMs: 60_000,
      maxQueuedJobs: 10,
      now: () => currentTime,
    });
    let enqueueCalls = 0;
    const dispatcher = createDocumentCompilationOutboxDispatcher({
      attempts,
      generateLockToken: () => lockToken,
      intervalMs: 60_000,
      jobs: {
        enqueue: async (input) => {
          enqueueCalls += 1;
          return queue.enqueue(input);
        },
      },
      lockMs: 1_000,
      maxBatchSize: 10,
      now: () => currentTime,
      visibilityMs: 4_000,
      workerId: "dispatcher-1",
    });

    await expect(dispatcher.tick()).resolves.toMatchObject({ dispatched: 1 });
    const [job] = await queue.lease({
      leaseMs: 4_000,
      limit: 1,
      now: currentTime,
      types: ["document.compile"],
      workerId: "runtime-1",
    });
    const queuedAttempt = await attempts.get(attemptId);
    expect(job).toBeDefined();
    expect(queuedAttempt).not.toBeNull();
    const claimed = await attempts.claim({
      attemptId,
      expectedRowVersion: queuedAttempt?.rowVersion ?? -1,
      leaseExpiresAt: new Date(currentTime + 4_000).toISOString(),
      leaseToken,
      now: new Date(currentTime).toISOString(),
      queueJobId: job?.id ?? "missing",
      workerId: "runtime-1",
    });
    expect(claimed).not.toBeNull();

    currentTime += 3_999;
    await expect(dispatcher.tick()).resolves.toMatchObject({ claimed: 0 });
    currentTime += 2;
    await expect(dispatcher.tick()).resolves.toMatchObject({ claimed: 1, dispatched: 1 });
    expect(enqueueCalls).toBe(2);
  });

  it("dispatches every claimed event concurrently within the bounded batch", async () => {
    const attempts = createInMemoryDocumentCompilationAttemptRepository();
    await startAttempt(attempts);
    await startAttempt(attempts, {
      assetId: secondAssetId,
      attemptId: secondAttemptId,
      generationId: secondGenerationId,
      outboxId: secondOutboxId,
    });
    const queue = createInlineJobQueueAdapter({ maxBatchSize: 10, maxQueuedJobs: 10 });
    let enqueueStarted = 0;
    let releaseEnqueues: (() => void) | undefined;
    const enqueueGate = new Promise<void>((resolve) => {
      releaseEnqueues = resolve;
    });
    let bothStarted: (() => void) | undefined;
    const bothStartedPromise = new Promise<void>((resolve) => {
      bothStarted = resolve;
    });
    const dispatcher = createDocumentCompilationOutboxDispatcher({
      attempts,
      generateLockToken: () => lockToken,
      intervalMs: 60_000,
      jobs: {
        enqueue: async (input) => {
          enqueueStarted += 1;
          if (enqueueStarted === 2) {
            bothStarted?.();
          }
          await enqueueGate;
          return queue.enqueue(input);
        },
      },
      lockMs: 5_000,
      maxBatchSize: 2,
      now: () => startedAt,
      workerId: "dispatcher-1",
    });

    const tick = dispatcher.tick();
    await bothStartedPromise;
    expect(enqueueStarted).toBe(2);
    releaseEnqueues?.();
    await expect(tick).resolves.toMatchObject({ claimed: 2, dispatched: 2 });
  });
});

async function startAttempt(
  attempts: ReturnType<typeof createInMemoryDocumentCompilationAttemptRepository>,
  overrides: {
    readonly assetId?: string;
    readonly attemptId?: string;
    readonly generationId?: string;
    readonly outboxId?: string;
  } = {},
): Promise<void> {
  await attempts.start({
    baseHeadRevision: 7,
    createdAt: new Date(startedAt).toISOString(),
    documentAssetId: overrides.assetId ?? assetId,
    documentVersion: 3,
    id: overrides.attemptId ?? attemptId,
    knowledgeSpaceId: spaceId,
    maxExecutionAttempts: 3,
    outboxId: overrides.outboxId ?? outboxId,
    publicationGenerationId: overrides.generationId ?? generationId,
    tenantId: "tenant-1",
  });
}
