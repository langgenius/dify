import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type { DatabaseAdapter, DatabaseExecuteInput, DatabaseRow } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  PageIndexUpgradeBackfillVerificationError,
  createDatabasePageIndexUpgradeBackfillRepository,
} from "./page-index-upgrade-backfill";

const tenantId = "tenant-1";
const spaceId = "10000000-0000-4000-8000-000000000001";
const publicationId = "60000000-0000-4000-8000-000000000001";
const outlineId = "30000000-0000-4000-8000-000000000001";
const assetId = "20000000-0000-4000-8000-000000000001";
const parseArtifactId = "40000000-0000-4000-8000-000000000001";
const generationId = "50000000-0000-4000-8000-000000000001";
const leaseToken = "70000000-0000-4000-8000-000000000001";
const now = "2026-07-14T00:00:00.000Z";
const later = "2026-07-14T00:00:10.000Z";
const leaseExpiry = "2026-07-14T00:01:00.000Z";

describe("PageIndex upgrade database lifecycle", () => {
  it("claims, heartbeats, materializes, verifies, promotes, and completes a frozen head", async () => {
    const fake = pageIndexDatabase({ job: queuedJobRow(), item: pendingItemRow() });
    const repository = createRepository(fake.database);

    await expect(repository.get({ knowledgeSpaceId: spaceId, tenantId })).resolves.toMatchObject({
      id: publicationId,
      runState: "queued",
    });
    await expect(
      repository.ensureCurrentHead({ knowledgeSpaceId: spaceId, now, tenantId }),
    ).resolves.toMatchObject({ id: publicationId });

    const [claimed] = await repository.claim({
      leaseExpiresAt: leaseExpiry,
      limit: 1,
      now,
      workerId: "worker-1",
    });
    expect(claimed).toMatchObject({ rowVersion: 1, runState: "running" });
    if (!claimed) throw new Error("Expected a claimed PageIndex upgrade");

    await expect(
      repository.heartbeat({
        ...fence(claimed.rowVersion),
        leaseExpiresAt: leaseExpiry,
        workerId: "other-worker",
      }),
    ).resolves.toBeNull();
    const heartbeat = await repository.heartbeat({
      ...fence(claimed.rowVersion),
      leaseExpiresAt: leaseExpiry,
      workerId: "worker-1",
    });
    expect(heartbeat).toMatchObject({ rowVersion: 2 });
    if (!heartbeat) throw new Error("Expected a PageIndex heartbeat");

    const work = await repository.getNextItem(fence(heartbeat.rowVersion));
    expect(work).toMatchObject({
      item: { documentOutlineId: outlineId, status: "pending" },
      outline: { id: outlineId, nodes: [] },
    });
    const marked = await repository.markItemSucceeded({
      ...fence(heartbeat.rowVersion),
      documentOutlineId: outlineId,
    });
    expect(marked).toMatchObject({ completedItems: 1, rowVersion: 3 });
    if (!marked) throw new Error("Expected a completed PageIndex item");
    await expect(
      repository.markItemSucceeded({
        ...fence(marked.rowVersion),
        documentOutlineId: outlineId,
      }),
    ).resolves.toMatchObject({ rowVersion: marked.rowVersion });
    await expect(repository.getNextItem(fence(marked.rowVersion))).resolves.toBeNull();

    const completed = await repository.complete(fence(marked.rowVersion));
    expect(completed).toMatchObject({
      completedItems: 1,
      rowVersion: 4,
      runState: "succeeded",
      totalItems: 1,
    });
    expect(
      fake.calls.some(
        (call) => call.tableName === "page_index_manifests" && call.operation === "update",
      ),
    ).toBe(true);
  });

  it("fails, retries, reclaims, and releases the same durable ledger", async () => {
    const fake = pageIndexDatabase({ job: runningJobRow(), item: pendingItemRow() });
    const repository = createRepository(fake.database);

    const failed = await repository.fail({
      ...fence(1),
      errorCode: "BUILD_FAILED",
      errorMessage: "materialization failed",
    });
    expect(failed).toMatchObject({
      lastErrorCode: "BUILD_FAILED",
      rowVersion: 2,
      runState: "failed",
    });

    const retried = await repository.retry({ knowledgeSpaceId: spaceId, now: later, tenantId });
    expect(retried).toMatchObject({ retryCount: 1, rowVersion: 3, runState: "queued" });
    await expect(
      repository.retry({ knowledgeSpaceId: spaceId, now: later, tenantId }),
    ).rejects.toThrow("cannot retry from state=queued");

    const [reclaimed] = await repository.claim({
      leaseExpiresAt: leaseExpiry,
      limit: 1,
      now: later,
      workerId: "worker-2",
    });
    if (!reclaimed) throw new Error("Expected a reclaimed PageIndex upgrade");
    await expect(
      repository.release({ ...fence(reclaimed.rowVersion), now: later }),
    ).resolves.toMatchObject({
      runState: "queued",
    });
  });

  it("keeps missing heads and missing frozen outline closure fail-closed", async () => {
    const noHead = createRepository(pageIndexDatabase({ head: false }).database);
    await expect(
      noHead.ensureCurrentHead({ knowledgeSpaceId: spaceId, now, tenantId }),
    ).resolves.toBeNull();
    await expect(
      noHead.heartbeat({
        ...fence(1),
        leaseExpiresAt: leaseExpiry,
        workerId: "worker-1",
      }),
    ).resolves.toBeNull();
    await expect(noHead.get({ knowledgeSpaceId: spaceId, tenantId })).resolves.toBeNull();
    await expect(
      noHead.isQueryReady({ knowledgeSpaceId: spaceId, resolvedMode: "research", tenantId }),
    ).resolves.toBe(false);
    await expect(
      noHead.markItemSucceeded({ ...fence(1), documentOutlineId: outlineId }),
    ).resolves.toBeNull();
    await expect(noHead.release(fence(1))).resolves.toBeNull();
    await expect(noHead.retry({ knowledgeSpaceId: spaceId, now, tenantId })).resolves.toBeNull();
    await expect(noHead.complete(fence(1))).rejects.toThrow("job was not found");

    const missingOutline = pageIndexDatabase({
      includeOutline: false,
      item: pendingItemRow(),
      job: runningJobRow(),
    });
    await expect(
      createRepository(missingOutline.database).getNextItem(fence(1)),
    ).rejects.toBeInstanceOf(PageIndexUpgradeBackfillVerificationError);
  });

  it("handles already-ready heads and rejects missing space or item CAS state", async () => {
    const ready = createRepository(pageIndexDatabase({ job: succeededJobRow() }).database);
    await expect(
      ready.isQueryReady({ knowledgeSpaceId: spaceId, resolvedMode: "research", tenantId }),
    ).resolves.toBe(true);
    await expect(
      ready.retry({ knowledgeSpaceId: spaceId, now: later, tenantId }),
    ).resolves.toMatchObject({ runState: "succeeded" });

    const alreadyClosed = createRepository(pageIndexDatabase({}).database);
    await expect(
      alreadyClosed.ensureCurrentHead({ knowledgeSpaceId: spaceId, now, tenantId }),
    ).resolves.toBeNull();

    const missingSpace = createRepository(
      pageIndexDatabase({ job: runningJobRow(), spaceExists: false }).database,
    );
    await expect(
      missingSpace.heartbeat({
        ...fence(1),
        leaseExpiresAt: leaseExpiry,
        workerId: "worker-1",
      }),
    ).rejects.toThrow("Knowledge space was not found");

    const missingItem = createRepository(pageIndexDatabase({ job: runningJobRow() }).database);
    await expect(
      missingItem.markItemSucceeded({ ...fence(1), documentOutlineId: outlineId }),
    ).rejects.toThrow("Frozen backfill item was not found");

    const itemCas = createRepository(
      pageIndexDatabase({
        item: pendingItemRow(),
        itemUpdateSucceeds: false,
        job: runningJobRow(),
      }).database,
    );
    await expect(
      itemCas.markItemSucceeded({ ...fence(1), documentOutlineId: outlineId }),
    ).rejects.toThrow("item changed before completion");
  });

  it("validates repository, claim, heartbeat, and string bounds before I/O", async () => {
    const database = pageIndexDatabase({}).database;
    expect(() =>
      createDatabasePageIndexUpgradeBackfillRepository({
        database,
        maxClaimBatchSize: 0,
        maxItemsPerJob: 1,
      }),
    ).toThrow("maxClaimBatchSize must be a positive safe integer");
    const repository = createRepository(database);
    await expect(
      repository.claim({ leaseExpiresAt: now, limit: 1, now, workerId: "worker" }),
    ).rejects.toThrow("leaseExpiresAt must be after now");
    await expect(
      repository.claim({ leaseExpiresAt: leaseExpiry, limit: 3, now, workerId: "worker" }),
    ).rejects.toThrow("claim limit exceeds maxClaimBatchSize=2");
    await expect(
      repository.claim({ leaseExpiresAt: leaseExpiry, limit: 1, now, workerId: " " }),
    ).rejects.toThrow("workerId must contain 1-255 characters");
    await expect(
      repository.heartbeat({
        ...fence(1),
        leaseExpiresAt: now,
        workerId: "worker",
      }),
    ).rejects.toThrow("leaseExpiresAt must be after now");
  });
});

