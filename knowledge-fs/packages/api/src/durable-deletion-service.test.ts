import { describe, expect, it, vi } from "vitest";

import {
  DurableDeletionIdempotencyConflictError,
  type DurableDeletionJob,
  type DurableDeletionRepository,
  type RequestDurableDeletionResult,
} from "./durable-deletion-repository";
import {
  createDurableDeletionService,
  toPublicDurableDeletionJob,
} from "./durable-deletion-service";
import { KnowledgeSpaceAuthorizationError } from "./knowledge-space-authorization";

describe("durable deletion public projection", () => {
  it("maps internal completion/target names and redacts every durable secret/fence field", () => {
    const response = toPublicDurableDeletionJob(job());

    expect(response).toMatchObject({
      checkpoint: "completed",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
      runState: "completed",
      targetType: "document",
    });
    for (const internalField of [
      "accessChannel",
      "apiKeyId",
      "idempotencyKey",
      "leaseToken",
      "nameChallengeDigest",
      "permissionSnapshotId",
      "requestFingerprint",
      "requestedBySubjectId",
      "rowVersion",
      "tenantId",
      "workerId",
    ]) {
      expect(response).not.toHaveProperty(internalField);
    }
  });

  it("never reflects historical raw provider errors and preserves only a keyed diagnostic token", () => {
    const sensitive = "credential=source-secret:v1:top-secret key=tenant/private.pdf";
    const legacy = toPublicDurableDeletionJob(
      job({
        activeSlot: 1,
        checkpoint: "deleting_objects",
        completedAt: undefined,
        lastErrorCode: "SECRET_DELETE_FAILED",
        lastErrorMessage: sensitive,
        runState: "failed",
      }),
    );
    expect(legacy.error).toEqual({
      code: "SECRET_DELETE_FAILED",
      message: "Durable deletion external cleanup failed",
      retryable: true,
    });
    expect(JSON.stringify(legacy)).not.toContain("top-secret");
    expect(JSON.stringify(legacy)).not.toContain("private.pdf");

    const current = toPublicDurableDeletionJob(
      job({
        activeSlot: 1,
        checkpoint: "deleting_objects",
        completedAt: undefined,
        lastErrorCode: "SECRET_DELETE_FAILED",
        lastErrorMessage: "Durable deletion external cleanup failed [diagnostic:0123456789abcdef]",
        runState: "failed",
      }),
    );
    expect(current.error?.message).toBe(
      "Durable deletion external cleanup failed [diagnostic:0123456789abcdef]",
    );
  });
});

