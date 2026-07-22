import { describe, expect, it } from "vitest";

import { createInMemorySourceRepository } from "./source-repository";
import {
  SourceRetiredSecretCleanupTransitionError,
  createInMemorySourceRetiredSecretCleanupRepository,
} from "./source-retired-secret-cleanup";

const TENANT_ID = "tenant-1";
const SPACE_ID = "10000000-0000-4000-8000-000000000001";
const SOURCE_ID = "20000000-0000-4000-8000-000000000001";
const JOB_ID = "30000000-0000-4000-8000-000000000001";
const LEASE_TOKEN = "30000000-0000-4000-8000-000000000002";
const OLD_REF = "source-secret:v1:40000000-0000-4000-8000-000000000001";
const NEW_REF = "source-secret:v1:50000000-0000-4000-8000-000000000001";
const THIRD_REF = "source-secret:v1:60000000-0000-4000-8000-000000000001";
const NOW = "2026-07-21T12:00:00.000Z";
const MID = "2026-07-21T12:01:00.000Z";
const LATER = "2026-07-21T12:05:00.000Z";
const LATEST = "2026-07-21T12:10:00.000Z";

function harness(options: { readonly maxJobs?: number } = {}) {
  const sources = createInMemorySourceRepository({ maxSources: 20, now: () => NOW });
  let nextId = 0;
  const repository = createInMemorySourceRetiredSecretCleanupRepository({
    generateId: () => {
      nextId += 1;
      return `30000000-0000-4000-8001-${String(nextId).padStart(12, "0")}`;
    },
    generateLeaseToken: () => LEASE_TOKEN,
    maxClaimBatchSize: 10,
    maxJobs: options.maxJobs ?? 20,
    now: () => NOW,
    sources,
  });
  return { repository, sources };
}

async function createUncredentialedSource(
  sources: ReturnType<typeof createInMemorySourceRepository>,
) {
  return sources.create({
    id: SOURCE_ID,
    knowledgeSpaceId: SPACE_ID,
    name: "Docs",
    type: "connector",
    uri: "connector://docs",
  });
}

function candidateFence() {
  return {
    expectedJobRowVersion: 0,
    jobId: JOB_ID,
    leaseToken: LEASE_TOKEN,
    now: NOW,
  };
}

async function reserveCandidate(
  repository: ReturnType<typeof createInMemorySourceRetiredSecretCleanupRepository>,
  credentialRef = OLD_REF,
) {
  return repository.reserveCandidate({
    credentialRef,
    knowledgeSpaceId: SPACE_ID,
    operationId: JOB_ID,
    recoverAfter: LATER,
    sourceId: SOURCE_ID,
    tenantId: TENANT_ID,
  });
}