interface PageIndexDatabaseOptions {
  readonly head?: boolean;
  readonly includeOutline?: boolean;
  readonly item?: DatabaseRow;
  readonly itemUpdateSucceeds?: boolean;
  readonly job?: DatabaseRow;
  readonly spaceExists?: boolean;
}

function pageIndexDatabase(options: PageIndexDatabaseOptions) {
  const calls: DatabaseExecuteInput[] = [];
  const job = options.job ? cloneRow(options.job) : undefined;
  const item = options.item ? cloneRow(options.item) : undefined;
  const headExists = options.head !== false;
  const includeOutline = options.includeOutline !== false;

  const execute = async (input: DatabaseExecuteInput) => {
    calls.push(input);
    if (input.tableName === "knowledge_spaces") {
      return result(
        options.spaceExists === false
          ? []
          : [{ deletion_job_id: null, id: spaceId, lifecycle_state: "active" }],
      );
    }
    if (input.tableName === "deletion_jobs") return result([]);
    if (input.tableName === "projection_set_publication_heads") {
      return result(headExists ? [headRow()] : []);
    }
    if (input.tableName === "page_index_upgrade_backfills") {
      if (input.operation === "select") {
        if (input.sql.includes("run_state") && job?.run_state !== "queued") return result([]);
        return result(job ? [cloneRow(job)] : []);
      }
      if (input.operation === "update") {
        if (!job) return result([], 0);
        const columns = [
          "run_state",
          "completed_items",
          "worker_id",
          "lease_token",
          "lease_expires_at",
          "heartbeat_at",
          "retry_count",
          "row_version",
          "last_error_code",
          "last_error_message",
          "updated_at",
          "completed_at",
        ] as const;
        for (const [index, column] of columns.entries()) job[column] = input.params[index];
        return result([], 1);
      }
    }
    if (input.tableName === "page_index_upgrade_backfill_items") {
      if (input.operation === "select") {
        if (input.sql.includes("COUNT(*)")) {
          const succeeded = item?.status === "succeeded" ? 1 : 0;
          return result([{ item_count: item ? 1 : 0, succeeded_count: succeeded }]);
        }
        if (input.params.length === 2 && input.sql.includes("outline_row")) {
          return result(item?.status === "pending" && includeOutline ? [outlineItemRow(item)] : []);
        }
        if (input.params.length === 1) {
          return result(item?.status === "pending" ? [{ document_outline_id: outlineId }] : []);
        }
        if (input.params.length === 4) return result([]);
        return result(item ? [cloneRow(item)] : []);
      }
      if (input.operation === "update") {
        if (!item || item.status !== "pending" || options.itemUpdateSucceeds === false) {
          return result([], 0);
        }
        item.status = "succeeded";
        item.updated_at = input.params[0];
        return result([], 1);
      }
    }
    if (input.tableName === "projection_set_publication_members") return result([]);
    if (input.tableName === "page_index_manifests" && input.operation === "update") {
      return result([], 1);
    }
    throw new Error(`Unexpected PageIndex query: ${input.operation} ${input.tableName}`);
  };

  const database = createSchemaDatabaseAdapter({
    executor: execute,
    kind: "postgres",
    transaction: async (callback) => callback({ execute }),
  });
  return { calls, database };
}