describe("durable deletion request replay", () => {
  it("replays a completed space deletion before reading the now-absent space row", async () => {
    const existing = job({
      idempotencyKey: "delete-space-request",
      targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      targetType: "knowledge_space",
    });
    const requestKnowledgeSpaceDeletion = vi.fn(async (input) =>
      requestResult(existing, input.idempotencyKey),
    );
    const spacesGet = vi.fn(async () => null);
    const authorization = vi.fn();
    const service = replayService(existing, {
      authorization,
      requestKnowledgeSpaceDeletion,
      spacesGet,
    });

    const result = await service.requestKnowledgeSpaceDeletion({
      callerKind: "interactive",
      challenge: "Deleted space",
      expectedRevision: existing.targetRevision,
      idempotencyKey: existing.idempotencyKey,
      knowledgeSpaceId: existing.knowledgeSpaceId,
      subject: {
        scopes: ["knowledge-spaces:*"],
        subjectId: existing.requestedBySubjectId,
        tenantId: existing.tenantId,
      },
    });

    expect(result.job.id).toBe(existing.id);
    expect(spacesGet).not.toHaveBeenCalled();
    expect(authorization).not.toHaveBeenCalled();
    expect(requestKnowledgeSpaceDeletion).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: existing.idempotencyKey,
        nameChallenge: "Deleted space",
        permissionSnapshotId: existing.permissionSnapshotId,
        permissionSnapshotRevision: existing.permissionSnapshotRevision,
      }),
    );
  });

  it("keeps repository keyed-payload conflict detection on replay", async () => {
    const existing = job({
      idempotencyKey: "delete-space-request",
      targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      targetType: "knowledge_space",
    });
    const requestKnowledgeSpaceDeletion = vi.fn(async () => {
      throw new DurableDeletionIdempotencyConflictError();
    });
    const service = replayService(existing, { requestKnowledgeSpaceDeletion });

    await expect(
      service.requestKnowledgeSpaceDeletion({
        callerKind: "interactive",
        challenge: "different challenge",
        expectedRevision: existing.targetRevision,
        idempotencyKey: existing.idempotencyKey,
        knowledgeSpaceId: existing.knowledgeSpaceId,
        subject: {
          scopes: ["knowledge-spaces:*"],
          subjectId: existing.requestedBySubjectId,
          tenantId: existing.tenantId,
        },
      }),
    ).rejects.toMatchObject({ code: "DURABLE_DELETION_IDEMPOTENCY_CONFLICT" });
  });

  it("does not reveal an idempotency ledger entry to a different requester", async () => {
    const existing = job({
      idempotencyKey: "delete-space-request",
      targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      targetType: "knowledge_space",
    });
    const requestKnowledgeSpaceDeletion = vi.fn();
    const service = replayService(existing, { requestKnowledgeSpaceDeletion });

    await expect(
      service.requestKnowledgeSpaceDeletion({
        callerKind: "interactive",
        challenge: "Deleted space",
        expectedRevision: existing.targetRevision,
        idempotencyKey: existing.idempotencyKey,
        knowledgeSpaceId: existing.knowledgeSpaceId,
        subject: {
          scopes: ["knowledge-spaces:*"],
          subjectId: "different-requester",
          tenantId: existing.tenantId,
        },
      }),
    ).rejects.toMatchObject({ code: "DURABLE_DELETION_IDEMPOTENCY_CONFLICT" });
    expect(requestKnowledgeSpaceDeletion).not.toHaveBeenCalled();
  });

  it("replays a deleting source without consulting the active-only source repository", async () => {
    const existing = job({
      checkpoint: "requested",
      idempotencyKey: "delete-source-request",
      runState: "dispatch_pending",
      targetType: "source",
    });
    const requestSourceDeletion = vi.fn(async (input) =>
      requestResult(existing, input.idempotencyKey),
    );
    const sourcesGet = vi.fn(async () => null);
    const authorization = vi.fn(async () => ({}));
    const service = replayService(existing, {
      authorization,
      requestSourceDeletion,
      sourcesGet,
    });

    await expect(
      service.requestSourceDeletion({
        callerKind: "interactive",
        deleteMode: "cascade",
        expectedRevision: existing.targetRevision,
        idempotencyKey: existing.idempotencyKey,
        knowledgeSpaceId: existing.knowledgeSpaceId,
        sourceId: existing.targetId,
        subject: {
          scopes: ["knowledge-spaces:write"],
          subjectId: existing.requestedBySubjectId,
          tenantId: existing.tenantId,
        },
      }),
    ).resolves.toMatchObject({ job: { id: existing.id, targetType: "source" } });
    expect(sourcesGet).not.toHaveBeenCalled();
    expect(authorization).toHaveBeenCalledOnce();
    expect(requestSourceDeletion).toHaveBeenCalledWith(
      expect.objectContaining({ deleteMode: "cascade", expectedVersion: existing.targetRevision }),
    );
  });

  it("replays a deleting document without consulting the active-only asset repository", async () => {
    const existing = job({
      checkpoint: "requested",
      idempotencyKey: "delete-document-request",
      runState: "dispatch_pending",
    });
    const requestDocumentDeletion = vi.fn(async (input) =>
      requestResult(existing, input.idempotencyKey),
    );
    const assetsGet = vi.fn(async () => null);
    const service = replayService(existing, { assetsGet, requestDocumentDeletion });

    await expect(
      service.requestDocumentDeletion({
        callerKind: "interactive",
        documentId: existing.targetId,
        expectedRevision: existing.targetRevision,
        idempotencyKey: existing.idempotencyKey,
        knowledgeSpaceId: existing.knowledgeSpaceId,
        subject: {
          scopes: ["knowledge-spaces:write"],
          subjectId: existing.requestedBySubjectId,
          tenantId: existing.tenantId,
        },
      }),
    ).resolves.toMatchObject({ job: { id: existing.id, targetType: "document" } });
    expect(assetsGet).not.toHaveBeenCalled();
    expect(requestDocumentDeletion).toHaveBeenCalledWith(
      expect.objectContaining({ expectedDocumentVersion: existing.targetRevision }),
    );
  });
});

