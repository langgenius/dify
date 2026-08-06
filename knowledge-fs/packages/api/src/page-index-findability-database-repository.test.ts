import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type {
  DatabaseAdapter,
  DatabaseExecuteInput,
  DatabaseExecuteResult,
  DatabaseExecutor,
  DatabaseRow,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { createDatabasePageIndexFindabilityRepository } from "./page-index-findability-repository";

const now = "2026-08-06T00:00:00.000Z";
const id = uuid(1);
const spaceId = uuid(2);
const documentId = uuid(3);
const outlineId = uuid(4);
const generationId = uuid(5);
const attemptId = uuid(6);
const lockToken = uuid(7);

describe.each(["postgres", "tidb"] as const)("database PageIndex findability (%s)", (dialect) => {
  it("persists an exact-generation route with a single bounded repair request", async () => {
    const script = scriptedDatabase(dialect, [
      { operation: "select", rows: [{ id: spaceId }] },
      { operation: "select", rows: [] },
      { operation: "select", rows: [] },
      { operation: "insert", rowsAffected: 1 },
    ]);
    const repository = createDatabasePageIndexFindabilityRepository({
      database: script.database,
      generateId: () => id,
      maxBatchSize: 10,
    });

    const persisted = await repository.persist(input());

    expect(persisted).toMatchObject({
      id,
      summaryRepairState: "queued",
      evaluation: { summaryRepairRequested: true },
    });
    expect(script.calls[0]?.sql).toContain("knowledge_spaces");
    expect(script.calls[0]?.sql).toContain("FOR UPDATE");
    expect(script.calls[3]?.sql).toContain(
      dialect === "postgres" ? "ON CONFLICT" : "ON DUPLICATE KEY UPDATE",
    );
    expect(script.calls[3]?.sql).toContain(dialect === "postgres" ? "::jsonb" : "CAST(? AS JSON)");
    script.expectDone();
  });

  it("reads exact routes and fences repair claim completion", async () => {
    const routeScript = scriptedDatabase(dialect, [
      {
        operation: "select",
        rows: [
          {
            document_asset_id: documentId,
            publication_generation_id: generationId,
            recommended_route: "hybrid",
            status: "failed",
          },
        ],
      },
    ]);
    const routeRepository = createDatabasePageIndexFindabilityRepository({
      database: routeScript.database,
      maxBatchSize: 10,
    });
    await expect(
      routeRepository.getManyRoutes({
        documents: [{ documentAssetId: documentId, generationId }],
        knowledgeSpaceId: spaceId,
        limit: 1,
        tenantId: "tenant-1",
      }),
    ).resolves.toEqual([
      { documentAssetId: documentId, generationId, recommendedRoute: "hybrid", status: "failed" },
    ]);
    routeScript.expectDone();

    const leaseExpiresAt = "2026-08-06T00:01:00.000Z";
    const claimScript = scriptedDatabase(dialect, [
      { operation: "select", rows: [row()] },
      { operation: "update", rowsAffected: 1 },
    ]);
    const claimRepository = createDatabasePageIndexFindabilityRepository({
      database: claimScript.database,
      generateLockToken: () => lockToken,
      maxBatchSize: 10,
    });
    const [claimed] = await claimRepository.claimSummaryRepairs({
      leaseExpiresAt,
      limit: 1,
      now,
      workerId: "worker-1",
    });
    expect(claimed).toMatchObject({
      leaseExpiresAt,
      lockToken,
      summaryRepairAttempts: 1,
      summaryRepairState: "leased",
    });
    claimScript.expectDone();

    const completeScript = scriptedDatabase(dialect, [
      {
        operation: "select",
        rows: [
          {
            ...row(),
            lease_expires_at: leaseExpiresAt,
            lock_token: lockToken,
            locked_by: "worker-1",
            summary_repair_attempts: 1,
            summary_repair_state: "leased",
          },
        ],
      },
      { operation: "update", rowsAffected: 1 },
    ]);
    const completeRepository = createDatabasePageIndexFindabilityRepository({
      database: completeScript.database,
      maxBatchSize: 10,
    });
    await expect(
      completeRepository.completeSummaryRepair({ id, lockToken, now }),
    ).resolves.toMatchObject({ summaryRepairState: "dispatched" });
    completeScript.expectDone();
  });

  it("rejects persisted evaluator prompt-version drift", async () => {
    const script = scriptedDatabase(dialect, [
      {
        operation: "select",
        rows: [
          {
            ...row(),
            evaluation: { ...evaluation(), promptVersion: "unexpected-prompt" },
          },
        ],
      },
    ]);
    const repository = createDatabasePageIndexFindabilityRepository({
      database: script.database,
      maxBatchSize: 10,
    });

    await expect(
      repository.claimSummaryRepairs({
        leaseExpiresAt: "2026-08-06T00:01:00.000Z",
        limit: 1,
        now,
        workerId: "worker-1",
      }),
    ).rejects.toThrow("Findability promptVersion is invalid");
    script.expectDone();
  });

  it("handles empty and duplicate route batches and validates route bounds", async () => {
    const emptyScript = scriptedDatabase(dialect, []);
    const emptyRepository = createDatabasePageIndexFindabilityRepository({
      database: emptyScript.database,
      maxBatchSize: 1,
    });
    await expect(
      emptyRepository.getManyRoutes({
        documents: [],
        knowledgeSpaceId: spaceId,
        limit: 1,
        tenantId: "tenant-1",
      }),
    ).resolves.toEqual([]);
    await expect(
      emptyRepository.getManyRoutes({
        documents: [
          { documentAssetId: documentId, generationId },
          { documentAssetId: documentId, generationId },
        ],
        knowledgeSpaceId: spaceId,
        limit: 2,
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("route input exceeds limit=1");
    emptyScript.expectDone();

    const duplicateScript = scriptedDatabase(dialect, [
      {
        operation: "select",
        rows: [
          {
            document_asset_id: documentId,
            publication_generation_id: generationId,
            recommended_route: "hybrid",
            status: "failed",
          },
          {
            document_asset_id: documentId,
            publication_generation_id: generationId,
            recommended_route: "hybrid",
            status: "failed",
          },
        ],
      },
    ]);
    const duplicateRepository = createDatabasePageIndexFindabilityRepository({
      database: duplicateScript.database,
      maxBatchSize: 2,
    });
    await expect(
      duplicateRepository.getManyRoutes({
        documents: [{ documentAssetId: documentId, generationId }],
        knowledgeSpaceId: spaceId,
        limit: 2,
        tenantId: "tenant-1",
      }),
    ).resolves.toHaveLength(1);
    duplicateScript.expectDone();
  });

  it("preserves an existing leased repair and rejects a missing knowledge space", async () => {
    const existingRow = {
      ...row(),
      available_at: "2026-08-06T00:00:30.000Z",
      evaluation: { ...evaluation(), summaryRepairRequested: true },
      lease_expires_at: "2026-08-06T00:01:00.000Z",
      lock_token: lockToken,
      locked_by: "worker-1",
      summary_repair_attempts: 2,
      summary_repair_error: "previous",
      summary_repair_state: "leased",
    };
    const script = scriptedDatabase(dialect, [
      { operation: "select", rows: [{ id: spaceId }] },
      { operation: "select", rows: [existingRow] },
      { operation: "select", rows: [] },
      { operation: "insert", rowsAffected: 1 },
    ]);
    const repository = createDatabasePageIndexFindabilityRepository({
      database: script.database,
      maxBatchSize: 10,
    });
    await expect(repository.persist(input())).resolves.toMatchObject({
      availableAt: "2026-08-06T00:00:30.000Z",
      leaseExpiresAt: "2026-08-06T00:01:00.000Z",
      lockToken,
      lockedBy: "worker-1",
      summaryRepairAttempts: 2,
      summaryRepairError: "previous",
      summaryRepairState: "leased",
    });
    script.expectDone();

    const missing = scriptedDatabase(dialect, [{ operation: "select", rows: [] }]);
    await expect(
      createDatabasePageIndexFindabilityRepository({
        database: missing.database,
        maxBatchSize: 10,
      }).persist(input()),
    ).rejects.toThrow("knowledge space was not found");
    missing.expectDone();
  });

  it("requeues database repairs, returns null for stale leases, and validates claim bounds", async () => {
    const leasedRow = {
      ...row(),
      lease_expires_at: "2026-08-06T00:01:00.000Z",
      lock_token: lockToken,
      locked_by: "worker-1",
      summary_repair_attempts: 1,
      summary_repair_state: "leased",
    };
    const retryAt = "2026-08-06T00:02:00.000Z";
    const retryScript = scriptedDatabase(dialect, [
      { operation: "select", rows: [leasedRow] },
      { operation: "update", rowsAffected: 1 },
    ]);
    await expect(
      createDatabasePageIndexFindabilityRepository({
        database: retryScript.database,
        maxBatchSize: 10,
      }).failSummaryRepair({ error: "temporary", id, lockToken, now, retryAt }),
    ).resolves.toMatchObject({
      availableAt: retryAt,
      summaryRepairError: "temporary",
      summaryRepairState: "queued",
    });
    retryScript.expectDone();

    const staleScript = scriptedDatabase(dialect, [{ operation: "select", rows: [] }]);
    await expect(
      createDatabasePageIndexFindabilityRepository({
        database: staleScript.database,
        maxBatchSize: 10,
      }).completeSummaryRepair({ id, lockToken, now }),
    ).resolves.toBeNull();
    staleScript.expectDone();

    const noCalls = scriptedDatabase(dialect, []);
    const repository = createDatabasePageIndexFindabilityRepository({
      database: noCalls.database,
      maxBatchSize: 1,
    });
    await expect(
      repository.claimSummaryRepairs({
        leaseExpiresAt: "2026-08-06T00:01:00.000Z",
        limit: 2,
        now,
        workerId: "worker",
      }),
    ).rejects.toThrow("claim exceeds maxBatchSize=1");
    await expect(
      repository.claimSummaryRepairs({
        leaseExpiresAt: now,
        limit: 1,
        now,
        workerId: "worker",
      }),
    ).rejects.toThrow("lease must expire after now");
    noCalls.expectDone();
  });

  it("rejects malformed persisted evaluation and repair fields", async () => {
    const malformedRows: readonly DatabaseRow[] = [
      { ...row(), evaluation: { ...evaluation(), model: null } },
      { ...row(), evaluation: { ...evaluation(), abstentionRate: 2 } },
      { ...row(), evaluation: { ...evaluation(), evaluatorVersion: 7 } },
      { ...row(), evaluation: { ...evaluation(), sampleCount: "3" } },
      { ...row(), evaluation: { ...evaluation(), topK: "5" } },
      { ...row(), evaluation: { ...evaluation(), status: "unknown" } },
      { ...row(), evaluation: { ...evaluation(), recommendedRoute: "unknown" } },
      { ...row(), summary_repair_state: "unknown" },
      { ...row(), summary_repair_attempts: -1 },
    ];
    for (const malformedRow of malformedRows) {
      const script = scriptedDatabase(dialect, [{ operation: "select", rows: [malformedRow] }]);
      const repository = createDatabasePageIndexFindabilityRepository({
        database: script.database,
        maxBatchSize: 10,
      });
      await expect(
        repository.claimSummaryRepairs({
          leaseExpiresAt: "2026-08-06T00:01:00.000Z",
          limit: 1,
          now,
          workerId: "worker-1",
        }),
      ).rejects.toThrow();
      script.expectDone();
    }
  });
});

it("validates the database repository batch bound", () => {
  const script = scriptedDatabase("postgres", []);
  expect(() =>
    createDatabasePageIndexFindabilityRepository({ database: script.database, maxBatchSize: 0 }),
  ).toThrow("maxBatchSize must be a positive integer");
});

function input() {
  return {
    compilationAttemptId: attemptId,
    documentAssetId: documentId,
    documentVersion: 1,
    evaluatedAt: now,
    evaluation: evaluation(),
    generationId,
    knowledgeSpaceId: spaceId,
    outlineId,
    publicationFingerprint: `projection-set-sha256:${"a".repeat(64)}`,
    requestSummaryRepair: true,
    tenantId: "tenant-1",
  };
}

function evaluation() {
  return {
    abstentionRate: 1,
    evaluatorVersion: "findability-v1",
    meanReciprocalRank: 0,
    model: { model: "reasoner-v1", pluginId: "plugin-1", provider: "provider-1" },
    pathRecallAtK: 0,
    promptVersion: "pageindex-layered-tree-search-v1" as const,
    recallAtK: 0,
    recommendedRoute: "hybrid" as const,
    sampleCount: 3,
    status: "failed" as const,
    summaryRepairRequested: false,
    topK: 5,
  };
}

function row(): DatabaseRow {
  return {
    available_at: null,
    compilation_attempt_id: attemptId,
    document_asset_id: documentId,
    document_version: 1,
    evaluated_at: now,
    evaluation: evaluation(),
    evaluator_version: "findability-v1",
    id,
    knowledge_space_id: spaceId,
    lease_expires_at: null,
    lock_token: null,
    locked_by: null,
    outline_id: outlineId,
    publication_fingerprint: `projection-set-sha256:${"a".repeat(64)}`,
    publication_generation_id: generationId,
    recommended_route: "hybrid",
    status: "failed",
    summary_repair_attempts: 0,
    summary_repair_error: null,
    summary_repair_state: "queued",
    tenant_id: "tenant-1",
    updated_at: now,
  };
}

interface ScriptStep {
  readonly operation: DatabaseExecuteInput["operation"];
  readonly rows?: readonly DatabaseRow[] | undefined;
  readonly rowsAffected?: number | undefined;
}

function scriptedDatabase(
  dialect: DatabaseAdapter["dialect"],
  steps: readonly ScriptStep[],
): {
  readonly calls: readonly DatabaseExecuteInput[];
  readonly database: DatabaseAdapter;
  expectDone(): void;
} {
  let cursor = 0;
  const calls: DatabaseExecuteInput[] = [];
  const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    calls.push(input);
    const expected = steps[cursor];
    if (!expected) throw new Error(`Unexpected SQL call ${input.operation} ${input.tableName}`);
    cursor += 1;
    expect(input.operation).toBe(expected.operation);
    return { rows: [...(expected.rows ?? [])], rowsAffected: expected.rowsAffected ?? 0 };
  };
  const executor: DatabaseExecutor = { execute };
  const database = createSchemaDatabaseAdapter({
    executor: execute,
    kind: dialect,
    transaction: async (operation) => operation(executor),
  });
  return {
    calls,
    database,
    expectDone: () => expect(cursor).toBe(steps.length),
  };
}

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
}
