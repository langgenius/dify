import { createInlineJobQueueAdapter } from "@knowledge/adapters";
import type { JobQueueAdapter } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  type DocumentCompilationAttemptRepository,
  createInMemoryDocumentCompilationAttemptRepository,
} from "./document-compilation-attempt-repository";
import {
  type DocumentCompilationExecutionContext,
  DocumentCompilationProcessingError,
  createDocumentCompilationRuntime,
} from "./document-compilation-runtime";

const attemptId = "018f0d60-7a49-7cc2-9c1b-5b36f18fa101";
const secondAttemptId = "018f0d60-7a49-7cc2-9c1b-5b36f18fa102";
const outboxId = "018f0d60-7a49-7cc2-9c1b-5b36f18fb101";
const secondOutboxId = "018f0d60-7a49-7cc2-9c1b-5b36f18fb102";
const spaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18fc101";
const assetId = "018f0d60-7a49-7cc2-9c1b-5b36f18fd101";
const secondAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18fd102";
const generationId = "018f0d60-7a49-7cc2-9c1b-5b36f18fe101";
const secondGenerationId = "018f0d60-7a49-7cc2-9c1b-5b36f18fe102";
const candidatePublicationId = "018f0d60-7a49-7cc2-9c1b-5b36f18fe103";
const candidateFingerprint = `projection-set-sha256:${"a".repeat(64)}`;
const lockToken = "018f0d60-7a49-7cc2-9c1b-5b36f18ff101";
const leaseToken = "018f0d60-7a49-7cc2-9c1b-5b36f18ff102";
const secondLeaseToken = "018f0d60-7a49-7cc2-9c1b-5b36f18ff103";
const embeddingProfileRevisionId = "018f0d60-7a49-7cc2-9c1b-5b36f18ff104";
const retrievalProfileRevisionId = "018f0d60-7a49-7cc2-9c1b-5b36f18ff105";
const embeddingProfileDigest = "b".repeat(64);
const retrievalProfileDigest = "c".repeat(64);
const startedAt = Date.parse("2026-07-13T05:00:00.000Z");