describe("bulk document deletion idempotency", () => {
  const documentA = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01";
  const documentB = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d02";
  const documentC = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d03";

  it("canonicalizes reordered payloads onto the same stable child keys", async () => {
    const fixture = bulkService();
    const first = await fixture.service.requestBulkDocumentDeletion(
      bulkCommand("bulk-reorder", [documentB, documentA]),
    );
    const replay = await fixture.service.requestBulkDocumentDeletion(
      bulkCommand("bulk-reorder", [documentA, documentB]),
    );

    expect(first.items.map((item) => item.documentId)).toEqual([documentA, documentB]);
    expect(replay.items.map((item) => item.job.id)).toEqual(first.items.map((item) => item.job.id));
    expect([...fixture.ledger.keys()]).toEqual(["bulk-reorder:0", "bulk-reorder:1"]);
    expect(new Set(fixture.calls.map((call) => call.idempotencyContext))).toHaveLength(1);
  });

  it("rejects reuse of the bulk key with any changed full-batch payload", async () => {
    const fixture = bulkService();
    await fixture.service.requestBulkDocumentDeletion(
      bulkCommand("bulk-conflict", [documentA, documentB]),
    );

    await expect(
      fixture.service.requestBulkDocumentDeletion(
        bulkCommand("bulk-conflict", [documentA, documentC]),
      ),
    ).rejects.toMatchObject({ code: "DURABLE_DELETION_IDEMPOTENCY_CONFLICT" });
    expect(fixture.ledger.size).toBe(2);
  });

  it("replays an already-created prefix after a partial failure and resumes stable children", async () => {
    const fixture = bulkService({ failOnceAtKey: "bulk-partial:1" });
    await expect(
      fixture.service.requestBulkDocumentDeletion(
        bulkCommand("bulk-partial", [documentC, documentA, documentB]),
      ),
    ).rejects.toThrow("injected partial failure");
    expect([...fixture.ledger.keys()]).toEqual(["bulk-partial:0"]);

    const replay = await fixture.service.requestBulkDocumentDeletion(
      bulkCommand("bulk-partial", [documentB, documentC, documentA]),
    );
    expect(replay.items.map((item) => item.documentId)).toEqual([documentA, documentB, documentC]);
    expect([...fixture.ledger.keys()]).toEqual([
      "bulk-partial:0",
      "bulk-partial:1",
      "bulk-partial:2",
    ]);
  });
});

