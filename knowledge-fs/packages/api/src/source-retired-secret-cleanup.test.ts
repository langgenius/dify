import type {
  DatabaseAdapter,
  DatabaseExecuteInput,
  DatabaseExecuteResult,
  DatabaseTransactionCallback,
} from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import { createInMemorySourceRepository } from "./source-repository";
import {
  SourceRetiredSecretCleanupTransitionError,
  createDatabaseSourceRetiredSecretCleanupRepository,
  createInMemorySourceRetiredSecretCleanupRepository,
} from "./source-retired-secret-cleanup";

const tenantId = "tenant-1";
const spaceId = "10000000-0000-4000-8000-000000000001";
const sourceId = "20000000-0000-4000-8000-000000000001";
const lifecycleId = "30000000-0000-4000-8000-000000000001";
const leaseToken = "30000000-0000-4000-8000-000000000002";
const oldRef = "source-secret:v1:40000000-0000-4000-8000-000000000001";
const newRef = "source-secret:v1:50000000-0000-4000-8000-000000000001";
const now = "2026-07-14T00:00:00.000Z";
const later = "2026-07-14T00:01:00.000Z";

describe("in-memory source secret lifecycle registry", () => {
  it("recovers reserve/activate retries after an ambiguous create commit", async () => {
    const { repository } = memoryRepository();
    const reservation = {
      credentialRef: oldRef,
      knowledgeSpaceId: spaceId,
      operationId: "create-request-1",
      purpose: "create" as const,
      recoverAfter: later,
      sourceId,
      tenantId,
    };
    await expect(repository.reserveStaged(reservation)).resolves.toMatchObject({ state: "staged" });

    const activate = () =>
      repository.activateCreate({
        operationId: reservation.operationId,
        reservedCredentialRef: oldRef,
        source: {
          id: sourceId,
          knowledgeSpaceId: spaceId,
          name: "Docs",
          type: "connector",
          uri: "connector://docs",
        },
        tenantId,
      });
    const created = await activate();
    expect(created).toMatchObject({ credentialRef: oldRef, version: 1 });

    // Both retries model a database commit whose acknowledgement was lost.
    await expect(repository.reserveStaged(reservation)).resolves.toMatchObject({ state: "active" });
    await expect(activate()).resolves.toEqual(created);
  });

  it("atomically rotates active refs, retires the prior ref, and fences deletion", async () => {
    const { repository } = memoryRepository();
    const created = await createActiveSource(repository);
    const rotateReservation = {
      credentialRef: newRef,
      knowledgeSpaceId: spaceId,
      operationId: "rotate-request-1",
      purpose: "rotate" as const,
      recoverAfter: later,
      sourceId,
      tenantId,
    };
    await repository.reserveStaged(rotateReservation);
    const rotated = await repository.activateRotateAndRetire({
      expectedVersion: created.version,
      knowledgeSpaceId: spaceId,
      metadata: {},
      newCredentialRef: newRef,
      operationId: rotateReservation.operationId,
      sourceId,
      tenantId,
    });
    expect(rotated).toMatchObject({ credentialRef: newRef, version: 2 });
    await expect(repository.getByRef({ credentialRef: oldRef })).resolves.toMatchObject({
      state: "retired",
    });
    await expect(repository.getByRef({ credentialRef: newRef })).resolves.toMatchObject({
      state: "active",
    });

    // A retry after commit returns the committed result rather than rotating a second time.
    await expect(repository.reserveStaged(rotateReservation)).resolves.toMatchObject({
      state: "active",
    });
    await expect(
      repository.activateRotateAndRetire({
        expectedVersion: 1,
        knowledgeSpaceId: spaceId,
        metadata: {},
        newCredentialRef: newRef,
        operationId: rotateReservation.operationId,
        sourceId,
        tenantId,
      }),
    ).resolves.toMatchObject({ credentialRef: newRef, version: 2 });

    const deleting = await repository.beginDelete({
      leaseExpiresAt: later,
      now,
      workerId: "cleanup-1",
    });
    expect(deleting).toMatchObject({ credentialRef: oldRef, state: "deleting" });
    await expect(
      repository.activateRotateAndRetire({
        expectedVersion: 2,
        knowledgeSpaceId: spaceId,
        metadata: {},
        newCredentialRef: oldRef,
        operationId: "create-request-1",
        sourceId,
        tenantId,
      }),
    ).rejects.toBeInstanceOf(SourceRetiredSecretCleanupTransitionError);
    await expect(
      repository.beginDelete({ leaseExpiresAt: later, now, workerId: "cleanup-2" }),
    ).resolves.toBeNull();
  });

  it("revalidates live source references before entering deleting", async () => {
    const { repository, sources } = memoryRepository();
    const created = await createActiveSource(repository);
    await repository.reserveStaged({
      credentialRef: newRef,
      knowledgeSpaceId: spaceId,
      operationId: "rotate-request-2",
      purpose: "rotate",
      recoverAfter: later,
      sourceId,
      tenantId,
    });
    const rotated = await repository.activateRotateAndRetire({
      expectedVersion: created.version,
      knowledgeSpaceId: spaceId,
      metadata: {},
      newCredentialRef: newRef,
      operationId: "rotate-request-2",
      sourceId,
      tenantId,
    });
    if (!rotated) throw new Error("expected rotated source");
    await sources.update({
      credentialRef: oldRef,
      expectedVersion: rotated.version,
      id: sourceId,
      knowledgeSpaceId: spaceId,
    });

    await expect(
      repository.beginDelete({ leaseExpiresAt: later, now, workerId: "cleanup" }),
    ).resolves.toBeNull();
    await expect(repository.getByRef({ credentialRef: oldRef })).resolves.toMatchObject({
      state: "active",
    });
  });

  it("reconciles expired staged/candidate refs from live references instead of guessing", async () => {
    let candidateInUse = true;
    const { repository } = memoryRepository((ref) =>
      Promise.resolve(candidateInUse && ref === oldRef),
    );
    await repository.reserveCandidate({
      credentialRef: oldRef,
      knowledgeSpaceId: spaceId,
      operationId: lifecycleId,
      recoverAfter: now,
      sourceId,
      tenantId,
    });
    await expect(
      repository.reconcileExpiredStaged({ nextRecoverAfter: later, now }),
    ).resolves.toMatchObject({ state: "candidate" });

    candidateInUse = false;
    await expect(
      repository.reconcileExpiredStaged({ nextRecoverAfter: later, now: later }),
    ).resolves.toMatchObject({ nextDeleteAt: later, state: "retired" });
  });

  it("activates, replays, abandons, and refreshes candidate reservations", async () => {
    const fence = {
      expectedJobRowVersion: 0,
      jobId: lifecycleId,
      leaseToken,
      now,
    };
    const activation = {
      ...fence,
      candidateCredentialRef: oldRef,
      expectedSourceVersion: 1,
      knowledgeSpaceId: spaceId,
      metadata: { adopted: true },
      sourceId,
      tenantId,
    };
    const active = memoryRepository();
    await active.sources.create({
      id: sourceId,
      knowledgeSpaceId: spaceId,
      name: "Candidate source",
      type: "connector",
      uri: "connector://candidate",
    });
    await active.repository.reserveCandidate({
      credentialRef: oldRef,
      knowledgeSpaceId: spaceId,
      operationId: lifecycleId,
      recoverAfter: later,
      sourceId,
      tenantId,
    });
    await expect(active.repository.candidateActivate(activation)).resolves.toMatchObject({
      credentialRef: oldRef,
      version: 2,
    });
    await expect(active.repository.candidateActivate(activation)).resolves.toMatchObject({
      credentialRef: oldRef,
      version: 2,
    });
    await expect(
      active.repository.candidateAbandon({
        ...fence,
        candidateCredentialRef: oldRef,
      }),
    ).rejects.toBeInstanceOf(SourceRetiredSecretCleanupTransitionError);

    const abandoned = memoryRepository();
    await abandoned.repository.reserveCandidate({
      credentialRef: oldRef,
      knowledgeSpaceId: spaceId,
      operationId: lifecycleId,
      recoverAfter: later,
      sourceId,
      tenantId,
    });
    const abandonInput = {
      ...fence,
      candidateCredentialRef: oldRef,
      errorCode: "CANDIDATE_UNUSED",
      errorMessage: "candidate was never assigned",
    };
    await expect(abandoned.repository.candidateAbandon(abandonInput)).resolves.toMatchObject({
      lastErrorCode: "CANDIDATE_UNUSED",
      nextDeleteAt: now,
      state: "retired",
    });
    await expect(abandoned.repository.candidateAbandon(abandonInput)).resolves.toMatchObject({
      state: "retired",
    });

    const refreshed = memoryRepository();
    await refreshed.repository.reserveCandidate({
      credentialRef: oldRef,
      knowledgeSpaceId: spaceId,
      operationId: lifecycleId,
      recoverAfter: now,
      sourceId,
      tenantId,
    });
    const refreshInput = {
      ...fence,
      knowledgeSpaceId: spaceId,
      newCandidateCredentialRef: newRef,
      newRecoverAfter: later,
      oldCandidateCredentialRef: oldRef,
      sourceId,
      tenantId,
    };
    await expect(refreshed.repository.candidateRefresh(refreshInput)).resolves.toMatchObject({
      credentialRef: newRef,
      state: "candidate",
    });
    await expect(refreshed.repository.candidateRefresh(refreshInput)).resolves.toMatchObject({
      credentialRef: newRef,
      state: "candidate",
    });

    const assigned = memoryRepository();
    await assigned.sources.create({
      id: sourceId,
      knowledgeSpaceId: spaceId,
      name: "Assigned candidate",
      type: "connector",
      uri: "connector://assigned",
    });
    await assigned.repository.reserveCandidate({
      credentialRef: oldRef,
      knowledgeSpaceId: spaceId,
      operationId: lifecycleId,
      recoverAfter: now,
      sourceId,
      tenantId,
    });
    await assigned.sources.update({
      credentialRef: oldRef,
      expectedVersion: 1,
      id: sourceId,
      knowledgeSpaceId: spaceId,
    });
    await expect(assigned.repository.candidateRefresh(refreshInput)).resolves.toMatchObject({
      credentialRef: oldRef,
      state: "active",
    });
  });

  it("runs delete leases through renew, retry, completion, and compatibility wrappers", async () => {
    const retireForCleanup = async () => {
      const value = memoryRepository();
      const created = await createActiveSource(value.repository);
      await value.repository.reserveStaged({
        credentialRef: newRef,
        knowledgeSpaceId: spaceId,
        operationId: "rotate-cleanup",
        purpose: "rotate",
        recoverAfter: later,
        sourceId,
        tenantId,
      });
      await value.repository.activateRotateAndRetire({
        expectedVersion: created.version,
        knowledgeSpaceId: spaceId,
        metadata: {},
        newCredentialRef: newRef,
        operationId: "rotate-cleanup",
        sourceId,
        tenantId,
      });
      return value;
    };

    const direct = await retireForCleanup();
    const deleting = await direct.repository.beginDelete({
      leaseExpiresAt: later,
      now,
      workerId: "cleanup-direct",
    });
    if (!deleting?.leaseToken) throw new Error("expected deleting lease");
    const renewed = await direct.repository.renewDelete({
      credentialRef: deleting.credentialRef,
      expectedRowVersion: deleting.rowVersion,
      leaseExpiresAt: "2026-07-14T00:02:00.000Z",
      leaseToken: deleting.leaseToken,
      now,
      workerId: "cleanup-direct",
    });
    await expect(
      direct.repository.retryDelete({
        credentialRef: renewed.credentialRef,
        errorCode: "SECRET_STORE_TIMEOUT",
        errorMessage: "retry later",
        expectedRowVersion: renewed.rowVersion,
        leaseToken: renewed.leaseToken as string,
        nextDeleteAt: now,
        now,
      }),
    ).resolves.toMatchObject({
      deleteAttempts: 1,
      lastErrorCode: "SECRET_STORE_TIMEOUT",
      state: "retired",
    });

    const compatible = await retireForCleanup();
    await expect(
      compatible.repository.claim({ leaseExpiresAt: later, limit: 0, now, workerId: "worker-a" }),
    ).rejects.toThrow("claim limit");
    const [job] = await compatible.repository.claim({
      leaseExpiresAt: later,
      limit: 1,
      now,
      workerId: "worker-a",
    });
    if (!job?.leaseToken) throw new Error("expected compatibility job");
    await expect(compatible.repository.get({ jobId: job.id })).resolves.toMatchObject({
      runState: "running",
    });
    await expect(compatible.repository.retry({ jobId: job.id, now })).resolves.toMatchObject({
      retiredCredentialRef: oldRef,
    });
    const heartbeat = await compatible.repository.heartbeat({
      expectedRowVersion: job.rowVersion,
      jobId: job.id,
      leaseExpiresAt: "2026-07-14T00:02:00.000Z",
      leaseToken: job.leaseToken,
      now,
      workerId: "worker-a",
    });
    await expect(
      compatible.repository.complete({
        expectedRowVersion: heartbeat.rowVersion,
        jobId: heartbeat.id,
        leaseToken: heartbeat.leaseToken as string,
        now,
      }),
    ).resolves.toMatchObject({ runState: "succeeded", state: "deleted" });

    const failed = await retireForCleanup();
    const [failureJob] = await failed.repository.claim({
      leaseExpiresAt: later,
      limit: 1,
      now,
      workerId: "worker-b",
    });
    if (!failureJob?.leaseToken) throw new Error("expected retryable job");
    await expect(
      failed.repository.retryableFailure({
        errorCode: "TRANSIENT",
        errorMessage: "retry",
        expectedRowVersion: failureJob.rowVersion,
        jobId: failureJob.id,
        leaseToken: failureJob.leaseToken,
        now,
      }),
    ).resolves.toMatchObject({ state: "retired" });

    const terminalFailure = await retireForCleanup();
    const [terminalJob] = await terminalFailure.repository.claim({
      leaseExpiresAt: later,
      limit: 1,
      now,
      workerId: "worker-c",
    });
    if (!terminalJob?.leaseToken) throw new Error("expected failure job");
    await expect(
      terminalFailure.repository.fail({
        errorCode: "TERMINAL",
        errorMessage: "failed",
        expectedRowVersion: terminalJob.rowVersion,
        jobId: terminalJob.id,
        leaseToken: terminalJob.leaseToken,
        now,
      }),
    ).resolves.toMatchObject({ lastErrorCode: "TERMINAL", state: "retired" });

    const missingJobId = "30000000-0000-4000-8000-000000000099";
    await expect(compatible.repository.get({ jobId: missingJobId })).resolves.toBeNull();
    await expect(compatible.repository.retry({ jobId: missingJobId, now })).resolves.toBeNull();
    await expect(
      compatible.repository.complete({
        expectedRowVersion: 1,
        jobId: missingJobId,
        leaseToken,
        now,
      }),
    ).rejects.toBeInstanceOf(SourceRetiredSecretCleanupTransitionError);
  });

  it("adopts legacy refs and replaces or revokes credentials idempotently", async () => {
    const { repository, sources } = memoryRepository();
    await sources.create({
      credentialRef: oldRef,
      id: sourceId,
      knowledgeSpaceId: spaceId,
      name: "Legacy source",
      type: "connector",
      uri: "connector://legacy",
    });

    await expect(
      repository.replaceCredentialAndRetire({
        credentialRef: newRef,
        expectedVersion: 1,
        knowledgeSpaceId: spaceId,
        metadata: { rotated: true },
        reason: "rotate",
        sourceId,
        tenantId,
      }),
    ).resolves.toMatchObject({ credentialRef: newRef, version: 2 });
    await expect(repository.getByRef({ credentialRef: oldRef })).resolves.toMatchObject({
      state: "retired",
    });
    await expect(
      repository.replaceCredentialAndRetire({
        credentialRef: null,
        expectedVersion: 2,
        knowledgeSpaceId: spaceId,
        metadata: { revoked: true },
        reason: "revoke",
        sourceId,
        tenantId,
      }),
    ).resolves.toMatchObject({ credentialRef: undefined, version: 3 });
    await expect(repository.getByRef({ credentialRef: newRef })).resolves.toMatchObject({
      state: "retired",
    });
    await expect(repository.isReferenceInUse({ retiredCredentialRef: newRef })).resolves.toBe(
      false,
    );
    await expect(
      repository.withWriteAdmission({ knowledgeSpaceId: spaceId, tenantId }, async () => "written"),
    ).resolves.toBe("written");
    const missing = memoryRepository();
    await expect(
      missing.repository.replaceCredentialAndRetire({
        credentialRef: null,
        expectedVersion: 1,
        knowledgeSpaceId: spaceId,
        metadata: {},
        reason: "rotate",
        sourceId: "20000000-0000-4000-8000-000000000099",
        tenantId,
      }),
    ).resolves.toBeNull();
  });

  it("fails closed for capacity, reservation, lease, and normalization boundaries", async () => {
    const sources = createInMemorySourceRepository({ maxSources: 10, now: () => now });
    expect(() =>
      createInMemorySourceRetiredSecretCleanupRepository({
        maxClaimBatchSize: 0,
        maxJobs: 1,
        sources,
      }),
    ).toThrow("maxClaimBatchSize");
    expect(() =>
      createInMemorySourceRetiredSecretCleanupRepository({
        maxClaimBatchSize: 1,
        maxJobs: 0,
        sources,
      }),
    ).toThrow("maxJobs");

    let ids = 0;
    const repository = createInMemorySourceRetiredSecretCleanupRepository({
      generateId: () => {
        ids += 1;
        return `30000000-0000-4000-8000-${String(ids).padStart(12, "0")}`;
      },
      generateLeaseToken: () => leaseToken,
      maxClaimBatchSize: 1,
      maxJobs: 1,
      now: () => now,
      sources,
    });
    await repository.reserveStaged({
      credentialRef: oldRef,
      knowledgeSpaceId: spaceId,
      operationId: "capacity-a",
      purpose: "create",
      recoverAfter: later,
      sourceId,
      tenantId,
    });
    await expect(
      repository.reserveStaged({
        credentialRef: oldRef,
        knowledgeSpaceId: spaceId,
        operationId: "conflicting-operation",
        purpose: "create",
        recoverAfter: later,
        sourceId,
        tenantId,
      }),
    ).rejects.toBeInstanceOf(SourceRetiredSecretCleanupTransitionError);
    await expect(
      repository.reserveStaged({
        credentialRef: newRef,
        knowledgeSpaceId: spaceId,
        operationId: "capacity-b",
        purpose: "rotate",
        recoverAfter: later,
        sourceId,
        tenantId,
      }),
    ).rejects.toThrow("maxJobs=1");
    await expect(repository.getByRef({ credentialRef: newRef })).resolves.toBeNull();
    await expect(repository.retire({ credentialRef: newRef, now })).rejects.toBeInstanceOf(
      SourceRetiredSecretCleanupTransitionError,
    );
    await expect(
      repository.beginDelete({ leaseExpiresAt: now, now, workerId: "worker" }),
    ).rejects.toThrow("expire after now");
    await expect(
      repository.reserveStaged({
        credentialRef: "invalid-ref",
        knowledgeSpaceId: spaceId,
        operationId: "invalid-ref",
        purpose: "create",
        recoverAfter: later,
        sourceId,
        tenantId,
      }),
    ).rejects.toThrow("Invalid source secret ref");
  });

  it("covers create replay conflicts and rotation CAS edge states", async () => {
    const existing = memoryRepository();
    await existing.repository.reserveStaged({
      credentialRef: oldRef,
      knowledgeSpaceId: spaceId,
      operationId: "existing-create",
      purpose: "create",
      recoverAfter: later,
      sourceId,
      tenantId,
    });
    await existing.sources.create({
      credentialRef: oldRef,
      id: sourceId,
      knowledgeSpaceId: spaceId,
      name: "Existing source",
      type: "connector",
      uri: "connector://existing",
    });
    const createInput = {
      operationId: "existing-create",
      reservedCredentialRef: oldRef,
      source: {
        id: sourceId,
        knowledgeSpaceId: spaceId,
        name: "Existing source",
        type: "connector" as const,
        uri: "connector://existing",
      },
      tenantId,
    };
    await expect(existing.repository.activateCreate(createInput)).resolves.toMatchObject({
      credentialRef: oldRef,
    });
    await existing.sources.update({
      credentialRef: newRef,
      expectedVersion: 1,
      id: sourceId,
      knowledgeSpaceId: spaceId,
    });
    await expect(existing.repository.activateCreate(createInput)).rejects.toBeInstanceOf(
      SourceRetiredSecretCleanupTransitionError,
    );

    const wrongState = memoryRepository();
    await wrongState.repository.reserveCandidate({
      credentialRef: oldRef,
      knowledgeSpaceId: spaceId,
      operationId: lifecycleId,
      recoverAfter: later,
      sourceId,
      tenantId,
    });
    await expect(
      wrongState.repository.activateCreate({
        ...createInput,
        operationId: lifecycleId,
      }),
    ).rejects.toBeInstanceOf(SourceRetiredSecretCleanupTransitionError);

    const legacyConflict = memoryRepository();
    await legacyConflict.sources.create({
      credentialRef: oldRef,
      id: sourceId,
      knowledgeSpaceId: spaceId,
      name: "Legacy conflict",
      type: "connector",
      uri: "connector://legacy-conflict",
    });
    await legacyConflict.repository.reserveStaged({
      credentialRef: oldRef,
      knowledgeSpaceId: spaceId,
      operationId: "uncommitted-create",
      purpose: "create",
      recoverAfter: later,
      sourceId,
      tenantId,
    });
    await expect(
      legacyConflict.repository.replaceCredentialAndRetire({
        credentialRef: null,
        expectedVersion: 1,
        knowledgeSpaceId: spaceId,
        metadata: {},
        reason: "revoke",
        sourceId,
        tenantId,
      }),
    ).rejects.toBeInstanceOf(SourceRetiredSecretCleanupTransitionError);

    const noPrior = memoryRepository();
    await noPrior.sources.create({
      id: sourceId,
      knowledgeSpaceId: spaceId,
      name: "No prior secret",
      type: "connector",
      uri: "connector://no-prior",
    });
    await noPrior.repository.reserveStaged({
      credentialRef: newRef,
      knowledgeSpaceId: spaceId,
      operationId: "attach-first-secret",
      purpose: "rotate",
      recoverAfter: later,
      sourceId,
      tenantId,
    });
    await expect(
      noPrior.repository.activateRotateAndRetire({
        expectedVersion: 1,
        knowledgeSpaceId: spaceId,
        metadata: {},
        newCredentialRef: newRef,
        operationId: "attach-first-secret",
        sourceId,
        tenantId,
      }),
    ).resolves.toMatchObject({ credentialRef: newRef, version: 2 });

    const stale = memoryRepository();
    await createActiveSource(stale.repository);
    await expect(
      stale.repository.activateRotateAndRetire({
        expectedVersion: 99,
        knowledgeSpaceId: spaceId,
        metadata: {},
        newCredentialRef: null,
        sourceId,
        tenantId,
      }),
    ).rejects.toThrow("modified concurrently");

    const inactivePrior = memoryRepository();
    await inactivePrior.sources.create({
      credentialRef: oldRef,
      id: sourceId,
      knowledgeSpaceId: spaceId,
      name: "Inactive prior",
      type: "connector",
      uri: "connector://inactive-prior",
    });
    await inactivePrior.repository.reserveStaged({
      credentialRef: oldRef,
      knowledgeSpaceId: spaceId,
      operationId: "pending-old",
      purpose: "rotate",
      recoverAfter: later,
      sourceId,
      tenantId,
    });
    await expect(
      inactivePrior.repository.activateRotateAndRetire({
        expectedVersion: 1,
        knowledgeSpaceId: spaceId,
        metadata: {},
        newCredentialRef: null,
        sourceId,
        tenantId,
      }),
    ).rejects.toBeInstanceOf(SourceRetiredSecretCleanupTransitionError);
  });

  it("covers candidate rejection, retire replay, expired leases, and deleted tombstones", async () => {
    const fence = {
      expectedJobRowVersion: 0,
      jobId: lifecycleId,
      leaseToken,
      now,
    };
    const missingSource = memoryRepository();
    await missingSource.repository.reserveCandidate({
      credentialRef: oldRef,
      knowledgeSpaceId: spaceId,
      operationId: lifecycleId,
      recoverAfter: later,
      sourceId,
      tenantId,
    });
    await expect(
      missingSource.repository.candidateActivate({
        ...fence,
        candidateCredentialRef: oldRef,
        expectedSourceVersion: 1,
        knowledgeSpaceId: spaceId,
        metadata: {},
        sourceId,
        tenantId,
      }),
    ).resolves.toBeNull();

    const assigned = memoryRepository();
    await assigned.sources.create({
      id: sourceId,
      knowledgeSpaceId: spaceId,
      name: "Assigned abandon",
      type: "connector",
      uri: "connector://assigned-abandon",
    });
    await assigned.repository.reserveCandidate({
      credentialRef: oldRef,
      knowledgeSpaceId: spaceId,
      operationId: lifecycleId,
      recoverAfter: later,
      sourceId,
      tenantId,
    });
    await assigned.sources.update({
      credentialRef: oldRef,
      expectedVersion: 1,
      id: sourceId,
      knowledgeSpaceId: spaceId,
    });
    await expect(
      assigned.repository.candidateAbandon({ ...fence, candidateCredentialRef: oldRef }),
    ).resolves.toMatchObject({ sourceVersion: 2, state: "active" });

    const conflictingRefresh = memoryRepository();
    for (const credentialRef of [oldRef, newRef]) {
      await conflictingRefresh.repository.reserveCandidate({
        credentialRef,
        knowledgeSpaceId: spaceId,
        operationId: lifecycleId,
        recoverAfter: later,
        sourceId,
        tenantId,
      });
    }
    await expect(
      conflictingRefresh.repository.candidateRefresh({
        ...fence,
        knowledgeSpaceId: spaceId,
        newCandidateCredentialRef: newRef,
        newRecoverAfter: later,
        oldCandidateCredentialRef: oldRef,
        sourceId,
        tenantId,
      }),
    ).rejects.toBeInstanceOf(SourceRetiredSecretCleanupTransitionError);

    const retired = memoryRepository();
    await createActiveSource(retired.repository);
    const retiredRow = await retired.repository.retire({ credentialRef: oldRef, now });
    await expect(retired.repository.retire({ credentialRef: oldRef, now })).resolves.toEqual(
      retiredRow,
    );
    await retired.sources.update({
      credentialRef: null,
      expectedVersion: 1,
      id: sourceId,
      knowledgeSpaceId: spaceId,
    });
    const deleting = await retired.repository.beginDelete({
      leaseExpiresAt: later,
      now,
      workerId: "lease-owner",
    });
    if (!deleting?.leaseToken) throw new Error("expected delete lease");
    await expect(retired.repository.retire({ credentialRef: oldRef, now })).rejects.toBeInstanceOf(
      SourceRetiredSecretCleanupTransitionError,
    );
    await expect(
      retired.repository.renewDelete({
        credentialRef: oldRef,
        expectedRowVersion: deleting.rowVersion,
        leaseExpiresAt: "2026-07-14T00:02:00.000Z",
        leaseToken: deleting.leaseToken,
        now,
        workerId: "wrong-worker",
      }),
    ).rejects.toBeInstanceOf(SourceRetiredSecretCleanupTransitionError);
    await expect(
      retired.repository.completeDelete({
        credentialRef: oldRef,
        expectedRowVersion: deleting.rowVersion + 1,
        leaseToken: deleting.leaseToken,
        now,
      }),
    ).rejects.toBeInstanceOf(SourceRetiredSecretCleanupTransitionError);
    await expect(
      retired.repository.beginDelete({
        leaseExpiresAt: "2026-07-14T00:03:00.000Z",
        now: later,
        workerId: "lease-reclaimer",
      }),
    ).resolves.toMatchObject({ deleteAttempts: 1, state: "deleting" });

    const empty = memoryRepository();
    await expect(
      empty.repository.reconcileExpiredStaged({ nextRecoverAfter: later, now }),
    ).resolves.toBeNull();
    await expect(
      empty.repository.claim({ leaseExpiresAt: later, limit: 1, now, workerId: "idle" }),
    ).resolves.toEqual([]);
  });
});