describe("createDocumentCompilationRuntime", () => {
  it("leases only document.compile and restores every processing fact from the database", async () => {
    const currentTime = startedAt;
    const attempts = createInMemoryDocumentCompilationAttemptRepository();
    const queue = createQueue(() => currentTime);
    await queue.enqueue({ payload: { researchTaskId: "research-1" }, type: "research.execute" });
    await startAttempt(attempts);
    await dispatchPendingAttempts(attempts, queue, currentTime);
    let observedAttemptId: string | undefined;
    const runtime = createRuntime({
      attempts,
      maxBatchSize: 1,
      now: () => currentTime,
      processor: async (context) => {
        observedAttemptId = context.attempt.id;
        expect(context.attempt).toMatchObject({
          baseHeadRevision: 7,
          documentAssetId: assetId,
          documentVersion: 3,
          knowledgeSpaceId: spaceId,
          publicationGenerationId: generationId,
          tenantId: "tenant-1",
        });
        await advanceToSmokeEvaluation(context);
      },
      queue,
    });

    await expect(runtime.tick()).resolves.toMatchObject({ leased: 1, succeeded: 1 });
    expect(observedAttemptId).toBe(attemptId);
    await expect(queue.status("job-1")).resolves.toMatchObject({ status: "queued" });
    await expect(queue.status("job-2")).resolves.toMatchObject({ status: "completed" });
    await expect(attempts.get(attemptId)).resolves.toMatchObject({
      checkpoint: "published",
      executionAttempts: 1,
      runState: "succeeded",
    });
  });

  it("refreshes the execution snapshot after fenced initial profile binding", async () => {
    const currentTime = startedAt;
    const attempts = createInMemoryDocumentCompilationAttemptRepository();
    const queue = createQueue(() => currentTime);
    await startAttempt(attempts);
    await dispatchPendingAttempts(attempts, queue, currentTime);
    const runtime = createRuntime({
      attempts,
      now: () => currentTime,
      processor: async (context) => {
        expect(context.attempt).not.toHaveProperty("embeddingProfile");
        expect(context.attempt).not.toHaveProperty("retrievalProfile");
        const initialRowVersion = context.attempt.rowVersion;
        const bound = await context.bindInitialProfiles({
          embeddingProfile: {
            kind: "embedding",
            revision: 1,
            revisionId: embeddingProfileRevisionId,
            snapshotDigest: embeddingProfileDigest,
          },
          retrievalProfile: {
            kind: "retrieval",
            revision: 2,
            revisionId: retrievalProfileRevisionId,
            snapshotDigest: retrievalProfileDigest,
          },
        });

        expect(bound).toMatchObject({
          embeddingProfile: {
            kind: "embedding",
            revision: 1,
            revisionId: embeddingProfileRevisionId,
            snapshotDigest: embeddingProfileDigest,
          },
          retrievalProfile: {
            kind: "retrieval",
            revision: 2,
            revisionId: retrievalProfileRevisionId,
            snapshotDigest: retrievalProfileDigest,
          },
          rowVersion: initialRowVersion + 1,
        });
        expect(context.attempt).toEqual(bound);
        await advanceToSmokeEvaluation(context);
      },
      queue,
    });

    await expect(runtime.tick()).resolves.toMatchObject({ succeeded: 1 });
    await expect(attempts.get(attemptId)).resolves.toMatchObject({
      embeddingProfile: { revisionId: embeddingProfileRevisionId },
      retrievalProfile: { revisionId: retrievalProfileRevisionId },
      runState: "succeeded",
    });
  });

  it("uses queueJobId as the primary fence when a restarted adapter omits externalJobId", async () => {
    const currentTime = startedAt;
    const attempts = createInMemoryDocumentCompilationAttemptRepository();
    const queue = createQueue(() => currentTime);
    await startAttempt(attempts);
    const [event] = await attempts.claimOutbox({
      limit: 1,
      lockedUntil: new Date(currentTime + 5_000).toISOString(),
      lockToken,
      now: new Date(currentTime).toISOString(),
      workerId: "dispatcher-1",
    });
    expect(event).toBeDefined();
    const job = await queue.enqueue({
      idempotencyKey: event?.idempotencyKey ?? "missing-event",
      payload: { attemptId },
      type: "document.compile",
    });
    await attempts.markOutboxDispatched({
      availableAt: new Date(currentTime + 30_000).toISOString(),
      deliveredAt: new Date(currentTime).toISOString(),
      externalJobId: "external-job-that-the-restarted-adapter-cannot-recover",
      lockToken,
      now: new Date(currentTime).toISOString(),
      outboxId: event?.id ?? outboxId,
      queueJobId: job.id,
    });
    expect(job.externalJobId).toBeUndefined();
    const runtime = createRuntime({
      attempts,
      now: () => currentTime,
      processor: async (context) => advanceToSmokeEvaluation(context),
      queue,
    });

    await expect(runtime.tick()).resolves.toMatchObject({ deferred: 0, succeeded: 1 });
  });

  it("persists retry_wait before ack and lets the outbox own exponential-backoff redelivery", async () => {
    let currentTime = startedAt;
    const attempts = createInMemoryDocumentCompilationAttemptRepository();
    const queue = createQueue(() => currentTime);
    await startAttempt(attempts);
    await dispatchPendingAttempts(attempts, queue, currentTime);
    let processingCalls = 0;
    const runtime = createRuntime({
      attempts,
      initialRetryDelayMs: 2_000,
      now: () => currentTime,
      processor: async (context) => {
        processingCalls += 1;
        if (processingCalls === 1) {
          throw new DocumentCompilationProcessingError("embedding provider unavailable", {
            code: "EMBEDDING_UNAVAILABLE",
            retryable: true,
          });
        }
        await advanceToSmokeEvaluation(context);
      },
      queue,
    });

    await expect(runtime.tick()).resolves.toMatchObject({ retryScheduled: 1 });
    await expect(attempts.get(attemptId)).resolves.toMatchObject({
      lastErrorCode: "EMBEDDING_UNAVAILABLE",
      retryAt: new Date(startedAt + 2_000).toISOString(),
      runState: "retry_wait",
    });
    await expect(queue.status("job-1")).resolves.toMatchObject({ status: "completed" });
    expect(await dispatchPendingAttempts(attempts, queue, currentTime)).toBe(0);

    currentTime += 2_000;
    expect(await dispatchPendingAttempts(attempts, queue, currentTime)).toBe(1);
    await expect(runtime.tick()).resolves.toMatchObject({ succeeded: 1 });
    expect(processingCalls).toBe(2);
    await expect(attempts.get(attemptId)).resolves.toMatchObject({
      executionAttempts: 2,
      runState: "succeeded",
    });
  });

  it("treats unknown failures as terminal, truncates diagnostics, and only acks redelivery", async () => {
    const currentTime = startedAt;
    const attempts = createInMemoryDocumentCompilationAttemptRepository();
    const queue = createQueue(() => currentTime);
    await startAttempt(attempts);
    await dispatchPendingAttempts(attempts, queue, currentTime);
    let processingCalls = 0;
    const statesAtQueueAck: Array<string | undefined> = [];
    const runtimeQueue: JobQueueAdapter = {
      ...queue,
      complete: async (jobId) => {
        statesAtQueueAck.push((await attempts.get(attemptId))?.runState);
        return queue.complete(jobId);
      },
    };
    const runtime = createRuntime({
      attempts,
      now: () => currentTime,
      processor: async () => {
        processingCalls += 1;
        throw new Error("x".repeat(5_000));
      },
      queue: runtimeQueue,
    });

    await expect(runtime.tick()).resolves.toMatchObject({ failed: 1 });
    const failed = await attempts.get(attemptId);
    expect(failed).toMatchObject({
      lastErrorCode: "DOCUMENT_COMPILATION_FAILED",
      runState: "failed",
    });
    expect(failed?.lastErrorMessage).toHaveLength(4_096);
    expect(statesAtQueueAck).toEqual(["failed"]);

    await queue.enqueue({
      idempotencyKey: "duplicate-terminal-delivery",
      payload: { attemptId },
      type: "document.compile",
    });
    await expect(runtime.tick()).resolves.toMatchObject({ acknowledgedTerminal: 1 });
    expect(processingCalls).toBe(1);
    expect(statesAtQueueAck).toEqual(["failed", "failed"]);
  });

  it("turns invalid checkpoint transitions into terminal processor failures", async () => {
    const currentTime = startedAt;
    const attempts = createInMemoryDocumentCompilationAttemptRepository();
    const queue = createQueue(() => currentTime);
    await startAttempt(attempts);
    await dispatchPendingAttempts(attempts, queue, currentTime);
    const runtime = createRuntime({
      attempts,
      now: () => currentTime,
      processor: async (context) => {
        await context.advance({ checkpoint: "projection_built" });
      },
      queue,
    });

    await expect(runtime.tick()).resolves.toMatchObject({ deferred: 0, failed: 1 });
    await expect(attempts.get(attemptId)).resolves.toMatchObject({
      lastErrorCode: "DOCUMENT_COMPILATION_FAILED",
      runState: "failed",
    });
  });

  it("keeps generation-scoped processing fail closed through an explicit processor policy", async () => {
    const currentTime = startedAt;
    const attempts = createInMemoryDocumentCompilationAttemptRepository();
    const queue = createQueue(() => currentTime);
    await startAttempt(attempts);
    await dispatchPendingAttempts(attempts, queue, currentTime);
    const runtime = createRuntime({
      attempts,
      now: () => currentTime,
      processor: async ({ attempt }) => {
        expect(attempt.publicationGenerationId).toBe(generationId);
        throw new DocumentCompilationProcessingError(
          "Generation-scoped document compilation requires a publication coordinator",
          { code: "GENERATION_COORDINATOR_REQUIRED", retryable: false },
        );
      },
      queue,
    });

    await expect(runtime.tick()).resolves.toMatchObject({ failed: 1, retryScheduled: 0 });
    await expect(attempts.get(attemptId)).resolves.toMatchObject({
      lastErrorCode: "GENERATION_COORDINATOR_REQUIRED",
      runState: "failed",
    });
  });

  it("rejects envelopes that contain scope fields in addition to attemptId", async () => {
    const currentTime = startedAt;
    const attempts = createInMemoryDocumentCompilationAttemptRepository();
    const queue = createQueue(() => currentTime);
    await queue.enqueue({
      payload: { attemptId, tenantId: "forged-tenant" },
      type: "document.compile",
    });
    let processingCalls = 0;
    const runtime = createRuntime({
      attempts,
      now: () => currentTime,
      processor: async () => {
        processingCalls += 1;
      },
      queue,
    });

    await expect(runtime.tick()).resolves.toMatchObject({ rejected: 1 });
    expect(processingCalls).toBe(0);
    await expect(queue.status("job-1")).resolves.toMatchObject({ status: "failed" });
  });

  it("acks a stale queue identity without claiming or processing the durable attempt", async () => {
    const currentTime = startedAt;
    const attempts = createInMemoryDocumentCompilationAttemptRepository();
    const queue = createQueue(() => currentTime);
    await startAttempt(attempts);
    await dispatchPendingAttempts(attempts, queue, currentTime);
    // Simulate a broker losing the current delivery while the database still points at job-1.
    await queue.complete("job-1");
    await queue.enqueue({
      idempotencyKey: "forged-stale-delivery",
      payload: { attemptId },
      type: "document.compile",
    });
    let processingCalls = 0;
    const runtime = createRuntime({
      attempts,
      now: () => currentTime,
      processor: async () => {
        processingCalls += 1;
      },
      queue,
    });

    await expect(runtime.tick()).resolves.toMatchObject({ acknowledgedStale: 1 });
    expect(processingCalls).toBe(0);
    await expect(attempts.get(attemptId)).resolves.toMatchObject({
      queueJobId: "job-1",
      runState: "queued",
    });
    await expect(queue.status("job-2")).resolves.toMatchObject({ status: "completed" });
  });

  it("queues heartbeats behind a lease-snapshot exclusive operation", async () => {
    const currentTime = startedAt;
    const repository = createInMemoryDocumentCompilationAttemptRepository();
    const queue = createQueue(() => currentTime);
    await startAttempt(repository);
    await dispatchPendingAttempts(repository, queue, currentTime);
    let heartbeatCalls = 0;
    const attempts: DocumentCompilationAttemptRepository = {
      ...repository,
      heartbeat: async (input) => {
        heartbeatCalls += 1;
        return repository.heartbeat(input);
      },
    };
    const runtime = createRuntime({
      attempts,
      now: () => currentTime,
      processor: async (context) => {
        let queuedHeartbeat:
          | ReturnType<DocumentCompilationExecutionContext["heartbeat"]>
          | undefined;
        const snapshotRowVersion = await context.withLeaseSnapshot(async (snapshot) => {
          queuedHeartbeat = context.heartbeat();
          await Promise.resolve();
          expect(heartbeatCalls).toBe(0);
          await expect(repository.get(attemptId)).resolves.toMatchObject({
            rowVersion: snapshot.rowVersion,
          });
          return snapshot.rowVersion;
        });
        if (!queuedHeartbeat) {
          throw new Error("Exclusive operation did not queue its heartbeat");
        }
        await queuedHeartbeat;
        expect(heartbeatCalls).toBe(1);
        expect(context.attempt.rowVersion).toBe(snapshotRowVersion + 1);
        await advanceToSmokeEvaluation(context);
      },
      queue,
    });

    await expect(runtime.tick()).resolves.toMatchObject({ succeeded: 1 });
  });

  it("stops fenced mutations and defers the broker delivery when a database heartbeat loses", async () => {
    const currentTime = startedAt;
    const repository = createInMemoryDocumentCompilationAttemptRepository();
    const queue = createQueue(() => currentTime);
    await startAttempt(repository);
    await dispatchPendingAttempts(repository, queue, currentTime);
    const attempts: DocumentCompilationAttemptRepository = {
      ...repository,
      heartbeat: async () => null,
    };
    const runtime = createRuntime({
      attempts,
      now: () => currentTime,
      processor: async (context) => {
        await context.heartbeat();
      },
      queue,
    });

    await expect(runtime.tick()).resolves.toMatchObject({ deferred: 1 });
    await expect(repository.get(attemptId)).resolves.toMatchObject({ runState: "running" });
    await expect(queue.status("job-1")).resolves.toMatchObject({
      runAfter: startedAt + 10_000,
      status: "queued",
    });
  });

  it("records completion errors without acknowledging work whose DB transition did not commit", async () => {
    const currentTime = startedAt;
    const repository = createInMemoryDocumentCompilationAttemptRepository();
    const queue = createQueue(() => currentTime);
    await startAttempt(repository);
    await dispatchPendingAttempts(repository, queue, currentTime);
    const observedErrors: unknown[] = [];
    const attempts: DocumentCompilationAttemptRepository = {
      ...repository,
      complete: async () => {
        throw new Error("database commit unavailable");
      },
    };
    const runtime = createRuntime({
      attempts,
      now: () => currentTime,
      onError: ({ error }) => observedErrors.push(error),
      processor: async (context) => advanceToSmokeEvaluation(context),
      queue,
    });

    await expect(runtime.tick()).resolves.toMatchObject({ succeeded: 0 });
    expect(observedErrors).toHaveLength(1);
    await expect(repository.get(attemptId)).resolves.toMatchObject({ runState: "running" });
    await expect(queue.status("job-1")).resolves.toMatchObject({ status: "running" });
  });

  it("starts all jobs in a leased batch concurrently so every execution can heartbeat", async () => {
    const currentTime = startedAt;
    const attempts = createInMemoryDocumentCompilationAttemptRepository();
    const queue = createQueue(() => currentTime);
    await startAttempt(attempts);
    await startAttempt(attempts, {
      assetId: secondAssetId,
      attemptId: secondAttemptId,
      generationId: secondGenerationId,
      outboxId: secondOutboxId,
    });
    await dispatchPendingAttempts(attempts, queue, currentTime);
    let started = 0;
    let releaseProcessors: (() => void) | undefined;
    const processorGate = new Promise<void>((resolve) => {
      releaseProcessors = resolve;
    });
    let bothStarted: (() => void) | undefined;
    const bothStartedPromise = new Promise<void>((resolve) => {
      bothStarted = resolve;
    });
    const tokens = [leaseToken, secondLeaseToken];
    const runtime = createRuntime({
      attempts,
      generateLeaseToken: () => tokens.shift() ?? leaseToken,
      maxBatchSize: 2,
      now: () => currentTime,
      processor: async (context) => {
        started += 1;
        if (started === 2) {
          bothStarted?.();
        }
        await processorGate;
        await advanceToSmokeEvaluation(context);
      },
      queue,
    });

    const tick = runtime.tick();
    await bothStartedPromise;
    expect(started).toBe(2);
    releaseProcessors?.();
    await expect(tick).resolves.toMatchObject({ leased: 2, succeeded: 2 });
  });

  it("terminalizes a crashed final execution after its durable lease expires", async () => {
    let currentTime = startedAt;
    const attempts = createInMemoryDocumentCompilationAttemptRepository();
    const queue = createQueue(() => currentTime);
    await startAttempt(attempts, { maxExecutionAttempts: 1 });
    await dispatchPendingAttempts(attempts, queue, currentTime);
    const [crashedJob] = await queue.lease({
      leaseMs: 1_000,
      limit: 1,
      now: currentTime,
      types: ["document.compile"],
      workerId: "crashed-runtime",
    });
    const queued = await attempts.get(attemptId);
    const crashedClaim = await attempts.claim({
      attemptId,
      expectedRowVersion: queued?.rowVersion ?? -1,
      leaseExpiresAt: new Date(currentTime + 1_000).toISOString(),
      leaseToken,
      now: new Date(currentTime).toISOString(),
      queueJobId: crashedJob?.id ?? "missing",
      workerId: "crashed-runtime",
    });
    expect(crashedClaim).not.toBeNull();
    currentTime += 1_001;
    let processingCalls = 0;
    const runtime = createRuntime({
      attempts,
      now: () => currentTime,
      processor: async () => {
        processingCalls += 1;
      },
      queue,
    });

    await expect(runtime.tick()).resolves.toMatchObject({ failed: 1 });
    expect(processingCalls).toBe(0);
    await expect(attempts.get(attemptId)).resolves.toMatchObject({
      lastErrorCode: "EXECUTION_ATTEMPTS_EXHAUSTED",
      runState: "failed",
    });
  });
});

