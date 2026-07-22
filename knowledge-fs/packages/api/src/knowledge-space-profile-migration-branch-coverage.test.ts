import { describe, expect, it, vi } from "vitest";

import {
  KnowledgeSpaceProfileMigrationConflictError,
  type StartKnowledgeSpaceProfileMigrationInput,
  createInMemoryKnowledgeSpaceProfileMigrationRepository,
  isTerminalKnowledgeSpaceProfileMigrationError,
} from "./knowledge-space-profile-migration";
import {
  type KnowledgeSpaceProfileMigrationCandidateBuildResult,
  createKnowledgeSpaceProfileMigrationRuntime,
} from "./knowledge-space-profile-migration-runtime";

const runId = "10000000-0000-4000-8000-000000000001";
const secondRunId = "10000000-0000-4000-8000-000000000002";
const capabilityGrantId = "10000000-0000-4000-8000-000000000003";
const fingerprint = `projection-set-sha256:${"a".repeat(64)}`;
const candidateFingerprint = `projection-set-sha256:${"b".repeat(64)}`;

describe("in-memory profile migration repository branch boundaries", () => {
  it("validates repository and start-input bounds", async () => {
    expect(() => repository({ maxRuns: 0 })).toThrow("maxRuns must be a positive integer");

    const invalidInputs: Array<[Partial<StartKnowledgeSpaceProfileMigrationInput>, string]> = [
      [{ rebuildScope: "clone-publication" }, "full vector-space rebuild"],
      [{ changedKind: "retrieval", rebuildScope: "full-vector-space" }, "rebuild scope is invalid"],
      [{ accessChannel: undefined }, "exactly one authorization binding"],
      [{ permissionSnapshotId: undefined }, "exactly one authorization binding"],
      [{ permissionSnapshotRevision: 0 }, "exactly one authorization binding"],
      [{ requestedBySubjectId: undefined }, "exactly one authorization binding"],
      [{ capabilityGrantId }, "exactly one authorization binding"],
      [{ basePublication: { fingerprint, headRevision: 0, id: "publication-1" } }, "positive"],
      [{ baseRetrievalProfile: { id: "", revision: 1, snapshotDigest: "a".repeat(64) } }, "empty"],
      [
        { candidateProfile: { id: "candidate", revision: 0, snapshotDigest: "a".repeat(64) } },
        "positive",
      ],
      [{ candidateProfile: { id: "candidate", revision: 2, snapshotDigest: "bad" } }, "SHA-256"],
      [{ createdAt: "bad-date" }, "ISO timestamp"],
      [{ idempotencyKey: "x".repeat(256) }, "exceeds 255"],
      [{ knowledgeSpaceId: " " }, "must not be empty"],
      [{ maxExecutionAttempts: Number.NaN }, "positive integer"],
      [{ tenantId: "x".repeat(256) }, "exceeds 255"],
    ];

    for (const [override, message] of invalidInputs) {
      await expect(repository().start({ ...startInput(), ...override })).rejects.toThrow(message);
    }
  });

  it("supports capability authorization, retrieval scopes, request lookup, and immutable results", async () => {
    const store = repository();
    const input: StartKnowledgeSpaceProfileMigrationInput = {
      ...startInput(),
      accessChannel: undefined,
      baseEmbeddingProfile: undefined,
      capabilityGrantId,
      changedKind: "retrieval",
      permissionSnapshotId: undefined,
      permissionSnapshotRevision: undefined,
      rebuildScope: "clone-publication",
      requestedBySubjectId: undefined,
    };
    const started = await store.start(input);

    expect(Object.isFrozen(started)).toBe(true);
    expect(Object.isFrozen(started.basePublication)).toBe(true);
    expect(started.baseEmbeddingProfile).toBeUndefined();
    await expect(
      store.findByRequest({
        capabilityGrantId,
        idempotencyKey: input.idempotencyKey,
        knowledgeSpaceId: input.knowledgeSpaceId,
        tenantId: input.tenantId,
      }),
    ).resolves.toBe(started);
    await expect(store.findByRequest({ ...input, idempotencyKey: "missing" })).resolves.toBeNull();
  });

  it("rejects idempotency drift, concurrent work, and capacity overflow", async () => {
    const store = repository({ maxRuns: 1 });
    const input = startInput();
    await store.start(input);
    await expect(
      store.start({ ...input, candidateProfile: { ...input.candidateProfile, revision: 3 } }),
    ).rejects.toMatchObject({ code: "PROFILE_MIGRATION_IDEMPOTENCY_CONFLICT" });
    await expect(store.start({ ...input, idempotencyKey: "concurrent" })).rejects.toMatchObject({
      code: "PROFILE_MIGRATION_ALREADY_ACTIVE",
    });
    await store.cancel({
      now: "2026-01-01T00:00:01.000Z",
      permissionSnapshotId: "permission-1",
      permissionSnapshotRevision: 1,
      reason: "done",
      requestedBySubjectId: "owner-1",
      runId,
    });
    await expect(
      store.start({ ...input, createdAt: "2026-01-01T00:00:02.000Z", idempotencyKey: "next" }),
    ).rejects.toThrow("capacity exceeded");
  });

  it("validates claims and exhausts the execution-attempt budget", async () => {
    const store = repository();
    await store.start({ ...startInput(), maxExecutionAttempts: 1 });
    await expect(
      store.claim({ leaseExpiresAt: "bad", limit: 1, now: "bad", workerId: "worker" }),
    ).rejects.toThrow("claim.now must be an ISO timestamp");
    await expect(
      store.claim({
        leaseExpiresAt: "2026-01-01T00:00:00.000Z",
        limit: 1,
        now: "2026-01-01T00:00:00.000Z",
        workerId: "worker",
      }),
    ).rejects.toThrow("expire after now");
    await expect(
      store.claim({
        leaseExpiresAt: "2026-01-01T00:00:01.000Z",
        limit: 0,
        now: "2026-01-01T00:00:00.000Z",
        workerId: "worker",
      }),
    ).rejects.toThrow("claim.limit");
    await expect(
      store.claim({
        leaseExpiresAt: "2026-01-01T00:00:01.000Z",
        limit: 1,
        now: "2026-01-01T00:00:00.000Z",
        workerId: " ",
      }),
    ).rejects.toThrow("claim.workerId");

    const [claimed] = await store.claim(claimInput());
    expect(claimed?.executionAttempts).toBe(1);
    await expect(
      store.claim({
        ...claimInput(),
        leaseExpiresAt: "2026-01-01T00:00:03.000Z",
        now: "2026-01-01T00:00:02.000Z",
      }),
    ).resolves.toEqual([]);
    await expect(store.get(runId)).resolves.toMatchObject({
      lastErrorCode: "PROFILE_MIGRATION_ATTEMPTS_EXHAUSTED",
      runState: "failed",
    });
  });

  it("fences heartbeat variants and advances valid heartbeats", async () => {
    const store = repository();
    await store.start(startInput());
    const [claimed] = await store.claim(claimInput());
    if (!claimed?.leaseToken) throw new Error("expected claim");
    const fence = {
      expectedRowVersion: claimed.rowVersion,
      leaseToken: claimed.leaseToken,
      now: "2026-01-01T00:00:00.500Z",
      runId,
    };

    await expect(
      store.heartbeat({ ...fence, leaseExpiresAt: "bad", workerId: "other" }),
    ).resolves.toBeNull();
    await expect(
      store.heartbeat({
        ...fence,
        leaseExpiresAt: "2026-01-01T00:00:02.000Z",
        workerId: "other",
      }),
    ).resolves.toBeNull();
    await expect(
      store.heartbeat({
        ...fence,
        leaseExpiresAt: fence.now,
        workerId: "worker-a",
      }),
    ).resolves.toBeNull();
    await expect(
      store.heartbeat({
        ...fence,
        leaseExpiresAt: "2026-01-01T00:00:02.000Z",
        workerId: "worker-a",
      }),
    ).resolves.toMatchObject({ rowVersion: claimed.rowVersion + 1 });
  });

  it("enforces candidate and evaluation checkpoint invariants", async () => {
    const cases = [
      {
        input: { checkpoint: "candidate-built" as const },
        code: "PROFILE_MIGRATION_CANDIDATE_PUBLICATION_REQUIRED",
      },
      {
        input: {
          candidatePublicationFingerprint: candidateFingerprint,
          checkpoint: "queued" as const,
        },
        code: "PROFILE_MIGRATION_CHECKPOINT_CONFLICT",
      },
      {
        input: {
          candidatePublicationFingerprint: candidateFingerprint,
          checkpoint: "candidate-built" as const,
          evaluationSummary: { score: 1 },
        },
        code: "PROFILE_MIGRATION_CHECKPOINT_CONFLICT",
      },
      {
        input: {
          candidatePublicationFingerprint: candidateFingerprint,
          checkpoint: "evaluated" as const,
        },
        code: "PROFILE_MIGRATION_EVALUATION_REQUIRED",
      },
    ];

    for (const testCase of cases) {
      const { store, claimed } = await claimedRepository();
      await expect(
        store.checkpoint({
          expectedRowVersion: claimed.rowVersion,
          leaseToken: claimed.leaseToken ?? "",
          now: "2026-01-01T00:00:00.500Z",
          runId,
          ...testCase.input,
        }),
      ).rejects.toMatchObject({ code: testCase.code });
    }
  });

  it("sanitizes evaluation summaries and rejects backwards checkpoints", async () => {
    const { store, claimed } = await claimedRepository();
    const built = await store.checkpoint({
      candidatePublicationFingerprint: candidateFingerprint,
      candidatePublicationId: "publication-2",
      checkpoint: "candidate-built",
      expectedRowVersion: claimed.rowVersion,
      leaseToken: claimed.leaseToken ?? "",
      now: "2026-01-01T00:00:00.500Z",
      runId,
    });
    if (!built?.leaseToken) throw new Error("expected built checkpoint");
    const evaluated = await store.checkpoint({
      checkpoint: "evaluated",
      evaluationSummary: {
        ignored: { nested: true },
        long: "x".repeat(600),
        passed: true,
        score: 0.9,
      },
      expectedRowVersion: built.rowVersion,
      leaseToken: built.leaseToken,
      now: "2026-01-01T00:00:00.600Z",
      runId,
    });
    expect(evaluated?.evaluationSummary).toEqual({
      long: "x".repeat(512),
      passed: true,
      score: 0.9,
    });
    await expect(
      store.checkpoint({
        checkpoint: "candidate-built",
        expectedRowVersion: evaluated?.rowVersion ?? 0,
        leaseToken: evaluated?.leaseToken ?? "",
        now: "2026-01-01T00:00:00.700Z",
        runId,
      }),
    ).rejects.toMatchObject({ code: "PROFILE_MIGRATION_CHECKPOINT_CONFLICT" });
  });

  it("covers success, failure fallback, cancellation idempotency, and missing records", async () => {
    const store = repository();
    expect(await store.get("missing")).toBeNull();
    expect(await store.cancel({ now: "bad", reason: "x", runId: "missing" })).toBeNull();
    expect(await store.retry({ now: "bad", runId: "missing" })).toBeNull();
    const started = await store.start(startInput());
    expect(
      await store.succeed({
        expectedRowVersion: started.rowVersion,
        leaseToken: "missing",
        now: "2026-01-01T00:00:00.000Z",
        runId,
      }),
    ).toBeNull();
    const [claimed] = await store.claim(claimInput());
    if (!claimed?.leaseToken) throw new Error("expected claim");
    const failed = await store.fail({
      errorCode: " \n",
      errorMessage: "\t",
      expectedRowVersion: claimed.rowVersion,
      leaseToken: claimed.leaseToken,
      now: "2026-01-01T00:00:00.500Z",
      runId,
      terminal: false,
    });
    expect(failed).toMatchObject({
      lastErrorCode: "PROFILE_MIGRATION_FAILED",
      lastErrorMessage: "Profile migration failed",
    });
    const canceled = await store.cancel({
      accessChannel: "interactive",
      now: "2026-01-01T00:00:01.000Z",
      permissionSnapshotId: "permission-2",
      permissionSnapshotRevision: 2,
      reason: "requested\nby owner",
      requestedBySubjectId: "owner-1",
      runId,
    });
    expect(canceled).toMatchObject({
      lastErrorMessage: "requested by owner",
      runState: "canceled",
    });
    await expect(store.cancel({ now: "bad", reason: "ignored", runId })).resolves.toBe(canceled);
  });

  it("checks retry authorization, state, terminality, and a valid retry", async () => {
    const store = repository();
    await store.start(startInput());
    await expect(
      store.retry({
        expectedPermissionSnapshotId: "permission-1",
        expectedPermissionSnapshotRevision: 1,
        now: "2026-01-01T00:00:01.000Z",
        permissionSnapshotId: "permission-2",
        permissionSnapshotRevision: 2,
        requestedBySubjectId: "owner-1",
        runId,
      }),
    ).rejects.toMatchObject({ code: "PROFILE_MIGRATION_NOT_RETRYABLE" });
    const [claimed] = await store.claim(claimInput());
    if (!claimed?.leaseToken) throw new Error("expected claim");
    await store.fail({
      errorCode: "TEMPORARY",
      errorMessage: "retry",
      expectedRowVersion: claimed.rowVersion,
      leaseToken: claimed.leaseToken,
      now: "2026-01-01T00:00:00.500Z",
      runId,
      terminal: false,
    });
    await expect(
      store.retry({
        expectedPermissionSnapshotId: "other",
        expectedPermissionSnapshotRevision: 1,
        now: "2026-01-01T00:00:01.000Z",
        permissionSnapshotId: "permission-2",
        permissionSnapshotRevision: 2,
        requestedBySubjectId: "owner-1",
        runId,
      }),
    ).rejects.toMatchObject({ code: "PROFILE_MIGRATION_PERMISSION_SNAPSHOT_CONFLICT" });
    await expect(
      store.retry({
        expectedPermissionSnapshotId: "permission-1",
        expectedPermissionSnapshotRevision: 1,
        now: "2026-01-01T00:00:01.000Z",
        permissionSnapshotId: "permission-2",
        permissionSnapshotRevision: 2,
        requestedBySubjectId: "owner-1",
        runId,
      }),
    ).resolves.toMatchObject({
      executionAttempts: 0,
      permissionSnapshotId: "permission-2",
      runState: "queued",
    });

    expect(isTerminalKnowledgeSpaceProfileMigrationError(undefined)).toBe(false);
    expect(isTerminalKnowledgeSpaceProfileMigrationError("TEMPORARY")).toBe(false);
    expect(
      isTerminalKnowledgeSpaceProfileMigrationError("PROFILE_MIGRATION_CANDIDATE_INVALID"),
    ).toBe(true);
    expect(new KnowledgeSpaceProfileMigrationConflictError("CODE", "message")).toMatchObject({
      code: "CODE",
      name: "KnowledgeSpaceProfileMigrationConflictError",
    });
  });
});

