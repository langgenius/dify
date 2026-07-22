import { describe, expect, it, vi } from "vitest";

import type { KnowledgeSpacePermissionSnapshot } from "./knowledge-space-access-control";
import {
  KnowledgeSpaceProfileMigrationConflictError,
  createInMemoryKnowledgeSpaceProfileMigrationRepository,
} from "./knowledge-space-profile-migration";
import {
  type KnowledgeSpaceProfileMigrationCandidateBuildResult,
  createKnowledgeSpaceProfileMigrationRuntime,
} from "./knowledge-space-profile-migration-runtime";
import { createKnowledgeSpaceProfileMigrationService } from "./knowledge-space-profile-migration-service";
import type { KnowledgeSpaceProfilePublicationRepository } from "./knowledge-space-profile-publication-repository";

const tenantId = "tenant-1";
const spaceId = "10000000-0000-4000-8000-000000000001";
const runId = "10000000-0000-4000-8000-000000000002";
const leaseToken = "10000000-0000-4000-8000-000000000003";
const candidatePublicationId = "10000000-0000-4000-8000-000000000004";
const digestA = "a".repeat(64);
const digestB = "b".repeat(64);
const fingerprintA = `projection-set-sha256:${"c".repeat(64)}`;
const fingerprintB = `projection-set-sha256:${"d".repeat(64)}`;

describe("knowledge-space profile migration durable repository", () => {
  it("replays identical admission and fences concurrent embedding/retrieval runs", async () => {
    const repository = createInMemoryKnowledgeSpaceProfileMigrationRepository({
      generateRunId: () => runId,
      maxRuns: 10,
    });
    const input = startInput();
    const first = await repository.start(input);
    expect(await repository.start(input)).toEqual(first);
    await expect(
      repository.start({
        ...input,
        candidateProfile: { ...input.candidateProfile, revision: 3 },
        changedKind: "retrieval",
        idempotencyKey: "another-request",
        rebuildScope: "clone-publication",
      }),
    ).rejects.toMatchObject({ code: "PROFILE_MIGRATION_ALREADY_ACTIVE" });
  });

  it("recovers expired leases while rejecting stale row-version checkpoints", async () => {
    let lease = 0;
    const repository = createInMemoryKnowledgeSpaceProfileMigrationRepository({
      generateLeaseToken: () => `${lease++}`,
      generateRunId: () => runId,
      maxRuns: 10,
    });
    await repository.start(startInput());
    const [first] = await repository.claim({
      leaseExpiresAt: "2026-01-01T00:00:01.000Z",
      limit: 1,
      now: "2026-01-01T00:00:00.000Z",
      workerId: "worker-a",
    });
    expect(first).toBeDefined();
    const [recovered] = await repository.claim({
      leaseExpiresAt: "2026-01-01T00:00:03.000Z",
      limit: 1,
      now: "2026-01-01T00:00:02.000Z",
      workerId: "worker-b",
    });
    expect(recovered?.executionAttempts).toBe(2);
    expect(
      await repository.checkpoint({
        candidatePublicationFingerprint: fingerprintB,
        candidatePublicationId,
        checkpoint: "candidate-built",
        expectedRowVersion: first?.rowVersion ?? 0,
        leaseToken: first?.leaseToken ?? "",
        now: "2026-01-01T00:00:00.500Z",
        runId,
      }),
    ).toBeNull();
  });
});

