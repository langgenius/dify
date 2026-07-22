import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type { DatabaseExecuteInput, DatabaseExecuteResult } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  TidbFtsPostingBackfillNotReadyError,
  createDatabaseTidbFtsPostingBackfillRepository,
} from "./tidb-fts-posting-backfill";
import { TIDB_FTS_TOKENIZER_VERSION, hashTidbFtsTerm } from "./tidb-fts-postings";

const tenantId = "tenant-1";
const spaceId = "10000000-0000-4000-8000-000000000001";
const afterSpaceId = "10000000-0000-4000-8000-000000000000";
const jobId = "20000000-0000-4000-8000-000000000001";
const projectionId = "30000000-0000-4000-8000-000000000001";
const leaseToken = "40000000-0000-4000-8000-000000000001";
const postingId = "50000000-0000-4000-8000-000000000001";
const now = "2026-07-14T00:00:10.000Z";
const expires = "2026-07-14T00:01:00.000Z";

describe.each(["postgres", "tidb"] as const)("TiDB FTS durable backfill SQL (%s)", (dialect) => {
  it("discovers only active projection gaps with exact anonymous-placeholder parameter order", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
      calls.push(input);
      if (input.operation === "select") {
        return {
          rows: [{ knowledge_space_id: spaceId, tenant_id: tenantId }],
          rowsAffected: 0,
        };
      }
      return { rows: [], rowsAffected: 1 };
    };
    const repository = createDatabaseTidbFtsPostingBackfillRepository({
      database: createDatabase(dialect, execute),
      generateId: () => jobId,
      maxClaimBatchSize: 10,
      maxDiscoveryBatchSize: 10,
    });

    await expect(
      repository.discover({ afterKnowledgeSpaceId: afterSpaceId, limit: 5, now }),
    ).resolves.toEqual({ created: 1, nextKnowledgeSpaceId: spaceId, scanned: 1 });

    expect(calls[0]?.params).toEqual([
      afterSpaceId,
      TIDB_FTS_TOKENIZER_VERSION,
      TIDB_FTS_TOKENIZER_VERSION,
      5,
    ]);
    expect(calls[0]?.sql).toContain("IN ('building', 'ready')");
    expect(calls[0]?.sql).toContain("NOT EXISTS");
    expect(calls[1]?.params).toEqual([
      jobId,
      tenantId,
      spaceId,
      TIDB_FTS_TOKENIZER_VERSION,
      "queued",
      0,
      0,
      0,
      0,
      now,
      now,
    ]);
    assertPlaceholderArity(calls, dialect);
  });

  it("claims queued work under a lease-token and row-version fence", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
      calls.push(input);
      return input.operation === "select"
        ? { rows: [jobRow({ run_state: "queued" })], rowsAffected: 0 }
        : { rows: [], rowsAffected: 1 };
    };
    const repository = createDatabaseTidbFtsPostingBackfillRepository({
      database: createDatabase(dialect, execute),
      generateLeaseToken: () => leaseToken,
      maxClaimBatchSize: 10,
      maxDiscoveryBatchSize: 10,
    });

    await expect(
      repository.claim({ leaseExpiresAt: expires, limit: 3, now, workerId: "worker-1" }),
    ).resolves.toMatchObject([{ leaseToken, rowVersion: 2, runState: "running" }]);

    expect(calls[0]?.params).toEqual([now, 3]);
    expect(calls[0]?.sql).toContain("FOR UPDATE");
    expect(calls[0]?.sql).toContain(dialect === "postgres" ? "SKIP LOCKED" : "LIMIT");
    expect(calls[1]?.params).toEqual([
      "running",
      null,
      0,
      0,
      "worker-1",
      leaseToken,
      expires,
      now,
      0,
      2,
      null,
      null,
      now,
      null,
      jobId,
      1,
    ]);
    assertPlaceholderArity(calls, dialect);
  });

  it("atomically replaces one projection and advances the durable cursor afterwards", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
      calls.push(input);
      if (input.tableName === "tidb_fts_posting_backfills" && input.operation === "select") {
        return { rows: [runningJobRow()], rowsAffected: 0 };
      }
      if (input.tableName === "knowledge_spaces" && input.operation === "select") {
        return { rows: [activeSpaceRow()], rowsAffected: 0 };
      }
      if (input.tableName === "deletion_jobs" && input.operation === "select") {
        return { rows: [], rowsAffected: 0 };
      }
      if (input.tableName === "index_projections" && input.operation === "select") {
        return {
          rows: [
            {
              fts_document: "Policy policy",
              id: projectionId,
              knowledge_space_id: spaceId,
            },
          ],
          rowsAffected: 0,
        };
      }
      return { rows: [], rowsAffected: 1 };
    };
    const repository = createDatabaseTidbFtsPostingBackfillRepository({
      database: createDatabase(dialect, execute),
      generatePostingId: () => postingId,
      maxClaimBatchSize: 10,
      maxDiscoveryBatchSize: 10,
    });

    await expect(
      repository.processNext({ expectedRowVersion: 1, jobId, leaseToken, now }),
    ).resolves.toMatchObject({
      completed: false,
      job: { cursorProjectionId: projectionId, rowVersion: 2, scannedProjections: 1 },
      projectionId,
    });

    expect(calls.map((call) => [call.tableName, call.operation])).toEqual([
      ["tidb_fts_posting_backfills", "select"],
      ["knowledge_spaces", "select"],
      ["deletion_jobs", "select"],
      ["tidb_fts_posting_backfills", "select"],
      ["index_projections", "select"],
      ["index_projection_fts_postings", "delete"],
      ["index_projection_fts_postings", "insert"],
      ["tidb_fts_posting_backfills", "update"],
    ]);
    expect(calls[1]?.params).toEqual([tenantId, spaceId]);
    expect(calls[1]?.sql).toContain("lifecycle_state");
    expect(calls[1]?.sql).toContain("deletion_job_id");
    expect(calls[2]?.sql).toContain("FOR UPDATE");
    expect(calls[4]?.params).toEqual([spaceId]);
    expect(calls[4]?.sql).toContain("IN ('building', 'ready')");
    expect(calls[5]?.params).toEqual([projectionId, TIDB_FTS_TOKENIZER_VERSION]);
    expect(calls[6]?.params).toEqual([
      postingId,
      spaceId,
      projectionId,
      TIDB_FTS_TOKENIZER_VERSION,
      hashTidbFtsTerm("policy"),
      "policy",
      2,
      2,
    ]);
    expect(calls[7]?.params).toEqual([
      "running",
      projectionId,
      1,
      1,
      "worker-1",
      leaseToken,
      expires,
      now,
      0,
      2,
      null,
      null,
      now,
      null,
      jobId,
      1,
    ]);
    assertPlaceholderArity(calls, dialect);
  });

  it("opens readiness only after the final active-projection closure succeeds", async () => {
    const calls: DatabaseExecuteInput[] = [];
    let projectionSelects = 0;
    const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
      calls.push(input);
      if (input.tableName === "tidb_fts_posting_backfills" && input.operation === "select") {
        return { rows: [runningJobRow({ cursor_projection_id: projectionId })], rowsAffected: 0 };
      }
      if (input.tableName === "knowledge_spaces" && input.operation === "select") {
        return { rows: [activeSpaceRow()], rowsAffected: 0 };
      }
      if (input.tableName === "deletion_jobs" && input.operation === "select") {
        return { rows: [], rowsAffected: 0 };
      }
      if (input.tableName === "index_projections" && input.operation === "select") {
        projectionSelects += 1;
        return { rows: [], rowsAffected: 0 };
      }
      return { rows: [], rowsAffected: 1 };
    };
    const repository = createDatabaseTidbFtsPostingBackfillRepository({
      database: createDatabase(dialect, execute),
      maxClaimBatchSize: 10,
      maxDiscoveryBatchSize: 10,
    });

    await expect(
      repository.processNext({ expectedRowVersion: 1, jobId, leaseToken, now }),
    ).resolves.toMatchObject({ completed: true, job: { runState: "succeeded" } });
    expect(projectionSelects).toBe(2);
    expect(calls[1]?.params).toEqual([tenantId, spaceId]);
    expect(calls[1]?.sql).toContain("lifecycle_state");
    expect(calls[1]?.sql).toContain("deletion_job_id");
    expect(calls[2]?.sql).toContain("FOR UPDATE");
    expect(calls[4]?.params).toEqual([spaceId, projectionId]);
    expect(calls[5]?.params).toEqual([spaceId, TIDB_FTS_TOKENIZER_VERSION]);
    expect(calls[5]?.sql).toContain("NOT EXISTS");
    expect(calls[5]?.sql).toContain("IN ('building', 'ready')");
    expect(calls[6]?.params).toEqual([
      "succeeded",
      projectionId,
      0,
      0,
      null,
      null,
      null,
      null,
      0,
      2,
      null,
      null,
      now,
      now,
      jobId,
      1,
    ]);
    assertPlaceholderArity(calls, dialect);
  });

  it("does not gate stale/failed projections but fails closed for a ready posting gap", async () => {
    const calls: DatabaseExecuteInput[] = [];
    let missingProjection: string | null = null;
    const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
      calls.push(input);
      if (input.tableName === "tidb_fts_posting_backfills") {
        return { rows: [], rowsAffected: 0 };
      }
      return {
        rows: [
          {
            knowledge_space_id: spaceId,
            missing_projection_id: missingProjection,
          },
        ],
        rowsAffected: 0,
      };
    };
    const repository = createDatabaseTidbFtsPostingBackfillRepository({
      database: createDatabase(dialect, execute, false),
      maxClaimBatchSize: 10,
      maxDiscoveryBatchSize: 10,
    });

    // The database query excludes stale/failed rows, including malformed historical documents.
    await expect(repository.assertReady({ knowledgeSpaceId: spaceId, tenantId })).resolves.toBe(
      undefined,
    );
    expect(calls[1]?.sql).toContain("IN ('building', 'ready')");
    missingProjection = projectionId;
    await expect(
      repository.assertReady({ knowledgeSpaceId: spaceId, tenantId }),
    ).rejects.toBeInstanceOf(TidbFtsPostingBackfillNotReadyError);
    expect(calls.at(-1)?.params).toEqual([TIDB_FTS_TOKENIZER_VERSION, tenantId, spaceId]);
    assertPlaceholderArity(calls, dialect);
  });
});