describe("in-memory source retired-secret cleanup behavior", () => {
  it("activates a backfill candidate atomically and replays the committed assignment", async () => {
    const { repository, sources } = harness();
    const source = await createUncredentialedSource(sources);
    await reserveCandidate(repository);
    const input = {
      ...candidateFence(),
      candidateCredentialRef: OLD_REF,
      expectedSourceVersion: source.version,
      knowledgeSpaceId: SPACE_ID,
      metadata: { provider: "docs" },
      sourceId: SOURCE_ID,
      tenantId: TENANT_ID,
    };

    const activated = await repository.candidateActivate(input);
    expect(activated).toMatchObject({ credentialRef: OLD_REF, version: source.version + 1 });
    await expect(repository.candidateActivate(input)).resolves.toEqual(activated);
    await expect(repository.getByRef({ credentialRef: OLD_REF })).resolves.toMatchObject({
      sourceVersion: source.version + 1,
      state: "active",
    });
  });

  it("returns null for stale candidate activation and rejects a non-candidate transition", async () => {
    const { repository, sources } = harness();
    const source = await createUncredentialedSource(sources);
    await reserveCandidate(repository);

    await expect(
      repository.candidateActivate({
        ...candidateFence(),
        candidateCredentialRef: OLD_REF,
        expectedSourceVersion: source.version + 1,
        knowledgeSpaceId: SPACE_ID,
        metadata: {},
        sourceId: SOURCE_ID,
        tenantId: TENANT_ID,
      }),
    ).resolves.toBeNull();
    await repository.candidateAbandon({
      ...candidateFence(),
      candidateCredentialRef: OLD_REF,
      errorCode: "STALE_SOURCE",
      errorMessage: "source changed",
    });
    await expect(
      repository.candidateActivate({
        ...candidateFence(),
        candidateCredentialRef: OLD_REF,
        expectedSourceVersion: source.version,
        knowledgeSpaceId: SPACE_ID,
        metadata: {},
        sourceId: SOURCE_ID,
        tenantId: TENANT_ID,
      }),
    ).rejects.toBeInstanceOf(SourceRetiredSecretCleanupTransitionError);
  });

  it("abandons unused candidates but adopts a candidate already assigned by another worker", async () => {
    const unused = harness();
    await createUncredentialedSource(unused.sources);
    await reserveCandidate(unused.repository);
    const retired = await unused.repository.candidateAbandon({
      ...candidateFence(),
      candidateCredentialRef: OLD_REF,
      errorCode: "SOURCE_CHANGED",
      errorMessage: "source changed before activation",
    });
    expect(retired).toMatchObject({
      lastErrorCode: "SOURCE_CHANGED",
      nextDeleteAt: NOW,
      state: "retired",
    });
    await expect(
      unused.repository.candidateAbandon({
        ...candidateFence(),
        candidateCredentialRef: OLD_REF,
      }),
    ).resolves.toEqual(retired);

    const adopted = harness();
    const source = await createUncredentialedSource(adopted.sources);
    await reserveCandidate(adopted.repository);
    await adopted.sources.update({
      credentialRef: OLD_REF,
      expectedVersion: source.version,
      id: SOURCE_ID,
      knowledgeSpaceId: SPACE_ID,
    });
    await expect(
      adopted.repository.candidateAbandon({
        ...candidateFence(),
        candidateCredentialRef: OLD_REF,
      }),
    ).resolves.toMatchObject({ state: "active" });
  });

  it("refreshes an expired candidate idempotently and adopts a concurrently assigned old ref", async () => {
    const refreshed = harness();
    await createUncredentialedSource(refreshed.sources);
    await reserveCandidate(refreshed.repository);
    const refreshInput = {
      ...candidateFence(),
      knowledgeSpaceId: SPACE_ID,
      newCandidateCredentialRef: NEW_REF,
      newRecoverAfter: LATEST,
      oldCandidateCredentialRef: OLD_REF,
      sourceId: SOURCE_ID,
      tenantId: TENANT_ID,
    };
    const next = await refreshed.repository.candidateRefresh(refreshInput);
    expect(next).toMatchObject({ credentialRef: NEW_REF, state: "candidate" });
    await expect(refreshed.repository.candidateRefresh(refreshInput)).resolves.toEqual(next);
    await expect(refreshed.repository.getByRef({ credentialRef: OLD_REF })).resolves.toMatchObject({
      nextDeleteAt: NOW,
      state: "retired",
    });

    const adopted = harness();
    const source = await createUncredentialedSource(adopted.sources);
    await reserveCandidate(adopted.repository);
    await adopted.sources.update({
      credentialRef: OLD_REF,
      expectedVersion: source.version,
      id: SOURCE_ID,
      knowledgeSpaceId: SPACE_ID,
    });
    await expect(adopted.repository.candidateRefresh(refreshInput)).resolves.toMatchObject({
      state: "active",
    });
  });

  it("rejects reservation collisions and enforces the bounded lifecycle registry", async () => {
    const { repository } = harness({ maxJobs: 1 });
    await reserveCandidate(repository);
    await expect(
      repository.reserveCandidate({
        credentialRef: OLD_REF,
        knowledgeSpaceId: SPACE_ID,
        operationId: "30000000-0000-4000-8000-000000000099",
        recoverAfter: LATER,
        sourceId: SOURCE_ID,
        tenantId: TENANT_ID,
      }),
    ).rejects.toBeInstanceOf(SourceRetiredSecretCleanupTransitionError);
    await expect(
      repository.reserveCandidate({
        credentialRef: NEW_REF,
        knowledgeSpaceId: SPACE_ID,
        operationId: JOB_ID,
        recoverAfter: LATER,
        sourceId: SOURCE_ID,
        tenantId: TENANT_ID,
      }),
    ).rejects.toThrow("maxJobs=1 exceeded");
    await expect(repository.retire({ credentialRef: THIRD_REF, now: NOW })).rejects.toBeInstanceOf(
      SourceRetiredSecretCleanupTransitionError,
    );
  });

  it("supports legacy replace-and-retire by adopting the live ref before rotation", async () => {
    const { repository, sources } = harness();
    await sources.create({
      credentialRef: OLD_REF,
      id: SOURCE_ID,
      knowledgeSpaceId: SPACE_ID,
      name: "Legacy docs",
      type: "connector",
      uri: "connector://legacy-docs",
    });

    const rotated = await repository.replaceCredentialAndRetire({
      credentialRef: NEW_REF,
      expectedVersion: 1,
      knowledgeSpaceId: SPACE_ID,
      metadata: { rotated: true },
      reason: "rotate",
      sourceId: SOURCE_ID,
      tenantId: TENANT_ID,
    });

    expect(rotated).toMatchObject({ credentialRef: NEW_REF, version: 2 });
    await expect(repository.getByRef({ credentialRef: OLD_REF })).resolves.toMatchObject({
      state: "retired",
    });
    await expect(repository.getByRef({ credentialRef: NEW_REF })).resolves.toMatchObject({
      state: "active",
    });
  });

  it("exercises compatibility claim, heartbeat, retry, fail, complete, and lookup semantics", async () => {
    const { repository } = harness();
    await repository.reserveStaged({
      credentialRef: OLD_REF,
      knowledgeSpaceId: SPACE_ID,
      operationId: JOB_ID,
      purpose: "rotate",
      recoverAfter: LATER,
      sourceId: SOURCE_ID,
      tenantId: TENANT_ID,
    });
    await repository.retire({ credentialRef: OLD_REF, now: NOW });
    await expect(
      repository.claim({ leaseExpiresAt: LATER, limit: 0, now: NOW, workerId: "cleanup-1" }),
    ).rejects.toThrow("Invalid lifecycle claim limit");

    const [claimed] = await repository.claim({
      leaseExpiresAt: LATER,
      limit: 1,
      now: NOW,
      workerId: "cleanup-1",
    });
    if (!claimed?.leaseToken) throw new Error("test cleanup claim missing lease token");
    await expect(repository.get({ jobId: claimed.id })).resolves.toMatchObject({
      runState: "running",
    });
    const heartbeat = await repository.heartbeat({
      expectedRowVersion: claimed.rowVersion,
      jobId: claimed.id,
      leaseExpiresAt: LATEST,
      leaseToken: claimed.leaseToken,
      now: MID,
      workerId: "cleanup-1",
    });
    if (!heartbeat.leaseToken) throw new Error("test heartbeat missing lease token");
    const failed = await repository.retryableFailure({
      errorCode: "VAULT_TIMEOUT",
      errorMessage: "vault timed out",
      expectedRowVersion: heartbeat.rowVersion,
      jobId: heartbeat.id,
      leaseToken: heartbeat.leaseToken,
      now: MID,
    });
    expect(failed).toMatchObject({ retryCount: 1, runState: "queued" });
    await expect(repository.retry({ jobId: failed.id, now: MID })).resolves.toEqual(failed);

    const [reclaimed] = await repository.claim({
      leaseExpiresAt: LATEST,
      limit: 1,
      now: LATER,
      workerId: "cleanup-2",
    });
    if (!reclaimed?.leaseToken) throw new Error("test cleanup reclaim missing lease token");
    const failedAgain = await repository.fail({
      errorCode: "VAULT_OFFLINE",
      errorMessage: "vault offline",
      expectedRowVersion: reclaimed.rowVersion,
      jobId: reclaimed.id,
      leaseToken: reclaimed.leaseToken,
      now: LATER,
    });
    expect(failedAgain).toMatchObject({ runState: "queued" });

    const [finalClaim] = await repository.claim({
      leaseExpiresAt: LATEST,
      limit: 1,
      now: LATER,
      workerId: "cleanup-3",
    });
    if (!finalClaim?.leaseToken) throw new Error("test final claim missing lease token");
    await expect(
      repository.complete({
        expectedRowVersion: finalClaim.rowVersion,
        jobId: finalClaim.id,
        leaseToken: finalClaim.leaseToken,
        now: LATER,
      }),
    ).resolves.toMatchObject({ runState: "succeeded" });
    await expect(
      repository.get({ jobId: "30000000-0000-4000-8000-000000000099" }),
    ).resolves.toBeNull();
    await expect(
      repository.retry({ jobId: "30000000-0000-4000-8000-000000000099", now: NOW }),
    ).resolves.toBeNull();
  });
});
