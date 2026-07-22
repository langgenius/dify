import type { DatabaseAdapter, DatabaseExecuteInput, DatabaseExecuteResult } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  DocumentCompilationAttemptCapacityExceededError,
  DocumentCompilationAttemptTransitionError,
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
const lockToken = "018f0d60-7a49-7cc2-9c1b-5b36f18f3201";
const otherLockToken = "018f0d60-7a49-7cc2-9c1b-5b36f18f3202";
const createdAt = "2026-07-13T12:00:00.000Z";

describe("in-memory document compilation repository completion behavior", () => {
  it("completes a generation-closed candidate and deletes its terminal ledger atomically", async () => {
    const repository = createInMemoryDocumentCompilationAttemptRepository();
    await repository.start(startInput());
    await dispatch(repository, lockToken, "queue-1");
    let current = await repository.claim({
      attemptId,
      expectedRowVersion: 1,
      leaseExpiresAt: "2026-07-13T12:20:00.000Z",
      leaseToken,
      now: "2026-07-13T12:00:02.000Z",
      queueJobId: "queue-1",
      workerId: "worker-1",
    });
    if (!current) throw new Error("Expected a running compilation attempt");

    const candidatePublicationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f3301";
    const candidateFingerprint = `projection-set-sha256:${"a".repeat(64)}`;
    for (const [index, checkpoint] of (
      [
        "parsed",
        "outline_built",
        "nodes_generated",
        "projection_built",
        "smoke_eval_passed",
      ] as const
    ).entries()) {
      current = await repository.advance({
        attemptId,
        ...(index === 0 ? { candidateFingerprint, candidatePublicationId } : {}),
        checkpoint,
        expectedRowVersion: current.rowVersion,
        leaseToken,
        now: `2026-07-13T12:00:0${index + 3}.000Z`,
      });
      if (!current) throw new Error(`Expected checkpoint ${checkpoint}`);
    }

    await expect(
      repository.complete({
        attemptId,
        expectedRowVersion: current.rowVersion + 1,
        leaseToken,
        now: "2026-07-13T12:00:09.000Z",
      }),
    ).resolves.toBeNull();
    const completed = await repository.complete({
      attemptId,
      expectedRowVersion: current.rowVersion,
      leaseToken,
      now: "2026-07-13T12:00:09.000Z",
    });
    expect(completed).toMatchObject({
      checkpoint: "published",
      runState: "succeeded",
    });
    expect(completed).not.toHaveProperty("activeSlot");

    await expect(repository.getMany([attemptId, attemptId, otherAttemptId])).resolves.toEqual([
      expect.objectContaining({ id: attemptId }),
    ]);
    await expect(
      repository.deleteTerminalOlderThan({
        maxJobs: 1,
        olderThan: "2026-07-13T13:00:00.000Z",
        tenantId,
      }),
    ).resolves.toBe(1);
    await expect(repository.get(attemptId)).resolves.toBeNull();
    await expect(
      repository.claimOutbox({
        limit: 1,
        lockedUntil: "2026-07-13T13:01:00.000Z",
        lockToken,
        now: "2026-07-13T13:00:00.000Z",
        workerId: "dispatcher",
      }),
    ).resolves.toEqual([]);
  });

  it("releases deferred dispatch only through the attempt and outbox CAS pair", async () => {
    const repository = createInMemoryDocumentCompilationAttemptRepository();
    const releaseDeferredDispatch = repository.releaseDeferredDispatch;
    if (!releaseDeferredDispatch) throw new Error("Expected deferred dispatch support");
    await repository.start(startInput({ availableAt: "9999-12-31T23:59:59.999Z" }));

    await expect(
      releaseDeferredDispatch({
        attemptId,
        expectedRowVersion: 1,
        now: createdAt,
      }),
    ).resolves.toBeNull();
    const released = await releaseDeferredDispatch({
      attemptId,
      expectedRowVersion: 0,
      now: createdAt,
    });
    expect(released).toMatchObject({ rowVersion: 1, runState: "dispatch_pending" });
    await expect(
      releaseDeferredDispatch({
        attemptId,
        expectedRowVersion: 1,
        now: createdAt,
      }),
    ).resolves.toBeNull();
    await expect(
      repository.claimOutbox({
        limit: 1,
        lockedUntil: "2026-07-13T12:01:00.000Z",
        lockToken,
        now: createdAt,
        workerId: "dispatcher",
      }),
    ).resolves.toEqual([expect.objectContaining({ status: "dispatching" })]);
  });

  it("requeues transient outbox errors and terminalizes a dead letter", async () => {
    const repository = createInMemoryDocumentCompilationAttemptRepository();
    await repository.start(startInput());
    await repository.claimOutbox({
      limit: 1,
      lockedUntil: "2026-07-13T12:01:00.000Z",
      lockToken,
      now: createdAt,
      workerId: "dispatcher-1",
    });
    await expect(
      repository.releaseOutbox({
        availableAt: "2026-07-13T12:02:00.000Z",
        error: "broker unavailable",
        lockToken: otherLockToken,
        now: "2026-07-13T12:00:01.000Z",
        outboxId,
      }),
    ).resolves.toBeNull();
    await expect(
      repository.releaseOutbox({
        availableAt: "2026-07-13T12:02:00.000Z",
        error: "broker unavailable",
        lockToken,
        now: "2026-07-13T12:00:01.000Z",
        outboxId,
      }),
    ).resolves.toMatchObject({ lastError: "broker unavailable", status: "pending" });

    await repository.claimOutbox({
      limit: 1,
      lockedUntil: "2026-07-13T12:03:00.000Z",
      lockToken: otherLockToken,
      now: "2026-07-13T12:02:00.000Z",
      workerId: "dispatcher-2",
    });
    await expect(
      repository.releaseOutbox({
        availableAt: "2026-07-13T12:04:00.000Z",
        deadLetter: true,
        error: "delivery exhausted",
        lockToken: otherLockToken,
        now: "2026-07-13T12:02:01.000Z",
        outboxId,
      }),
    ).resolves.toMatchObject({ status: "dead" });
    await expect(repository.get(attemptId)).resolves.toMatchObject({
      lastErrorCode: "OUTBOX_DEAD",
      runState: "failed",
    });
  });

  it("supersedes active work and preserves capacity and identifier invariants", async () => {
    const repository = createInMemoryDocumentCompilationAttemptRepository({
      maxAttempts: 1,
      maxOutboxEvents: 1,
    });
    await repository.start(startInput());
    const superseded = await repository.supersede({
      attemptId,
      expectedRowVersion: 0,
      now: "2026-07-13T12:01:00.000Z",
      reason: "new document version",
    });
    expect(superseded).toMatchObject({
      lastErrorMessage: "new document version",
      runState: "superseded",
    });
    await expect(
      repository.start(startInput({ id: otherAttemptId, outboxId: otherOutboxId })),
    ).rejects.toBeInstanceOf(DocumentCompilationAttemptCapacityExceededError);

    const collisionRepository = createInMemoryDocumentCompilationAttemptRepository({
      maxAttempts: 2,
      maxOutboxEvents: 2,
    });
    await collisionRepository.start(startInput());
    await collisionRepository.supersede({
      attemptId,
      expectedRowVersion: 0,
      now: "2026-07-13T12:01:00.000Z",
    });
    await expect(
      collisionRepository.start(startInput({ outboxId: otherOutboxId })),
    ).rejects.toBeInstanceOf(DocumentCompilationAttemptTransitionError);
  });

  it("rejects malformed authorization, profile, identifier, and numeric bindings", async () => {
    const permissionSnapshot = {
      accessChannel: "interactive" as const,
      id: otherAttemptId,
      revision: 1,
    };
    const repository = createInMemoryDocumentCompilationAttemptRepository({
      maxOutboxClaimBatchSize: 1,
    });
    await expect(repository.start(startInput({ permissionSnapshot }))).rejects.toThrow(
      "requester and permission snapshot must be bound together",
    );
    await expect(
      repository.start(
        startInput({
          capabilityGrantId: otherOutboxId,
          permissionSnapshot,
          requestedBySubjectId: "editor",
        }),
      ),
    ).rejects.toThrow("exactly one authorization binding");
    await expect(
      repository.start(
        startInput({
          embeddingProfile: {
            kind: "retrieval",
            revision: 1,
            revisionId: otherAttemptId,
            snapshotDigest: "a".repeat(64),
          },
        }),
      ),
    ).rejects.toThrow("embedding profile kind is invalid");
    await expect(
      repository.start(
        startInput({
          retrievalProfile: {
            kind: "retrieval",
            revision: 1,
            revisionId: otherAttemptId,
            snapshotDigest: "invalid",
          },
        }),
      ),
    ).rejects.toThrow("retrieval profile snapshotDigest is invalid");
    await expect(
      repository.cancel({
        attemptId,
        expectedRowVersion: 0,
        now: createdAt,
        permissionSnapshot,
      }),
    ).rejects.toThrow("requester and permission snapshot must be bound together");
    await expect(
      repository.claimOutbox({
        limit: 2,
        lockedUntil: "2026-07-13T12:01:00.000Z",
        lockToken,
        now: createdAt,
        workerId: "dispatcher",
      }),
    ).rejects.toThrow("claim limit exceeds maxOutboxClaimBatchSize=1");

    for (const invalid of [
      startInput({ createdAt: "not-a-date" }),
      startInput({ id: "not-a-uuid" }),
      startInput({ tenantId: " " }),
      startInput({ tenantId: "t".repeat(256) }),
      startInput({ baseHeadRevision: -1 }),
      startInput({ documentVersion: 0 }),
    ]) {
      await expect(repository.start(invalid)).rejects.toThrow();
    }
  });
});