function createRepository(database: DatabaseAdapter) {
  return createDatabasePageIndexUpgradeBackfillRepository({
    database,
    generateLeaseToken: () => leaseToken,
    maxClaimBatchSize: 2,
    maxItemsPerJob: 10,
  });
}

function fence(expectedRowVersion: number) {
  return { expectedRowVersion, jobId: publicationId, leaseToken, now: later };
}

function queuedJobRow(): DatabaseRow {
  return jobRow();
}

function runningJobRow(): DatabaseRow {
  return jobRow({
    heartbeat_at: now,
    lease_expires_at: leaseExpiry,
    lease_token: leaseToken,
    row_version: 1,
    run_state: "running",
    worker_id: "worker-1",
  });
}

function succeededJobRow(): DatabaseRow {
  return jobRow({
    completed_at: later,
    completed_items: 1,
    row_version: 1,
    run_state: "succeeded",
  });
}

function jobRow(patch: Record<string, unknown> = {}): DatabaseRow {
  return {
    completed_at: null,
    completed_items: 0,
    created_at: now,
    head_revision: 3,
    heartbeat_at: null,
    id: publicationId,
    knowledge_space_id: spaceId,
    last_error_code: null,
    last_error_message: null,
    lease_expires_at: null,
    lease_token: null,
    publication_fingerprint: `projection-set-sha256:${"a".repeat(64)}`,
    publication_id: publicationId,
    retry_count: 0,
    row_version: 0,
    run_state: "queued",
    tenant_id: tenantId,
    total_items: 1,
    updated_at: now,
    worker_id: null,
    ...patch,
  };
}