describe("knowledge-space profile migration runtime", () => {
  it("requires full vector rebuild proof, evaluates, and performs one joint CAS", async () => {
    const repository = createInMemoryKnowledgeSpaceProfileMigrationRepository({
      generateLeaseToken: () => leaseToken,
      generateRunId: () => runId,
      maxRuns: 10,
    });
    await repository.start(startInput());
    const binding = bindingRepository();
    const runtime = createKnowledgeSpaceProfileMigrationRuntime({
      access: { revalidatePermissionSnapshot: async () => permissionSnapshot() },
      bindings: binding.repository,
      builder: {
        build: async () => candidate({ fullVectorSpaceRebuilt: true }),
        getBuiltCandidate: async () => candidate({ fullVectorSpaceRebuilt: true }),
      },
      claimLimit: 1,
      evaluator: { evaluate: async () => ({ passed: true, summary: { recall: 0.9 } }) },
      heartbeatIntervalMs: 500,
      leaseMs: 2_000,
      now: tickingClock(),
      repository,
      workerId: "worker-a",
    });

    await expect(runtime.tick()).resolves.toEqual({
      claimed: 1,
      failed: 0,
      stale: 0,
      succeeded: 1,
    });
    expect(binding.bind).toHaveBeenCalledOnce();
    expect(binding.activate).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedProfileHeadRevision: 1,
        expectedPublicationHeadRevision: 7,
        profileRevision: 2,
      }),
    );
    await expect(repository.get(runId)).resolves.toMatchObject({
      checkpoint: "activated",
      runState: "succeeded",
    });
  });

  it("fails closed before binding when the injected builder cannot prove rebuild completeness", async () => {
    const repository = createInMemoryKnowledgeSpaceProfileMigrationRepository({
      generateLeaseToken: () => leaseToken,
      generateRunId: () => runId,
      maxRuns: 10,
    });
    await repository.start(startInput());
    const binding = bindingRepository();
    const runtime = createKnowledgeSpaceProfileMigrationRuntime({
      access: { revalidatePermissionSnapshot: async () => permissionSnapshot() },
      bindings: binding.repository,
      builder: {
        build: async () => candidate({ fullVectorSpaceRebuilt: false }),
        getBuiltCandidate: async () => candidate({ fullVectorSpaceRebuilt: false }),
      },
      claimLimit: 1,
      evaluator: { evaluate: async () => ({ passed: true, summary: {} }) },
      leaseMs: 10_000,
      now: tickingClock(),
      repository,
      workerId: "worker-a",
    });

    await expect(runtime.tick()).resolves.toMatchObject({ failed: 1, succeeded: 0 });
    expect(binding.bind).not.toHaveBeenCalled();
    expect(binding.activate).not.toHaveBeenCalled();
    await expect(repository.get(runId)).resolves.toMatchObject({
      lastErrorCode: "PROFILE_MIGRATION_VECTOR_REBUILD_INCOMPLETE",
      runState: "failed",
    });
  });

  it("makes deterministic failures terminal and releases the space for a new settings migration", async () => {
    const successorRunId = "10000000-0000-4000-8000-000000000005";
    const runIds = [runId, successorRunId];
    const repository = createInMemoryKnowledgeSpaceProfileMigrationRepository({
      generateLeaseToken: () => leaseToken,
      generateRunId: () => runIds.shift() ?? successorRunId,
      maxRuns: 10,
    });
    await repository.start(startInput());
    const runtime = createKnowledgeSpaceProfileMigrationRuntime({
      access: { revalidatePermissionSnapshot: async () => permissionSnapshot() },
      bindings: bindingRepository().repository,
      builder: {
        build: async () => candidate({ fullVectorSpaceRebuilt: true }),
        getBuiltCandidate: async () => candidate({ fullVectorSpaceRebuilt: true }),
      },
      claimLimit: 1,
      evaluator: { evaluate: async () => ({ passed: false, summary: {} }) },
      leaseMs: 10_000,
      now: tickingClock(),
      repository,
      workerId: "worker-a",
    });

    await expect(runtime.tick()).resolves.toMatchObject({ failed: 1, succeeded: 0 });
    await expect(
      repository.retry({
        expectedPermissionSnapshotId: "permission-1",
        expectedPermissionSnapshotRevision: 1,
        now: "2026-01-01T00:00:09.000Z",
        permissionSnapshotId: "permission-1",
        permissionSnapshotRevision: 1,
        requestedBySubjectId: "owner-1",
        runId,
      }),
    ).rejects.toMatchObject({ code: "PROFILE_MIGRATION_NOT_RETRYABLE" });

    await expect(
      repository.start({
        ...startInput(),
        candidateProfile: { id: "embedding-3", revision: 3, snapshotDigest: digestA },
        createdAt: "2026-01-01T00:00:10.000Z",
        idempotencyKey: "settings-embedding-request-2",
      }),
    ).resolves.toMatchObject({ id: successorRunId, runState: "queued" });
  });

  it("fails before candidate construction when the durable admin grant drifted", async () => {
    const repository = createInMemoryKnowledgeSpaceProfileMigrationRepository({
      generateLeaseToken: () => leaseToken,
      generateRunId: () => runId,
      maxRuns: 10,
    });
    await repository.start(startInput());
    const build = vi.fn(async () => candidate({ fullVectorSpaceRebuilt: true }));
    const runtime = createKnowledgeSpaceProfileMigrationRuntime({
      access: {
        revalidatePermissionSnapshot: async () => ({
          ...permissionSnapshot(),
          revision: 2,
        }),
      },
      bindings: bindingRepository().repository,
      builder: { build, getBuiltCandidate: build },
      claimLimit: 1,
      evaluator: { evaluate: async () => ({ passed: true, summary: {} }) },
      leaseMs: 10_000,
      now: tickingClock(),
      repository,
      workerId: "worker-a",
    });

    await expect(runtime.tick()).resolves.toMatchObject({ failed: 1 });
    expect(build).not.toHaveBeenCalled();
  });

  it("fails a long rebuild when its permission expires at a cooperative heartbeat", async () => {
    const repository = createInMemoryKnowledgeSpaceProfileMigrationRepository({
      generateLeaseToken: () => leaseToken,
      generateRunId: () => runId,
      maxRuns: 10,
    });
    await repository.start(startInput());
    let permissionChecks = 0;
    const binding = bindingRepository();
    const runtime = createKnowledgeSpaceProfileMigrationRuntime({
      access: {
        revalidatePermissionSnapshot: async () => {
          permissionChecks += 1;
          if (permissionChecks > 1) throw new Error("permission expired");
          return permissionSnapshot();
        },
      },
      bindings: binding.repository,
      builder: {
        build: async (input) => {
          await input.execution?.heartbeat();
          return candidate({ fullVectorSpaceRebuilt: true });
        },
        getBuiltCandidate: async () => candidate({ fullVectorSpaceRebuilt: true }),
      },
      claimLimit: 1,
      evaluator: { evaluate: async () => ({ passed: true, summary: {} }) },
      leaseMs: 10_000,
      now: tickingClock(),
      repository,
      workerId: "worker-a",
    });

    await expect(runtime.tick()).resolves.toMatchObject({ failed: 1, succeeded: 0 });
    expect(binding.bind).not.toHaveBeenCalled();
    await expect(repository.get(runId)).resolves.toMatchObject({
      lastErrorCode: "PROFILE_MIGRATION_PERMISSION_INVALID",
      runState: "failed",
    });
  });

  it("revalidates permission after evaluation before it can bind", async () => {
    const repository = createInMemoryKnowledgeSpaceProfileMigrationRepository({
      generateLeaseToken: () => leaseToken,
      generateRunId: () => runId,
      maxRuns: 10,
    });
    await repository.start(startInput());
    let revoked = false;
    const binding = bindingRepository();
    const runtime = createKnowledgeSpaceProfileMigrationRuntime({
      access: {
        revalidatePermissionSnapshot: async () => {
          if (revoked) throw new Error("permission revoked");
          return permissionSnapshot();
        },
      },
      bindings: binding.repository,
      builder: {
        build: async () => candidate({ fullVectorSpaceRebuilt: true }),
        getBuiltCandidate: async () => candidate({ fullVectorSpaceRebuilt: true }),
      },
      claimLimit: 1,
      evaluator: {
        evaluate: async () => {
          revoked = true;
          return { passed: true, summary: {} };
        },
      },
      leaseMs: 10_000,
      now: tickingClock(),
      repository,
      workerId: "worker-a",
    });

    await expect(runtime.tick()).resolves.toMatchObject({ failed: 1, succeeded: 0 });
    expect(binding.bind).not.toHaveBeenCalled();
    expect(binding.activate).not.toHaveBeenCalled();
  });

  it("revalidates permission immediately before the joint activation CAS", async () => {
    const repository = createInMemoryKnowledgeSpaceProfileMigrationRepository({
      generateLeaseToken: () => leaseToken,
      generateRunId: () => runId,
      maxRuns: 10,
    });
    await repository.start(startInput());
    let permissionChecks = 0;
    const binding = bindingRepository();
    const runtime = createKnowledgeSpaceProfileMigrationRuntime({
      access: {
        revalidatePermissionSnapshot: async () => {
          permissionChecks += 1;
          if (permissionChecks >= 7) throw new Error("permission revoked before activation");
          return permissionSnapshot();
        },
      },
      bindings: binding.repository,
      builder: {
        build: async () => candidate({ fullVectorSpaceRebuilt: true }),
        getBuiltCandidate: async () => candidate({ fullVectorSpaceRebuilt: true }),
      },
      claimLimit: 1,
      evaluator: { evaluate: async () => ({ passed: true, summary: {} }) },
      leaseMs: 10_000,
      now: tickingClock(),
      repository,
      workerId: "worker-a",
    });

    await expect(runtime.tick()).resolves.toMatchObject({ failed: 1, succeeded: 0 });
    expect(binding.bind).toHaveBeenCalledOnce();
    expect(binding.activate).not.toHaveBeenCalled();
  });
});