describe("profile migration runtime branch boundaries", () => {
  it("validates scheduler configuration", () => {
    const options = runtimeOptions(repository(), validCandidate());
    expect(() =>
      createKnowledgeSpaceProfileMigrationRuntime({ ...options, claimLimit: 0 }),
    ).toThrow("claimLimit must be positive");
    expect(() => createKnowledgeSpaceProfileMigrationRuntime({ ...options, leaseMs: 0 })).toThrow(
      "leaseMs must be positive",
    );
    expect(() =>
      createKnowledgeSpaceProfileMigrationRuntime({ ...options, heartbeatIntervalMs: 0 }),
    ).toThrow("heartbeatIntervalMs must be positive");
    expect(() =>
      createKnowledgeSpaceProfileMigrationRuntime({ ...options, heartbeatIntervalMs: 1_000 }),
    ).toThrow("heartbeat must be below lease");
    expect(() =>
      createKnowledgeSpaceProfileMigrationRuntime({ ...options, workerId: " " }),
    ).toThrow("workerId must not be empty");
  });

  it.each([
    ["missing identity", { publicationId: "" }, "PROFILE_MIGRATION_CANDIDATE_INVALID"],
    [
      "non-validating publication",
      { publicationStatus: "candidate" },
      "PROFILE_MIGRATION_CANDIDATE_NOT_VALIDATING",
    ],
    [
      "missing vector proof",
      { fullVectorSpaceRebuilt: false },
      "PROFILE_MIGRATION_VECTOR_REBUILD_INCOMPLETE",
    ],
  ])("records terminal candidate proof failure: %s", async (_name, override, errorCode) => {
    const store = repository();
    await store.start(startInput());
    const runtime = createKnowledgeSpaceProfileMigrationRuntime(
      runtimeOptions(store, {
        ...validCandidate(),
        ...override,
      } as KnowledgeSpaceProfileMigrationCandidateBuildResult),
    );

    await expect(runtime.tick()).resolves.toMatchObject({ claimed: 1, failed: 1 });
    await expect(store.get(runId)).resolves.toMatchObject({
      lastErrorCode: errorCode,
      runState: "failed",
    });
  });

  it.each([
    [
      "clone-publication",
      { successorMembersCloned: false },
      "PROFILE_MIGRATION_SUCCESSOR_INCOMPLETE",
    ],
    [
      "full-page-index-summary-outline",
      { pageIndexSummaryOutlineRebuilt: false },
      "PROFILE_MIGRATION_PAGE_INDEX_REBUILD_INCOMPLETE",
    ],
  ] as const)(
    "requires the proof for retrieval scope %s",
    async (rebuildScope, proof, errorCode) => {
      const store = repository();
      await store.start({
        ...startInput(),
        changedKind: "retrieval",
        rebuildScope,
      });
      const runtime = createKnowledgeSpaceProfileMigrationRuntime(
        runtimeOptions(store, { ...validCandidate(), ...proof }),
      );

      await expect(runtime.tick()).resolves.toMatchObject({ failed: 1 });
      await expect(store.get(runId)).resolves.toMatchObject({ lastErrorCode: errorCode });
    },
  );

  it("fails capability-bound work when its grant repository is unavailable", async () => {
    const store = repository();
    await store.start({
      ...startInput(),
      accessChannel: undefined,
      capabilityGrantId,
      permissionSnapshotId: undefined,
      permissionSnapshotRevision: undefined,
      requestedBySubjectId: undefined,
    });
    const build = vi.fn(async () => validCandidate());
    const runtime = createKnowledgeSpaceProfileMigrationRuntime({
      ...runtimeOptions(store, validCandidate()),
      builder: { build, getBuiltCandidate: build },
    });

    await expect(runtime.tick()).resolves.toMatchObject({ failed: 1 });
    expect(build).not.toHaveBeenCalled();
    await expect(store.get(runId)).resolves.toMatchObject({
      lastErrorCode: "PROFILE_MIGRATION_PERMISSION_INVALID",
    });
  });

  it("deduplicates overlapping ticks", async () => {
    const store = repository();
    let releaseClaim: (() => void) | undefined;
    const claim = vi.spyOn(store, "claim").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseClaim = () => resolve([]);
        }),
    );
    const runtime = createKnowledgeSpaceProfileMigrationRuntime(
      runtimeOptions(store, validCandidate()),
    );
    const first = runtime.tick();
    const second = runtime.tick();
    releaseClaim?.();

    await expect(Promise.all([first, second])).resolves.toEqual([
      { claimed: 0, failed: 0, stale: 0, succeeded: 0 },
      { claimed: 0, failed: 0, stale: 0, succeeded: 0 },
    ]);
    expect(claim).toHaveBeenCalledOnce();
  });
});