describe("database document compilation repository transition behavior", () => {
  it("executes heartbeat, retry, terminal failure, exhaustion, and supersede CAS transitions", async () => {
    const running = attemptRow({
      execution_attempts: 1,
      heartbeat_at: "2026-07-13T12:00:02.000Z",
      lease_expires_at: "2026-07-13T12:05:00.000Z",
      lease_token: leaseToken,
      queue_job_id: "queue-1",
      row_version: 2,
      run_state: "running",
      started_at: "2026-07-13T12:00:02.000Z",
      worker_id: "worker-1",
    });

    await expect(
      databaseRepository(running).heartbeat({
        attemptId,
        expectedRowVersion: 2,
        leaseExpiresAt: "2026-07-13T12:10:00.000Z",
        leaseToken,
        now: "2026-07-13T12:01:00.000Z",
        workerId: "worker-1",
      }),
    ).resolves.toMatchObject({ rowVersion: 3, runState: "running" });
    await expect(
      databaseRepository(running).scheduleRetry({
        attemptId,
        errorCode: "UPSTREAM_TIMEOUT",
        errorMessage: "retry",
        expectedRowVersion: 2,
        leaseToken,
        now: "2026-07-13T12:01:00.000Z",
        retryAt: "2026-07-13T12:02:00.000Z",
      }),
    ).resolves.toMatchObject({ rowVersion: 3, runState: "retry_wait" });
    await expect(
      databaseRepository(running).fail({
        attemptId,
        errorCode: "PARSER_FAILED",
        errorMessage: "bad document",
        expectedRowVersion: 2,
        leaseToken,
        now: "2026-07-13T12:01:00.000Z",
      }),
    ).resolves.toMatchObject({ lastErrorCode: "PARSER_FAILED", runState: "failed" });
    await expect(
      databaseRepository(running).supersede({
        attemptId,
        expectedRowVersion: 2,
        now: "2026-07-13T12:01:00.000Z",
        reason: "new revision",
      }),
    ).resolves.toMatchObject({ lastErrorCode: "SUPERSEDED", runState: "superseded" });

    const exhausted = attemptRow({
      ...running,
      execution_attempts: 3,
      lease_expires_at: "2026-07-13T12:05:00.000Z",
      max_execution_attempts: 3,
    });
    await expect(
      databaseRepository(exhausted).failExhausted({
        attemptId,
        errorCode: "EXHAUSTED",
        errorMessage: "retry budget used",
        expectedRowVersion: 2,
        now: "2026-07-13T12:05:00.000Z",
      }),
    ).resolves.toMatchObject({ lastErrorCode: "EXHAUSTED", runState: "failed" });
  });

  it("returns null for absent database attempts and preserves getMany ordering and bounds", async () => {
    const empty = databaseRepository(undefined);
    await expect(
      empty.fail({
        attemptId,
        errorCode: "FAILED",
        errorMessage: "missing",
        expectedRowVersion: 0,
        leaseToken,
        now: createdAt,
      }),
    ).resolves.toBeNull();
    await expect(
      empty.failExhausted({
        attemptId,
        errorCode: "FAILED",
        errorMessage: "missing",
        expectedRowVersion: 0,
        now: createdAt,
      }),
    ).resolves.toBeNull();
    await expect(
      empty.heartbeat({
        attemptId,
        expectedRowVersion: 0,
        leaseExpiresAt: "2026-07-13T12:01:00.000Z",
        leaseToken,
        now: createdAt,
        workerId: "worker",
      }),
    ).resolves.toBeNull();
    await expect(
      empty.scheduleRetry({
        attemptId,
        expectedRowVersion: 0,
        leaseToken,
        now: createdAt,
        retryAt: "2026-07-13T12:01:00.000Z",
      }),
    ).resolves.toBeNull();
    await expect(
      empty.supersede({ attemptId, expectedRowVersion: 0, now: createdAt }),
    ).resolves.toBeNull();
    await expect(empty.getMany([])).resolves.toEqual([]);

    const repository = databaseRepository(attemptRow());
    await expect(repository.getMany([otherAttemptId, attemptId, attemptId])).resolves.toEqual([
      expect.objectContaining({ id: attemptId }),
    ]);
    const tooManyIds = Array.from(
      { length: 1_001 },
      (_, index) => `018f0d60-7a49-7cc2-9c1b-${index.toString(16).padStart(12, "0")}`,
    );
    await expect(repository.getMany(tooManyIds)).rejects.toThrow("cannot exceed 1000 IDs");
  });

  it("claims deterministically ordered outbox rows and removes a bounded terminal batch", async () => {
    const repository = databaseRepository(attemptRow(), [
      outboxRow({
        available_at: "2026-07-13T11:59:00.000Z",
        created_at: "2026-07-13T11:59:30.000Z",
        id: otherOutboxId,
      }),
      outboxRow(),
    ]);
    await expect(
      repository.claimOutbox({
        limit: 2,
        lockedUntil: "2026-07-13T12:01:00.000Z",
        lockToken,
        now: createdAt,
        workerId: "dispatcher",
      }),
    ).resolves.toEqual([
      expect.objectContaining({ id: otherOutboxId, status: "dispatching" }),
      expect.objectContaining({ id: outboxId, status: "dispatching" }),
    ]);
    await expect(
      repository.claimOutbox({
        limit: 1,
        lockedUntil: createdAt,
        lockToken,
        now: createdAt,
        workerId: "dispatcher",
      }),
    ).rejects.toThrow("lockedUntil must be after now");
    await expect(
      repository.deleteTerminalOlderThan({
        maxJobs: 1,
        olderThan: "2026-07-13T13:00:00.000Z",
        tenantId,
      }),
    ).resolves.toBe(1);
  });
});

