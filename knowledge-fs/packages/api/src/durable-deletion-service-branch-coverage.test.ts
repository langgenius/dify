import { describe, expect, it, vi } from "vitest";

import {
  DurableDeletionCheckpointConflictError,
  DurableDeletionIdempotencyConflictError,
  type DurableDeletionJob,
  DurableDeletionNameChallengeMismatchError,
  DurableDeletionPermissionFenceError,
  type DurableDeletionRepository,
  DurableDeletionTargetConflictError,
  DurableDeletionTargetRevisionConflictError,
  type RequestDurableDeletionResult,
} from "./durable-deletion-repository";
import {
  type DurableDeletionRequestPrincipal,
  createDurableDeletionService,
} from "./durable-deletion-service";
import { KnowledgeSpaceAccessError } from "./knowledge-space-access-control";
import { KnowledgeSpaceAuthorizationError } from "./knowledge-space-authorization";

const NOW = Date.parse("2026-07-14T12:05:00.000Z");
const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const TARGET_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";

describe("durable deletion service branch boundaries", () => {
  it.each([0, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an invalid permission snapshot TTL (%s)",
    (permissionSnapshotTtlMs) => {
      expect(() => branchFixture({ permissionSnapshotTtlMs })).toThrow(
        "permissionSnapshotTtlMs must be a positive integer",
      );
    },
  );

  it("maps authorization denial while issuing a permission and preserves unexpected errors", async () => {
    const denied = branchFixture({
      authorize: vi.fn(async () => {
        throw new KnowledgeSpaceAuthorizationError("KNOWLEDGE_SPACE_ROLE_DENIED", "denied");
      }),
    });
    await expect(
      denied.service.requestDocumentDeletion(documentCommand(false)),
    ).rejects.toMatchObject({ code: "DURABLE_DELETION_FORBIDDEN", message: "denied" });

    const unexpected = new Error("authorization backend failed");
    const failed = branchFixture({
      authorize: vi.fn(async () => {
        throw unexpected;
      }),
    });
    await expect(failed.service.requestDocumentDeletion(documentCommand(false))).rejects.toBe(
      unexpected,
    );
  });

  it("uses capability provenance and rejects missing or out-of-scope request targets", async () => {
    const capability = branchFixture();
    await capability.service.requestDocumentDeletion(documentCommand(true));
    expect(capability.repository.requestDocumentDeletion).toHaveBeenCalledWith(
      expect.objectContaining({ capabilityGrantId: "grant-1" }),
    );

    const missingSpace = branchFixture({ space: null });
    await expect(
      missingSpace.service.requestDocumentDeletion(documentCommand(true)),
    ).rejects.toMatchObject({ code: "DURABLE_DELETION_NOT_FOUND" });

    for (const asset of [null, { metadata: { permissionScope: ["private"] }, version: 1 }]) {
      const fixture = branchFixture({ asset });
      await expect(
        fixture.service.requestDocumentDeletion(documentCommand(true)),
      ).rejects.toMatchObject({ code: "DURABLE_DELETION_NOT_FOUND" });
    }

    for (const source of [null, { permissionScope: ["private"] }]) {
      const fixture = branchFixture({ source });
      await expect(
        fixture.service.requestSourceDeletion(sourceCommand(true)),
      ).rejects.toMatchObject({
        code: "DURABLE_DELETION_NOT_FOUND",
      });
    }
  });

  it("covers knowledge-space caller, challenge, and capability admission branches", async () => {
    const nonInteractive = branchFixture();
    await expect(
      nonInteractive.service.requestKnowledgeSpaceDeletion({
        ...spaceCommand(false),
        callerKind: "api_key",
      }),
    ).rejects.toMatchObject({ code: "DURABLE_DELETION_FORBIDDEN" });

    const mismatch = branchFixture();
    await expect(
      mismatch.service.requestKnowledgeSpaceDeletion({
        ...spaceCommand(true),
        challenge: "wrong",
      }),
    ).rejects.toMatchObject({ code: "DURABLE_DELETION_CHALLENGE_MISMATCH" });

    const allowed = branchFixture();
    await allowed.service.requestKnowledgeSpaceDeletion(spaceCommand(true));
    expect(allowed.repository.requestKnowledgeSpaceDeletion).toHaveBeenCalledWith(
      expect.objectContaining({ capabilityGrantId: "grant-1", nameChallenge: "Space" }),
    );
  });

  it("fails closed across every logical-document admission boundary", async () => {
    const unavailable = branchFixture({ logicalDocuments: false });
    await expect(
      unavailable.service.requestLogicalDocumentDeletion(logicalCommand()),
    ).rejects.toMatchObject({ code: "DURABLE_DELETION_UNAVAILABLE" });

    const missing = branchFixture({ logical: null });
    await expect(
      missing.service.requestLogicalDocumentDeletion(logicalCommand()),
    ).rejects.toMatchObject({ code: "DURABLE_DELETION_NOT_FOUND" });

    const noRevision = branchFixture({ logical: { active: null }, revisions: [] });
    await expect(
      noRevision.service.requestLogicalDocumentDeletion(logicalCommand()),
    ).rejects.toMatchObject({ code: "DURABLE_DELETION_NOT_FOUND" });

    const active = { documentAssetId: TARGET_ID, documentAssetVersion: 2 };
    for (const asset of [
      null,
      { metadata: {}, version: 1 },
      { metadata: { permissionScope: ["private"] }, version: 2 },
    ]) {
      const fixture = branchFixture({ asset, logical: { active } });
      await expect(
        fixture.service.requestLogicalDocumentDeletion(logicalCommand()),
      ).rejects.toMatchObject({ code: "DURABLE_DELETION_NOT_FOUND" });
    }

    const allowed = branchFixture({ asset: { metadata: {}, version: 2 }, logical: { active } });
    await allowed.service.requestLogicalDocumentDeletion(logicalCommand());
    expect(allowed.repository.requestLogicalDocumentDeletion).toHaveBeenCalledOnce();
  });

  it.each([
    [new DurableDeletionPermissionFenceError(), "DURABLE_DELETION_FORBIDDEN"],
    [
      new KnowledgeSpaceAccessError("space_access_permission_snapshot_invalid", "snapshot invalid"),
      "DURABLE_DELETION_FORBIDDEN",
    ],
    [new DurableDeletionNameChallengeMismatchError(), "DURABLE_DELETION_CHALLENGE_MISMATCH"],
    [new DurableDeletionIdempotencyConflictError(), "DURABLE_DELETION_IDEMPOTENCY_CONFLICT"],
    [new DurableDeletionTargetRevisionConflictError(), "DURABLE_DELETION_REVISION_CONFLICT"],
    [new DurableDeletionTargetConflictError(), "DURABLE_DELETION_STATE_CONFLICT"],
    [new DurableDeletionCheckpointConflictError(), "DURABLE_DELETION_STATE_CONFLICT"],
  ] as const)("maps repository error %# onto %s", async (error, code) => {
    const fixture = branchFixture({
      repository: {
        requestDocumentDeletion: vi.fn(async () => {
          throw error;
        }),
      },
    });
    await expect(
      fixture.service.requestDocumentDeletion(documentCommand(true)),
    ).rejects.toMatchObject({
      code,
    });
  });

  it("preserves unrelated repository failures", async () => {
    const error = new Error("database unavailable");
    const fixture = branchFixture({
      repository: {
        requestSourceDeletion: vi.fn(async () => {
          throw error;
        }),
      },
    });
    await expect(fixture.service.requestSourceDeletion(sourceCommand(true))).rejects.toBe(error);
  });

  it("replays capability jobs and rejects incomplete legacy provenance", async () => {
    const capabilityJob = deletionJob({ capabilityGrantId: "grant-1" });
    const capability = branchFixture({ jobByIdempotency: capabilityJob });
    await capability.service.requestDocumentDeletion(documentCommand(true));
    expect(capability.repository.requestDocumentDeletion).toHaveBeenCalledWith(
      expect.objectContaining({ capabilityGrantId: "grant-1" }),
    );

    const incomplete = deletionJob({ permissionSnapshotRevision: 0 });
    const legacy = branchFixture({ jobByIdempotency: incomplete });
    await expect(
      legacy.service.requestDocumentDeletion(documentCommand(false)),
    ).rejects.toMatchObject({
      code: "DURABLE_DELETION_STATE_CONFLICT",
    });
  });

  it("retains API-key provenance on request and replay", async () => {
    const expiresAt = "2026-07-14T13:00:00.000Z";
    const apiKey = { expiresAt, id: "api-key-1", revision: 3 };
    const requested = branchFixture({
      activeKey: {
        expiresAt,
        principalSubjectId: "owner-1",
        revision: 3,
      },
    });
    await requested.service.requestDocumentDeletion({
      ...documentCommand(false),
      apiKey,
      callerKind: "api_key",
    });
    expect(requested.repository.requestDocumentDeletion).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKeyExpiresAt: expiresAt,
        apiKeyId: "api-key-1",
        apiKeyRevision: 3,
      }),
    );

    const replayJob = deletionJob({
      accessChannel: "service_api",
      apiKeyExpiresAt: expiresAt,
      apiKeyId: "api-key-1",
      apiKeyRevision: 3,
    });
    const replay = branchFixture({
      activeKey: {
        expiresAt,
        principalSubjectId: "owner-1",
        revision: 3,
      },
      jobByIdempotency: replayJob,
    });
    await replay.service.requestDocumentDeletion({
      ...documentCommand(false),
      apiKey,
      callerKind: "api_key",
    });
    expect(replay.repository.requestDocumentDeletion).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKeyExpiresAt: expiresAt,
        apiKeyId: "api-key-1",
        apiKeyRevision: 3,
      }),
    );
  });

  it.each([
    [null, "missing"],
    [{ expiresAt: undefined, principalSubjectId: "owner-1", revision: 2 }, "revision"],
    [{ expiresAt: undefined, principalSubjectId: "other", revision: 3 }, "subject"],
    [
      {
        expiresAt: "2026-07-14T13:00:00.000Z",
        principalSubjectId: "owner-1",
        revision: 3,
      },
      "expiry",
    ],
  ] as const)(
    "rejects an API-key job when the active key has a %s mismatch",
    async (activeKey, _reason) => {
      const job = deletionJob({
        accessChannel: "service_api",
        apiKeyId: "api-key-1",
        apiKeyRevision: 3,
      });
      const fixture = branchFixture({ activeKey, job });
      await expect(
        fixture.service.get({
          apiKey: { id: "api-key-1", revision: 3 },
          callerKind: "api_key",
          jobId: job.id,
          subject: principal(false).subject,
        }),
      ).resolves.toBeNull();
    },
  );

  it("rejects mismatched or expired recorded API-key bindings before active-key lookup", async () => {
    const cases = [
      { apiKeyId: "different", apiKeyRevision: 3 },
      { apiKeyId: "api-key-1", apiKeyRevision: 2 },
      {
        apiKeyExpiresAt: "2026-07-14T13:00:00.000Z",
        apiKeyId: "api-key-1",
        apiKeyRevision: 3,
      },
      {
        apiKeyExpiresAt: "2026-07-14T12:00:00.000Z",
        apiKeyId: "api-key-1",
        apiKeyRevision: 3,
      },
    ];
    for (const overrides of cases) {
      const job = deletionJob({ accessChannel: "service_api", ...overrides });
      const fixture = branchFixture({ job });
      await expect(
        fixture.service.get({
          apiKey: { id: "api-key-1", revision: 3 },
          callerKind: "api_key",
          jobId: job.id,
          subject: principal(false).subject,
        }),
      ).resolves.toBeNull();
      expect(fixture.access.getActiveApiKeyById).not.toHaveBeenCalled();
    }
  });

  it("covers capability status and retry authorization", async () => {
    const job = deletionJob({ capabilityGrantId: "grant-1", runState: "failed" });
    const matching = branchFixture({ job });
    await expect(
      matching.service.get({ ...principal(true), jobId: job.id }),
    ).resolves.toMatchObject({ id: job.id });
    await expect(
      matching.service.retry({ ...principal(true), idempotencyKey: "retry-cap", jobId: job.id }),
    ).resolves.toMatchObject({ job: { id: job.id } });
    expect(matching.repository.retryFailedJob).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilityGrantId: "grant-1",
        retryAuthority: "original_requester",
      }),
    );

    const mismatched = branchFixture({ job });
    await expect(
      mismatched.service.retry({
        ...principal(true, "other-grant"),
        idempotencyKey: "retry-cap-other",
        jobId: job.id,
      }),
    ).resolves.toBeNull();
  });

  it("covers missing jobs, noninteractive rescue, and forbidden retry permission", async () => {
    const missing = branchFixture();
    await expect(
      missing.service.retry({
        ...principal(false),
        idempotencyKey: "retry-missing",
        jobId: "missing",
      }),
    ).resolves.toBeNull();

    const foreign = deletionJob({ requestedBySubjectId: "removed-owner", runState: "failed" });
    const nonInteractive = branchFixture({ job: foreign });
    await expect(
      nonInteractive.service.retry({
        callerKind: "api_key",
        idempotencyKey: "retry-api",
        jobId: foreign.id,
        subject: principal(false).subject,
      }),
    ).resolves.toBeNull();

    const forbidden = branchFixture({
      authorize: vi.fn(async () => {
        throw new KnowledgeSpaceAuthorizationError("KNOWLEDGE_SPACE_ROLE_DENIED", "denied");
      }),
      job: foreign,
    });
    await expect(
      forbidden.service.retry({
        ...principal(false),
        idempotencyKey: "retry-forbidden",
        jobId: foreign.id,
      }),
    ).resolves.toBeNull();
  });

  it("allows a recorded rescuer to read terminal work and propagates unexpected rescue errors", async () => {
    const completed = deletionJob({ requestedBySubjectId: "removed-owner", runState: "succeeded" });
    const terminal = branchFixture({ hasRetryAuditActor: true, job: completed });
    await expect(
      terminal.service.get({ ...principal(false), jobId: completed.id }),
    ).resolves.toMatchObject({ id: completed.id });

    const failure = new Error("authorization unavailable");
    const active = deletionJob({ requestedBySubjectId: "removed-owner", runState: "failed" });
    const unexpected = branchFixture({
      authorize: vi.fn(async () => {
        throw failure;
      }),
      hasRetryAuditActor: true,
      job: active,
    });
    await expect(unexpected.service.get({ ...principal(false), jobId: active.id })).rejects.toBe(
      failure,
    );
  });
});