describe("knowledge-space profile migration permission renewal", () => {
  it("binds a fresh durable admin permission to cancellation", async () => {
    const repository = createInMemoryKnowledgeSpaceProfileMigrationRepository({
      generateRunId: () => runId,
      maxRuns: 10,
    });
    await repository.start(startInput());
    const cancel = vi.spyOn(repository, "cancel");
    const createPermissionSnapshot = vi.fn(async () => ({
      ...permissionSnapshot(),
      createdAt: "2026-01-01T00:00:02.000Z",
      expiresAt: "2026-01-01T01:00:02.000Z",
      id: "permission-cancel",
      updatedAt: "2026-01-01T00:00:02.000Z",
    }));
    const service = createKnowledgeSpaceProfileMigrationService({
      access: {
        createPermissionSnapshot,
        getPermissionSnapshot: async () => permissionSnapshot(),
      },
      authorization: { authorize: async () => ({ role: "owner" }) } as never,
      now: () => Date.parse("2026-01-01T00:00:02.000Z"),
      profiles: { getRevision: async () => null } as never,
      publications: {} as never,
      repository,
    });

    await expect(
      service.cancel({
        callerKind: "interactive",
        knowledgeSpaceId: spaceId,
        runId,
        subject: { scopes: [], subjectId: "owner-1", tenantId },
      }),
    ).resolves.toMatchObject({ runState: "canceled" });
    expect(cancel).toHaveBeenCalledWith(
      expect.objectContaining({
        accessChannel: "interactive",
        permissionSnapshotId: "permission-cancel",
        permissionSnapshotRevision: 1,
        requestedBySubjectId: "owner-1",
      }),
    );
  });

  it("atomically replaces an expired durable grant when an exact-provenance retry is queued", async () => {
    const repository = createInMemoryKnowledgeSpaceProfileMigrationRepository({
      generateLeaseToken: () => leaseToken,
      generateRunId: () => runId,
      maxRuns: 10,
    });
    await repository.start(startInput());
    const [claimed] = await repository.claim({
      leaseExpiresAt: "2026-01-01T00:00:10.000Z",
      limit: 1,
      now: "2026-01-01T00:00:00.000Z",
      workerId: "worker-a",
    });
    if (!claimed?.leaseToken) throw new Error("Expected claimed migration");
    await repository.fail({
      errorCode: "PROFILE_MIGRATION_PERMISSION_INVALID",
      errorMessage: "permission expired",
      expectedRowVersion: claimed.rowVersion,
      leaseToken: claimed.leaseToken,
      now: "2026-01-01T00:00:01.000Z",
      runId,
      terminal: false,
    });
    const createPermissionSnapshot = vi.fn(async () => ({
      ...permissionSnapshot(),
      createdAt: "2026-01-01T00:00:02.000Z",
      expiresAt: "2026-01-01T01:00:02.000Z",
      id: "permission-2",
      updatedAt: "2026-01-01T00:00:02.000Z",
    }));
    const service = createKnowledgeSpaceProfileMigrationService({
      access: {
        createPermissionSnapshot,
        getPermissionSnapshot: async () => ({
          ...permissionSnapshot(),
          expiresAt: "2026-01-01T00:00:01.000Z",
          status: "expired",
        }),
      },
      authorization: { authorize: async () => ({ role: "owner" }) } as never,
      now: () => Date.parse("2026-01-01T00:00:02.000Z"),
      profiles: {} as never,
      publications: {} as never,
      repository,
    });

    await expect(
      service.retry({
        callerKind: "interactive",
        knowledgeSpaceId: spaceId,
        runId,
        subject: { scopes: [], subjectId: "owner-1", tenantId },
      }),
    ).resolves.toMatchObject({
      permissionSnapshotId: "permission-2",
      permissionSnapshotRevision: 1,
      runState: "queued",
    });
    expect(createPermissionSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        accessChannel: "interactive",
        knowledgeSpaceId: spaceId,
        subjectId: "owner-1",
      }),
    );
  });
});