type InMemoryRepository = ReturnType<typeof createInMemoryDocumentCompilationAttemptRepository>;

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
  } as Parameters<InMemoryRepository["start"]>[0];
}

async function dispatch(repository: InMemoryRepository, token: string, queueJobId: string) {
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

function databaseRepository(
  attempt: Record<string, unknown> | undefined,
  outboxes: readonly Record<string, unknown>[] = attempt ? [outboxRow()] : [],
) {
  const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    if (input.tableName === "document_compilation_attempts") {
      if (input.operation === "select") return databaseResult(attempt ? [attempt] : []);
      return databaseResult([], 1);
    }
    if (input.tableName === "document_compilation_outbox") {
      if (input.operation === "select") return databaseResult(outboxes);
      return databaseResult([], 1);
    }
    throw new Error(`Unexpected document compilation query: ${input.tableName}`);
  };
  const database = {
    dialect: "postgres",
    execute,
    kind: "postgres",
    transaction: async <T>(
      callback: (executor: {
        execute(input: DatabaseExecuteInput): Promise<DatabaseExecuteResult>;
      }) => Promise<T>,
    ) => callback({ execute }),
  } as unknown as DatabaseAdapter;
  return createDatabaseDocumentCompilationAttemptRepository({ database });
}

function attemptRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    active_slot: 1,
    base_head_revision: 2,
    candidate_fingerprint: null,
    candidate_publication_id: null,
    capability_grant_id: null,
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
    requested_by_subject_id: null,
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
    available_at: "2026-07-13T12:05:00.000Z",
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
    queue_job_id: "queue-1",
    schema_version: 1,
    status: "leased",
    updated_at: createdAt,
    ...overrides,
  };
}

function databaseResult(
  rows: readonly Record<string, unknown>[],
  rowsAffected = 0,
): DatabaseExecuteResult {
  return { rows, rowsAffected };
}
