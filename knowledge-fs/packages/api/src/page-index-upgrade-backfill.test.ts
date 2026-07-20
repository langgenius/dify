import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type { DatabaseExecuteInput, DatabaseExecuteResult } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { createDatabasePageIndexUpgradeBackfillRepository } from "./page-index-upgrade-backfill";

const tenantId = "tenant-1";
const spaceId = "10000000-0000-4000-8000-000000000001";
const oldPublicationId = "60000000-0000-4000-8000-000000000001";
const newPublicationId = "60000000-0000-4000-8000-000000000002";
const outlineId = "30000000-0000-4000-8000-000000000001";
const assetId = "20000000-0000-4000-8000-000000000001";
const generationId = "50000000-0000-4000-8000-000000000001";
const leaseToken = "70000000-0000-4000-8000-000000000001";

describe.each(["postgres", "tidb"] as const)("PageIndex upgrade SQL (%s)", (dialect) => {
  it("applies the fail-closed gate only to Research and validates the full current-head closure", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const database = createSchemaDatabaseAdapter({
      executor: async (input) => {
        calls.push(input);
        if (input.tableName === "projection_set_publication_heads") {
          return {
            rows: [headRow(oldPublicationId, 3)],
            rowsAffected: 0,
          };
        }
        if (input.tableName === "page_index_upgrade_backfills") {
          return { rows: [], rowsAffected: 0 };
        }
        if (input.tableName === "projection_set_publication_members") {
          return { rows: [], rowsAffected: 0 };
        }
        throw new Error(`Unexpected query: ${input.tableName}`);
      },
      kind: dialect,
    });
    const repository = createDatabasePageIndexUpgradeBackfillRepository({
      database,
      generateLeaseToken: () => leaseToken,
      maxClaimBatchSize: 10,
      maxItemsPerJob: 100,
    });

    await expect(
      repository.isQueryReady({ knowledgeSpaceId: spaceId, resolvedMode: "fast", tenantId }),
    ).resolves.toBe(true);
    expect(calls).toHaveLength(0);
    await expect(
      repository.isQueryReady({ knowledgeSpaceId: spaceId, resolvedMode: "deep", tenantId }),
    ).resolves.toBe(true);
    expect(calls).toHaveLength(0);
    await expect(
      repository.isQueryReady({ knowledgeSpaceId: spaceId, resolvedMode: "research", tenantId }),
    ).resolves.toBe(true);

    const validation = calls.find(
      (call) => call.tableName === "projection_set_publication_members",
    );
    expect(validation?.sql).toContain("page_index_manifests");
    expect(validation?.sql).toContain("pageindex-nfkc-exact-v1");
    expect(validation?.sql).toContain("knowledge_space_id");
    expect(validation?.sql).not.toContain("page_index_nodes");
    expect(validation?.sql).not.toContain("page_index_terms");
    assertPlaceholderArity(calls, dialect);
  });

  it("claims expired work with a portable row lock and a lease fence", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
      calls.push(input);
      return { rows: [], rowsAffected: 0 };
    };
    const database = createSchemaDatabaseAdapter({
      executor: execute,
      kind: dialect,
      transaction: async (callback) => callback({ execute }),
    });
    const repository = createDatabasePageIndexUpgradeBackfillRepository({
      database,
      generateLeaseToken: () => leaseToken,
      maxClaimBatchSize: 10,
      maxItemsPerJob: 100,
    });

    await expect(
      repository.claim({
        leaseExpiresAt: "2026-07-14T00:01:00.000Z",
        limit: 5,
        now: "2026-07-14T00:00:00.000Z",
        workerId: "worker-1",
      }),
    ).resolves.toEqual([]);
    expect(calls[0]?.sql).toContain("FOR UPDATE");
    if (dialect === "postgres") {
      expect(calls[0]?.sql).toContain("SKIP LOCKED");
    } else {
      expect(calls[0]?.sql).not.toContain("SKIP LOCKED");
    }
    assertPlaceholderArity(calls, dialect);
  });

  it("rejects every worker transition after the lease expires", async () => {
    const mutationCalls: DatabaseExecuteInput[] = [];
    const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
      if (input.operation !== "select") {
        mutationCalls.push(input);
        return { rows: [], rowsAffected: 1 };
      }
      if (input.tableName === "page_index_upgrade_backfills") {
        return {
          rows: [
            {
              ...runningJobRow(),
              lease_expires_at: "2026-07-14T00:01:00.000Z",
            },
          ],
          rowsAffected: 0,
        };
      }
      if (input.tableName === "knowledge_spaces") {
        return { rows: [activeSpaceRow()], rowsAffected: 0 };
      }
      if (input.tableName === "deletion_jobs") {
        return { rows: [], rowsAffected: 0 };
      }
      if (input.tableName === "projection_set_publication_heads") {
        return { rows: [headRow(oldPublicationId, 3)], rowsAffected: 0 };
      }
      throw new Error(`Unexpected query: ${input.tableName}`);
    };
    const database = createSchemaDatabaseAdapter({
      executor: execute,
      kind: dialect,
      transaction: async (callback) => callback({ execute }),
    });
    const repository = createDatabasePageIndexUpgradeBackfillRepository({
      database,
      generateLeaseToken: () => leaseToken,
      maxClaimBatchSize: 10,
      maxItemsPerJob: 100,
    });
    const fence = {
      expectedRowVersion: 1,
      jobId: oldPublicationId,
      leaseToken,
      now: "2026-07-14T00:01:00.000Z",
    };
    const lostLease = /lost its lease or row-version fence/;

    await expect(
      repository.markItemSucceeded({ ...fence, documentOutlineId: outlineId }),
    ).rejects.toThrow(lostLease);
    await expect(repository.complete(fence)).rejects.toThrow(lostLease);
    await expect(
      repository.fail({ ...fence, errorCode: "TEST", errorMessage: "expired" }),
    ).rejects.toThrow(lostLease);
    await expect(repository.release(fence)).rejects.toThrow(lostLease);
    expect(mutationCalls).toEqual([]);
  });

  it("supersedes a frozen job on head change and creates independent work for the new head", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
      calls.push(input);
      if (input.tableName === "page_index_upgrade_backfills" && input.operation === "select") {
        return input.params[0] === oldPublicationId
          ? { rows: [runningJobRow()], rowsAffected: 0 }
          : { rows: [], rowsAffected: 0 };
      }
      if (input.tableName === "knowledge_spaces") {
        return { rows: [activeSpaceRow()], rowsAffected: 0 };
      }
      if (input.tableName === "deletion_jobs") {
        return { rows: [], rowsAffected: 0 };
      }
      if (input.tableName === "projection_set_publication_heads") {
        return { rows: [headRow(newPublicationId, 4)], rowsAffected: 0 };
      }
      if (
        input.tableName === "projection_set_publication_members" &&
        input.sql.includes("page_index_manifests")
      ) {
        return { rows: [{ component_key: outlineId }], rowsAffected: 0 };
      }
      if (input.tableName === "projection_set_publication_members") {
        return {
          rows: [
            {
              document_asset_id: assetId,
              document_outline_id: outlineId,
              document_version: 1,
              publication_generation_id: generationId,
            },
          ],
          rowsAffected: 0,
        };
      }
      if (input.operation === "update" || input.operation === "insert") {
        return { rows: [], rowsAffected: 1 };
      }
      throw new Error(`Unexpected query: ${input.tableName}`);
    };
    const database = createSchemaDatabaseAdapter({
      executor: execute,
      kind: dialect,
      transaction: async (callback) => callback({ execute }),
    });
    const repository = createDatabasePageIndexUpgradeBackfillRepository({
      database,
      generateLeaseToken: () => leaseToken,
      maxClaimBatchSize: 10,
      maxItemsPerJob: 100,
    });

    await expect(
      repository.complete({
        expectedRowVersion: 1,
        jobId: oldPublicationId,
        leaseToken,
        now: "2026-07-14T00:00:10.000Z",
      }),
    ).resolves.toMatchObject({
      lastErrorCode: "HEAD_CHANGED",
      runState: "superseded",
    });
    expect(
      calls.some(
        (call) =>
          call.tableName === "page_index_upgrade_backfills" &&
          call.operation === "insert" &&
          call.params[0] === newPublicationId,
      ),
    ).toBe(true);
    expect(
      calls.some(
        (call) =>
          call.tableName === "page_index_upgrade_backfill_items" &&
          call.operation === "insert" &&
          call.params[0] === newPublicationId,
      ),
    ).toBe(true);
    assertPlaceholderArity(calls, dialect);
  });
});