function startInput() {
  return {
    accessChannel: "interactive" as const,
    baseEmbeddingProfile: { id: "embedding-1", revision: 1, snapshotDigest: digestA },
    basePublication: { fingerprint: fingerprintA, headRevision: 7, id: "publication-1" },
    baseRetrievalProfile: { id: "retrieval-1", revision: 1, snapshotDigest: digestA },
    candidateProfile: { id: "embedding-2", revision: 2, snapshotDigest: digestB },
    changedKind: "embedding" as const,
    createdAt: "2026-01-01T00:00:00.000Z",
    idempotencyKey: "settings-embedding-request",
    knowledgeSpaceId: spaceId,
    maxExecutionAttempts: 3,
    permissionSnapshotId: "permission-1",
    permissionSnapshotRevision: 1,
    rebuildScope: "full-vector-space" as const,
    requestedBySubjectId: "owner-1",
    tenantId,
  };
}

function candidate(
  proof: Partial<KnowledgeSpaceProfileMigrationCandidateBuildResult>,
): KnowledgeSpaceProfileMigrationCandidateBuildResult {
  return {
    publicationFingerprint: fingerprintB,
    publicationId: candidatePublicationId,
    publicationStatus: "validating",
    ...proof,
  };
}

function permissionSnapshot(): KnowledgeSpacePermissionSnapshot {
  return {
    accessChannel: "interactive",
    accessPolicyRevision: 1,
    apiAccessRevision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2030-01-01T00:00:00.000Z",
    id: "permission-1",
    knowledgeSpaceId: spaceId,
    memberRevision: 1,
    permissionScopes: [],
    revision: 1,
    role: "owner",
    status: "active",
    subjectId: "owner-1",
    tenantId,
    updatedAt: "2026-01-01T00:00:00.000Z",
    visibility: "only_me",
  };
}