describe("logical document deletion admission", () => {
  it.each(["pending", "failed"] as const)(
    "admits a readable %s aggregate without requiring an active revision",
    async (status) => {
      const logicalJob = job({
        checkpoint: "requested",
        idempotencyKey: `delete-logical-${status}`,
        inventoryComplete: false,
        runState: "dispatch_pending",
        targetRevision: 4,
        targetType: "logical_document",
      });
      const requestLogicalDocumentDeletion = vi.fn(async (input) =>
        requestResult(logicalJob, input.idempotencyKey),
      );
      const listRevisions = vi.fn(async () => ({
        items: [
          {
            documentAssetId: logicalJob.targetId,
            documentAssetVersion: 1,
            state: status === "pending" ? "candidate" : "failed",
          },
        ],
      }));
      const repository = {
        getJobByIdempotency: vi.fn(async () => null),
        requestLogicalDocumentDeletion,
      } as unknown as DurableDeletionRepository;
      const service = createDurableDeletionService({
        access: {
          createPermissionSnapshot: vi.fn(async () => ({
            accessChannel: "interactive",
            id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2e21",
            revision: 7,
            role: "editor",
          })),
          getActiveApiKeyById: vi.fn(),
        } as never,
        assets: {
          get: vi.fn(async () => ({
            metadata: { permissionScope: ["document:read"] },
            version: 1,
          })),
        } as never,
        authorization: {
          authorize: vi.fn(async () => ({
            accessContext: {} as never,
            permissionSnapshot: { candidateGrants: ["document:read"] },
          })),
        } as never,
        logicalDocuments: {
          get: vi.fn(async () => ({
            active: null,
            activeRevision: undefined,
            id: logicalJob.targetId,
            rowVersion: 4,
            status,
          })),
          listRevisions,
        } as never,
        repository,
        sources: { get: vi.fn() },
        spaces: { get: vi.fn(async () => ({ id: logicalJob.knowledgeSpaceId })) } as never,
      });

      await expect(
        service.requestLogicalDocumentDeletion({
          callerKind: "interactive",
          documentId: logicalJob.targetId,
          expectedRevision: 4,
          idempotencyKey: logicalJob.idempotencyKey,
          knowledgeSpaceId: logicalJob.knowledgeSpaceId,
          subject: subject(logicalJob.requestedBySubjectId, logicalJob.tenantId),
        }),
      ).resolves.toMatchObject({
        job: { id: logicalJob.id, targetType: "logical_document" },
      });
      expect(listRevisions).toHaveBeenCalledWith(
        expect.objectContaining({
          candidateGrants: ["document:read"],
          documentId: logicalJob.targetId,
          limit: 1,
        }),
      );
      expect(requestLogicalDocumentDeletion).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: logicalJob.targetId,
          expectedDocumentRowVersion: 4,
          permissionSnapshotId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2e21",
        }),
      );
    },
  );
});