interface BranchFixtureOptions {
  readonly activeKey?: unknown;
  readonly asset?: unknown;
  readonly authorize?: ReturnType<typeof vi.fn>;
  readonly hasRetryAuditActor?: boolean;
  readonly job?: DurableDeletionJob | null;
  readonly jobByIdempotency?: DurableDeletionJob | null;
  readonly logical?: unknown;
  readonly logicalDocuments?: boolean;
  readonly permissionSnapshotTtlMs?: number;
  readonly repository?: Partial<DurableDeletionRepository>;
  readonly revisions?: readonly unknown[];
  readonly source?: unknown;
  readonly space?: unknown;
}

function branchFixture(options: BranchFixtureOptions = {}) {
  const defaultJob = deletionJob();
  const result = (value = defaultJob): RequestDurableDeletionResult =>
    ({
      created: true,
      job: value,
      outbox: { requestIdempotencyKey: value.idempotencyKey },
      tombstone: {},
    }) as RequestDurableDeletionResult;
  const repository = {
    getJob: vi.fn(async () => options.job ?? null),
    getJobByIdempotency: vi.fn(async () => options.jobByIdempotency ?? null),
    hasRetryAuditActor: vi.fn(async () => options.hasRetryAuditActor ?? false),
    requestDocumentDeletion: vi.fn(async () => result()),
    requestKnowledgeSpaceDeletion: vi.fn(async () =>
      result(deletionJob({ targetId: SPACE_ID, targetType: "knowledge_space" })),
    ),
    requestLogicalDocumentDeletion: vi.fn(async () =>
      result(deletionJob({ targetType: "logical_document" })),
    ),
    requestSourceDeletion: vi.fn(async () => result(deletionJob({ targetType: "source" }))),
    retryFailedJob: vi.fn(async () => result(options.job ?? defaultJob)),
    ...options.repository,
  } as unknown as DurableDeletionRepository;
  const authorize =
    options.authorize ?? vi.fn(async () => ({ permissionSnapshot: { candidateGrants: [] } }));
  const access = {
    createPermissionSnapshot: vi.fn(
      async (input: {
        readonly accessChannel: string;
        readonly apiKey?: {
          readonly expiresAt?: string;
          readonly id: string;
          readonly revision: number;
        };
      }) => ({
        accessChannel: input.accessChannel,
        ...(input.apiKey?.expiresAt ? { apiKeyExpiresAt: input.apiKey.expiresAt } : {}),
        ...(input.apiKey
          ? { apiKeyId: input.apiKey.id, apiKeyRevision: input.apiKey.revision }
          : {}),
        id: "permission-1",
        revision: 1,
        role: "owner",
      }),
    ),
    getActiveApiKeyById: vi.fn(async () => options.activeKey ?? null),
  };
  const logicalDocuments =
    options.logicalDocuments === false
      ? undefined
      : {
          get: vi.fn(async () =>
            options.logical === undefined
              ? { active: { documentAssetId: TARGET_ID, documentAssetVersion: 1 } }
              : options.logical,
          ),
          listRevisions: vi.fn(async () => ({ items: options.revisions ?? [] })),
        };
  const service = createDurableDeletionService({
    access: access as never,
    assets: {
      get: vi.fn(async () =>
        options.asset === undefined ? { metadata: {}, version: 1 } : options.asset,
      ),
    } as never,
    authorization: { authorize } as never,
    logicalDocuments: logicalDocuments as never,
    now: () => NOW,
    ...(options.permissionSnapshotTtlMs === undefined
      ? {}
      : { permissionSnapshotTtlMs: options.permissionSnapshotTtlMs }),
    repository,
    sources: {
      get: vi.fn(async () =>
        options.source === undefined ? { permissionScope: undefined } : options.source,
      ),
    } as never,
    spaces: {
      get: vi.fn(async () => (options.space === undefined ? { name: "Space" } : options.space)),
    } as never,
  });
  return { access, repository, service };
}

