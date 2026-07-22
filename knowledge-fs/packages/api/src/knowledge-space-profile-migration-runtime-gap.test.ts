import { afterEach, describe, expect, it, vi } from "vitest";

import type { KnowledgeSpaceProfileMigrationRun } from "./knowledge-space-profile-migration";
import {
  type KnowledgeSpaceProfileMigrationCandidateBuildResult,
  createKnowledgeSpaceProfileMigrationRuntime,
} from "./knowledge-space-profile-migration-runtime";

const runId = "10000000-0000-4000-8000-000000000101";
const capabilityGrantId = "10000000-0000-4000-8000-000000000102";
const candidatePublicationId = "10000000-0000-4000-8000-000000000103";
const baseFingerprint = `projection-set-sha256:${"a".repeat(64)}`;
const candidateFingerprint = `projection-set-sha256:${"b".repeat(64)}`;
const digestA = "a".repeat(64);
const digestB = "b".repeat(64);
const timestamp = Date.parse("2026-01-01T00:00:00.000Z");

afterEach(() => {
  vi.useRealTimers();
});

describe("profile migration runtime uncovered state boundaries", () => {
  it("accepts both default heartbeat calculations and rejects non-safe scheduler values", () => {
    const first = runtimeHarness({ leaseMs: 2 });
    const second = runtimeHarness({ leaseMs: 9 });

    expect(first.runtime).toBeDefined();
    expect(second.runtime).toBeDefined();
    expect(() => runtimeHarness({ claimLimit: Number.NaN })).toThrow("claimLimit must be positive");
    expect(() => runtimeHarness({ leaseMs: Number.POSITIVE_INFINITY })).toThrow(
      "leaseMs must be positive",
    );
  });

  it("rejects a non-finite scheduler clock before claiming work", async () => {
    const fixture = runtimeHarness({ now: () => Number.NaN });

    await expect(fixture.runtime.tick()).rejects.toThrow("clock must be finite");
    expect(fixture.repository.claim).not.toHaveBeenCalled();
  });

  it("processes capability-bound work and rechecks a captured deletion fence", async () => {
    const assertPublicationAllowed = vi.fn(async () => undefined);
    const assertDeletionFenceUnchanged = vi.fn(async () => undefined);
    const captureDeletionFence = vi.fn(async () => ({ token: "deletion-fence" }));
    const fixture = runtimeHarness({
      capabilityGrants: { assertPublicationAllowed },
      deletionFence: { assertDeletionFenceUnchanged, captureDeletionFence },
      run: capabilityRun(),
    });

    await expect(fixture.runtime.tick()).resolves.toMatchObject({ succeeded: 1 });
    expect(assertPublicationAllowed.mock.calls.length).toBeGreaterThan(1);
    expect(captureDeletionFence).toHaveBeenCalledOnce();
    expect(assertDeletionFenceUnchanged.mock.calls.length).toBeGreaterThan(1);
  });

  it("maps a revoked capability grant to a durable permission failure", async () => {
    const fixture = runtimeHarness({
      capabilityGrants: {
        assertPublicationAllowed: async () => {
          throw new Error("revoked");
        },
      },
      run: capabilityRun(),
    });

    await expect(fixture.runtime.tick()).resolves.toMatchObject({ failed: 1 });
    expect(fixture.repository.fail).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "PROFILE_MIGRATION_PERMISSION_INVALID" }),
    );
  });

  it.each([
    ["access channel", { accessChannel: undefined }],
    ["snapshot id", { permissionSnapshotId: undefined }],
    ["snapshot revision", { permissionSnapshotRevision: undefined }],
    ["requesting subject", { requestedBySubjectId: undefined }],
  ] as const)("fails closed when durable provenance lacks its %s", async (_name, override) => {
    const fixture = runtimeHarness({ run: runFixture(override) });

    await expect(fixture.runtime.tick()).resolves.toMatchObject({ failed: 1 });
    expect(fixture.access.revalidatePermissionSnapshot).not.toHaveBeenCalled();
    expect(fixture.repository.fail).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "PROFILE_MIGRATION_PERMISSION_INVALID" }),
    );
  });

  it("rejects a permission snapshot whose role is no longer owner", async () => {
    const fixture = runtimeHarness({
      access: {
        revalidatePermissionSnapshot: async () => ({ revision: 1, role: "editor" }),
      },
    });

    await expect(fixture.runtime.tick()).resolves.toMatchObject({ failed: 1 });
    expect(fixture.repository.fail).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "PROFILE_MIGRATION_PERMISSION_INVALID" }),
    );
  });

  it("returns stale when the candidate-built checkpoint loses its row fence", async () => {
    const fixture = runtimeHarness({ checkpoint: async () => null });

    await expect(fixture.runtime.tick()).resolves.toEqual({
      claimed: 1,
      failed: 0,
      stale: 1,
      succeeded: 0,
    });
    expect(fixture.evaluator.evaluate).not.toHaveBeenCalled();
  });

  it.each([
    ["fingerprint", { candidatePublicationFingerprint: undefined }],
    ["publication id", { candidatePublicationId: undefined }],
  ] as const)("rejects a resumed checkpoint without its %s", async (_name, override) => {
    const fixture = runtimeHarness({
      run: runFixture({
        candidatePublicationFingerprint: candidateFingerprint,
        candidatePublicationId,
        checkpoint: "candidate-built",
        ...override,
      }),
    });

    await expect(fixture.runtime.tick()).resolves.toMatchObject({ failed: 1 });
    expect(fixture.builder.getBuiltCandidate).not.toHaveBeenCalled();
    expect(fixture.repository.fail).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "PROFILE_MIGRATION_CHECKPOINT_CORRUPT" }),
    );
  });

  it("returns stale when a resumed candidate loses the evaluated checkpoint fence", async () => {
    const fixture = runtimeHarness({
      checkpoint: async () => null,
      run: resumedRun("candidate-built"),
    });

    await expect(fixture.runtime.tick()).resolves.toMatchObject({ stale: 1 });
    expect(fixture.builder.build).not.toHaveBeenCalled();
    expect(fixture.builder.getBuiltCandidate).toHaveBeenCalledOnce();
    expect(fixture.bindings.bindCandidate).toHaveBeenCalledOnce();
  });

  it("fails a resumed checkpoint that cannot be activated", async () => {
    const fixture = runtimeHarness({
      run: resumedRun("activated" as KnowledgeSpaceProfileMigrationRun["checkpoint"]),
    });

    await expect(fixture.runtime.tick()).resolves.toMatchObject({ failed: 1 });
    expect(fixture.repository.fail).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "PROFILE_MIGRATION_CHECKPOINT_CORRUPT" }),
    );
  });

  it.each(["embedding", "retrieval"] as const)(
    "recognizes an already activated %s binding without another activation",
    async (changedKind) => {
      const run = resumedRun("evaluated", {
        baseEmbeddingProfile:
          changedKind === "embedding"
            ? { id: "embedding-1", revision: 1, snapshotDigest: digestA }
            : undefined,
        candidateProfile: {
          id: changedKind === "embedding" ? "embedding-2" : "retrieval-2",
          revision: 2,
          snapshotDigest: digestB,
        },
        changedKind,
        rebuildScope: changedKind === "embedding" ? "full-vector-space" : "clone-publication",
      });
      const changed = run.candidateProfile;
      const fixture = runtimeHarness({
        binding: {
          embeddingProfile: changedKind === "embedding" ? changed : undefined,
          retrievalProfile: changedKind === "retrieval" ? changed : undefined,
        },
        run,
      });

      await expect(fixture.runtime.tick()).resolves.toMatchObject({ succeeded: 1 });
      expect(fixture.bindings.activateCandidate).not.toHaveBeenCalled();
      expect(fixture.repository.succeed).toHaveBeenCalledOnce();
    },
  );

  it("accepts activation that atomically completed the migration run", async () => {
    const fixture = runtimeHarness({
      activation: { migrationRunCompleted: true },
      binding: { embeddingProfile: undefined, retrievalProfile: undefined },
      run: resumedRun("evaluated", { baseEmbeddingProfile: undefined }),
    });

    await expect(fixture.runtime.tick()).resolves.toMatchObject({ succeeded: 1 });
    expect(fixture.bindings.activateCandidate).toHaveBeenCalledWith(
      expect.objectContaining({ expectedProfileHeadRevision: null }),
    );
    expect(fixture.repository.succeed).not.toHaveBeenCalled();
  });

  it("returns stale when an already activated run loses its final succeed fence", async () => {
    const run = resumedRun("evaluated");
    const fixture = runtimeHarness({
      binding: { embeddingProfile: run.candidateProfile },
      run,
      succeed: async () => null,
    });

    await expect(fixture.runtime.tick()).resolves.toMatchObject({ stale: 1 });
  });

  it("sanitizes a non-Error failure and returns stale when failure recording loses its fence", async () => {
    const onError = vi.fn();
    const fixture = runtimeHarness({
      build: async () => {
        throw "plain failure\nwith details";
      },
      fail: async () => null,
      onError,
    });

    await expect(fixture.runtime.tick()).resolves.toMatchObject({ stale: 1 });
    expect(fixture.repository.fail).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "PROFILE_MIGRATION_UNEXPECTED",
        errorMessage: "Unexpected profile migration failure",
        terminal: false,
      }),
    );
    expect(onError).toHaveBeenCalledOnce();
  });

  it("reports both the work error and a failure-recording error", async () => {
    const onError = vi.fn();
    const fixture = runtimeHarness({
      build: async () => {
        throw Object.assign(new Error("coded failure\nwith details"), {
          code: "X".repeat(80),
        });
      },
      fail: async () => {
        throw new Error("recording failed");
      },
      onError,
    });

    await expect(fixture.runtime.tick()).resolves.toMatchObject({ stale: 1 });
    expect(fixture.repository.fail).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "X".repeat(64),
        errorMessage: "coded failure with details",
      }),
    );
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it("fails stale when a claimed run has no execution lease token", async () => {
    const onError = vi.fn();
    const fixture = runtimeHarness({
      onError,
      run: runFixture({ leaseToken: undefined }),
    });

    await expect(fixture.runtime.tick()).resolves.toMatchObject({ stale: 1 });
    expect(onError).toHaveBeenCalledTimes(2);
    expect(fixture.repository.fail).not.toHaveBeenCalled();
  });

  it("propagates a timer heartbeat fence loss to the active build", async () => {
    vi.useFakeTimers();
    let releaseBuild: (() => void) | undefined;
    let markBuildEntered: (() => void) | undefined;
    const buildEntered = new Promise<void>((resolve) => {
      markBuildEntered = resolve;
    });
    const fixture = runtimeHarness({
      build: async () => {
        markBuildEntered?.();
        await new Promise<void>((resolve) => {
          releaseBuild = resolve;
        });
        return validCandidate();
      },
      heartbeat: async () => null,
      heartbeatIntervalMs: 5,
      leaseMs: 100,
    });

    const tick = fixture.runtime.tick();
    await buildEntered;
    await vi.advanceTimersByTimeAsync(5);
    releaseBuild?.();

    await expect(tick).resolves.toMatchObject({ failed: 1 });
    expect(fixture.repository.heartbeat).toHaveBeenCalled();
    expect(fixture.repository.fail).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "PROFILE_MIGRATION_UNEXPECTED" }),
    );
  });
});