function createQueue(now: () => number): JobQueueAdapter {
  return createInlineJobQueueAdapter({
    maxBatchSize: 10,
    maxLeaseMs: 60_000,
    maxQueuedJobs: 20,
    now,
  });
}

function createRuntime({
  attempts,
  generateLeaseToken = () => leaseToken,
  initialRetryDelayMs,
  maxBatchSize = 10,
  now,
  onError,
  processor,
  queue,
}: {
  readonly attempts: DocumentCompilationAttemptRepository;
  readonly generateLeaseToken?: () => string;
  readonly initialRetryDelayMs?: number | undefined;
  readonly maxBatchSize?: number | undefined;
  readonly now: () => number;
  readonly onError?: Parameters<typeof createDocumentCompilationRuntime>[0]["onError"];
  readonly processor: Parameters<typeof createDocumentCompilationRuntime>[0]["processor"];
  readonly queue: JobQueueAdapter;
}) {
  return createDocumentCompilationRuntime({
    attempts,
    generateLeaseToken,
    heartbeatIntervalMs: 5_000,
    ...(initialRetryDelayMs ? { initialRetryDelayMs } : {}),
    intervalMs: 60_000,
    jobs: queue,
    leaseMs: 10_000,
    maxBatchSize,
    now,
    ...(onError ? { onError } : {}),
    processor,
    workerId: "runtime-1",
  });
}

