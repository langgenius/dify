import type { DatabaseAdapter, DatabaseExecuteInput, DatabaseExecuteResult } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  createDatabaseDocumentCompilationAttemptRepository,
  createInMemoryDocumentCompilationAttemptRepository,
} from "./document-compilation-attempt-repository";

const tenantId = "tenant-1";
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const documentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01";
const attemptId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2e01";
const otherAttemptId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2e02";
const outboxId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2f01";
const otherOutboxId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2f02";
const generationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f3001";
const leaseToken = "018f0d60-7a49-7cc2-9c1b-5b36f18f3101";
const otherLeaseToken = "018f0d60-7a49-7cc2-9c1b-5b36f18f3102";
const lockToken = "018f0d60-7a49-7cc2-9c1b-5b36f18f3201";
const otherLockToken = "018f0d60-7a49-7cc2-9c1b-5b36f18f3202";
const createdAt = "2026-07-13T12:00:00.000Z";
const embeddingProfileRevisionId = "018f0d60-7a49-7cc2-9c1b-5b36f18f3303";
const retrievalProfileRevisionId = "018f0d60-7a49-7cc2-9c1b-5b36f18f3304";
const embeddingProfileDigest = "a".repeat(64);
const retrievalProfileDigest = "b".repeat(64);
const logicalDocumentId = "018f0d60-7a49-7cc2-9c1b-5b36f18f3501";

function activeKnowledgeSpaceRow() {
  return {
    deletion_job_id: null,
    id: knowledgeSpaceId,
    lifecycle_state: "active",
  };
}

function activeDocumentAssetRow() {
  return {
    id: documentAssetId,
    source_id: null,
  };
}