describe.each(["postgres", "tidb"] as const)("database lifecycle SQL (%s)", (dialect) => {
  it("holds deletion admission across SecretStore writes and rejects them once deletion is active", async () => {
    const calls: DatabaseExecuteInput[] = [];
    let inTransaction = false;
    let mutationRanInTransaction = false;
    const writable = createDatabase(
      dialect,
      async (input) => {
        calls.push(input);
        return { rows: [], rowsAffected: input.operation === "select" ? 0 : 1 };
      },
      (running) => {
        inTransaction = running;
      },
    );
    const repository = createDatabaseSourceRetiredSecretCleanupRepository({
      database: writable,
      maxClaimBatchSize: 10,
    });

    await expect(
      repository.withWriteAdmission({ knowledgeSpaceId: spaceId, tenantId }, async () => {
        mutationRanInTransaction = inTransaction;
        return "stored";
      }),
    ).resolves.toBe("stored");
    expect(mutationRanInTransaction).toBe(true);
    expect(calls.map((call) => call.tableName)).toEqual(["knowledge_spaces", "deletion_jobs"]);
    expect(calls[0]?.sql).toContain("FOR UPDATE");
    expect(calls[1]?.sql).toContain("active_slot");

    const rejectedMutation = vi.fn(async () => "late-write");
    const deleting = createDatabase(
      dialect,
      async () => ({ rows: [], rowsAffected: 0 }),
      undefined,
      { activeDeletion: true },
    );
    const deletingRepository = createDatabaseSourceRetiredSecretCleanupRepository({
      database: deleting,
      maxClaimBatchSize: 10,
    });
    await expect(
      deletingRepository.withWriteAdmission(
        { knowledgeSpaceId: spaceId, tenantId },
        rejectedMutation,
      ),
    ).rejects.toBeInstanceOf(SourceRetiredSecretCleanupTransitionError);
    await expect(
      deletingRepository.reserveStaged({
        credentialRef: oldRef,
        knowledgeSpaceId: spaceId,
        operationId: "late-reservation",
        purpose: "create",
        recoverAfter: later,
        sourceId,
        tenantId,
      }),
    ).rejects.toBeInstanceOf(SourceRetiredSecretCleanupTransitionError);
    expect(rejectedMutation).not.toHaveBeenCalled();

    const activationCalls: DatabaseExecuteInput[] = [];
    const deletingWithSource = createDatabase(
      dialect,
      async (input) => {
        activationCalls.push(input);
        return input.operation === "select" && input.tableName === "sources"
          ? { rows: [sourceRow(oldRef, 7)], rowsAffected: 0 }
          : { rows: [], rowsAffected: input.operation === "select" ? 0 : 1 };
      },
      undefined,
      { activeDeletion: true },
    );
    const activationRepository = createDatabaseSourceRetiredSecretCleanupRepository({
      database: deletingWithSource,
      maxClaimBatchSize: 10,
    });
    await expect(
      activationRepository.activateCreate({
        operationId: "late-create",
        reservedCredentialRef: oldRef,
        source: {
          id: sourceId,
          knowledgeSpaceId: spaceId,
          name: "Late source",
          type: "connector",
          uri: "connector://late",
        },
        tenantId,
      }),
    ).rejects.toBeInstanceOf(SourceRetiredSecretCleanupTransitionError);
    await expect(
      activationRepository.activateRotateAndRetire({
        expectedVersion: 7,
        knowledgeSpaceId: spaceId,
        metadata: {},
        newCredentialRef: null,
        sourceId,
        tenantId,
      }),
    ).rejects.toBeInstanceOf(SourceRetiredSecretCleanupTransitionError);
    await expect(
      activationRepository.replaceCredentialAndRetire({
        credentialRef: null,
        expectedVersion: 7,
        knowledgeSpaceId: spaceId,
        metadata: {},
        reason: "revoke",
        sourceId,
        tenantId,
      }),
    ).rejects.toBeInstanceOf(SourceRetiredSecretCleanupTransitionError);
    expect(activationCalls.filter((call) => call.operation !== "select")).toHaveLength(0);
  });

  it("reserves before assignment and treats an active same-operation row as idempotent", async () => {
    const calls: DatabaseExecuteInput[] = [];
    let active = false;
    const database = createDatabase(dialect, async (input) => {
      calls.push(input);
      if (input.operation === "select" && input.sql.includes("source_secret_lifecycle_refs")) {
        return { rows: active ? [lifecycleRow("active")] : [], rowsAffected: 0 };
      }
      if (
        input.operation === "select" &&
        input.sql.includes("FROM") &&
        input.sql.includes("sources")
      ) {
        return { rows: [sourceRow(oldRef, 1)], rowsAffected: 0 };
      }
      if (input.operation === "insert") active = true;
      return { rows: [], rowsAffected: 1 };
    });
    const repository = createDatabaseSourceRetiredSecretCleanupRepository({
      database,
      generateId: () => lifecycleId,
      maxClaimBatchSize: 10,
      now: () => now,
    });
    const reservation = {
      credentialRef: oldRef,
      knowledgeSpaceId: spaceId,
      operationId: "create-request-1",
      purpose: "create" as const,
      recoverAfter: later,
      sourceId,
      tenantId,
    };
    await repository.reserveStaged(reservation);
    await expect(repository.reserveStaged(reservation)).resolves.toMatchObject({ state: "active" });
    await expect(
      repository.activateCreate({
        operationId: reservation.operationId,
        reservedCredentialRef: oldRef,
        source: {
          id: sourceId,
          knowledgeSpaceId: spaceId,
          name: "Docs",
          type: "connector",
          uri: "connector://docs",
        },
        tenantId,
      }),
    ).resolves.toMatchObject({ credentialRef: oldRef, version: 1 });
    expect(calls.filter((call) => call.operation === "insert")).toHaveLength(1);
    assertPlaceholderArity(calls, dialect);
  });

  it("claims at most one row and revalidates active and candidate refs inside the transaction", async () => {
    const calls: Array<DatabaseExecuteInput & { readonly inTransaction: boolean }> = [];
    let inTransaction = false;
    const database = createDatabase(
      dialect,
      async (input) => {
        calls.push({ ...input, inTransaction });
        if (
          input.operation === "select" &&
          input.sql.includes("source_secret_lifecycle_refs") &&
          input.sql.includes("ORDER BY")
        ) {
          return { rows: [lifecycleRow("retired")], rowsAffected: 0 };
        }
        return { rows: [], rowsAffected: input.operation === "select" ? 0 : 1 };
      },
      (running) => {
        inTransaction = running;
      },
    );
    const repository = createDatabaseSourceRetiredSecretCleanupRepository({
      database,
      generateLeaseToken: () => leaseToken,
      maxClaimBatchSize: 10,
    });

    await expect(
      repository.beginDelete({ leaseExpiresAt: later, now, workerId: "cleanup-worker" }),
    ).resolves.toMatchObject({ credentialRef: oldRef, state: "deleting" });
    expect(calls.every((call) => call.inTransaction)).toBe(true);
    const claim = calls[0];
    expect(claim?.maxRows).toBe(1);
    expect(claim?.sql).toContain("LIMIT 1 FOR UPDATE");
    expect(claim?.sql.includes("SKIP LOCKED")).toBe(dialect === "postgres");
    expect(
      calls.some((call) => call.sql.includes("credential_ref") && call.sql.includes("sources")),
    ).toBe(true);
    expect(calls.some((call) => call.sql.includes("candidate_credential_ref"))).toBe(true);
    expect(calls.at(-1)?.operation).toBe("update");
    assertPlaceholderArity(calls, dialect);
  });

  it("reclaims a due deleted tombstone for a later idempotent scrub", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const database = createDatabase(dialect, async (input) => {
      calls.push(input);
      if (
        input.operation === "select" &&
        input.tableName === "source_secret_lifecycle_refs" &&
        input.sql.includes("ORDER BY")
      ) {
        return { rows: [lifecycleRow("deleted")], rowsAffected: 0 };
      }
      return { rows: [], rowsAffected: input.operation === "select" ? 0 : 1 };
    });
    const repository = createDatabaseSourceRetiredSecretCleanupRepository({
      database,
      generateLeaseToken: () => leaseToken,
      maxClaimBatchSize: 10,
    });

    const reclaimed = await repository.beginDelete({
      leaseExpiresAt: later,
      now,
      workerId: "tombstone-scrubber",
    });
    expect(reclaimed).toMatchObject({
      credentialRef: oldRef,
      state: "deleting",
    });
    expect(reclaimed).not.toHaveProperty("deletedAt");
    expect(calls[0]?.sql).toContain("= 'deleted'");
    expect(calls[0]?.params).toHaveLength(dialect === "postgres" ? 1 : 3);
    expect(calls.at(-1)?.params.at(-3)).toBeNull();
    assertPlaceholderArity(calls, dialect);
  });

  it("locks refs in stable order before the source CAS and both lifecycle transitions", async () => {
    const calls: Array<DatabaseExecuteInput & { readonly inTransaction: boolean }> = [];
    let inTransaction = false;
    const database = createDatabase(
      dialect,
      async (input) => {
        calls.push({ ...input, inTransaction });
        if (input.operation === "select" && input.tableName === "sources") {
          return { rows: [sourceRow(oldRef, 7)], rowsAffected: 0 };
        }
        if (input.operation === "select" && input.tableName === "source_secret_lifecycle_refs") {
          const ref = input.params[0];
          return {
            rows: [
              ref === newRef
                ? lifecycleRow("staged", {
                    credentialRef: newRef,
                    operationId: "rotate-request-1",
                    purpose: "rotate",
                    rowVersion: 0,
                    sourceVersion: null,
                  })
                : lifecycleRow("active"),
            ],
            rowsAffected: 0,
          };
        }
        return { rows: [], rowsAffected: 1 };
      },
      (running) => {
        inTransaction = running;
      },
    );
    const repository = createDatabaseSourceRetiredSecretCleanupRepository({
      database,
      maxClaimBatchSize: 10,
      now: () => now,
    });

    await expect(
      repository.activateRotateAndRetire({
        expectedVersion: 7,
        knowledgeSpaceId: spaceId,
        metadata: { provider: "docs" },
        newCredentialRef: newRef,
        operationId: "rotate-request-1",
        sourceId,
        tenantId,
      }),
    ).resolves.toMatchObject({ credentialRef: newRef, version: 8 });

    const transactional = calls.filter((call) => call.inTransaction);
    expect(transactional.map((call) => [call.operation, call.tableName])).toEqual([
      ["select", "knowledge_spaces"],
      ["select", "deletion_jobs"],
      ["select", "source_secret_lifecycle_refs"],
      ["select", "source_secret_lifecycle_refs"],
      ["select", "sources"],
      ["update", "sources"],
      ["update", "source_secret_lifecycle_refs"],
      ["update", "source_secret_lifecycle_refs"],
    ]);
    expect(transactional[2]?.params).toEqual([oldRef]);
    expect(transactional[3]?.params).toEqual([newRef]);
    expect(transactional.slice(5).every((call) => call.inTransaction)).toBe(true);
    assertPlaceholderArity(calls, dialect);
  });

  it("locks candidate registry, backfill fence, then source for activate/refresh/abandon", async () => {
    for (const operation of ["activate", "refresh", "abandon"] as const) {
      const calls: DatabaseExecuteInput[] = [];
      const database = createDatabase(dialect, async (input) => {
        calls.push(input);
        if (input.operation === "select" && input.tableName === "source_secret_lifecycle_refs") {
          return {
            rows:
              input.params[0] === newRef
                ? []
                : [
                    lifecycleRow("candidate", {
                      operationId: lifecycleId,
                      purpose: "backfill",
                      rowVersion: 0,
                      sourceVersion: null,
                    }),
                  ],
            rowsAffected: 0,
          };
        }
        if (input.operation === "select" && input.tableName === "source_credential_backfills") {
          return { rows: [backfillRow()], rowsAffected: 0 };
        }
        if (input.operation === "select" && input.tableName === "sources") {
          return { rows: [sourceRow(null, 3)], rowsAffected: 0 };
        }
        return { rows: [], rowsAffected: 1 };
      });
      const repository = createDatabaseSourceRetiredSecretCleanupRepository({
        database,
        generateId: () => "30000000-0000-4000-8000-000000000099",
        maxClaimBatchSize: 10,
      });
      const fence = {
        expectedJobRowVersion: 4,
        jobId: lifecycleId,
        leaseToken,
        now,
      };

      if (operation === "activate") {
        await repository.candidateActivate({
          ...fence,
          candidateCredentialRef: oldRef,
          expectedSourceVersion: 3,
          knowledgeSpaceId: spaceId,
          metadata: {},
          sourceId,
          tenantId,
        });
      } else if (operation === "refresh") {
        await repository.candidateRefresh({
          ...fence,
          knowledgeSpaceId: spaceId,
          newCandidateCredentialRef: newRef,
          newRecoverAfter: later,
          oldCandidateCredentialRef: oldRef,
          sourceId,
          tenantId,
        });
      } else {
        await repository.candidateAbandon({
          ...fence,
          candidateCredentialRef: oldRef,
          errorCode: "SOURCE_CHANGED",
          errorMessage: "Source changed",
        });
      }

      const selectedTables = calls
        .filter((call) => call.operation === "select")
        .map((call) => call.tableName);
      expect(selectedTables, operation).toEqual(
        operation === "refresh"
          ? [
              "knowledge_spaces",
              "deletion_jobs",
              "source_secret_lifecycle_refs",
              "source_secret_lifecycle_refs",
              "source_credential_backfills",
              "sources",
            ]
          : operation === "abandon"
            ? [
                "source_secret_lifecycle_refs",
                "knowledge_spaces",
                "deletion_jobs",
                "source_secret_lifecycle_refs",
                "source_credential_backfills",
                "sources",
              ]
            : [
                "knowledge_spaces",
                "deletion_jobs",
                "source_secret_lifecycle_refs",
                "source_credential_backfills",
                "sources",
              ],
      );
      expect(calls.filter((call) => call.operation !== "select").length, operation).toBe(
        operation === "refresh" || operation === "activate" ? 2 : 1,
      );
      assertPlaceholderArity(calls, dialect);
    }
  });

  it("rejects stale/expired delete fences and returns failures to retired retry state", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const database = createDatabase(dialect, async (input) => {
      calls.push(input);
      if (input.operation === "select") {
        return {
          rows: [
            lifecycleRow("deleting", {
              heartbeatAt: now,
              leaseExpiresAt: later,
              leaseToken,
              rowVersion: 3,
              workerId: "cleanup-worker",
            }),
          ],
          rowsAffected: 0,
        };
      }
      return { rows: [], rowsAffected: 1 };
    });
    const repository = createDatabaseSourceRetiredSecretCleanupRepository({
      database,
      maxClaimBatchSize: 10,
    });

    await expect(
      repository.retryDelete({
        credentialRef: oldRef,
        errorCode: "VAULT_TIMEOUT",
        errorMessage: "Vault timed out",
        expectedRowVersion: 99,
        leaseToken,
        nextDeleteAt: later,
        now,
      }),
    ).rejects.toBeInstanceOf(SourceRetiredSecretCleanupTransitionError);
    await expect(
      repository.completeDelete({
        credentialRef: oldRef,
        expectedRowVersion: 3,
        leaseToken,
        now: later,
      }),
    ).rejects.toBeInstanceOf(SourceRetiredSecretCleanupTransitionError);
    await expect(
      repository.retryDelete({
        credentialRef: oldRef,
        errorCode: "VAULT_TIMEOUT",
        errorMessage: "Vault timed out",
        expectedRowVersion: 3,
        leaseToken,
        nextDeleteAt: later,
        now,
      }),
    ).resolves.toMatchObject({
      deleteAttempts: 1,
      lastErrorCode: "VAULT_TIMEOUT",
      state: "retired",
    });
    expect(calls.filter((call) => call.operation === "update")).toHaveLength(1);
    assertPlaceholderArity(calls, dialect);
  });

  it("creates, adopts, and replays a source from its staged lifecycle reservation", async () => {
    const cases = [
      { lifecycleState: "staged" as const, source: null, version: 1 },
      { lifecycleState: "staged" as const, source: sourceRow(oldRef, 4), version: 4 },
      { lifecycleState: "active" as const, source: sourceRow(oldRef, 4), version: 4 },
    ];
    for (const testCase of cases) {
      const database = createDatabase(dialect, async (input) => {
        if (input.operation === "select" && input.tableName === "source_secret_lifecycle_refs") {
          return {
            rows: [
              lifecycleRow(testCase.lifecycleState, {
                operationId: "create-request-1",
                sourceVersion: testCase.source?.version ?? null,
              }),
            ],
            rowsAffected: 0,
          };
        }
        if (input.operation === "select" && input.tableName === "sources") {
          return { rows: testCase.source ? [testCase.source] : [], rowsAffected: 0 };
        }
        return { rows: [], rowsAffected: input.operation === "select" ? 0 : 1 };
      });
      const repository = createDatabaseSourceRetiredSecretCleanupRepository({
        database,
        maxClaimBatchSize: 10,
        now: () => now,
      });

      await expect(
        repository.activateCreate({
          operationId: "create-request-1",
          reservedCredentialRef: oldRef,
          source: {
            id: sourceId,
            knowledgeSpaceId: spaceId,
            name: "Docs",
            permissionScope: [],
            status: "active",
            type: "connector",
            uri: "connector://docs",
          },
          tenantId,
        }),
      ).resolves.toMatchObject({ credentialRef: oldRef, version: testCase.version });
    }

    const conflicting = createDatabase(dialect, async (input) => {
      if (input.operation === "select" && input.tableName === "source_secret_lifecycle_refs") {
        return { rows: [lifecycleRow("active")], rowsAffected: 0 };
      }
      if (input.operation === "select" && input.tableName === "sources") {
        return { rows: [sourceRow(newRef, 2)], rowsAffected: 0 };
      }
      return { rows: [], rowsAffected: input.operation === "select" ? 0 : 1 };
    });
    await expect(
      createDatabaseSourceRetiredSecretCleanupRepository({
        database: conflicting,
        maxClaimBatchSize: 10,
      }).activateCreate({
        operationId: "create-request-1",
        reservedCredentialRef: oldRef,
        source: {
          id: sourceId,
          knowledgeSpaceId: spaceId,
          name: "Docs",
          permissionScope: [],
          status: "active",
          type: "connector",
          uri: "connector://docs",
        },
        tenantId,
      }),
    ).rejects.toBeInstanceOf(SourceRetiredSecretCleanupTransitionError);
  });

  it("revalidates live refs for deleted tombstones and expired staged rows", async () => {
    for (const lifecycleState of ["deleted", "retired"] as const) {
      const database = createDatabase(dialect, async (input) => {
        if (
          input.operation === "select" &&
          input.tableName === "source_secret_lifecycle_refs" &&
          input.sql.includes("ORDER BY")
        ) {
          return { rows: [lifecycleRow(lifecycleState)], rowsAffected: 0 };
        }
        if (input.operation === "select" && input.tableName === "sources") {
          return { rows: [sourceRow(oldRef, 1)], rowsAffected: 0 };
        }
        return { rows: [], rowsAffected: input.operation === "select" ? 0 : 1 };
      });
      const repository = createDatabaseSourceRetiredSecretCleanupRepository({
        database,
        maxClaimBatchSize: 10,
      });
      await expect(
        repository.beginDelete({ leaseExpiresAt: later, now, workerId: "cleanup" }),
      ).resolves.toBeNull();
    }

    for (const use of ["active", "candidate", "retired"] as const) {
      const database = createDatabase(dialect, async (input) => {
        if (
          input.operation === "select" &&
          input.tableName === "source_secret_lifecycle_refs" &&
          input.sql.includes("ORDER BY")
        ) {
          return {
            rows: [
              lifecycleRow("staged", {
                operationId: "create-request-1",
                sourceVersion: null,
              }),
            ],
            rowsAffected: 0,
          };
        }
        if (input.operation === "select" && input.tableName === "sources") {
          return { rows: use === "active" ? [sourceRow(oldRef, 1)] : [], rowsAffected: 0 };
        }
        if (input.operation === "select" && input.tableName === "source_credential_backfills") {
          return { rows: use === "candidate" ? [backfillRow()] : [], rowsAffected: 0 };
        }
        return { rows: [], rowsAffected: input.operation === "select" ? 0 : 1 };
      });
      const repository = createDatabaseSourceRetiredSecretCleanupRepository({
        database,
        maxClaimBatchSize: 10,
      });
      await expect(
        repository.reconcileExpiredStaged({ nextRecoverAfter: later, now }),
      ).resolves.toMatchObject({ state: use });
    }
  });

  it("exposes database cleanup jobs through compatibility wrappers", async () => {
    const deletingRow = lifecycleRow("deleting", {
      heartbeatAt: now,
      leaseExpiresAt: later,
      leaseToken,
      rowVersion: 3,
      workerId: "cleanup-worker",
    });
    const database = createDatabase(dialect, async (input) => {
      if (input.operation === "select" && input.tableName === "source_secret_lifecycle_refs") {
        return { rows: [deletingRow], rowsAffected: 0 };
      }
      if (input.operation === "select" && input.tableName === "sources") {
        return { rows: [sourceRow(oldRef, 1)], rowsAffected: 0 };
      }
      return { rows: [], rowsAffected: input.operation === "select" ? 0 : 1 };
    });
    const repository = createDatabaseSourceRetiredSecretCleanupRepository({
      database,
      maxClaimBatchSize: 10,
    });
    const fence = {
      expectedRowVersion: 3,
      jobId: lifecycleId,
      leaseToken,
      now,
    };

    await expect(repository.get({ jobId: lifecycleId })).resolves.toMatchObject({
      runState: "running",
    });
    await expect(repository.retry({ jobId: lifecycleId, now })).resolves.toMatchObject({
      runState: "running",
    });
    await expect(
      repository.heartbeat({
        ...fence,
        leaseExpiresAt: later,
        workerId: "cleanup-worker",
      }),
    ).resolves.toMatchObject({ runState: "running" });
    await expect(
      repository.retryableFailure({
        ...fence,
        errorCode: "VAULT_TIMEOUT",
        errorMessage: "vault timed out",
      }),
    ).resolves.toMatchObject({ runState: "queued" });
    await expect(
      repository.fail({
        ...fence,
        errorCode: "VAULT_OFFLINE",
        errorMessage: "vault offline",
      }),
    ).resolves.toMatchObject({ runState: "queued" });
    await expect(repository.complete(fence)).resolves.toMatchObject({ runState: "succeeded" });
    await expect(repository.isReferenceInUse({ retiredCredentialRef: oldRef })).resolves.toBe(true);
    await expect(
      repository.claim({ leaseExpiresAt: later, limit: 0, now, workerId: "cleanup-worker" }),
    ).rejects.toThrow("Invalid lifecycle claim limit");
  });

  it("replays active candidate assignment and adopts assigned candidates during cleanup", async () => {
    const activeCandidateDatabase = createDatabase(dialect, async (input) => {
      if (input.operation === "select" && input.tableName === "source_secret_lifecycle_refs") {
        return {
          rows: [
            lifecycleRow("active", {
              operationId: lifecycleId,
              purpose: "backfill",
              sourceVersion: 4,
            }),
          ],
          rowsAffected: 0,
        };
      }
      if (input.operation === "select" && input.tableName === "sources") {
        return { rows: [sourceRow(oldRef, 4)], rowsAffected: 0 };
      }
      return { rows: [], rowsAffected: input.operation === "select" ? 0 : 1 };
    });
    const activeCandidate = createDatabaseSourceRetiredSecretCleanupRepository({
      database: activeCandidateDatabase,
      maxClaimBatchSize: 10,
    });
    await expect(
      activeCandidate.candidateActivate({
        candidateCredentialRef: oldRef,
        expectedJobRowVersion: 4,
        expectedSourceVersion: 3,
        jobId: lifecycleId,
        knowledgeSpaceId: spaceId,
        leaseToken,
        metadata: {},
        now,
        sourceId,
        tenantId,
      }),
    ).resolves.toMatchObject({ credentialRef: oldRef, version: 4 });

    const assignedCandidateDatabase = createDatabase(dialect, async (input) => {
      if (input.operation === "select" && input.tableName === "source_secret_lifecycle_refs") {
        return {
          rows:
            input.params[0] === newRef
              ? []
              : [
                  lifecycleRow("candidate", {
                    operationId: lifecycleId,
                    purpose: "backfill",
                    rowVersion: 0,
                    sourceVersion: null,
                  }),
                ],
          rowsAffected: 0,
        };
      }
      if (input.operation === "select" && input.tableName === "source_credential_backfills") {
        return { rows: [backfillRow()], rowsAffected: 0 };
      }
      if (input.operation === "select" && input.tableName === "sources") {
        return { rows: [sourceRow(oldRef, 3)], rowsAffected: 0 };
      }
      return { rows: [], rowsAffected: input.operation === "select" ? 0 : 1 };
    });
    const assignedCandidate = createDatabaseSourceRetiredSecretCleanupRepository({
      database: assignedCandidateDatabase,
      maxClaimBatchSize: 10,
    });
    await expect(
      assignedCandidate.candidateAbandon({
        candidateCredentialRef: oldRef,
        expectedJobRowVersion: 4,
        jobId: lifecycleId,
        leaseToken,
        now,
      }),
    ).resolves.toMatchObject({ state: "active" });
    await expect(
      assignedCandidate.candidateRefresh({
        expectedJobRowVersion: 4,
        jobId: lifecycleId,
        knowledgeSpaceId: spaceId,
        leaseToken,
        newCandidateCredentialRef: newRef,
        newRecoverAfter: later,
        now,
        oldCandidateCredentialRef: oldRef,
        sourceId,
        tenantId,
      }),
    ).resolves.toMatchObject({ state: "active" });
  });

  it("keeps retire idempotent and rejects deletion-owned rows", async () => {
    for (const state of ["retired", "deleting", "deleted"] as const) {
      const database = createDatabase(dialect, async (input) =>
        input.operation === "select" && input.tableName === "source_secret_lifecycle_refs"
          ? {
              rows: [
                lifecycleRow(
                  state,
                  state === "deleting"
                    ? {
                        heartbeatAt: now,
                        leaseExpiresAt: later,
                        leaseToken,
                        workerId: "cleanup-worker",
                      }
                    : {},
                ),
              ],
              rowsAffected: 0,
            }
          : { rows: [], rowsAffected: input.operation === "select" ? 0 : 1 },
      );
      const repository = createDatabaseSourceRetiredSecretCleanupRepository({
        database,
        maxClaimBatchSize: 10,
      });
      const result = repository.retire({ credentialRef: oldRef, now });
      if (state === "retired") {
        await expect(result).resolves.toMatchObject({ state: "retired" });
      } else {
        await expect(result).rejects.toBeInstanceOf(SourceRetiredSecretCleanupTransitionError);
      }
    }
  });
});