function runtimeHarness(
  options: {
    readonly access?: { revalidatePermissionSnapshot(): Promise<unknown> } | undefined;
    readonly activation?: unknown;
    readonly binding?: unknown;
    readonly build?:
      | (() => Promise<KnowledgeSpaceProfileMigrationCandidateBuildResult>)
      | undefined;
    readonly capabilityGrants?: unknown;
    readonly checkpoint?: (() => Promise<KnowledgeSpaceProfileMigrationRun | null>) | undefined;
    readonly claimLimit?: number | undefined;
    readonly deletionFence?: unknown;
    readonly fail?: (() => Promise<KnowledgeSpaceProfileMigrationRun | null>) | undefined;
    readonly heartbeat?: (() => Promise<KnowledgeSpaceProfileMigrationRun | null>) | undefined;
    readonly heartbeatIntervalMs?: number | undefined;
    readonly leaseMs?: number | undefined;
    readonly now?: (() => number) | undefined;
    readonly onError?: ((input: unknown) => void) | undefined;
    readonly run?: KnowledgeSpaceProfileMigrationRun | undefined;
    readonly succeed?: (() => Promise<KnowledgeSpaceProfileMigrationRun | null>) | undefined;
  } = {},
) {
  let current = options.run ?? runFixture();
  const access = {
    revalidatePermissionSnapshot: vi.fn(
      options.access?.revalidatePermissionSnapshot ??
        (async () => ({ revision: 1, role: "owner" as const })),
    ),
  };
  const repository = {
    checkpoint: vi.fn(
      async (input: { readonly checkpoint: KnowledgeSpaceProfileMigrationRun["checkpoint"] }) => {
        if (options.checkpoint) return options.checkpoint();
        current = {
          ...current,
          candidatePublicationFingerprint:
            current.candidatePublicationFingerprint ?? candidateFingerprint,
          candidatePublicationId: current.candidatePublicationId ?? candidatePublicationId,
          checkpoint: input.checkpoint,
          rowVersion: current.rowVersion + 1,
        };
        return current;
      },
    ),
    claim: vi.fn(async () => [current]),
    fail: vi.fn(async () => {
      if (options.fail) return options.fail();
      current = { ...current, rowVersion: current.rowVersion + 1, runState: "failed" };
      return current;
    }),
    heartbeat: vi.fn(async () => {
      if (options.heartbeat) return options.heartbeat();
      current = { ...current, rowVersion: current.rowVersion + 1 };
      return current;
    }),
    succeed: vi.fn(async () => {
      if (options.succeed) return options.succeed();
      current = {
        ...current,
        checkpoint: "activated",
        rowVersion: current.rowVersion + 1,
        runState: "succeeded",
      };
      return current;
    }),
  };
  const build = vi.fn(options.build ?? (async () => validCandidate()));
  const builder = {
    build,
    getBuiltCandidate: vi.fn(async () => validCandidate()),
  };
  const evaluator = {
    evaluate: vi.fn(async () => ({ passed: true, summary: { recall: 1 } })),
  };
  const bindings = {
    activateCandidate: vi.fn(async () => options.activation ?? { migrationRunCompleted: false }),
    bindCandidate: vi.fn(async () => ({})),
    requireActivatedBinding: vi.fn(async () => {
      if (options.binding !== undefined) return options.binding;
      throw new Error("not activated");
    }),
  };
  const runtime = createKnowledgeSpaceProfileMigrationRuntime({
    access: access as never,
    bindings: bindings as never,
    builder,
    ...(options.capabilityGrants === undefined
      ? {}
      : { capabilityGrants: options.capabilityGrants as never }),
    claimLimit: options.claimLimit ?? 1,
    ...(options.deletionFence === undefined
      ? {}
      : { deletionFence: options.deletionFence as never }),
    evaluator,
    ...(options.heartbeatIntervalMs === undefined
      ? {}
      : { heartbeatIntervalMs: options.heartbeatIntervalMs }),
    leaseMs: options.leaseMs ?? 1_000,
    now: options.now ?? (() => timestamp),
    ...(options.onError ? { onError: options.onError as never } : {}),
    repository: repository as never,
    workerId: "worker-gap-tests",
  });
  return { access, bindings, builder, evaluator, repository, runtime };
}