describe("in-memory document compilation attempt repository", () => {
  it("atomically creates one active attempt and an attempt-only outbox payload", async () => {
    const repository = createInMemoryDocumentCompilationAttemptRepository();
    const first = await repository.start(
      startInput({ publicationGenerationId: generationId.toUpperCase() }),
    );

    expect(first).toMatchObject({
      created: true,
      attempt: {
        activeSlot: 1,
        baseHeadRevision: 2,
        publicationGenerationId: generationId,
        rowVersion: 0,
        runState: "dispatch_pending",
      },
      outbox: {
        eventType: "document.compile",
        payload: { attemptId },
        schemaVersion: 1,
        status: "pending",
      },
    });
    expect(Object.keys(first.outbox.payload)).toEqual(["attemptId"]);

    const duplicate = await repository.start(
      startInput({
        id: otherAttemptId,
        outboxId: otherOutboxId,
        publicationGenerationId: "018f0d60-7a49-7cc2-9c1b-5b36f18f3999",
      }),
    );
    expect(duplicate.created).toBe(false);
    expect(duplicate.attempt.id).toBe(attemptId);
    expect(duplicate.outbox.id).toBe(outboxId);

    await expect(
      repository.start(
        startInput({
          documentVersion: 2,
          id: otherAttemptId,
          outboxId: otherOutboxId,
          publicationGenerationId: "00000000-0000-0000-0000-000000000000",
        }),
      ),
    ).rejects.toThrow("non-zero UUID");
    await expect(repository.get(otherAttemptId)).resolves.toBeNull();
  });

  it("fences delivery, lease, checkpoint and durable retry with row versions", async () => {
    const repository = createInMemoryDocumentCompilationAttemptRepository();
    await repository.start(startInput());
    const firstEvent = (
      await repository.claimOutbox({
        limit: 1,
        lockedUntil: "2026-07-13T12:01:00.000Z",
        lockToken,
        now: createdAt,
        workerId: "dispatcher-1",
      })
    )[0];
    expect(firstEvent?.status).toBe("dispatching");
    await expect(
      repository.markOutboxDispatched({
        availableAt: "2026-07-13T12:10:01.000Z",
        deliveredAt: "2026-07-13T12:00:01.000Z",
        externalJobId: "shadow-1",
        lockToken,
        now: "2026-07-13T12:00:01.000Z",
        outboxId,
        queueJobId: "queue-1",
      }),
    ).resolves.toMatchObject({ status: "dispatched" });

    const queued = await repository.get(attemptId);
    expect(queued).toMatchObject({ queueJobId: "queue-1", rowVersion: 1, runState: "queued" });
    await expect(
      repository.claim({
        attemptId,
        expectedRowVersion: 1,
        leaseExpiresAt: "2026-07-13T12:02:00.000Z",
        leaseToken,
        now: "2026-07-13T12:00:02.000Z",
        queueJobId: "forged-job",
        workerId: "worker-1",
      }),
    ).resolves.toBeNull();

    const running = await repository.claim({
      attemptId,
      expectedRowVersion: 1,
      leaseExpiresAt: "2026-07-13T12:02:00.000Z",
      leaseToken,
      now: "2026-07-13T12:00:02.000Z",
      queueJobId: "queue-1",
      workerId: "worker-1",
    });
    expect(running).toMatchObject({ executionAttempts: 1, rowVersion: 2, runState: "running" });
    await expect(
      repository.heartbeat({
        attemptId,
        expectedRowVersion: 2,
        leaseExpiresAt: "2026-07-13T12:03:00.000Z",
        leaseToken: otherLeaseToken,
        now: "2026-07-13T12:00:03.000Z",
        workerId: "worker-1",
      }),
    ).resolves.toBeNull();

    const retry = await repository.scheduleRetry({
      attemptId,
      errorCode: "UPSTREAM_TIMEOUT",
      errorMessage: "try again",
      expectedRowVersion: 2,
      leaseToken,
      now: "2026-07-13T12:00:04.000Z",
      retryAt: "2026-07-13T12:05:00.000Z",
    });
    expect(retry).toMatchObject({
      lastErrorCode: "UPSTREAM_TIMEOUT",
      rowVersion: 3,
      runState: "retry_wait",
    });
    expect(retry).not.toHaveProperty("leaseToken");
    expect(retry).not.toHaveProperty("queueJobId");

    await expect(
      repository.claimOutbox({
        limit: 1,
        lockedUntil: "2026-07-13T12:05:30.000Z",
        lockToken: otherLockToken,
        now: "2026-07-13T12:04:59.999Z",
        workerId: "dispatcher-2",
      }),
    ).resolves.toEqual([]);
    const retryEvent = (
      await repository.claimOutbox({
        limit: 1,
        lockedUntil: "2026-07-13T12:06:00.000Z",
        lockToken: otherLockToken,
        now: "2026-07-13T12:05:00.000Z",
        workerId: "dispatcher-2",
      })
    )[0];
    expect(retryEvent).toMatchObject({ status: "dispatching" });
    expect(retryEvent).not.toHaveProperty("deliveredAt");
    expect(retryEvent).not.toHaveProperty("queueJobId");
    await repository.markOutboxDispatched({
      availableAt: "2026-07-13T12:15:01.000Z",
      deliveredAt: "2026-07-13T12:05:01.000Z",
      lockToken: otherLockToken,
      now: "2026-07-13T12:05:01.000Z",
      outboxId,
      queueJobId: "queue-2",
    });
    const requeued = await repository.get(attemptId);
    expect(requeued).toMatchObject({ checkpoint: "queued", rowVersion: 4, runState: "queued" });
    expect(requeued).not.toHaveProperty("retryAt");

    await expect(
      repository.claim({
        attemptId,
        expectedRowVersion: 4,
        leaseExpiresAt: "2026-07-13T12:07:00.000Z",
        leaseToken: otherLeaseToken,
        now: "2026-07-13T12:05:02.000Z",
        queueJobId: "queue-1",
        workerId: "worker-2",
      }),
    ).resolves.toBeNull();
    await expect(
      repository.claim({
        attemptId,
        expectedRowVersion: 4,
        leaseExpiresAt: "2026-07-13T12:07:00.000Z",
        leaseToken: otherLeaseToken,
        now: "2026-07-13T12:05:02.000Z",
        queueJobId: "queue-2",
        workerId: "worker-2",
      }),
    ).resolves.toMatchObject({ executionAttempts: 2, rowVersion: 5, runState: "running" });
  });

  it("fenced-binds initial profiles exactly once on a leased uninitialized attempt", async () => {
    const repository = createInMemoryDocumentCompilationAttemptRepository();
    await repository.start(startInput());
    await dispatch(repository, lockToken, "queue-1");
    const running = await repository.claim({
      attemptId,
      expectedRowVersion: 1,
      leaseExpiresAt: "2026-07-13T12:02:00.000Z",
      leaseToken,
      now: "2026-07-13T12:00:02.000Z",
      queueJobId: "queue-1",
      workerId: "worker-1",
    });
    expect(running).not.toHaveProperty("retrievalProfile");

    await expect(
      repository.bindInitialProfiles({
        attemptId,
        embeddingProfile: embeddingProfileReference(),
        expectedRowVersion: running?.rowVersion ?? -1,
        leaseToken: otherLeaseToken,
        now: "2026-07-13T12:00:03.000Z",
        retrievalProfile: retrievalProfileReference(),
      }),
    ).resolves.toBeNull();

    const bound = await repository.bindInitialProfiles({
      attemptId,
      embeddingProfile: embeddingProfileReference(),
      expectedRowVersion: running?.rowVersion ?? -1,
      leaseToken,
      now: "2026-07-13T12:00:03.000Z",
      retrievalProfile: retrievalProfileReference(),
    });
    expect(bound).toMatchObject({
      embeddingProfile: embeddingProfileReference(),
      retrievalProfile: retrievalProfileReference(),
      rowVersion: (running?.rowVersion ?? 0) + 1,
      runState: "running",
    });

    await expect(
      repository.bindInitialProfiles({
        attemptId,
        embeddingProfile: embeddingProfileReference(),
        expectedRowVersion: bound?.rowVersion ?? -1,
        leaseToken,
        now: "2026-07-13T12:00:04.000Z",
        retrievalProfile: retrievalProfileReference(),
      }),
    ).rejects.toThrow("can only be bound once");
  });

  it("redelivers stale dispatched and leased events without admitting an active lease", async () => {
    const repository = createInMemoryDocumentCompilationAttemptRepository();
    await repository.start(startInput());
    await dispatch(repository, lockToken, "queue-1");

    await expect(
      repository.claimOutbox({
        limit: 1,
        lockedUntil: "2026-07-13T12:10:30.000Z",
        lockToken: otherLockToken,
        now: "2026-07-13T12:09:59.999Z",
        workerId: "dispatcher-2",
      }),
    ).resolves.toEqual([]);
    const staleDispatched = await repository.claimOutbox({
      limit: 1,
      lockedUntil: "2026-07-13T12:11:00.000Z",
      lockToken: otherLockToken,
      now: "2026-07-13T12:10:01.000Z",
      workerId: "dispatcher-2",
    });
    expect(staleDispatched[0]).toMatchObject({ status: "dispatching" });
    await repository.markOutboxDispatched({
      availableAt: "2026-07-13T12:20:02.000Z",
      deliveredAt: "2026-07-13T12:10:02.000Z",
      lockToken: otherLockToken,
      now: "2026-07-13T12:10:02.000Z",
      outboxId,
      queueJobId: "queue-2",
    });

    const running = await repository.claim({
      attemptId,
      expectedRowVersion: 2,
      leaseExpiresAt: "2026-07-13T12:12:00.000Z",
      leaseToken,
      now: "2026-07-13T12:10:03.000Z",
      queueJobId: "queue-2",
      workerId: "worker-1",
    });
    expect(running).toMatchObject({ rowVersion: 3, runState: "running" });
    await expect(
      repository.claimOutbox({
        limit: 1,
        lockedUntil: "2026-07-13T12:12:30.000Z",
        lockToken,
        now: "2026-07-13T12:11:59.999Z",
        workerId: "dispatcher-3",
      }),
    ).resolves.toEqual([]);
    const staleLeased = await repository.claimOutbox({
      limit: 1,
      lockedUntil: "2026-07-13T12:13:00.000Z",
      lockToken,
      now: "2026-07-13T12:12:00.000Z",
      workerId: "dispatcher-3",
    });
    expect(staleLeased[0]).toMatchObject({ status: "dispatching" });
    await repository.markOutboxDispatched({
      availableAt: "2026-07-13T12:22:01.000Z",
      deliveredAt: "2026-07-13T12:12:01.000Z",
      lockToken,
      now: "2026-07-13T12:12:01.000Z",
      outboxId,
      queueJobId: "queue-3",
    });
    const expiredRunning = await repository.get(attemptId);
    expect(expiredRunning).toMatchObject({
      queueJobId: "queue-3",
      rowVersion: 4,
      runState: "running",
    });
    await expect(
      repository.claim({
        attemptId,
        expectedRowVersion: 4,
        leaseExpiresAt: "2026-07-13T12:14:00.000Z",
        leaseToken: otherLeaseToken,
        now: "2026-07-13T12:12:02.000Z",
        queueJobId: "queue-3",
        workerId: "worker-2",
      }),
    ).resolves.toMatchObject({ executionAttempts: 2, rowVersion: 5, runState: "running" });
  });

  it("keeps a candidate publication binding immutable", async () => {
    const repository = createInMemoryDocumentCompilationAttemptRepository();
    await repository.start(startInput());
    await dispatch(repository, lockToken, "queue-1");
    const running = await repository.claim({
      attemptId,
      expectedRowVersion: 1,
      leaseExpiresAt: "2026-07-13T12:05:00.000Z",
      leaseToken,
      now: "2026-07-13T12:00:02.000Z",
      queueJobId: "queue-1",
      workerId: "worker-1",
    });
    const candidatePublicationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f3301";
    const candidateFingerprint = `projection-set-sha256:${"a".repeat(64)}`;
    const advanced = await repository.advance({
      attemptId,
      candidateFingerprint,
      candidatePublicationId,
      checkpoint: "parsed",
      expectedRowVersion: running?.rowVersion ?? -1,
      leaseToken,
      now: "2026-07-13T12:00:03.000Z",
    });
    expect(advanced).toMatchObject({ candidateFingerprint, candidatePublicationId });
    await expect(
      repository.advance({
        attemptId,
        candidateFingerprint: `projection-set-sha256:${"b".repeat(64)}`,
        candidatePublicationId: "018f0d60-7a49-7cc2-9c1b-5b36f18f3302",
        checkpoint: "outline_built",
        expectedRowVersion: advanced?.rowVersion ?? -1,
        leaseToken,
        now: "2026-07-13T12:00:04.000Z",
      }),
    ).rejects.toThrow("candidate binding is immutable");
    await expect(repository.get(attemptId)).resolves.toMatchObject({
      candidateFingerprint,
      candidatePublicationId,
      checkpoint: "parsed",
      rowVersion: advanced?.rowVersion,
    });
  });

  it("refuses to enter projection_built without a complete candidate binding", async () => {
    const repository = createInMemoryDocumentCompilationAttemptRepository();
    await repository.start(startInput());
    await dispatch(repository, lockToken, "queue-1");
    let current = await repository.claim({
      attemptId,
      expectedRowVersion: 1,
      leaseExpiresAt: "2026-07-13T12:10:00.000Z",
      leaseToken,
      now: "2026-07-13T12:00:02.000Z",
      queueJobId: "queue-1",
      workerId: "worker-1",
    });
    for (const [index, checkpoint] of (
      ["parsed", "outline_built", "nodes_generated"] as const
    ).entries()) {
      current = await repository.advance({
        attemptId,
        checkpoint,
        expectedRowVersion: current?.rowVersion ?? -1,
        leaseToken,
        now: `2026-07-13T12:00:0${index + 3}.000Z`,
      });
    }

    await expect(
      repository.advance({
        attemptId,
        checkpoint: "projection_built",
        expectedRowVersion: current?.rowVersion ?? -1,
        leaseToken,
        now: "2026-07-13T12:00:06.000Z",
      }),
    ).rejects.toThrow("requires a bound candidate publication");
    await expect(repository.get(attemptId)).resolves.toMatchObject({
      checkpoint: "nodes_generated",
      rowVersion: current?.rowVersion,
    });
  });

  it("atomically terminalizes attempts and closes or resets their outbox", async () => {
    const repository = createInMemoryDocumentCompilationAttemptRepository();
    await repository.start(startInput());
    await dispatch(repository, lockToken, "queue-1");
    const running = await repository.claim({
      attemptId,
      expectedRowVersion: 1,
      leaseExpiresAt: "2026-07-13T12:02:00.000Z",
      leaseToken,
      now: "2026-07-13T12:00:02.000Z",
      queueJobId: "queue-1",
      workerId: "worker-1",
    });
    const failed = await repository.fail({
      attemptId,
      errorCode: "PARSER_FAILED",
      errorMessage: "bad document",
      expectedRowVersion: running?.rowVersion ?? -1,
      leaseToken,
      now: "2026-07-13T12:00:03.000Z",
    });
    expect(failed).toMatchObject({ runState: "failed" });
    expect(failed).not.toHaveProperty("activeSlot");
    await expect(
      repository.claimOutbox({
        limit: 1,
        lockedUntil: "2026-07-13T12:10:00.000Z",
        lockToken: otherLockToken,
        now: "2026-07-13T12:09:00.000Z",
        workerId: "dispatcher-2",
      }),
    ).resolves.toEqual([]);

    const retried = await repository.retryTerminal({
      attemptId,
      expectedRowVersion: failed?.rowVersion ?? -1,
      now: "2026-07-13T12:10:00.000Z",
    });
    expect(retried).toMatchObject({
      activeSlot: 1,
      executionAttempts: 0,
      runState: "dispatch_pending",
    });
    const resetEvent = await repository.claimOutbox({
      limit: 1,
      lockedUntil: "2026-07-13T12:11:00.000Z",
      lockToken: otherLockToken,
      now: "2026-07-13T12:10:00.000Z",
      workerId: "dispatcher-2",
    });
    expect(resetEvent[0]).toMatchObject({ dispatchAttempts: 1, status: "dispatching" });

    await expect(
      repository.cancel({
        attemptId,
        expectedRowVersion: (retried?.rowVersion ?? 0) + 1,
        now: "2026-07-13T12:10:00.500Z",
        permissionSnapshot: {
          accessChannel: "interactive",
          id: "018f0d60-7a49-7cc2-9c1b-5b36f18f34ff",
          revision: 2,
        },
        requestedBySubjectId: "current-editor",
      }),
    ).resolves.toBeNull();
    await expect(repository.get(attemptId)).resolves.not.toHaveProperty("permissionSnapshot");

    const canceled = await repository.cancel({
      attemptId,
      expectedRowVersion: retried?.rowVersion ?? -1,
      now: "2026-07-13T12:10:01.000Z",
      reason: "user canceled",
    });
    await expect(
      repository.retryTerminal({
        attemptId,
        expectedRowVersion: canceled?.rowVersion ?? -1,
        now: "2026-07-13T12:10:02.000Z",
      }),
    ).resolves.toBeNull();
    await expect(
      repository.markOutboxDispatched({
        availableAt: "2026-07-13T12:20:03.000Z",
        deliveredAt: "2026-07-13T12:10:03.000Z",
        lockToken: otherLockToken,
        now: "2026-07-13T12:10:03.000Z",
        outboxId,
        queueJobId: "queue-after-cancel",
      }),
    ).resolves.toBeNull();
  });

  it("CAS-fails exhausted active work and releases its active slot", async () => {
    const repository = createInMemoryDocumentCompilationAttemptRepository();
    await repository.start(startInput({ maxExecutionAttempts: 1 }));
    await dispatch(repository, lockToken, "queue-1");
    const running = await repository.claim({
      attemptId,
      expectedRowVersion: 1,
      leaseExpiresAt: "2026-07-13T12:01:00.000Z",
      leaseToken,
      now: "2026-07-13T12:00:02.000Z",
      queueJobId: "queue-1",
      workerId: "worker-1",
    });

    await expect(
      repository.failExhausted({
        attemptId,
        errorCode: "EXHAUSTED",
        errorMessage: "too many attempts",
        expectedRowVersion: running?.rowVersion ?? -1,
        now: "2026-07-13T12:00:59.999Z",
      }),
    ).resolves.toBeNull();
    const exhausted = await repository.failExhausted({
      attemptId,
      errorCode: "EXHAUSTED",
      errorMessage: "too many attempts",
      expectedRowVersion: running?.rowVersion ?? -1,
      now: "2026-07-13T12:01:00.000Z",
    });
    expect(exhausted).toMatchObject({ runState: "failed" });
    expect(exhausted).not.toHaveProperty("activeSlot");

    await expect(
      repository.start(startInput({ id: otherAttemptId, outboxId: otherOutboxId })),
    ).resolves.toMatchObject({ created: true, attempt: { id: otherAttemptId } });
    await expect(
      repository.retryTerminal({
        attemptId,
        expectedRowVersion: exhausted?.rowVersion ?? -1,
        now: "2026-07-13T12:02:00.000Z",
      }),
    ).resolves.toBeNull();
  });
});