describe("database source secret lifecycle edge coverage", () => {
  const candidateFence = {
    expectedJobRowVersion: 4,
    jobId: lifecycleId,
    leaseToken,
    now,
  };
  const candidateActivation = {
    ...candidateFence,
    candidateCredentialRef: oldRef,
    expectedSourceVersion: 3,
    knowledgeSpaceId: spaceId,
    metadata: {},
    sourceId,
    tenantId,
  };
  const candidateRefresh = {
    ...candidateFence,
    knowledgeSpaceId: spaceId,
    newCandidateCredentialRef: newRef,
    newRecoverAfter: later,
    oldCandidateCredentialRef: oldRef,
    sourceId,
    tenantId,
  };

  it("covers empty reads, candidate reservation replay, and compatibility misses", async () => {
    for (const dialect of ["postgres", "tidb"] as const) {
      const emptyRepository = createDatabaseSourceRetiredSecretCleanupRepository({
        database: createDatabase(dialect, async (input) => ({
          rows: [],
          rowsAffected: input.operation === "select" ? 0 : 1,
        })),
        generateId: () => lifecycleId,
        maxClaimBatchSize: 2,
        now: () => now,
      });
      await expect(
        emptyRepository.reserveCandidate({
          credentialRef: oldRef,
          knowledgeSpaceId: spaceId,
          operationId: lifecycleId,
          recoverAfter: later,
          sourceId,
          tenantId,
        }),
      ).resolves.toMatchObject({ purpose: "backfill", state: "candidate" });
      await expect(
        emptyRepository.beginDelete({ leaseExpiresAt: later, now, workerId: "worker-empty" }),
      ).resolves.toBeNull();
      await expect(
        emptyRepository.reconcileExpiredStaged({ nextRecoverAfter: later, now }),
      ).resolves.toBeNull();
      await expect(
        emptyRepository.claim({ leaseExpiresAt: later, limit: 0, now, workerId: "worker-empty" }),
      ).rejects.toThrow("claim limit");
      await expect(
        emptyRepository.claim({ leaseExpiresAt: later, limit: 1, now, workerId: "worker-empty" }),
      ).resolves.toEqual([]);
      await expect(emptyRepository.get({ jobId: lifecycleId })).resolves.toBeNull();
      await expect(emptyRepository.retry({ jobId: lifecycleId, now })).resolves.toBeNull();
      await expect(
        emptyRepository.isReferenceInUse({ retiredCredentialRef: oldRef }),
      ).resolves.toBe(false);
      await expect(
        emptyRepository.replaceCredentialAndRetire({
          credentialRef: null,
          expectedVersion: 1,
          knowledgeSpaceId: spaceId,
          metadata: {},
          reason: "revoke",
          sourceId,
          tenantId,
        }),
      ).resolves.toBeNull();
      await expect(
        emptyRepository.complete({
          expectedRowVersion: 1,
          jobId: lifecycleId,
          leaseToken,
          now,
        }),
      ).rejects.toBeInstanceOf(SourceRetiredSecretCleanupTransitionError);
    }

    const replayDatabase = createDatabase("postgres", async (input) => {
      if (input.operation === "select" && input.tableName === "source_secret_lifecycle_refs") {
        return {
          rows: [
            lifecycleRow("candidate", {
              operationId: lifecycleId,
              purpose: "backfill",
              rowVersion: 0,
              sourceVersion: null,
            }),
          ],
          rowsAffected: 0,
        };
      }
      return { rows: [], rowsAffected: input.operation === "select" ? 0 : 1 };
    });
    const replay = createDatabaseSourceRetiredSecretCleanupRepository({
      database: replayDatabase,
      maxClaimBatchSize: 2,
    });
    await expect(
      replay.reserveCandidate({
        credentialRef: oldRef,
        knowledgeSpaceId: spaceId,
        operationId: lifecycleId,
        recoverAfter: later,
        sourceId,
        tenantId,
      }),
    ).resolves.toMatchObject({ state: "candidate" });
    await expect(
      replay.reserveStaged({
        credentialRef: oldRef,
        knowledgeSpaceId: spaceId,
        operationId: "different-operation",
        purpose: "create",
        recoverAfter: later,
        sourceId,
        tenantId,
      }),
    ).rejects.toBeInstanceOf(SourceRetiredSecretCleanupTransitionError);
  });

  it("fails create activation for invalid lifecycle and existing-source bindings", async () => {
    const activate = (state: "candidate" | "staged", credentialRef: string | null) => {
      const database = createDatabase("postgres", async (input) => {
        if (input.operation === "select" && input.tableName === "source_secret_lifecycle_refs") {
          return {
            rows: [
              lifecycleRow(state, {
                operationId: "create-edge",
                purpose: state === "candidate" ? "backfill" : "create",
              }),
            ],
            rowsAffected: 0,
          };
        }
        if (input.operation === "select" && input.tableName === "sources") {
          return credentialRef
            ? { rows: [sourceRow(credentialRef, 1)], rowsAffected: 0 }
            : { rows: [], rowsAffected: 0 };
        }
        return { rows: [], rowsAffected: input.operation === "select" ? 0 : 1 };
      });
      return createDatabaseSourceRetiredSecretCleanupRepository({
        database,
        maxClaimBatchSize: 2,
      }).activateCreate({
        operationId: "create-edge",
        reservedCredentialRef: oldRef,
        source: {
          id: sourceId,
          knowledgeSpaceId: spaceId,
          name: "Create edge",
          type: "connector",
          uri: "connector://create-edge",
        },
        tenantId,
      });
    };

    await expect(activate("candidate", null)).rejects.toBeInstanceOf(
      SourceRetiredSecretCleanupTransitionError,
    );
    await expect(activate("staged", newRef)).rejects.toBeInstanceOf(
      SourceRetiredSecretCleanupTransitionError,
    );
  });

  it("covers rotation replay, missing current rows, and CAS conflicts", async () => {
    const rotate = (
      lifecycle: (credentialRef: string) => ReturnType<typeof lifecycleRow>,
      observed: DatabaseExecuteResult,
      current: DatabaseExecuteResult,
      newCredentialRef: string | null,
      expectedVersion = 1,
    ) => {
      const database = createDatabase("postgres", async (input) => {
        if (input.operation === "select" && input.tableName === "source_secret_lifecycle_refs") {
          return {
            rows: [lifecycle(String(input.params[0]))],
            rowsAffected: 0,
          };
        }
        if (input.operation === "select" && input.tableName === "sources") {
          return input.sql.includes("FOR UPDATE") ? current : observed;
        }
        return { rows: [], rowsAffected: input.operation === "select" ? 0 : 1 };
      });
      return createDatabaseSourceRetiredSecretCleanupRepository({
        database,
        maxClaimBatchSize: 2,
      }).activateRotateAndRetire({
        expectedVersion,
        knowledgeSpaceId: spaceId,
        metadata: {},
        newCredentialRef,
        ...(newCredentialRef ? { operationId: "rotate-edge" } : {}),
        sourceId,
        tenantId,
      });
    };

    const sourceOld = { rows: [sourceRow(oldRef, 1)], rowsAffected: 0 };
    await expect(
      rotate(() => lifecycleRow("active"), sourceOld, { rows: [], rowsAffected: 0 }, null),
    ).resolves.toBeNull();

    const sourceNewV2 = { rows: [sourceRow(newRef, 2)], rowsAffected: 0 };
    await expect(
      rotate(
        () =>
          lifecycleRow("active", {
            credentialRef: newRef,
            operationId: "rotate-edge",
            purpose: "rotate",
            sourceVersion: 2,
          }),
        sourceNewV2,
        sourceNewV2,
        newRef,
      ),
    ).resolves.toMatchObject({ credentialRef: newRef, version: 2 });

    await expect(
      rotate(
        () =>
          lifecycleRow("retired", {
            credentialRef: newRef,
            operationId: "rotate-edge",
            purpose: "rotate",
          }),
        sourceOld,
        sourceOld,
        newRef,
      ),
    ).rejects.toBeInstanceOf(SourceRetiredSecretCleanupTransitionError);

    await expect(
      rotate(
        () => lifecycleRow("active"),
        sourceOld,
        { rows: [sourceRow(newRef, 1)], rowsAffected: 0 },
        null,
      ),
    ).rejects.toThrow("modified concurrently");

    await expect(
      rotate(() => lifecycleRow("staged"), sourceOld, sourceOld, null),
    ).rejects.toBeInstanceOf(SourceRetiredSecretCleanupTransitionError);

    const noPrior = { rows: [sourceRow(null, 1)], rowsAffected: 0 };
    await expect(
      rotate(
        () =>
          lifecycleRow("staged", {
            credentialRef: newRef,
            operationId: "rotate-edge",
            purpose: "rotate",
            sourceVersion: null,
          }),
        noPrior,
        noPrior,
        newRef,
      ),
    ).rejects.toBeInstanceOf(SourceRetiredSecretCleanupTransitionError);
  });

  it("covers candidate activation and refresh replay rejection branches", async () => {
    const candidateRepository = (
      lifecycleFor: (ref: string) => DatabaseExecuteResult,
      source: DatabaseExecuteResult,
      job: DatabaseExecuteResult = { rows: [backfillRow()], rowsAffected: 0 },
    ) => {
      const database = createDatabase("postgres", async (input) => {
        if (input.operation === "select" && input.tableName === "source_secret_lifecycle_refs") {
          return lifecycleFor(String(input.params[0]));
        }
        if (input.operation === "select" && input.tableName === "source_credential_backfills") {
          return job;
        }
        if (input.operation === "select" && input.tableName === "sources") return source;
        return { rows: [], rowsAffected: input.operation === "select" ? 0 : 1 };
      });
      return createDatabaseSourceRetiredSecretCleanupRepository({
        database,
        generateId: () => "30000000-0000-4000-8000-000000000077",
        maxClaimBatchSize: 2,
      });
    };
    const row = (state: "active" | "candidate" | "retired" | "staged", ref = oldRef) => ({
      rows: [
        lifecycleRow(state, {
          credentialRef: ref,
          operationId: lifecycleId,
          purpose: "backfill",
          rowVersion: 0,
          sourceVersion: state === "active" ? 4 : null,
        }),
      ],
      rowsAffected: 0,
    });

    await expect(
      candidateRepository(() => row("active"), {
        rows: [sourceRow(newRef, 4)],
        rowsAffected: 0,
      }).candidateActivate(candidateActivation),
    ).rejects.toBeInstanceOf(SourceRetiredSecretCleanupTransitionError);
    await expect(
      candidateRepository(() => row("staged"), { rows: [], rowsAffected: 0 }).candidateActivate(
        candidateActivation,
      ),
    ).rejects.toBeInstanceOf(SourceRetiredSecretCleanupTransitionError);
    await expect(
      candidateRepository(
        () => row("candidate"),
        { rows: [], rowsAffected: 0 },
        { rows: [{ ...backfillRow(), candidate_credential_ref: newRef }], rowsAffected: 0 },
      ).candidateActivate(candidateActivation),
    ).rejects.toBeInstanceOf(SourceRetiredSecretCleanupTransitionError);
    await expect(
      candidateRepository(() => row("candidate"), {
        rows: [sourceRow(oldRef, 3)],
        rowsAffected: 0,
      }).candidateActivate(candidateActivation),
    ).resolves.toBeNull();

    await expect(
      candidateRepository(() => ({ rows: [], rowsAffected: 0 }), {
        rows: [],
        rowsAffected: 0,
      }).candidateAbandon({ ...candidateFence, candidateCredentialRef: oldRef }),
    ).rejects.toBeInstanceOf(SourceRetiredSecretCleanupTransitionError);

    await expect(
      candidateRepository(() => ({ rows: [], rowsAffected: 0 }), {
        rows: [],
        rowsAffected: 0,
      }).candidateRefresh(candidateRefresh),
    ).rejects.toBeInstanceOf(SourceRetiredSecretCleanupTransitionError);

    await expect(
      candidateRepository(
        (ref) => (ref === oldRef ? row("retired", oldRef) : row("candidate", newRef)),
        { rows: [], rowsAffected: 0 },
      ).candidateRefresh(candidateRefresh),
    ).resolves.toMatchObject({ credentialRef: newRef, state: "candidate" });

    await expect(
      candidateRepository(() => row("active"), { rows: [], rowsAffected: 0 }).candidateRefresh(
        candidateRefresh,
      ),
    ).rejects.toBeInstanceOf(SourceRetiredSecretCleanupTransitionError);

    await expect(
      candidateRepository(
        (ref) => (ref === oldRef ? row("candidate", oldRef) : { rows: [], rowsAffected: 0 }),
        { rows: [], rowsAffected: 0 },
        { rows: [{ ...backfillRow(), candidate_credential_ref: newRef }], rowsAffected: 0 },
      ).candidateRefresh(candidateRefresh),
    ).rejects.toBeInstanceOf(SourceRetiredSecretCleanupTransitionError);

    await expect(
      candidateRepository(
        (ref) => (ref === oldRef ? row("candidate", oldRef) : { rows: [], rowsAffected: 0 }),
        { rows: [], rowsAffected: 0 },
      ).candidateRefresh(candidateRefresh),
    ).rejects.toBeInstanceOf(SourceRetiredSecretCleanupTransitionError);

    await expect(
      candidateRepository(
        (ref) => (ref === oldRef ? row("candidate", oldRef) : row("candidate", newRef)),
        { rows: [sourceRow(null, 3)], rowsAffected: 0 },
      ).candidateRefresh(candidateRefresh),
    ).rejects.toBeInstanceOf(SourceRetiredSecretCleanupTransitionError);
  });
});