function createDatabase(
  dialect: "postgres" | "tidb",
  execute: (input: DatabaseExecuteInput) => Promise<DatabaseExecuteResult>,
  transaction = true,
) {
  return createSchemaDatabaseAdapter({
    executor: execute,
    kind: dialect,
    ...(transaction ? { transaction: async (callback) => callback({ execute }) } : {}),
  });
}

function jobRow(overrides: Record<string, unknown> = {}) {
  return {
    completed_at: null,
    created_at: "2026-07-14T00:00:00.000Z",
    cursor_projection_id: null,
    heartbeat_at: null,
    id: jobId,
    knowledge_space_id: spaceId,
    last_error_code: null,
    last_error_message: null,
    lease_expires_at: null,
    lease_token: null,
    retry_count: 0,
    row_version: 1,
    run_state: "queued",
    scanned_projections: 0,
    tenant_id: tenantId,
    tokenizer_version: TIDB_FTS_TOKENIZER_VERSION,
    updated_at: "2026-07-14T00:00:00.000Z",
    worker_id: null,
    written_postings: 0,
    ...overrides,
  };
}

function activeSpaceRow() {
  return { deletion_job_id: null, id: spaceId, lifecycle_state: "active" };
}

function runningJobRow(overrides: Record<string, unknown> = {}) {
  return jobRow({
    heartbeat_at: "2026-07-14T00:00:00.000Z",
    lease_expires_at: expires,
    lease_token: leaseToken,
    run_state: "running",
    worker_id: "worker-1",
    ...overrides,
  });
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
