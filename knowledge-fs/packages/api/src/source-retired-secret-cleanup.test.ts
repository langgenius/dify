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