describe("failed durable deletion retry authorization", () => {
  it("binds an original requester retry to a fresh current permission snapshot", async () => {
    const fixture = retryService();

    await expect(
      fixture.service.retry({
        callerKind: "interactive",
        idempotencyKey: "retry-by-requester",
        jobId: fixture.failed.id,
        subject: subject(fixture.failed.requestedBySubjectId, fixture.failed.tenantId),
      }),
    ).resolves.toMatchObject({ job: { id: fixture.failed.id } });

    expect(fixture.retryFailedJob).toHaveBeenCalledWith(
      expect.objectContaining({
        accessChannel: "interactive",
        idempotencyKey: "retry-by-requester",
        permissionSnapshotId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2e11",
        permissionSnapshotRevision: 7,
        requestedBySubjectId: fixture.failed.requestedBySubjectId,
        retryAuthority: "original_requester",
      }),
    );
  });

  it("lets a current interactive owner rescue a failed job after its API key was revoked", async () => {
    const fixture = retryService({
      accessChannel: "service_api",
      apiKeyExpiresAt: "2026-07-14T13:00:00.000Z",
      apiKeyId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2e20",
      apiKeyRevision: 3,
      requestedBySubjectId: "removed-api-principal",
    });

    await expect(
      fixture.service.retry({
        callerKind: "interactive",
        idempotencyKey: "owner-rescue-new-key",
        jobId: fixture.failed.id,
        subject: subject("owner-current", fixture.failed.tenantId),
      }),
    ).resolves.toMatchObject({ job: { id: fixture.failed.id } });

    expect(fixture.retryFailedJob).toHaveBeenCalledWith(
      expect.objectContaining({
        accessChannel: "interactive",
        idempotencyKey: "owner-rescue-new-key",
        permissionSnapshotId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2e12",
        requestedBySubjectId: "owner-current",
        requestFingerprint: fixture.failed.requestFingerprint,
        retryAuthority: "interactive_owner_rescue",
      }),
    );
    expect(fixture.failed.requestedBySubjectId).toBe("removed-api-principal");

    await expect(
      fixture.service.get({
        callerKind: "interactive",
        jobId: fixture.failed.id,
        subject: subject("owner-current", fixture.failed.tenantId),
      }),
    ).resolves.toMatchObject({ id: fixture.failed.id });
  });

  it("does not extend rescue monitoring to another owner, editor, tenant, or API key", async () => {
    const fixture = retryService({ requestedBySubjectId: "removed-requester" });
    await fixture.service.retry({
      callerKind: "interactive",
      idempotencyKey: "owner-rescue-monitor",
      jobId: fixture.failed.id,
      subject: subject("owner-current", fixture.failed.tenantId),
    });

    await expect(
      fixture.service.get({
        callerKind: "interactive",
        jobId: fixture.failed.id,
        subject: subject("owner-other", fixture.failed.tenantId),
      }),
    ).resolves.toBeNull();
    await expect(
      fixture.service.get({
        callerKind: "interactive",
        jobId: fixture.failed.id,
        subject: subject("editor-other", fixture.failed.tenantId),
      }),
    ).resolves.toBeNull();
    await expect(
      fixture.service.get({
        callerKind: "interactive",
        jobId: fixture.failed.id,
        subject: subject("owner-current", "tenant-other"),
      }),
    ).resolves.toBeNull();
    await expect(
      fixture.service.get({
        callerKind: "api_key",
        jobId: fixture.failed.id,
        subject: subject("owner-current", fixture.failed.tenantId),
      }),
    ).resolves.toBeNull();
  });

  it("does not allow a different editor to rescue another requester's failed job", async () => {
    const fixture = retryService();

    await expect(
      fixture.service.retry({
        callerKind: "interactive",
        idempotencyKey: "editor-cannot-rescue",
        jobId: fixture.failed.id,
        subject: subject("editor-other", fixture.failed.tenantId),
      }),
    ).resolves.toBeNull();
    expect(fixture.retryFailedJob).not.toHaveBeenCalled();
  });

  it("does not reveal or rescue a failed job across tenants", async () => {
    const fixture = retryService();

    await expect(
      fixture.service.retry({
        callerKind: "interactive",
        idempotencyKey: "cross-tenant-rescue",
        jobId: fixture.failed.id,
        subject: subject("owner-current", "tenant-other"),
      }),
    ).resolves.toBeNull();
    expect(fixture.authorization).not.toHaveBeenCalled();
    expect(fixture.retryFailedJob).not.toHaveBeenCalled();
  });
});

function job(overrides: Partial<DurableDeletionJob> = {}): DurableDeletionJob {
  return {
    accessChannel: "interactive",
    checkpoint: "completed",
    createdAt: "2026-07-14T12:00:00.000Z",
    deleteMode: "cascade",
    executionAttempts: 1,
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
    idempotencyKey: "secret-idempotency-key",
    inventoryComplete: true,
    knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
    maxExecutionAttempts: 10,
    nameChallengeDigest: "a".repeat(64),
    permissionSnapshotId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c46",
    permissionSnapshotRevision: 1,
    requestFingerprint: "b".repeat(64),
    requestedBySubjectId: "owner-1",
    rowVersion: 9,
    runState: "succeeded",
    targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
    targetRevision: 2,
    targetType: "document_asset",
    tenantId: "tenant-1",
    updatedAt: "2026-07-14T12:01:00.000Z",
    ...overrides,
  };
}