function capabilityRun(): KnowledgeSpaceProfileMigrationRun {
  return runFixture({
    accessChannel: undefined,
    capabilityGrantId,
    permissionSnapshotId: undefined,
    permissionSnapshotRevision: undefined,
    requestedBySubjectId: undefined,
  });
}

function resumedRun(
  checkpoint: KnowledgeSpaceProfileMigrationRun["checkpoint"],
  overrides: Partial<KnowledgeSpaceProfileMigrationRun> = {},
): KnowledgeSpaceProfileMigrationRun {
  return runFixture({
    candidatePublicationFingerprint: candidateFingerprint,
    candidatePublicationId,
    checkpoint,
    ...overrides,
  });
}

function runFixture(
  overrides: Partial<KnowledgeSpaceProfileMigrationRun> = {},
): KnowledgeSpaceProfileMigrationRun {
  return {
    accessChannel: "interactive",
    baseEmbeddingProfile: { id: "embedding-1", revision: 1, snapshotDigest: digestA },
    basePublication: { fingerprint: baseFingerprint, headRevision: 7, id: "publication-base" },
    baseRetrievalProfile: { id: "retrieval-1", revision: 1, snapshotDigest: digestA },
    candidateProfile: { id: "embedding-2", revision: 2, snapshotDigest: digestB },
    changedKind: "embedding",
    checkpoint: "queued",
    createdAt: "2026-01-01T00:00:00.000Z",
    executionAttempts: 1,
    id: runId,
    idempotencyKey: "runtime-gap-tests",
    knowledgeSpaceId: "10000000-0000-4000-8000-000000000104",
    leaseExpiresAt: "2026-01-01T00:00:10.000Z",
    leaseToken: "lease-gap-tests",
    maxExecutionAttempts: 3,
    permissionSnapshotId: "permission-1",
    permissionSnapshotRevision: 1,
    rebuildScope: "full-vector-space",
    requestedBySubjectId: "owner-1",
    rowVersion: 1,
    runState: "running",
    tenantId: "tenant-gap-tests",
    updatedAt: "2026-01-01T00:00:00.000Z",
    workerId: "worker-gap-tests",
    ...overrides,
  };
}

function validCandidate(): KnowledgeSpaceProfileMigrationCandidateBuildResult {
  return {
    fullVectorSpaceRebuilt: true,
    pageIndexSummaryOutlineRebuilt: true,
    publicationFingerprint: candidateFingerprint,
    publicationId: candidatePublicationId,
    publicationStatus: "validating",
    successorMembersCloned: true,
  };
}