async function startAttempt(
  attempts: DocumentCompilationAttemptRepository,
  overrides: {
    readonly assetId?: string;
    readonly attemptId?: string;
    readonly generationId?: string;
    readonly maxExecutionAttempts?: number;
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
    maxExecutionAttempts: overrides.maxExecutionAttempts ?? 3,
    outboxId: overrides.outboxId ?? outboxId,
    publicationGenerationId: overrides.generationId ?? generationId,
    tenantId: "tenant-1",
  });
}

async function dispatchPendingAttempts(
  attempts: DocumentCompilationAttemptRepository,
  queue: JobQueueAdapter,
  now: number,
): Promise<number> {
  const events = await attempts.claimOutbox({
    limit: 10,
    lockedUntil: new Date(now + 5_000).toISOString(),
    lockToken,
    now: new Date(now).toISOString(),
    workerId: "dispatcher-1",
  });
  for (const event of events) {
    const job = await queue.enqueue({
      idempotencyKey: event.idempotencyKey,
      payload: { attemptId: event.attemptId },
      type: "document.compile",
    });
    const marked = await attempts.markOutboxDispatched({
      availableAt: new Date(now + 30_000).toISOString(),
      deliveredAt: new Date(now).toISOString(),
      lockToken,
      now: new Date(now).toISOString(),
      outboxId: event.id,
      queueJobId: job.id,
    });
    expect(marked).not.toBeNull();
  }
  return events.length;
}

async function advanceToSmokeEvaluation(
  context: DocumentCompilationExecutionContext,
): Promise<void> {
  const checkpoints = [
    "parsed",
    "outline_built",
    "nodes_generated",
    "projection_built",
    "smoke_eval_passed",
  ] as const;
  for (const checkpoint of checkpoints) {
    await context.advance(
      checkpoint === "projection_built"
        ? { candidateFingerprint, candidatePublicationId, checkpoint }
        : { checkpoint },
    );
  }
}