function repository(options: { maxRuns?: number } = {}) {
  const ids = [runId, secondRunId];
  let lease = 0;
  return createInMemoryKnowledgeSpaceProfileMigrationRepository({
    generateLeaseToken: () => `lease-${++lease}`,
    generateRunId: () => ids.shift() ?? secondRunId,
    maxRuns: options.maxRuns ?? 10,
  });
}

async function claimedRepository() {
  const store = repository();
  await store.start(startInput());
  const [claimed] = await store.claim(claimInput());
  if (!claimed) throw new Error("expected claim");
  return { claimed, store };
}

function claimInput() {
  return {
    leaseExpiresAt: "2026-01-01T00:00:01.000Z",
    limit: 1,
    now: "2026-01-01T00:00:00.000Z",
    workerId: "worker-a",
  };
}

function startInput(): StartKnowledgeSpaceProfileMigrationInput {
  return {
    accessChannel: "interactive",
    baseEmbeddingProfile: { id: "embedding-1", revision: 1, snapshotDigest: "A".repeat(64) },
    basePublication: { fingerprint, headRevision: 1, id: "publication-1" },
    baseRetrievalProfile: { id: "retrieval-1", revision: 1, snapshotDigest: "a".repeat(64) },
    candidateProfile: { id: "embedding-2", revision: 2, snapshotDigest: "b".repeat(64) },
    changedKind: "embedding",
    createdAt: "2026-01-01T00:00:00.000Z",
    idempotencyKey: "migration-request",
    knowledgeSpaceId: "10000000-0000-4000-8000-000000000010",
    maxExecutionAttempts: 3,
    permissionSnapshotId: "permission-1",
    permissionSnapshotRevision: 1,
    rebuildScope: "full-vector-space",
    requestedBySubjectId: "owner-1",
    tenantId: "tenant-1",
  };
}

function validCandidate(): KnowledgeSpaceProfileMigrationCandidateBuildResult {
  return {
    fullVectorSpaceRebuilt: true,
    pageIndexSummaryOutlineRebuilt: true,
    publicationFingerprint: candidateFingerprint,
    publicationId: "publication-2",
    publicationStatus: "validating",
    successorMembersCloned: true,
  };
}

function runtimeOptions(
  store: ReturnType<typeof repository>,
  candidate: KnowledgeSpaceProfileMigrationCandidateBuildResult,
) {
  const build = vi.fn(async () => candidate);
  return {
    access: {
      revalidatePermissionSnapshot: async () => ({
        revision: 1,
        role: "owner" as const,
      }),
    } as never,
    bindings: {
      activateCandidate: vi.fn(),
      bindCandidate: vi.fn(),
      requireActivatedBinding: vi.fn(),
    } as never,
    builder: { build, getBuiltCandidate: build },
    claimLimit: 1,
    evaluator: { evaluate: async () => ({ passed: true, summary: {} }) },
    heartbeatIntervalMs: 500,
    leaseMs: 1_000,
    now: () => Date.parse("2026-01-01T00:00:00.000Z"),
    repository: store,
    workerId: "worker-a",
  };
}