function principal(capability: boolean, grantId = "grant-1"): DurableDeletionRequestPrincipal {
  return {
    ...(capability ? { capability: { contentScopeIds: [], grantId } } : {}),
    callerKind: "interactive",
    subject: { scopes: ["knowledge-spaces:*"], subjectId: "owner-1", tenantId: "tenant-1" },
  };
}

function documentCommand(capability: boolean) {
  return {
    ...principal(capability),
    documentId: TARGET_ID,
    expectedRevision: 1,
    idempotencyKey: "delete-document",
    knowledgeSpaceId: SPACE_ID,
  };
}

function logicalCommand() {
  return {
    ...principal(true),
    documentId: TARGET_ID,
    expectedRevision: 1,
    idempotencyKey: "delete-logical",
    knowledgeSpaceId: SPACE_ID,
  };
}

function sourceCommand(capability: boolean) {
  return {
    ...principal(capability),
    deleteMode: "cascade" as const,
    expectedRevision: 1,
    idempotencyKey: "delete-source",
    knowledgeSpaceId: SPACE_ID,
    sourceId: TARGET_ID,
  };
}

function spaceCommand(capability: boolean) {
  return {
    ...principal(capability),
    challenge: "Space",
    expectedRevision: 1,
    idempotencyKey: "delete-space",
    knowledgeSpaceId: SPACE_ID,
  };
}

function deletionJob(overrides: Partial<DurableDeletionJob> = {}): DurableDeletionJob {
  return {
    accessChannel: "interactive",
    checkpoint: "requested",
    createdAt: "2026-07-14T12:00:00.000Z",
    deleteMode: "cascade",
    executionAttempts: 1,
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
    idempotencyKey: "delete-document",
    inventoryComplete: false,
    knowledgeSpaceId: SPACE_ID,
    maxExecutionAttempts: 10,
    permissionSnapshotId: "permission-1",
    permissionSnapshotRevision: 1,
    requestFingerprint: "b".repeat(64),
    requestedBySubjectId: "owner-1",
    rowVersion: 1,
    runState: "dispatch_pending",
    targetId: TARGET_ID,
    targetRevision: 1,
    targetType: "document_asset",
    tenantId: "tenant-1",
    updatedAt: "2026-07-14T12:00:00.000Z",
    ...overrides,
  };
}