function headRow(publicationId: string, headRevision: number) {
  return {
    fingerprint: `projection-set-sha256:${(publicationId === oldPublicationId ? "a" : "b").repeat(64)}`,
    head_revision: headRevision,
    publication_id: publicationId,
  };
}

function activeSpaceRow() {
  return { deletion_job_id: null, id: spaceId, lifecycle_state: "active" };
}

function runningJobRow() {
  return {
    completed_at: null,
    completed_items: 0,
    created_at: "2026-07-14T00:00:00.000Z",
    head_revision: 3,
    heartbeat_at: "2026-07-14T00:00:00.000Z",
    id: oldPublicationId,
    knowledge_space_id: spaceId,
    last_error_code: null,
    last_error_message: null,
    lease_expires_at: "2026-07-14T00:01:00.000Z",
    lease_token: leaseToken,
    publication_fingerprint: `projection-set-sha256:${"a".repeat(64)}`,
    publication_id: oldPublicationId,
    retry_count: 0,
    row_version: 1,
    run_state: "running",
    tenant_id: tenantId,
    total_items: 1,
    updated_at: "2026-07-14T00:00:00.000Z",
    worker_id: "worker-1",
  };
}

function assertPlaceholderArity(
  calls: readonly DatabaseExecuteInput[],
  dialect: "postgres" | "tidb",
) {
  for (const call of calls) {
    if (dialect === "postgres") {
      const positions = [...call.sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
      expect(Math.max(0, ...positions)).toBe(call.params.length);
    } else {
      expect((call.sql.match(/\?/g) ?? []).length).toBe(call.params.length);
    }
  }
}