describe("database document compilation attempt repository", () => {
  it("locks the tenant scope, snapshots the head, and inserts attempt plus outbox in one transaction", async () => {
    const fake = fakeDatabase((input) => {
      if (input.tableName === "knowledge_spaces") {
        return result([activeKnowledgeSpaceRow()], 0);
      }
      if (input.tableName === "deletion_jobs") return result([], 0);
      if (input.tableName === "document_assets") {
        return result([activeDocumentAssetRow()], 0);
      }
      if (input.tableName === "projection_set_publication_heads") {
        return result([{ head_revision: 2 }], 0);
      }
      if (input.tableName === "knowledge_space_profile_heads") {
        return result(activeProfileRows(), 0);
      }
      return result([], 1);
    });
    const repository = createDatabaseDocumentCompilationAttemptRepository({
      database: fake.database,
    });

    await expect(repository.start(startInput())).resolves.toMatchObject({
      created: true,
      attempt: {
        baseHeadRevision: 2,
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
        runState: "dispatch_pending",
      },
      outbox: { payload: { attemptId }, status: "pending" },
    });
    expect(fake.transactionCount()).toBe(1);
    expect(fake.calls.map((call) => call.tableName)).toEqual([
      "knowledge_spaces",
      "deletion_jobs",
      "document_assets",
      "document_compilation_attempts",
      "projection_set_publication_heads",
      "knowledge_space_profile_heads",
      "document_compilation_attempts",
      "document_compilation_outbox",
    ]);
    expect(fake.calls.every((call) => call.lane === "transaction")).toBe(true);
    expect(fake.calls[0]?.sql).toContain("FOR UPDATE");
    expect(fake.calls[6]?.sql).toContain("ON CONFLICT");
    expect(fake.calls[7]?.sql).toContain("::jsonb");
    expect(fake.calls[7]?.params).toContain(JSON.stringify({ attemptId }));
  });

  it("enqueues an uninitialized attempt when the knowledge space has no active profiles", async () => {
    const fake = fakeDatabase((input) => {
      if (input.tableName === "knowledge_spaces") return result([activeKnowledgeSpaceRow()], 0);
      if (input.tableName === "deletion_jobs") return result([], 0);
      if (input.tableName === "document_assets") return result([activeDocumentAssetRow()], 0);
      if (input.tableName === "projection_set_publication_heads") {
        return result([{ head_revision: 2 }], 0);
      }
      if (input.tableName === "knowledge_space_profile_heads") return result([], 0);
      return result([], input.operation === "select" ? 0 : 1);
    });
    const repository = createDatabaseDocumentCompilationAttemptRepository({
      database: fake.database,
    });

    const started = await repository.start(startInput());
    expect(started).toMatchObject({
      attempt: { checkpoint: "queued", runState: "dispatch_pending" },
      created: true,
    });
    expect(started.attempt).not.toHaveProperty("embeddingProfile");
    expect(started.attempt).not.toHaveProperty("retrievalProfile");
    expect(fake.calls.filter((call) => call.operation === "insert")).toHaveLength(2);
  });

  it("fenced-binds only the exact active profile tuple on a running attempt", async () => {
    const runningRow = attemptRow({
      execution_attempts: 1,
      heartbeat_at: "2026-07-13T12:00:02.000Z",
      lease_expires_at: "2026-07-13T12:02:00.000Z",
      lease_token: leaseToken,
      queue_job_id: "queue-1",
      row_version: 4,
      run_state: "running",
      started_at: "2026-07-13T12:00:02.000Z",
      worker_id: "worker-1",
    });
    const fake = fakeDatabase((input) => {
      if (input.tableName === "document_compilation_attempts" && input.operation === "select") {
        return result([runningRow], 0);
      }
      if (input.tableName === "knowledge_space_profile_heads") {
        return result(activeProfileRows(), 0);
      }
      return result([], input.operation === "select" ? 0 : 1);
    });
    const repository = createDatabaseDocumentCompilationAttemptRepository({
      database: fake.database,
    });

    await expect(
      repository.bindInitialProfiles({
        attemptId,
        embeddingProfile: embeddingProfileReference(),
        expectedRowVersion: 4,
        leaseToken: otherLeaseToken,
        now: "2026-07-13T12:00:03.000Z",
        retrievalProfile: retrievalProfileReference(),
      }),
    ).resolves.toBeNull();
    expect(fake.calls.map((call) => `${call.operation}:${call.tableName}`)).toEqual([
      "select:document_compilation_attempts",
    ]);

    fake.calls.length = 0;
    await expect(
      repository.bindInitialProfiles({
        attemptId,
        embeddingProfile: embeddingProfileReference(),
        expectedRowVersion: 4,
        leaseToken,
        now: "2026-07-13T12:00:03.000Z",
        retrievalProfile: {
          ...retrievalProfileReference(),
          snapshotDigest: "d".repeat(64),
        },
      }),
    ).rejects.toThrow("requested initial profiles are no longer active");
    expect(fake.calls.map((call) => `${call.operation}:${call.tableName}`)).toEqual([
      "select:document_compilation_attempts",
      "select:knowledge_space_profile_heads",
    ]);

    fake.calls.length = 0;
    await expect(
      repository.bindInitialProfiles({
        attemptId,
        embeddingProfile: embeddingProfileReference(),
        expectedRowVersion: 4,
        leaseToken,
        now: "2026-07-13T12:00:03.000Z",
        retrievalProfile: retrievalProfileReference(),
      }),
    ).resolves.toMatchObject({
      embeddingProfile: embeddingProfileReference(),
      retrievalProfile: retrievalProfileReference(),
      rowVersion: 5,
      runState: "running",
    });
    expect(fake.calls.map((call) => `${call.operation}:${call.tableName}`)).toEqual([
      "select:document_compilation_attempts",
      "select:knowledge_space_profile_heads",
      "update:document_compilation_attempts",
    ]);
    expect(fake.calls[1]?.sql).toContain("FOR UPDATE");
  });

  it.each(["deferred-dispatch", "public-cancel"] as const)(
    "locks space before attempt for %s control",
    async (operation) => {
      const freshSnapshotId = "018f0d60-7a49-7cc2-9c1b-5b36f18f3401";
      const fake = fakeDatabase((input) => {
        if (input.tableName === "document_compilation_attempts" && input.operation === "select") {
          return result([attemptRow()], 0);
        }
        if (input.tableName === "knowledge_spaces") {
          return result([activeKnowledgeSpaceRow()], 0);
        }
        if (input.tableName === "deletion_jobs") return result([], 0);
        if (input.tableName === "document_assets") {
          return result([activeDocumentAssetRow()], 0);
        }
        if (input.tableName === "logical_documents" && input.operation === "select") {
          return result([{ id: logicalDocumentId }], 0);
        }
        if (input.tableName === "knowledge_space_permission_snapshots") {
          return result([permissionSnapshotRow(freshSnapshotId)], 0);
        }
        if (
          [
            "knowledge_space_members",
            "knowledge_space_access_policies",
            "knowledge_space_api_access",
          ].includes(input.tableName)
        ) {
          return result([{ id: `${input.tableName}-row` }], 0);
        }
        if (input.tableName === "document_compilation_outbox" && input.operation === "select") {
          return result(
            [
              outboxRow({
                available_at:
                  operation === "deferred-dispatch" ? "9999-12-31T23:59:59.999Z" : createdAt,
                delivered_at: null,
                status: "pending",
              }),
            ],
            0,
          );
        }
        return result([], input.operation === "select" ? 0 : 1);
      });
      const repository = createDatabaseDocumentCompilationAttemptRepository({
        database: fake.database,
      });

      if (operation === "deferred-dispatch") {
        await expect(
          repository.releaseDeferredDispatch?.({
            attemptId,
            expectedRowVersion: 0,
            now: "2026-07-13T12:00:01.000Z",
          }),
        ).resolves.toMatchObject({ rowVersion: 1 });
      } else {
        await expect(
          repository.cancel({
            attemptId,
            expectedRowVersion: 0,
            now: "2026-07-13T12:00:01.000Z",
            permissionSnapshot: {
              accessChannel: "interactive",
              id: freshSnapshotId,
              revision: 7,
            },
            requestedBySubjectId: "current-editor",
          }),
        ).resolves.toMatchObject({ rowVersion: 1, runState: "canceled" });
      }

      const lockingTables = fake.calls
        .filter((call) => call.operation === "select" && call.sql.includes("FOR UPDATE"))
        .map((call) => call.tableName);
      expect(lockingTables.indexOf("knowledge_spaces")).toBeLessThan(
        lockingTables.indexOf("document_compilation_attempts"),
      );
    },
  );

  it("enqueues an unresolved attempt while lazy activation has only installed embedding", async () => {
    const fake = fakeDatabase((input) => {
      if (input.tableName === "knowledge_spaces") return result([activeKnowledgeSpaceRow()], 0);
      if (input.tableName === "deletion_jobs") return result([], 0);
      if (input.tableName === "document_assets") return result([activeDocumentAssetRow()], 0);
      if (input.tableName === "projection_set_publication_heads") {
        return result([{ head_revision: 2 }], 0);
      }
      if (input.tableName === "knowledge_space_profile_heads") {
        return result(
          activeProfileRows().filter((row) => row.profile_kind === "embedding"),
          0,
        );
      }
      return result([], input.operation === "select" ? 0 : 1);
    });
    const repository = createDatabaseDocumentCompilationAttemptRepository({
      database: fake.database,
    });

    await expect(repository.start(startInput())).resolves.toMatchObject({
      attempt: { checkpoint: "queued", runState: "dispatch_pending" },
      created: true,
    });
    expect(fake.calls.filter((call) => call.operation === "insert")).toHaveLength(2);
  });

  it("returns an existing active attempt before re-reading mutable publication/profile heads", async () => {
    const fake = fakeDatabase((input) => {
      if (input.tableName === "knowledge_spaces") return result([activeKnowledgeSpaceRow()], 0);
      if (input.tableName === "deletion_jobs") return result([], 0);
      if (input.tableName === "document_assets") return result([activeDocumentAssetRow()], 0);
      if (input.tableName === "document_compilation_attempts") {
        return result([attemptRow()], 0);
      }
      if (input.tableName === "document_compilation_outbox") {
        return result([outboxRow()], 0);
      }
      throw new Error(`mutable tuple should not be reread: ${input.tableName}`);
    });
    const repository = createDatabaseDocumentCompilationAttemptRepository({
      database: fake.database,
    });

    await expect(repository.start(startInput())).resolves.toMatchObject({
      attempt: { id: attemptId },
      created: false,
      outbox: { id: outboxId },
    });
    expect(fake.calls.map((call) => call.tableName)).toEqual([
      "knowledge_spaces",
      "deletion_jobs",
      "document_assets",
      "document_compilation_attempts",
      "document_compilation_outbox",
    ]);
  });

  it("fails closed on a stale base head before either durable insert", async () => {
    const fake = fakeDatabase((input) => {
      if (input.tableName === "knowledge_spaces") {
        return result([activeKnowledgeSpaceRow()], 0);
      }
      if (input.tableName === "deletion_jobs") return result([], 0);
      if (input.tableName === "document_assets") {
        return result([activeDocumentAssetRow()], 0);
      }
      if (input.tableName === "projection_set_publication_heads") {
        return result([{ head_revision: 3 }], 0);
      }
      if (input.tableName === "document_compilation_attempts" && input.operation === "select") {
        return result([], 0);
      }
      throw new Error("unexpected insert");
    });
    const repository = createDatabaseDocumentCompilationAttemptRepository({
      database: fake.database,
    });

    await expect(repository.start(startInput())).rejects.toEqual(
      expect.objectContaining({
        actualHeadRevision: 3,
        expectedHeadRevision: 2,
      }),
    );
    expect(fake.calls.every((call) => call.operation === "select")).toBe(true);
  });

  it("claims attempt and outbox together only for the persisted delivery identity", async () => {
    const fake = fakeDatabase((input) => {
      if (input.operation === "select" && input.tableName === "document_compilation_attempts") {
        return result([attemptRow({ queue_job_id: "queue-1", run_state: "queued" })], 0);
      }
      if (input.operation === "select" && input.tableName === "document_compilation_outbox") {
        return result([outboxRow({ queue_job_id: "queue-1", status: "dispatched" })], 0);
      }
      return result([], 1);
    });
    const repository = createDatabaseDocumentCompilationAttemptRepository({
      database: fake.database,
    });

    await expect(
      repository.claim({
        attemptId,
        expectedRowVersion: 0,
        leaseExpiresAt: "2026-07-13T12:02:00.000Z",
        leaseToken,
        now: "2026-07-13T12:00:02.000Z",
        queueJobId: "wrong-job",
        workerId: "worker-1",
      }),
    ).resolves.toBeNull();
    expect(fake.calls.filter((call) => call.operation === "update")).toHaveLength(0);

    fake.calls.length = 0;
    await expect(
      repository.claim({
        attemptId,
        expectedRowVersion: 0,
        leaseExpiresAt: "2026-07-13T12:02:00.000Z",
        leaseToken,
        now: "2026-07-13T12:00:02.000Z",
        queueJobId: "queue-1",
        workerId: "worker-1",
      }),
    ).resolves.toMatchObject({ rowVersion: 1, runState: "running" });
    expect(fake.calls.map((call) => `${call.operation}:${call.tableName}`)).toEqual([
      "select:document_compilation_attempts",
      "select:document_compilation_outbox",
      "update:document_compilation_attempts",
      "update:document_compilation_outbox",
    ]);
    expect(
      fake.calls.filter((call) => call.sql.includes("FOR UPDATE")).map((call) => call.tableName),
    ).toEqual(["document_compilation_attempts", "document_compilation_outbox"]);
    expect(fake.calls.every((call) => call.lane === "transaction")).toBe(true);
  });

  it("keeps dispatch confirmation on the consumer-compatible attempt-to-outbox lock order", async () => {
    const fake = fakeDatabase((input) => {
      if (input.operation === "select" && input.tableName === "document_compilation_attempts") {
        return result([attemptRow()], 0);
      }
      if (input.operation === "select" && input.tableName === "document_compilation_outbox") {
        return result(
          [
            outboxRow({
              delivered_at: null,
              locked_by: "dispatcher-1",
              locked_until: "2026-07-13T12:01:00.000Z",
              lock_token: lockToken,
              status: "dispatching",
            }),
          ],
          0,
        );
      }
      return result([], 1);
    });
    const repository = createDatabaseDocumentCompilationAttemptRepository({
      database: fake.database,
    });

    await expect(
      repository.markOutboxDispatched({
        availableAt: "2026-07-13T12:10:01.000Z",
        deliveredAt: "2026-07-13T12:00:01.000Z",
        lockToken,
        now: "2026-07-13T12:00:01.000Z",
        outboxId,
        queueJobId: "queue-1",
      }),
    ).resolves.toMatchObject({ queueJobId: "queue-1", status: "dispatched" });

    const selects = fake.calls.filter((call) => call.operation === "select");
    expect(selects.map((call) => call.tableName)).toEqual([
      "document_compilation_outbox",
      "document_compilation_attempts",
      "document_compilation_outbox",
    ]);
    expect(selects[0]?.sql).not.toContain("FOR UPDATE");
    expect(selects[1]?.sql).toContain("FOR UPDATE");
    expect(selects[2]?.sql).toContain("FOR UPDATE");
    expect(
      fake.calls.filter((call) => call.operation === "update").map((call) => call.tableName),
    ).toEqual(["document_compilation_attempts", "document_compilation_outbox"]);
  });

  it("revalidates dispatcher ownership after acquiring the ordered row locks", async () => {
    let outboxReads = 0;
    const fake = fakeDatabase((input) => {
      if (input.operation === "select" && input.tableName === "document_compilation_attempts") {
        return result([attemptRow()], 0);
      }
      if (input.operation === "select" && input.tableName === "document_compilation_outbox") {
        outboxReads += 1;
        return result(
          [
            outboxRow({
              delivered_at: null,
              locked_by: outboxReads === 1 ? "dispatcher-1" : "dispatcher-2",
              locked_until: "2026-07-13T12:01:00.000Z",
              lock_token: outboxReads === 1 ? lockToken : otherLockToken,
              status: "dispatching",
            }),
          ],
          0,
        );
      }
      return result([], 1);
    });
    const repository = createDatabaseDocumentCompilationAttemptRepository({
      database: fake.database,
    });

    await expect(
      repository.markOutboxDispatched({
        availableAt: "2026-07-13T12:10:01.000Z",
        deliveredAt: "2026-07-13T12:00:01.000Z",
        lockToken,
        now: "2026-07-13T12:00:01.000Z",
        outboxId,
        queueJobId: "queue-1",
      }),
    ).resolves.toBeNull();
    expect(fake.calls.filter((call) => call.operation === "update")).toHaveLength(0);
    expect(
      fake.calls.filter((call) => call.sql.includes("FOR UPDATE")).map((call) => call.tableName),
    ).toEqual(["document_compilation_attempts", "document_compilation_outbox"]);
  });

  it("orders dead-letter locks while keeping ordinary release outbox-only", async () => {
    const fake = fakeDatabase((input) => {
      if (input.operation === "select" && input.tableName === "document_compilation_attempts") {
        return result([attemptRow()], 0);
      }
      if (input.operation === "select" && input.tableName === "document_compilation_outbox") {
        return result(
          [
            outboxRow({
              delivered_at: null,
              locked_by: "dispatcher-1",
              locked_until: "2026-07-13T12:01:00.000Z",
              lock_token: lockToken,
              status: "dispatching",
            }),
          ],
          0,
        );
      }
      return result([], 1);
    });
    const repository = createDatabaseDocumentCompilationAttemptRepository({
      database: fake.database,
    });

    await expect(
      repository.releaseOutbox({
        availableAt: "2026-07-13T12:05:00.000Z",
        deadLetter: true,
        error: "queue unavailable",
        lockToken,
        now: "2026-07-13T12:00:01.000Z",
        outboxId,
      }),
    ).resolves.toMatchObject({ lastError: "queue unavailable", status: "dead" });
    expect(
      fake.calls.filter((call) => call.sql.includes("FOR UPDATE")).map((call) => call.tableName),
    ).toEqual(["document_compilation_attempts", "document_compilation_outbox"]);
    expect(
      fake.calls.filter((call) => call.operation === "update").map((call) => call.tableName),
    ).toEqual(["document_compilation_attempts", "document_compilation_outbox"]);

    fake.calls.length = 0;
    await expect(
      repository.releaseOutbox({
        availableAt: "2026-07-13T12:05:00.000Z",
        deadLetter: false,
        error: "retry later",
        lockToken,
        now: "2026-07-13T12:00:01.000Z",
        outboxId,
      }),
    ).resolves.toMatchObject({ lastError: "retry later", status: "pending" });
    expect(fake.calls.map((call) => `${call.operation}:${call.tableName}`)).toEqual([
      "select:document_compilation_outbox",
      "update:document_compilation_outbox",
    ]);
    expect(fake.calls[0]?.sql).toContain("FOR UPDATE");
    expect(fake.calls[1]?.sql).not.toContain('"attempt_id" =');
  });

  it("locks and validates the first candidate binding in the attempt tenant scope", async () => {
    const candidatePublicationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f3301";
    const candidateFingerprint = `projection-set-sha256:${"a".repeat(64)}`;
    const fake = fakeDatabase((input) => {
      if (input.operation === "select" && input.tableName === "document_compilation_attempts") {
        return result(
          [
            attemptRow({
              execution_attempts: 1,
              heartbeat_at: "2026-07-13T12:00:01.000Z",
              lease_expires_at: "2026-07-13T12:05:00.000Z",
              lease_token: leaseToken,
              queue_job_id: "queue-1",
              row_version: 1,
              run_state: "running",
              started_at: "2026-07-13T12:00:01.000Z",
              worker_id: "worker-1",
            }),
          ],
          0,
        );
      }
      if (input.tableName === "projection_set_publications") {
        return result([{ id: candidatePublicationId }], 0);
      }
      return result([], 1);
    });
    const repository = createDatabaseDocumentCompilationAttemptRepository({
      database: fake.database,
    });

    await expect(
      repository.advance({
        attemptId,
        candidateFingerprint,
        candidatePublicationId,
        checkpoint: "parsed",
        expectedRowVersion: 1,
        leaseToken,
        now: "2026-07-13T12:00:02.000Z",
      }),
    ).resolves.toMatchObject({ candidateFingerprint, candidatePublicationId, rowVersion: 2 });
    expect(fake.calls.map((call) => call.tableName)).toEqual([
      "document_compilation_attempts",
      "projection_set_publications",
      "document_compilation_attempts",
    ]);
    expect(fake.calls[1]?.params).toEqual([
      tenantId,
      knowledgeSpaceId,
      candidatePublicationId,
      candidateFingerprint,
      "candidate",
    ]);
    expect(fake.calls[1]?.sql).toContain("FOR UPDATE");
  });

  it.each(["postgres", "tidb"] as const)(
    "atomically rebinds a terminal retry to a fresh permission snapshot on %s",
    async (dialect) => {
      const freshSnapshotId = "018f0d60-7a49-7cc2-9c1b-5b36f18f3401";
      const fake = fakeDatabase((input) => {
        if (input.tableName === "document_compilation_attempts" && input.operation === "select") {
          if (input.params.length > 1) return result([], 0);
          return result(
            [
              attemptRow({
                active_slot: null,
                completed_at: "2026-07-13T12:05:00.000Z",
                last_error_code: "PARSER_FAILED",
                last_error_message: "bad document",
                row_version: 4,
                run_state: "failed",
              }),
            ],
            0,
          );
        }
        if (input.tableName === "knowledge_spaces") {
          return result([activeKnowledgeSpaceRow()], 0);
        }
        if (input.tableName === "deletion_jobs") return result([], 0);
        if (input.tableName === "document_assets") {
          return result([activeDocumentAssetRow()], 0);
        }
        if (input.tableName === "logical_documents" && input.operation === "select") {
          return input.sql.includes(" JOIN ")
            ? result([{ id: logicalDocumentId }], 0)
            : result([{ active_revision: null, row_version: 0 }], 0);
        }
        if (input.tableName === "knowledge_space_permission_snapshots") {
          return result([permissionSnapshotRow(freshSnapshotId)], 0);
        }
        if (
          [
            "knowledge_space_members",
            "knowledge_space_access_policies",
            "knowledge_space_api_access",
          ].includes(input.tableName)
        ) {
          return result([{ id: `${input.tableName}-row` }], 0);
        }
        if (input.tableName === "document_revisions" && input.operation === "select") {
          return result(
            [
              {
                compilation_attempt_id: attemptId,
                document_id: logicalDocumentId,
                expected_active_revision: null,
                expected_document_row_version: 0,
                knowledge_space_id: knowledgeSpaceId,
                revision: 1,
                state: "failed",
                tenant_id: tenantId,
              },
            ],
            0,
          );
        }
        if (
          input.operation === "select" &&
          ["document_reindex_attempts", "document_chunk_state_changes"].includes(input.tableName)
        ) {
          return result([], 0);
        }
        if (input.tableName === "document_compilation_outbox" && input.operation === "select") {
          return result([outboxRow({ status: "completed" })], 0);
        }
        return result([], 1);
      }, dialect);
      const repository = createDatabaseDocumentCompilationAttemptRepository({
        database: fake.database,
      });

      await expect(
        repository.retryTerminal({
          attemptId,
          expectedRowVersion: 4,
          now: "2026-07-13T12:06:00.000Z",
          permissionSnapshot: {
            accessChannel: "interactive",
            id: freshSnapshotId,
            revision: 7,
          },
          requestedBySubjectId: "current-editor",
        }),
      ).resolves.toMatchObject({
        permissionSnapshot: {
          accessChannel: "interactive",
          id: freshSnapshotId,
          revision: 7,
        },
        requestedBySubjectId: "current-editor",
        rowVersion: 5,
        runState: "dispatch_pending",
      });

      expect(fake.calls.every((call) => call.lane === "transaction")).toBe(true);
      const operations = fake.calls.map((call) => `${call.operation}:${call.tableName}`);
      const lockingTables = fake.calls
        .filter((call) => call.operation === "select" && call.sql.includes("FOR UPDATE"))
        .map((call) => call.tableName);
      expect(lockingTables.indexOf("knowledge_spaces")).toBeLessThan(
        lockingTables.indexOf("document_compilation_attempts"),
      );
      expect(operations).toContain("update:document_revisions");
      const logicalDocumentFence = fake.calls.find(
        (call) => call.tableName === "logical_documents" && call.sql.includes(" JOIN "),
      );
      expect(logicalDocumentFence?.sql).toContain(
        dialect === "postgres"
          ? 'revision."revision" = document."active_revision"'
          : "revision.`revision` = document.`active_revision`",
      );
      expect(logicalDocumentFence?.sql).toContain(
        dialect === "postgres" ? "revision.\"state\" = 'active'" : "revision.`state` = 'active'",
      );
      expect(operations.indexOf("update:document_revisions")).toBeLessThan(
        operations.indexOf("update:document_compilation_outbox"),
      );
      expect(operations.slice(-2)).toEqual([
        "update:document_compilation_outbox",
        "update:document_compilation_attempts",
      ]);
      const attemptUpdate = fake.calls.at(-1);
      expect(attemptUpdate?.params).toEqual(
        expect.arrayContaining(["current-editor", freshSnapshotId, 7, "interactive"]),
      );
    },
  );

  it.each(["settings", "chunk"] as const)(
    "restores the failed %s product candidate before retry outbox release",
    async (product) => {
      const fake = fakeDatabase((input) => {
        if (input.tableName === "document_compilation_attempts" && input.operation === "select") {
          if (input.params.length > 1) return result([], 0);
          return result(
            [
              attemptRow({
                active_slot: null,
                completed_at: "2026-07-13T12:05:00.000Z",
                row_version: 4,
                run_state: "failed",
              }),
            ],
            0,
          );
        }
        if (input.tableName === "knowledge_spaces") {
          return result([activeKnowledgeSpaceRow()], 0);
        }
        if (input.tableName === "deletion_jobs") return result([], 0);
        if (input.tableName === "document_assets") {
          return result([activeDocumentAssetRow()], 0);
        }
        if (input.tableName === "logical_documents" && input.operation === "select") {
          return input.sql.includes(" JOIN ")
            ? result([{ id: logicalDocumentId }], 0)
            : result([{ active_revision: 1, row_version: 1 }], 0);
        }
        if (input.tableName === "document_revisions" && input.operation === "select") {
          return result([], 0);
        }
        if (input.tableName === "document_reindex_attempts" && input.operation === "select") {
          return product === "settings"
            ? result(
                [
                  {
                    document_id: logicalDocumentId,
                    document_revision: 1,
                    expected_settings_head_revision: 1,
                    knowledge_space_id: knowledgeSpaceId,
                    settings_revision: 2,
                    state: "failed",
                    tenant_id: tenantId,
                  },
                ],
                0,
              )
            : result([], 0);
        }
        if (input.tableName === "document_chunk_state_changes" && input.operation === "select") {
          return product === "chunk"
            ? result(
                [
                  {
                    document_id: logicalDocumentId,
                    document_revision: 1,
                    knowledge_space_id: knowledgeSpaceId,
                    state: "failed",
                    tenant_id: tenantId,
                  },
                ],
                0,
              )
            : result([], 0);
        }
        if (input.tableName === "document_settings_heads" && input.operation === "select") {
          return result([{ active_revision: 1 }], 0);
        }
        if (input.tableName === "document_settings_revisions" && input.operation === "select") {
          return result([{ state: "failed" }], 0);
        }
        if (input.tableName === "document_compilation_outbox" && input.operation === "select") {
          return result([outboxRow({ status: "completed" })], 0);
        }
        return result([], input.operation === "select" ? 0 : 1);
      });
      const repository = createDatabaseDocumentCompilationAttemptRepository({
        database: fake.database,
      });

      await expect(
        repository.retryTerminal({
          attemptId,
          expectedRowVersion: 4,
          now: "2026-07-13T12:06:00.000Z",
        }),
      ).resolves.toMatchObject({ runState: "dispatch_pending" });
      const operations = fake.calls.map((call) => `${call.operation}:${call.tableName}`);
      const restoredOperation = `update:${
        product === "settings" ? "document_settings_revisions" : "document_chunk_state_changes"
      }`;
      expect(operations).toContain(restoredOperation);
      expect(operations.indexOf(restoredOperation)).toBeLessThan(
        operations.indexOf("update:document_compilation_outbox"),
      );
    },
  );

  it.each(["space", "asset", "logical-document"] as const)(
    "rejects terminal retry when the %s deletion fence is active",
    async (fence) => {
      const fake = fakeDatabase((input) => {
        if (input.tableName === "document_compilation_attempts" && input.operation === "select") {
          if (input.params.length > 1) return result([], 0);
          return result(
            [
              attemptRow({
                active_slot: null,
                completed_at: "2026-07-13T12:05:00.000Z",
                row_version: 4,
                run_state: "failed",
              }),
            ],
            0,
          );
        }
        if (input.tableName === "knowledge_spaces") {
          return result(
            [
              fence === "space"
                ? {
                    deletion_job_id: "018f0d60-7a49-7cc2-9c1b-5b36f18f35ff",
                    id: knowledgeSpaceId,
                    lifecycle_state: "deleting",
                  }
                : activeKnowledgeSpaceRow(),
            ],
            0,
          );
        }
        if (input.tableName === "deletion_jobs") return result([], 0);
        if (input.tableName === "document_assets") {
          return fence === "asset" ? result([], 0) : result([activeDocumentAssetRow()], 0);
        }
        if (input.tableName === "logical_documents") {
          return fence === "logical-document"
            ? result([], 0)
            : result([{ id: logicalDocumentId }], 0);
        }
        return result([], input.operation === "select" ? 0 : 1);
      });
      const repository = createDatabaseDocumentCompilationAttemptRepository({
        database: fake.database,
      });

      await expect(
        repository.retryTerminal({
          attemptId,
          expectedRowVersion: 4,
          now: "2026-07-13T12:06:00.000Z",
        }),
      ).rejects.toThrow();
      expect(fake.calls.some((call) => call.operation === "update")).toBe(false);
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "uses a supported %s row-lock strategy for dispatch and cleanup",
    async (dialect) => {
      const fake = fakeDatabase(() => result([], 0), dialect);
      const repository = createDatabaseDocumentCompilationAttemptRepository({
        database: fake.database,
      });

      await repository.claimOutbox({
        limit: 1,
        lockedUntil: "2026-07-13T12:01:00.000Z",
        lockToken,
        now: createdAt,
        workerId: "dispatcher-1",
      });
      await repository.deleteTerminalOlderThan({
        maxJobs: 1,
        olderThan: "2026-07-13T13:00:00.000Z",
        tenantId,
      });

      const lockQueries = fake.calls.filter((call) => call.sql.includes("FOR UPDATE"));
      expect(lockQueries).toHaveLength(2);
      if (dialect === "postgres") {
        expect(lockQueries.every((call) => call.sql.includes("SKIP LOCKED"))).toBe(true);
      } else {
        expect(lockQueries.every((call) => !call.sql.includes("SKIP LOCKED"))).toBe(true);
      }
    },
  );
});

function startInput(overrides: Record<string, unknown> = {}) {
  return {
    baseHeadRevision: 2,
    createdAt,
    documentAssetId,
    documentVersion: 1,
    id: attemptId,
    knowledgeSpaceId,
    maxExecutionAttempts: 3,
    outboxId,
    publicationGenerationId: generationId,
    tenantId,
    ...overrides,
  } as Parameters<
    ReturnType<typeof createInMemoryDocumentCompilationAttemptRepository>["start"]
  >[0];
}

async function dispatch(
  repository: ReturnType<typeof createInMemoryDocumentCompilationAttemptRepository>,
  token: string,
  queueJobId: string,
) {
  await repository.claimOutbox({
    limit: 1,
    lockedUntil: "2026-07-13T12:01:00.000Z",
    lockToken: token,
    now: createdAt,
    workerId: "dispatcher-1",
  });
  return repository.markOutboxDispatched({
    availableAt: "2026-07-13T12:10:01.000Z",
    deliveredAt: "2026-07-13T12:00:01.000Z",
    lockToken: token,
    now: "2026-07-13T12:00:01.000Z",
    outboxId,
    queueJobId,
  });
}

interface FakeDatabase {
  readonly calls: Array<DatabaseExecuteInput & { readonly lane: "outside" | "transaction" }>;
  readonly database: DatabaseAdapter;
  readonly transactionCount: () => number;
}

function fakeDatabase(
  respond: (input: DatabaseExecuteInput) => DatabaseExecuteResult,
  dialect: DatabaseAdapter["dialect"] = "postgres",
): FakeDatabase {
  const calls: FakeDatabase["calls"] = [];
  let transactions = 0;
  const execute = async (
    input: DatabaseExecuteInput,
    lane: "outside" | "transaction",
  ): Promise<DatabaseExecuteResult> => {
    calls.push({ ...input, lane });
    return respond(input);
  };
  const database = {
    dialect,
    execute: (input: DatabaseExecuteInput) => execute(input, "outside"),
    kind: dialect,
    transaction: async <T>(
      callback: (executor: {
        execute(input: DatabaseExecuteInput): Promise<DatabaseExecuteResult>;
      }) => Promise<T>,
    ) => {
      transactions += 1;
      return callback({ execute: (input) => execute(input, "transaction") });
    },
  } as unknown as DatabaseAdapter;
  return { calls, database, transactionCount: () => transactions };
}

function result(
  rows: readonly Record<string, unknown>[],
  rowsAffected: number,
): DatabaseExecuteResult {
  return { rows, rowsAffected };
}

function attemptRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    active_slot: 1,
    base_head_revision: 2,
    candidate_fingerprint: null,
    candidate_publication_id: null,
    checkpoint: "queued",
    completed_at: null,
    created_at: createdAt,
    document_asset_id: documentAssetId,
    document_version: 1,
    execution_attempts: 0,
    external_job_id: null,
    heartbeat_at: null,
    id: attemptId,
    knowledge_space_id: knowledgeSpaceId,
    last_error_code: null,
    last_error_message: null,
    lease_expires_at: null,
    lease_token: null,
    max_execution_attempts: 3,
    publication_generation_id: generationId,
    queue_job_id: null,
    retry_at: null,
    row_version: 0,
    run_state: "dispatch_pending",
    started_at: null,
    tenant_id: tenantId,
    updated_at: createdAt,
    worker_id: null,
    ...overrides,
  };
}

function outboxRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    attempt_id: attemptId,
    available_at: createdAt,
    created_at: createdAt,
    delivered_at: "2026-07-13T12:00:01.000Z",
    dispatch_attempts: 1,
    event_type: "document.compile",
    external_job_id: null,
    id: outboxId,
    idempotency_key: `document.compile:${attemptId}`,
    last_error: null,
    locked_by: null,
    locked_until: null,
    lock_token: null,
    payload: { attemptId },
    queue_job_id: null,
    schema_version: 1,
    status: "pending",
    updated_at: createdAt,
    ...overrides,
  };
}

function activeProfileRows(): readonly Record<string, unknown>[] {
  return [
    {
      profile_kind: "embedding",
      profile_revision: 1,
      profile_revision_id: embeddingProfileRevisionId,
      profile_snapshot_digest: embeddingProfileDigest,
    },
    {
      profile_kind: "retrieval",
      profile_revision: 2,
      profile_revision_id: retrievalProfileRevisionId,
      profile_snapshot_digest: retrievalProfileDigest,
    },
  ];
}

function embeddingProfileReference() {
  return {
    kind: "embedding" as const,
    revision: 1,
    revisionId: embeddingProfileRevisionId,
    snapshotDigest: embeddingProfileDigest,
  };
}

function retrievalProfileReference() {
  return {
    kind: "retrieval" as const,
    revision: 2,
    revisionId: retrievalProfileRevisionId,
    snapshotDigest: retrievalProfileDigest,
  };
}

function permissionSnapshotRow(id: string): Record<string, unknown> {
  return {
    access_channel: "interactive",
    access_policy_revision: 1,
    api_access_revision: 1,
    api_key_expires_at: null,
    api_key_id: null,
    api_key_revision: null,
    created_at: createdAt,
    expires_at: "2026-07-14T13:00:00.000Z",
    id,
    knowledge_space_id: knowledgeSpaceId,
    member_revision: 1,
    permission_scopes: [],
    revision: 7,
    revoked_at: null,
    role: "editor",
    status: "active",
    subject_id: "current-editor",
    tenant_id: tenantId,
    updated_at: createdAt,
    visibility: "all_members",
  };
}