function bindingRepository() {
  const binding = {
    bindingReason: "candidate-switch" as const,
    changedKind: "embedding" as const,
    createdAt: "2026-01-01T00:00:00.000Z",
    embeddingProfile: { id: "embedding-2", revision: 2, snapshotDigest: digestB },
    id: "binding-1",
    knowledgeSpaceId: spaceId,
    publicationFingerprint: fingerprintB,
    publicationId: candidatePublicationId,
    retrievalProfile: { id: "retrieval-1", revision: 1, snapshotDigest: digestA },
    tenantId,
    vectorSpaceId: "embedding-space-sha256:x",
  };
  const bind = vi.fn(async () => binding);
  const activate = vi.fn(async () => ({
    binding: { ...binding, activatedAt: "2026-01-01T00:00:01.000Z" },
    profileHeadRevision: 2,
    profileHeadRowVersion: 2,
    publicationHeadRevision: 8,
  }));
  const repository: KnowledgeSpaceProfilePublicationRepository = {
    activateCandidate: activate,
    bindCandidate: bind,
    bindCurrentPublished: vi.fn(),
    bindExistingPublished: vi.fn(),
    requireActivatedBinding: vi.fn(async () => {
      throw new Error("not activated");
    }),
  };
  return { activate, bind, repository };
}

function tickingClock() {
  let value = Date.parse("2026-01-01T00:00:00.000Z");
  return () => {
    value += 10;
    return value;
  };
}