async function createActiveSource(
  repository: ReturnType<typeof createInMemorySourceRetiredSecretCleanupRepository>,
) {
  await repository.reserveStaged({
    credentialRef: oldRef,
    knowledgeSpaceId: spaceId,
    operationId: "create-request-1",
    purpose: "create",
    recoverAfter: later,
    sourceId,
    tenantId,
  });
  return repository.activateCreate({
    operationId: "create-request-1",
    reservedCredentialRef: oldRef,
    source: {
      id: sourceId,
      knowledgeSpaceId: spaceId,
      name: "Docs",
      type: "connector",
      uri: "connector://docs",
    },
    tenantId,
  });
}

function memoryRepository(candidateReferenceInUse?: (ref: string) => Promise<boolean>) {
  const sources = createInMemorySourceRepository({ maxSources: 10, now: () => now });
  let ids = 0;
  const repository = createInMemorySourceRetiredSecretCleanupRepository({
    ...(candidateReferenceInUse ? { candidateReferenceInUse } : {}),
    generateId: () => {
      ids += 1;
      return `30000000-0000-4000-8000-${String(ids).padStart(12, "0")}`;
    },
    generateLeaseToken: () => leaseToken,
    maxClaimBatchSize: 10,
    maxJobs: 100,
    now: () => now,
    sources,
  });
  return { repository, sources };
}