function replayService(
  existing: DurableDeletionJob,
  overrides: {
    readonly assetsGet?: ReturnType<typeof vi.fn> | undefined;
    readonly authorization?: ReturnType<typeof vi.fn> | undefined;
    readonly requestDocumentDeletion?: ReturnType<typeof vi.fn> | undefined;
    readonly requestKnowledgeSpaceDeletion?: ReturnType<typeof vi.fn> | undefined;
    readonly requestSourceDeletion?: ReturnType<typeof vi.fn> | undefined;
    readonly sourcesGet?: ReturnType<typeof vi.fn> | undefined;
    readonly spacesGet?: ReturnType<typeof vi.fn> | undefined;
  } = {},
) {
  const repository = {
    getJobByIdempotency: vi.fn(async () => existing),
    requestDocumentDeletion:
      overrides.requestDocumentDeletion ??
      vi.fn(async (input) => requestResult(existing, input.idempotencyKey)),
    requestKnowledgeSpaceDeletion:
      overrides.requestKnowledgeSpaceDeletion ??
      vi.fn(async (input) => requestResult(existing, input.idempotencyKey)),
    requestSourceDeletion:
      overrides.requestSourceDeletion ??
      vi.fn(async (input) => requestResult(existing, input.idempotencyKey)),
  } as unknown as DurableDeletionRepository;
  return createDurableDeletionService({
    access: {
      createPermissionSnapshot: vi.fn(),
      getActiveApiKeyById: vi.fn(),
    } as never,
    assets: { get: overrides.assetsGet ?? vi.fn() },
    authorization: {
      authorize: overrides.authorization ?? vi.fn(async () => ({})),
    } as never,
    repository,
    sources: { get: overrides.sourcesGet ?? vi.fn() },
    spaces: { get: overrides.spacesGet ?? vi.fn(async () => null) },
  });
}

function requestResult(jobValue: DurableDeletionJob, idempotencyKey: string) {
  return {
    created: false,
    job: jobValue,
    outbox: { requestIdempotencyKey: idempotencyKey },
    tombstone: {},
  } as RequestDurableDeletionResult;
}

function bulkCommand(idempotencyKey: string, documentIds: readonly string[]) {
  return {
    callerKind: "interactive" as const,
    documents: documentIds.map((documentId) => ({ documentId, expectedRevision: 1 })),
    idempotencyKey,
    knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
    subject: {
      scopes: ["knowledge-spaces:write"],
      subjectId: "user-a",
      tenantId: "tenant-a",
    },
  };
}

function bulkService(options: { readonly failOnceAtKey?: string | undefined } = {}) {
  type DocumentRequest = Parameters<DurableDeletionRepository["requestDocumentDeletion"]>[0];
  const ledger = new Map<
    string,
    { readonly job: DurableDeletionJob; readonly signature: string }
  >();
  const calls: DocumentRequest[] = [];
  let failed = false;
  const requestDocumentDeletion = vi.fn(async (input: DocumentRequest) => {
    calls.push(input);
    if (!failed && input.idempotencyKey === options.failOnceAtKey) {
      failed = true;
      throw new Error("injected partial failure");
    }
    const signature = JSON.stringify({
      context: input.idempotencyContext,
      documentAssetId: input.documentAssetId,
      expectedDocumentVersion: input.expectedDocumentVersion,
    });
    const existing = ledger.get(input.idempotencyKey);
    if (existing) {
      if (existing.signature !== signature) {
        throw new DurableDeletionIdempotencyConflictError();
      }
      return requestResult(existing.job, input.idempotencyKey);
    }
    const created = job({
      checkpoint: "requested",
      id: `018f0d60-7a49-7cc2-9c1b-${String(ledger.size + 1).padStart(12, "0")}`,
      idempotencyKey: input.idempotencyKey,
      inventoryComplete: false,
      knowledgeSpaceId: input.knowledgeSpaceId,
      permissionSnapshotId: input.permissionSnapshotId,
      permissionSnapshotRevision: input.permissionSnapshotRevision,
      requestedBySubjectId: input.requestedBySubjectId,
      runState: "dispatch_pending",
      targetId: input.documentAssetId,
      targetRevision: input.expectedDocumentVersion,
      tenantId: input.tenantId,
    });
    ledger.set(input.idempotencyKey, { job: created, signature });
    return requestResult(created, input.idempotencyKey);
  });
  const repository = {
    getJobByIdempotency: vi.fn(
      async (input: { readonly idempotencyKey: string }) =>
        ledger.get(input.idempotencyKey)?.job ?? null,
    ),
    requestDocumentDeletion,
  } as unknown as DurableDeletionRepository;
  const permissionSnapshot = {
    accessChannel: "interactive",
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c46",
    revision: 1,
    role: "editor",
  };
  const service = createDurableDeletionService({
    access: {
      createPermissionSnapshot: vi.fn(async () => permissionSnapshot),
      getActiveApiKeyById: vi.fn(),
    } as never,
    assets: { get: vi.fn(async () => ({ metadata: {} })) } as never,
    authorization: {
      authorize: vi.fn(async () => ({ permissionSnapshot: { candidateGrants: [] } })),
    } as never,
    now: () => Date.parse("2026-07-14T12:00:00.000Z"),
    repository,
    sources: { get: vi.fn() },
    spaces: { get: vi.fn(async () => ({})) } as never,
  });
  return { calls, ledger, service };
}