function pendingItemRow(): DatabaseRow {
  return {
    backfill_id: publicationId,
    created_at: now,
    document_asset_id: assetId,
    document_outline_id: outlineId,
    document_version: 1,
    ordinal: 0,
    publication_generation_id: generationId,
    status: "pending",
    updated_at: now,
  };
}

function outlineItemRow(item: DatabaseRow): DatabaseRow {
  return {
    ...item,
    outline_artifact_hash: "a".repeat(64),
    outline_created_at: now,
    outline_document_asset_id: assetId,
    outline_id: outlineId,
    outline_knowledge_space_id: spaceId,
    outline_metadata: JSON.stringify({}),
    outline_nodes: JSON.stringify([]),
    outline_outline_version: "outline-v1",
    outline_parse_artifact_id: parseArtifactId,
    outline_publication_generation_id: generationId,
    outline_updated_at: null,
    outline_version: 1,
  };
}

function headRow(): DatabaseRow {
  return {
    fingerprint: `projection-set-sha256:${"a".repeat(64)}`,
    head_revision: 3,
    publication_id: publicationId,
  };
}

function cloneRow(row: DatabaseRow): Record<string, unknown> {
  return structuredClone(row) as Record<string, unknown>;
}

function result(rows: readonly DatabaseRow[], rowsAffected = 0) {
  return { rows, rowsAffected };
}