function createDatabase(
  dialect: "postgres" | "tidb",
  execute: (input: DatabaseExecuteInput) => Promise<DatabaseExecuteResult>,
  transactionState?: (running: boolean) => void,
  admission?: { readonly activeDeletion?: boolean | undefined },
): DatabaseAdapter {
  const admittedExecute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    const result = await execute(input);
    if (input.operation === "select" && input.tableName === "knowledge_spaces") {
      return {
        rows: [{ deletion_job_id: null, id: spaceId, lifecycle_state: "active" }],
        rowsAffected: 0,
      };
    }
    if (input.operation === "select" && input.tableName === "deletion_jobs") {
      return {
        rows: admission?.activeDeletion ? [{ id: "active-deletion-job" }] : [],
        rowsAffected: 0,
      };
    }
    return result;
  };
  return {
    dialect,
    execute: admittedExecute,
    kind: dialect,
    transaction: async <T>(callback: DatabaseTransactionCallback<T>) => {
      transactionState?.(true);
      try {
        return await callback({ execute: admittedExecute });
      } finally {
        transactionState?.(false);
      }
    },
  } as unknown as DatabaseAdapter;
}

function lifecycleRow(
  state: "active" | "candidate" | "deleted" | "deleting" | "retired" | "staged",
  options: {
    readonly credentialRef?: string;
    readonly heartbeatAt?: string;
    readonly leaseExpiresAt?: string;
    readonly leaseToken?: string;
    readonly operationId?: string;
    readonly purpose?: "backfill" | "create" | "rotate";
    readonly rowVersion?: number;
    readonly sourceVersion?: number | null;
    readonly workerId?: string;
  } = {},
) {
  return {
    created_at: now,
    credential_ref: options.credentialRef ?? oldRef,
    delete_attempts: 0,
    deleted_at: state === "deleted" ? now : null,
    heartbeat_at: options.heartbeatAt ?? null,
    id: lifecycleId,
    knowledge_space_id: spaceId,
    last_error_code: null,
    last_error_message: null,
    lease_expires_at: options.leaseExpiresAt ?? null,
    lease_token: options.leaseToken ?? null,
    next_delete_at: state === "retired" || state === "deleted" ? now : null,
    operation_id: options.operationId ?? "create-request-1",
    purpose: options.purpose ?? "create",
    recover_after: later,
    row_version: options.rowVersion ?? (state === "active" ? 1 : 2),
    source_id: sourceId,
    source_version: "sourceVersion" in options ? options.sourceVersion : 1,
    state,
    tenant_id: tenantId,
    updated_at: now,
    worker_id: options.workerId ?? null,
  };
}

function backfillRow() {
  return {
    candidate_credential_ref: oldRef,
    knowledge_space_id: spaceId,
    lease_expires_at: later,
    lease_token: leaseToken,
    row_version: 4,
    run_state: "running",
    source_id: sourceId,
    source_version: 3,
    tenant_id: tenantId,
  };
}

function sourceRow(credentialRef: string | null, version: number) {
  return {
    created_at: now,
    credential_ref: credentialRef,
    id: sourceId,
    knowledge_space_id: spaceId,
    metadata: {},
    name: "Docs",
    permission_scope: [],
    status: "active",
    type: "connector",
    updated_at: now,
    uri: "connector://docs",
    version,
  };
}

function assertPlaceholderArity(
  calls: readonly DatabaseExecuteInput[],
  dialect: "postgres" | "tidb",
) {
  for (const call of calls) {
    if (dialect === "postgres") {
      const positions = [...call.sql.matchAll(/\$(\d+)/gu)].map((match) => Number(match[1]));
      expect(Math.max(0, ...positions), call.sql).toBe(call.params.length);
    } else {
      expect((call.sql.match(/\?/gu) ?? []).length, call.sql).toBe(call.params.length);
    }
  }
}