function retryService(overrides: Partial<DurableDeletionJob> = {}) {
  const failed = job({
    activeSlot: 1,
    checkpoint: "deleting_objects",
    completedAt: undefined,
    inventoryComplete: true,
    lastErrorCode: "OBJECT_DELETE_FAILED",
    lastErrorMessage: "storage unavailable",
    runState: "failed",
    ...overrides,
  });
  let current = failed;
  const rescueActors = new Set<string>();
  const retryFailedJob = vi.fn(async (input) => {
    if (input.retryAuthority === "interactive_owner_rescue") {
      rescueActors.add(input.requestedBySubjectId);
    }
    current = job({
      ...failed,
      lastErrorCode: undefined,
      lastErrorMessage: undefined,
      rowVersion: failed.rowVersion + 1,
      runState: "dispatch_pending",
    });
    return requestResult(current, input.idempotencyKey);
  });
  const authorization = vi.fn(
    async (input: { requiredAccess: string; subject: { subjectId: string } }) => {
      const role = input.subject.subjectId.startsWith("owner-")
        ? "owner"
        : input.subject.subjectId === failed.requestedBySubjectId
          ? "editor"
          : "editor";
      if (input.requiredAccess === "admin" && role !== "owner") {
        throw new KnowledgeSpaceAuthorizationError(
          "KNOWLEDGE_SPACE_ROLE_DENIED",
          "Knowledge space owner access is required",
        );
      }
      if (
        input.requiredAccess === "write" &&
        input.subject.subjectId !== failed.requestedBySubjectId
      ) {
        throw new KnowledgeSpaceAuthorizationError(
          "KNOWLEDGE_SPACE_ROLE_DENIED",
          "Knowledge space write access is required",
        );
      }
      return {};
    },
  );
  const repository = {
    getJob: vi.fn(async (input: { readonly tenantId: string }) =>
      input.tenantId === failed.tenantId ? current : null,
    ),
    hasRetryAuditActor: vi.fn(
      async (input: { readonly subjectId: string; readonly tenantId: string }) =>
        input.tenantId === failed.tenantId && rescueActors.has(input.subjectId),
    ),
    retryFailedJob,
  } as unknown as DurableDeletionRepository;
  const service = createDurableDeletionService({
    access: {
      createPermissionSnapshot: vi.fn(async (input) => ({
        accessChannel: input.accessChannel,
        id:
          input.subjectId === "owner-current"
            ? "018f0d60-7a49-7cc2-9c1b-5b36f18f2e12"
            : "018f0d60-7a49-7cc2-9c1b-5b36f18f2e11",
        revision: 7,
        role: input.subjectId === "owner-current" ? "owner" : "editor",
      })),
      getActiveApiKeyById: vi.fn(async () => null),
    } as never,
    assets: { get: vi.fn() },
    authorization: { authorize: authorization } as never,
    now: () => Date.parse("2026-07-14T12:05:00.000Z"),
    repository,
    sources: { get: vi.fn() },
    spaces: { get: vi.fn() },
  });
  return { authorization, failed, retryFailedJob, service };
}

function subject(subjectId: string, tenantId: string) {
  return { scopes: ["knowledge-spaces:*"], subjectId, tenantId };
}
