import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type {
  DatabaseAdapter,
  DatabaseExecuteInput,
  DatabaseExecuteResult,
  DatabaseExecutor,
  DatabaseRow,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  DurableDeletionCheckpointConflictError,
  DurableDeletionIdempotencyConflictError,
  DurableDeletionTargetRevisionConflictError,
  type RequestDocumentDeletionInput,
  createDatabaseDurableDeletionRepository,
} from "./durable-deletion-repository";
import { SOURCE_WORKFLOW_OWNERSHIP_METADATA_KEY } from "./source-document-workflow-ownership";

const tenantId = "tenant-a";
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const targetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01";
const sourceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d02";
const logicalDocumentId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d03";
const failedCompilationAttemptId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d04";
const jobId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2e01";
const tombstoneId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2f01";
const outboxId = "018f0d60-7a49-7cc2-9c1b-5b36f18f3001";
const retryAuditId = "018f0d60-7a49-7cc2-9c1b-5b36f18f3002";
const leaseToken = "018f0d60-7a49-7cc2-9c1b-5b36f18f3101";
const reclaimedLeaseToken = "018f0d60-7a49-7cc2-9c1b-5b36f18f3102";
const createdAt = "2026-07-14T12:00:00.000Z";
const requestFingerprint = "a".repeat(64);

interface ScriptStep {
  readonly contains?: string | undefined;
  readonly operation: DatabaseExecuteInput["operation"];
  readonly result: DatabaseExecuteResult;
  readonly tableName: string;
}

describe.each(["postgres", "tidb"] as const)(
  "database durable deletion repository (%s)",
  (dialect) => {
    it("looks up an existing request by tenant-scoped idempotency key", async () => {
      const script = scriptedDatabase(dialect, [step("deletion_jobs", "select", [jobRow()])]);
      const repository = repositoryFor(script.database, requestFingerprint);

      await expect(
        repository.getJobByIdempotency({ idempotencyKey: "delete-source-a", tenantId }),
      ).resolves.toMatchObject({
        id: jobId,
        idempotencyKey: "delete-source-a",
        tenantId,
      });
      script.expectDone();
    });

    it("looks up a recorded owner-rescue actor with an exact bounded tenant fence", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const database = createSchemaDatabaseAdapter({
        executor: async (input) => {
          calls.push(input);
          const exact =
            input.params[0] === tenantId &&
            input.params[1] === jobId &&
            input.params[2] === "owner-current";
          return { rows: exact ? [{ id: retryAuditId }] : [], rowsAffected: 0 };
        },
        kind: dialect,
      });
      const repository = repositoryFor(database, requestFingerprint);

      await expect(
        repository.hasRetryAuditActor({ jobId, subjectId: "owner-current", tenantId }),
      ).resolves.toBe(true);
      await expect(
        repository.hasRetryAuditActor({
          jobId,
          subjectId: "owner-current",
          tenantId: "tenant-other",
        }),
      ).resolves.toBe(false);

      expect(calls).toHaveLength(2);
      expect(calls[0]).toMatchObject({
        maxRows: 1,
        operation: "select",
        params: [tenantId, jobId, "owner-current"],
        tableName: "deletion_retry_audits",
      });
      expect(calls[0]?.sql).toContain("interactive_owner_rescue");
      expect(calls[0]?.sql).toContain(identifier(dialect, "actor_subject_id"));
    });

    it("replays an identical request even when authorization issued a new snapshot", async () => {
      const script = scriptedDatabase(dialect, [
        step("deletion_jobs", "select", [jobRow()]),
        step("deletion_tombstones", "select", [tombstoneRow()]),
        step("deletion_outbox", "select", [outboxRow()]),
      ]);
      const repository = repositoryFor(script.database, requestFingerprint);

      const result = await repository.requestSourceDeletion({
        accessChannel: "interactive",
        createdAt,
        deleteMode: "cascade",
        expectedVersion: 4,
        idempotencyKey: "delete-source-a",
        knowledgeSpaceId,
        // Snapshot identity is intentionally different from the original row. It is audit
        // provenance, not part of the stable idempotency fingerprint.
        permissionSnapshotId: "018f0d60-7a49-7cc2-9c1b-5b36f18f3999",
        permissionSnapshotRevision: 7,
        requestedBySubjectId: "user-a",
        sourceId: targetId,
        tenantId,
      });

      expect(result).toMatchObject({
        created: false,
        job: { id: jobId, permissionSnapshotRevision: 1 },
        outbox: { deletionJobId: jobId },
        tombstone: { deletionJobId: jobId },
      });
      script.expectDone();
    });

    it("rejects tenant-global idempotency-key reuse with a different keyed fingerprint", async () => {
      const script = scriptedDatabase(dialect, [step("deletion_jobs", "select", [jobRow()])]);
      const repository = repositoryFor(script.database, "b".repeat(64));

      await expect(
        repository.requestSourceDeletion({
          accessChannel: "interactive",
          createdAt,
          deleteMode: "keep",
          expectedVersion: 4,
          idempotencyKey: "delete-source-a",
          knowledgeSpaceId,
          permissionSnapshotId: "018f0d60-7a49-7cc2-9c1b-5b36f18f3999",
          permissionSnapshotRevision: 7,
          requestedBySubjectId: "user-a",
          sourceId: targetId,
          tenantId,
        }),
      ).rejects.toBeInstanceOf(DurableDeletionIdempotencyConflictError);
      script.expectDone();
    });

    it("binds an optional canonical bulk-batch digest into each child request fingerprint", async () => {
      const script = scriptedDatabase(dialect, [
        step("deletion_jobs", "select", [jobRow()]),
        step("deletion_tombstones", "select", [tombstoneRow()]),
        step("deletion_outbox", "select", [outboxRow()]),
      ]);
      const fingerprintedValues: string[] = [];
      const repository = createDatabaseDurableDeletionRepository({
        database: script.database,
        fingerprinter: (input) => {
          if (input.purpose === "request_payload") fingerprintedValues.push(input.value);
          return requestFingerprint;
        },
      });

      await repository.requestDocumentDeletion({
        accessChannel: "interactive",
        createdAt,
        documentAssetId: targetId,
        expectedDocumentVersion: 4,
        idempotencyContext: "c".repeat(64),
        idempotencyKey: "delete-source-a",
        knowledgeSpaceId,
        permissionSnapshotId: "018f0d60-7a49-7cc2-9c1b-5b36f18f3999",
        permissionSnapshotRevision: 7,
        requestedBySubjectId: "user-a",
        tenantId,
      });

      expect(fingerprintedValues).toHaveLength(1);
      const fingerprintedRequest = JSON.parse(fingerprintedValues[0] ?? "{}") as Record<
        string,
        unknown
      >;
      expect(fingerprintedRequest).toMatchObject({
        idempotencyContext: "c".repeat(64),
      });
      expect(fingerprintedRequest).not.toHaveProperty("failedSourceMaterialization");
      script.expectDone();
    });

    it("atomically admits exact failed Source materialization cleanup under the asset lock", async () => {
      const harness = failedSourceCleanupDatabase(dialect);
      const repository = createDatabaseDurableDeletionRepository({
        database: harness.database,
        fingerprinter: () => requestFingerprint,
        generateJobId: () => jobId,
        generateOutboxId: () => outboxId,
        generateTombstoneId: () => tombstoneId,
      });

      await expect(
        repository.requestDocumentDeletion(failedSourceCleanupRequest()),
      ).resolves.toMatchObject({
        created: true,
        job: { targetId, targetType: "document_asset" },
      });
      const insertsAfterFirstRequest = harness.calls.filter(
        (call) => call.operation === "insert",
      ).length;
      await expect(
        repository.requestDocumentDeletion(failedSourceCleanupRequest()),
      ).resolves.toMatchObject({
        created: false,
        job: { id: jobId, targetId, targetType: "document_asset" },
      });
      expect(harness.calls.filter((call) => call.operation === "insert")).toHaveLength(
        insertsAfterFirstRequest,
      );

      const assetLock = harness.calls.findIndex(
        (call) => call.operation === "select" && call.tableName === "document_assets",
      );
      const parentLock = harness.calls.findIndex(
        (call) => call.operation === "select" && call.tableName === "logical_documents",
      );
      const referenceLock = harness.calls.findIndex(
        (call) =>
          call.operation === "select" &&
          call.tableName === "document_revisions" &&
          call.sql.includes("LIMIT 2"),
      );
      const assetFreeze = harness.calls.findIndex(
        (call) => call.operation === "update" && call.tableName === "document_assets",
      );
      expect(assetLock).toBeGreaterThanOrEqual(0);
      expect(assetLock).toBeLessThan(parentLock);
      expect(parentLock).toBeLessThan(referenceLock);
      expect(referenceLock).toBeLessThan(assetFreeze);
    });

    it("rejects cleanup when a concurrent rollback added another asset reference", async () => {
      const harness = failedSourceCleanupDatabase(dialect, { additionalReference: true });
      const repository = createDatabaseDurableDeletionRepository({
        database: harness.database,
        fingerprinter: () => requestFingerprint,
      });

      await expect(
        repository.requestDocumentDeletion(failedSourceCleanupRequest()),
      ).rejects.toBeInstanceOf(DurableDeletionTargetRevisionConflictError);
      expect(harness.calls.some((call) => call.operation !== "select")).toBe(false);
    });

    it("rejects cleanup when concurrent publication activated the target revision", async () => {
      const harness = failedSourceCleanupDatabase(dialect, { activeRevision: 1 });
      const repository = createDatabaseDurableDeletionRepository({
        database: harness.database,
        fingerprinter: () => requestFingerprint,
      });

      await expect(
        repository.requestDocumentDeletion(failedSourceCleanupRequest()),
      ).rejects.toBeInstanceOf(DurableDeletionTargetRevisionConflictError);
      expect(harness.calls.some((call) => call.operation !== "select")).toBe(false);
      expect(harness.calls.some((call) => call.tableName === "document_revisions")).toBe(false);
    });

    it("atomically hides every active child document when source deletion is requested", async () => {
      const calls: Array<DatabaseExecuteInput & { readonly inTransaction: boolean }> = [];
      let inTransaction = false;
      let insertedJob = false;
      const permissionSnapshotId = "018f0d60-7a49-7cc2-9c1b-5b36f18f3201";
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push({ ...input, inTransaction });
        if (input.operation === "select" && input.tableName === "deletion_jobs") {
          return { rows: insertedJob ? [jobRow()] : [], rowsAffected: 0 };
        }
        if (input.operation === "select" && input.tableName === "knowledge_spaces") {
          return {
            rows: [
              {
                deletion_job_id: null,
                lifecycle_state: "active",
                name: "Source space",
                revision: 2,
              },
            ],
            rowsAffected: 0,
          };
        }
        if (input.operation === "select" && input.tableName === "sources") {
          return {
            rows: [{ deletion_job_id: null, permission_scope: [], status: "idle", version: 4 }],
            rowsAffected: 0,
          };
        }
        if (
          input.operation === "select" &&
          input.tableName === "knowledge_space_permission_snapshots"
        ) {
          return { rows: [permissionSnapshotRow(permissionSnapshotId)], rowsAffected: 0 };
        }
        if (
          input.operation === "select" &&
          [
            "knowledge_space_members",
            "knowledge_space_access_policies",
            "knowledge_space_api_access",
          ].includes(input.tableName)
        ) {
          return { rows: [{ id: `${input.tableName}-row` }], rowsAffected: 0 };
        }
        if (input.operation === "select" && input.tableName === "deletion_tombstones") {
          return { rows: [], rowsAffected: 0 };
        }
        if (input.operation === "insert" && input.tableName === "deletion_jobs") {
          insertedJob = true;
        }
        return { rows: [], rowsAffected: input.operation === "select" ? 0 : 1 };
      };
      const transaction = async <T>(callback: (executor: DatabaseExecutor) => Promise<T>) => {
        inTransaction = true;
        try {
          return await callback({ execute });
        } finally {
          inTransaction = false;
        }
      };
      const database = createSchemaDatabaseAdapter({
        executor: execute,
        kind: dialect,
        transaction,
      });
      const repository = createDatabaseDurableDeletionRepository({
        database,
        fingerprinter: () => requestFingerprint,
        generateJobId: () => jobId,
        generateOutboxId: () => outboxId,
        generateTombstoneId: () => tombstoneId,
      });

      await expect(
        repository.requestSourceDeletion({
          accessChannel: "interactive",
          createdAt,
          deleteMode: "keep",
          expectedVersion: 4,
          idempotencyKey: "delete-source-a",
          knowledgeSpaceId,
          permissionSnapshotId,
          permissionSnapshotRevision: 1,
          requestedBySubjectId: "user-a",
          sourceId: targetId,
          tenantId,
        }),
      ).resolves.toMatchObject({
        created: true,
        job: {
          id: jobId,
          idempotencyKey: "delete-source-a",
          runState: "dispatch_pending",
          targetType: "source",
        },
        outbox: {
          deletionJobId: jobId,
          requestIdempotencyKey: "delete-source-a",
          status: "pending",
        },
        tombstone: { deletionJobId: jobId, targetId, targetType: "source" },
      });

      const sourceUpdate = calls.find(
        (call) => call.operation === "update" && call.tableName === "sources",
      );
      const childUpdate = calls.find(
        (call) => call.operation === "update" && call.tableName === "document_assets",
      );
      expect(sourceUpdate?.inTransaction).toBe(true);
      expect(childUpdate?.inTransaction).toBe(true);
      expect(childUpdate?.params).toEqual([jobId, createdAt, knowledgeSpaceId, targetId]);
      expect(childUpdate?.sql).toContain(`${identifier(dialect, "lifecycle_state")} = 'deleting'`);
      expect(childUpdate?.sql).toContain(identifier(dialect, "deletion_job_id"));
      expect(childUpdate?.sql).toContain(identifier(dialect, "source_id"));
      expect(childUpdate?.sql).toContain(`${identifier(dialect, "lifecycle_state")} = 'active'`);
      expect(calls.findIndex((call) => call === sourceUpdate)).toBeLessThan(
        calls.findIndex((call) => call === childUpdate),
      );
      const spaceLock = calls.findIndex(
        (call) => call.operation === "select" && call.tableName === "knowledge_spaces",
      );
      const permissionLock = calls.findIndex(
        (call) =>
          call.operation === "select" && call.tableName === "knowledge_space_permission_snapshots",
      );
      const sourceLock = calls.findIndex(
        (call) => call.operation === "select" && call.tableName === "sources",
      );
      expect(spaceLock).toBeLessThan(permissionLock);
      expect(permissionLock).toBeLessThan(sourceLock);
    });

    it("rejects a revoked source-removal permission before locking or mutating the source", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.tableName === "deletion_jobs" && input.operation === "select") {
          return { rows: [], rowsAffected: 0 };
        }
        if (input.tableName === "knowledge_spaces" && input.operation === "select") {
          return {
            rows: [
              {
                deletion_job_id: null,
                lifecycle_state: "active",
                name: "Source space",
                revision: 2,
              },
            ],
            rowsAffected: 0,
          };
        }
        if (
          input.tableName === "knowledge_space_permission_snapshots" &&
          input.operation === "select"
        ) {
          return { rows: [], rowsAffected: 0 };
        }
        return { rows: [], rowsAffected: input.operation === "select" ? 0 : 1 };
      };
      const database = createSchemaDatabaseAdapter({
        executor: execute,
        kind: dialect,
        transaction: async (callback) => callback({ execute }),
      });
      const repository = repositoryFor(database, requestFingerprint);

      await expect(
        repository.requestSourceDeletion({
          accessChannel: "interactive",
          createdAt,
          deleteMode: "cascade",
          expectedVersion: 4,
          idempotencyKey: "bulk-remove-revoked",
          knowledgeSpaceId,
          permissionSnapshotId: "permission-revoked",
          permissionSnapshotRevision: 1,
          requestedBySubjectId: "user-a",
          sourceId: targetId,
          tenantId,
        }),
      ).rejects.toMatchObject({ code: "space_access_permission_snapshot_invalid" });

      expect(calls.some((call) => call.tableName === "sources")).toBe(false);
      expect(calls.some((call) => call.operation !== "select")).toBe(false);
    });

    it("CAS-deletes a pending or failed logical aggregate and freezes only exclusively owned assets", async () => {
      const calls: Array<DatabaseExecuteInput & { readonly inTransaction: boolean }> = [];
      let inTransaction = false;
      let insertedJob = false;
      const permissionSnapshotId = "018f0d60-7a49-7cc2-9c1b-5b36f18f3201";
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push({ ...input, inTransaction });
        if (input.operation === "select" && input.tableName === "deletion_jobs") {
          return {
            rows: insertedJob
              ? [
                  jobRow({
                    idempotency_key: "delete-logical-a",
                    target_revision: 4,
                    target_type: "logical_document",
                  }),
                ]
              : [],
            rowsAffected: 0,
          };
        }
        if (input.operation === "select" && input.tableName === "knowledge_spaces") {
          return {
            rows: [
              {
                deletion_job_id: null,
                lifecycle_state: "active",
                name: "Logical document space",
                revision: 2,
              },
            ],
            rowsAffected: 0,
          };
        }
        if (input.operation === "select" && input.tableName === "logical_documents") {
          return {
            rows: [
              {
                active_revision: null,
                row_version: 4,
                source_id: null,
                status: "failed",
              },
            ],
            rowsAffected: 0,
          };
        }
        if (
          input.operation === "select" &&
          input.tableName === "knowledge_space_permission_snapshots"
        ) {
          return {
            rows: [permissionSnapshotRow(permissionSnapshotId)],
            rowsAffected: 0,
          };
        }
        if (
          input.operation === "select" &&
          [
            "knowledge_space_members",
            "knowledge_space_access_policies",
            "knowledge_space_api_access",
          ].includes(input.tableName)
        ) {
          return { rows: [{ id: `${input.tableName}-row` }], rowsAffected: 0 };
        }
        if (input.operation === "select" && input.tableName === "deletion_tombstones") {
          return { rows: [], rowsAffected: 0 };
        }
        if (input.operation === "insert" && input.tableName === "deletion_jobs") {
          insertedJob = true;
        }
        return { rows: [], rowsAffected: input.operation === "select" ? 0 : 1 };
      };
      const transaction = async <T>(callback: (executor: DatabaseExecutor) => Promise<T>) => {
        inTransaction = true;
        try {
          return await callback({ execute });
        } finally {
          inTransaction = false;
        }
      };
      const repository = createDatabaseDurableDeletionRepository({
        database: createSchemaDatabaseAdapter({ executor: execute, kind: dialect, transaction }),
        fingerprinter: () => requestFingerprint,
        generateJobId: () => jobId,
        generateOutboxId: () => outboxId,
        generateTombstoneId: () => tombstoneId,
      });

      await expect(
        repository.requestLogicalDocumentDeletion({
          accessChannel: "interactive",
          createdAt,
          documentId: targetId,
          expectedDocumentRowVersion: 4,
          idempotencyKey: "delete-logical-a",
          knowledgeSpaceId,
          permissionSnapshotId,
          permissionSnapshotRevision: 1,
          requestedBySubjectId: "user-a",
          tenantId,
        }),
      ).resolves.toMatchObject({
        created: true,
        job: { targetRevision: 4, targetType: "logical_document" },
      });

      const logicalUpdate = calls.find(
        (call) => call.operation === "update" && call.tableName === "logical_documents",
      );
      const assetUpdate = calls.find(
        (call) => call.operation === "update" && call.tableName === "document_assets",
      );
      expect(logicalUpdate?.inTransaction).toBe(true);
      expect(logicalUpdate?.sql).toContain(identifier(dialect, "row_version"));
      expect(logicalUpdate?.params).toEqual([
        jobId,
        createdAt,
        tenantId,
        knowledgeSpaceId,
        targetId,
        4,
      ]);
      expect(assetUpdate?.inTransaction).toBe(true);
      expect(assetUpdate?.sql).toContain("owned_revision");
      expect(assetUpdate?.sql).toContain("external_revision");
      expect(assetUpdate?.sql).toContain("NOT EXISTS");
      expect(assetUpdate?.params).toEqual([jobId, createdAt, tenantId, knowledgeSpaceId, targetId]);
      expect(calls.findIndex((call) => call === logicalUpdate)).toBeLessThan(
        calls.findIndex((call) => call === assetUpdate),
      );
    });

    it("retires a crashed final-attempt lease instead of stranding it in running", async () => {
      const exhausted = jobRow({
        checkpoint: "deleting_derived_data",
        execution_attempts: 3,
        heartbeat_at: "2026-07-14T11:58:00.000Z",
        lease_expires_at: "2026-07-14T11:59:00.000Z",
        lease_token: leaseToken,
        max_execution_attempts: 3,
        row_version: 8,
        run_state: "running",
        worker_id: "worker-dead",
      });
      const script = scriptedDatabase(dialect, [
        step("deletion_jobs", "select", [exhausted], "execution_attempts"),
        step("deletion_jobs", "update", [], "execution_attempts"),
        step("deletion_outbox", "update", []),
        step("deletion_jobs", "select", [], "execution_attempts"),
      ]);
      const repository = repositoryFor(script.database, requestFingerprint);

      await expect(
        repository.claimJobs({
          leaseExpiresAt: "2026-07-14T12:05:00.000Z",
          limit: 10,
          now: createdAt,
          workerId: "worker-live",
        }),
      ).resolves.toEqual([]);
      expect(
        script.calls.find(
          (call) => call.operation === "update" && call.tableName === "deletion_jobs",
        )?.sql,
      ).toContain(`${identifier(dialect, "run_state")} = 'failed'`);
      expect(
        script.calls.find(
          (call) => call.operation === "update" && call.tableName === "deletion_outbox",
        )?.sql,
      ).toContain(`${identifier(dialect, "status")} = 'dead'`);
      script.expectDone();
    });

    it("reclaims an expired non-final running lease with the same leased outbox and completes", async () => {
      const expired = jobRow({
        checkpoint: "deleting_primary_data",
        execution_attempts: 1,
        heartbeat_at: "2026-07-14T11:58:00.000Z",
        lease_expires_at: "2026-07-14T11:59:00.000Z",
        lease_token: leaseToken,
        max_execution_attempts: 3,
        row_version: 8,
        run_state: "running",
        worker_id: "worker-dead",
      });
      const reclaimed = jobRow({
        checkpoint: "deleting_primary_data",
        execution_attempts: 2,
        heartbeat_at: createdAt,
        lease_expires_at: "2026-07-14T12:05:00.000Z",
        lease_token: reclaimedLeaseToken,
        max_execution_attempts: 3,
        row_version: 9,
        run_state: "running",
        worker_id: "worker-live",
      });
      const succeeded = jobRow({
        active_slot: null,
        checkpoint: "completed",
        completed_at: "2026-07-14T12:00:01.000Z",
        execution_attempts: 2,
        row_version: 10,
        run_state: "succeeded",
      });
      const script = scriptedDatabase(dialect, [
        step("deletion_jobs", "select", [], "execution_attempts"),
        step("deletion_jobs", "select", [expired], "lease_expires_at"),
        step("deletion_jobs", "update", [], "execution_attempts"),
        step("deletion_outbox", "update", [], "updated_at"),
        step("deletion_jobs", "select", [reclaimed]),
        step("deletion_jobs", "select", [reclaimed], "FOR UPDATE"),
        step("deletion_job_items", "select", []),
        step("sources", "select", [{ deletion_job_id: jobId }], "FOR UPDATE"),
        step("sources", "delete", [], "deletion_job_id"),
        step("sources", "select", []),
        step("deletion_tombstones", "update", []),
        step("deletion_outbox", "update", []),
        step("deletion_jobs", "update", []),
        step("deletion_jobs", "select", [succeeded]),
      ]);
      const repository = createDatabaseDurableDeletionRepository({
        database: script.database,
        fingerprinter: () => requestFingerprint,
        generateLeaseToken: () => reclaimedLeaseToken,
      });

      const claimed = await repository.claimJobs({
        leaseExpiresAt: "2026-07-14T12:05:00.000Z",
        limit: 10,
        now: createdAt,
        workerId: "worker-live",
      });
      expect(claimed).toMatchObject([
        { executionAttempts: 2, id: jobId, leaseToken: reclaimedLeaseToken, rowVersion: 9 },
      ]);
      const reclaimOutbox = script.calls.find(
        (call) =>
          call.operation === "update" &&
          call.tableName === "deletion_outbox" &&
          call.params[2] === "leased",
      );
      expect(reclaimOutbox?.params).toEqual([createdAt, jobId, "leased"]);
      expect(reclaimOutbox?.sql).toContain(
        `${identifier(dialect, "status")} = ${placeholder(dialect, 3)}`,
      );
      expect(reclaimOutbox?.sql).toContain(identifier(dialect, "updated_at"));
      expect(script.calls.some((call) => call.operation === "insert")).toBe(false);

      await expect(
        repository.completeJob({
          deleteAndProbePrimaryData: async ({ job, transaction }) => {
            await transaction.execute({
              maxRows: 0,
              operation: "delete",
              params: [job.targetId, job.knowledgeSpaceId, job.id],
              sql: `DELETE FROM ${identifier(dialect, "sources")} WHERE ${identifier(dialect, "id")} = ${placeholder(dialect, 1)} AND ${identifier(dialect, "knowledge_space_id")} = ${placeholder(dialect, 2)} AND ${identifier(dialect, "deletion_job_id")} = ${placeholder(dialect, 3)};`,
              tableName: "sources",
            });
            return { clean: true };
          },
          deletionJobId: jobId,
          expectedRowVersion: 9,
          leaseToken: reclaimedLeaseToken,
          now: "2026-07-14T12:00:01.000Z",
        }),
      ).resolves.toMatchObject({ checkpoint: "completed", runState: "succeeded" });
      script.expectDone();
    });

    it("atomically deletes primary rows, proves residue, and completes all ledgers", async () => {
      const running = runningJobRow();
      const succeeded = jobRow({
        active_slot: null,
        checkpoint: "completed",
        completed_at: "2026-07-14T12:00:01.000Z",
        execution_attempts: 1,
        row_version: 10,
        run_state: "succeeded",
      });
      const script = scriptedDatabase(dialect, [
        step("deletion_jobs", "select", [running], "FOR UPDATE"),
        step("deletion_job_items", "select", []),
        step("knowledge_spaces", "select", [{ deletion_job_id: jobId }], "FOR UPDATE"),
        step("knowledge_spaces", "delete", [], "deletion_job_id"),
        step("knowledge_spaces", "select", []),
        step("knowledge_spaces", "select", []),
        step("deletion_tombstones", "update", []),
        step("deletion_outbox", "update", []),
        step("deletion_jobs", "update", []),
        step("deletion_jobs", "select", [succeeded]),
      ]);
      const repository = repositoryFor(script.database, requestFingerprint);

      const completed = await repository.completeJob({
        deleteAndProbePrimaryData: async ({ job, transaction }) => {
          expect(job).toMatchObject({ id: jobId, leaseToken, rowVersion: 9 });
          await transaction.execute({
            maxRows: 0,
            operation: "delete",
            params: [job.tenantId, job.targetId, job.id],
            sql: `DELETE FROM ${identifier(dialect, "knowledge_spaces")} WHERE ${identifier(dialect, "tenant_id")} = ${placeholder(dialect, 1)} AND ${identifier(dialect, "id")} = ${placeholder(dialect, 2)} AND ${identifier(dialect, "deletion_job_id")} = ${placeholder(dialect, 3)};`,
            tableName: "knowledge_spaces",
          });
          const residue = await transaction.execute({
            maxRows: 1,
            operation: "select",
            params: [job.targetId],
            sql: `SELECT ${identifier(dialect, "id")} FROM ${identifier(dialect, "knowledge_spaces")} WHERE ${identifier(dialect, "id")} = ${placeholder(dialect, 1)} LIMIT 1;`,
            tableName: "knowledge_spaces",
          });
          return { clean: residue.rows.length === 0 };
        },
        deletionJobId: jobId,
        expectedRowVersion: 9,
        leaseToken,
        now: "2026-07-14T12:00:01.000Z",
      });

      expect(completed).toMatchObject({ checkpoint: "completed", runState: "succeeded" });
      script.expectDone();
    });

    it("does not run primary deletion for a stale lease and refuses a dirty residue proof", async () => {
      const stale = scriptedDatabase(dialect, [step("deletion_jobs", "select", [runningJobRow()])]);
      const staleRepository = repositoryFor(stale.database, requestFingerprint);
      let staleCallbackCalled = false;
      await expect(
        staleRepository.completeJob({
          deleteAndProbePrimaryData: async () => {
            staleCallbackCalled = true;
            return { clean: true };
          },
          deletionJobId: jobId,
          expectedRowVersion: 8,
          leaseToken,
          now: "2026-07-14T12:00:01.000Z",
        }),
      ).resolves.toBeNull();
      expect(staleCallbackCalled).toBe(false);
      stale.expectDone();

      const dirty = scriptedDatabase(dialect, [
        step("deletion_jobs", "select", [runningJobRow()]),
        step("deletion_job_items", "select", []),
        step("knowledge_spaces", "select", [{ deletion_job_id: jobId }]),
      ]);
      const dirtyRepository = repositoryFor(dirty.database, requestFingerprint);
      await expect(
        dirtyRepository.completeJob({
          deleteAndProbePrimaryData: async () => ({ clean: false }),
          deletionJobId: jobId,
          expectedRowVersion: 9,
          leaseToken,
          now: "2026-07-14T12:00:01.000Z",
        }),
      ).rejects.toBeInstanceOf(DurableDeletionCheckpointConflictError);
      dirty.expectDone();
    });

    it("fenced-rewinds a dirty final proof and discards redacted inventory for a full rescan", async () => {
      const running = runningJobRow();
      const rewound = jobRow({
        ...running,
        checkpoint: "quiescing",
        inventory_complete: false,
        row_version: 10,
        scan_cursor: null,
        scan_phase: "reconcile-after-dirty-primary",
      });
      const script = scriptedDatabase(dialect, [
        step("deletion_jobs", "select", [running], "FOR UPDATE"),
        step("deletion_job_items", "delete", []),
        step("deletion_jobs", "update", [], "reconcile-after-dirty-primary"),
        step("deletion_jobs", "select", [rewound]),
      ]);
      const repository = repositoryFor(script.database, requestFingerprint);

      await expect(
        repository.reconcileDirtyPrimary({
          deletionJobId: jobId,
          expectedRowVersion: 9,
          leaseToken,
          now: "2026-07-14T12:00:01.000Z",
        }),
      ).resolves.toMatchObject({
        checkpoint: "quiescing",
        inventoryComplete: false,
        rowVersion: 10,
        scanPhase: "reconcile-after-dirty-primary",
      });

      expect(script.calls[1]?.sql).not.toContain("ordinal");
      expect(script.calls[2]?.sql).toContain(
        dialect === "postgres" ? '"inventory_complete" = FALSE' : "`inventory_complete` = 0",
      );
      script.expectDone();
    });

    it("resets consecutive attempts after cooperative progress even on the nominal final lease", async () => {
      const exhaustedButProgressing = jobRow({
        checkpoint: "deleting_objects",
        execution_attempts: 3,
        heartbeat_at: createdAt,
        lease_expires_at: "2026-07-14T12:10:00.000Z",
        lease_token: leaseToken,
        max_execution_attempts: 3,
        row_version: 9,
        run_state: "running",
        worker_id: "worker-a",
      });
      const retrying = jobRow({
        checkpoint: "deleting_objects",
        execution_attempts: 0,
        heartbeat_at: null,
        lease_expires_at: null,
        lease_token: null,
        max_execution_attempts: 3,
        retry_at: "2026-07-14T12:00:02.000Z",
        row_version: 10,
        run_state: "retry_wait",
        worker_id: null,
      });
      const script = scriptedDatabase(dialect, [
        step("deletion_jobs", "select", [exhaustedButProgressing]),
        step("deletion_jobs", "update", [], "execution_attempts"),
        step("deletion_outbox", "update", []),
        step("deletion_jobs", "select", [retrying]),
      ]);
      const repository = repositoryFor(script.database, requestFingerprint);

      const result = await repository.scheduleJobRetry({
        deletionJobId: jobId,
        errorCode: "DURABLE_DELETION_COOPERATIVE_YIELD",
        errorMessage: "bounded progress",
        expectedRowVersion: 9,
        leaseToken,
        now: "2026-07-14T12:00:01.000Z",
        resetExecutionAttempts: true,
        retryAt: "2026-07-14T12:00:02.000Z",
      });

      expect(result).toMatchObject({ executionAttempts: 0, runState: "retry_wait" });
      script.expectDone();
    });

    it("persists only a bounded keyed diagnostic instead of a provider secret", async () => {
      const sensitive =
        "S3 delete failed key=tenants/private/document.pdf credential=source-secret:v1:top-secret";
      const failed = jobRow({
        checkpoint: "deleting_objects",
        execution_attempts: 1,
        heartbeat_at: null,
        last_error_code: "SECRET_DELETE_FAILED",
        last_error_message:
          "Durable deletion external cleanup failed [diagnostic:aaaaaaaaaaaaaaaa]",
        lease_expires_at: null,
        lease_token: null,
        row_version: 10,
        run_state: "failed",
        worker_id: null,
      });
      const script = scriptedDatabase(dialect, [
        step("deletion_jobs", "select", [runningJobRow()]),
        step("deletion_jobs", "update", []),
        step("deletion_outbox", "update", []),
        step("deletion_jobs", "select", [failed]),
      ]);
      const repository = repositoryFor(script.database, requestFingerprint);

      await expect(
        repository.failJob({
          deletionJobId: jobId,
          errorCode: "SECRET_DELETE_FAILED",
          errorMessage: sensitive,
          expectedRowVersion: 9,
          leaseToken,
          now: "2026-07-14T12:00:01.000Z",
        }),
      ).resolves.toMatchObject({ runState: "failed" });

      const serializedCalls = JSON.stringify(script.calls);
      expect(serializedCalls).not.toContain("private/document.pdf");
      expect(serializedCalls).not.toContain("top-secret");
      const jobUpdate = script.calls.find(
        (call) => call.operation === "update" && call.tableName === "deletion_jobs",
      );
      expect(jobUpdate?.params.slice(0, 2)).toEqual([
        "SECRET_DELETE_FAILED",
        "Durable deletion external cleanup failed [diagnostic:aaaaaaaaaaaaaaaa]",
      ]);
      expect(String(jobUpdate?.params[1]).length).toBeLessThanOrEqual(256);
      script.expectDone();
    });

    it("rolls back a dispatched outbox transition when the linked job cannot be queued", async () => {
      const script = scriptedDatabase(dialect, [
        step("deletion_outbox", "select", [
          outboxRow({
            locked_by: "dispatcher-a",
            locked_until: "2026-07-14T12:05:00.000Z",
            lock_token: leaseToken,
            status: "dispatching",
          }),
        ]),
        step("deletion_outbox", "update", []),
        { ...step("deletion_jobs", "update", []), result: { rows: [], rowsAffected: 0 } },
      ]);
      const repository = repositoryFor(script.database, requestFingerprint);

      await expect(
        repository.markOutboxDispatched({
          deliveredAt: "2026-07-14T12:00:01.000Z",
          lockToken: leaseToken,
          now: createdAt,
          outboxId,
          queueJobId: "queue-a",
        }),
      ).rejects.toThrow("did not queue its job");
      script.expectDone();
    });

    it("atomically records owner-rescue provenance without overwriting the original requester", async () => {
      const failed = jobRow({
        checkpoint: "deleting_objects",
        last_error_code: "OBJECT_DELETE_FAILED",
        last_error_message: "storage unavailable",
        row_version: 5,
        run_state: "failed",
      });
      const retried = jobRow({
        checkpoint: "deleting_objects",
        last_error_code: null,
        last_error_message: null,
        row_version: 6,
        run_state: "dispatch_pending",
      });
      const calls: DatabaseExecuteInput[] = [];
      let jobSelects = 0;
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.operation === "select" && input.tableName === "deletion_jobs") {
          jobSelects += 1;
          return { rows: [jobSelects === 1 ? failed : retried], rowsAffected: 0 };
        }
        if (input.operation === "select" && input.tableName === "deletion_outbox") {
          return input.sql.includes("request_idempotency_key")
            ? { rows: [], rowsAffected: 0 }
            : { rows: [{ delivery_revision: 1 }], rowsAffected: 0 };
        }
        if (input.operation === "select" && input.tableName === "deletion_tombstones") {
          return { rows: [tombstoneRow()], rowsAffected: 0 };
        }
        return { rows: [], rowsAffected: 1 };
      };
      const transaction = async <T>(callback: (executor: DatabaseExecutor) => Promise<T>) =>
        callback({ execute });
      const database = createSchemaDatabaseAdapter({
        executor: execute,
        kind: dialect,
        transaction,
      });
      const repository = createDatabaseDurableDeletionRepository({
        database,
        fingerprinter: () => requestFingerprint,
        generateOutboxId: () => outboxId,
        generateRetryAuditId: () => retryAuditId,
      });

      await expect(
        repository.retryFailedJob({
          accessChannel: "interactive",
          expectedRowVersion: 5,
          idempotencyKey: "owner-rescue-key",
          jobId,
          now: createdAt,
          permissionSnapshotId: "018f0d60-7a49-7cc2-9c1b-5b36f18f3209",
          permissionSnapshotRevision: 9,
          requestFingerprint,
          requestedBySubjectId: "owner-current",
          retryAuthority: "interactive_owner_rescue",
          tenantId,
        }),
      ).resolves.toMatchObject({
        created: true,
        job: { requestedBySubjectId: "user-a", rowVersion: 6, runState: "dispatch_pending" },
      });

      const auditInsert = calls.find(
        (call) => call.operation === "insert" && call.tableName === "deletion_retry_audits",
      );
      expect(auditInsert?.params).toEqual([
        "interactive",
        "owner-current",
        null,
        null,
        null,
        createdAt,
        jobId,
        retryAuditId,
        knowledgeSpaceId,
        outboxId,
        "018f0d60-7a49-7cc2-9c1b-5b36f18f3209",
        9,
        requestFingerprint,
        "owner-rescue-key",
        "interactive_owner_rescue",
        tenantId,
      ]);
      expect(auditInsert?.sql).toContain(identifier(dialect, "actor_subject_id"));
      expect(auditInsert?.sql).toContain(identifier(dialect, "permission_snapshot_id"));
      const jobUpdate = calls.find(
        (call) => call.operation === "update" && call.tableName === "deletion_jobs",
      );
      expect(jobUpdate?.sql).not.toContain(identifier(dialect, "requested_by_subject_id"));
      expect(jobUpdate?.sql).not.toContain(identifier(dialect, "permission_snapshot_id"));
    });
  },
);

function repositoryFor(database: DatabaseAdapter, fingerprint: string) {
  return createDatabaseDurableDeletionRepository({
    database,
    fingerprinter: () => fingerprint,
  });
}

function failedSourceCleanupRequest(): RequestDocumentDeletionInput {
  return {
    accessChannel: "interactive",
    createdAt,
    documentAssetId: targetId,
    expectedDocumentVersion: 4,
    failedSourceMaterialization: {
      documentId: logicalDocumentId,
      ownership: {
        contentHash: "a".repeat(64),
        itemKey: "provider-item-1",
        runId: "source-run-1",
      },
      revision: 1,
      sourceId,
    },
    idempotencyKey: "source-failed-materialization-run-1",
    knowledgeSpaceId,
    permissionSnapshotId: "permission-snapshot-1",
    permissionSnapshotRevision: 1,
    requestedBySubjectId: "user-a",
    tenantId,
  };
}

function failedSourceCleanupDatabase(
  dialect: DatabaseAdapter["dialect"],
  options: {
    readonly activeRevision?: number | undefined;
    readonly additionalReference?: boolean | undefined;
  } = {},
): { readonly calls: readonly DatabaseExecuteInput[]; readonly database: DatabaseAdapter } {
  const ownership = failedSourceCleanupRequest().failedSourceMaterialization?.ownership;
  if (!ownership) throw new Error("test ownership missing");
  const calls: DatabaseExecuteInput[] = [];
  let insertedJob = false;
  let insertedOutbox = false;
  let insertedTombstone = false;
  const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    calls.push(input);
    if (input.operation === "select" && input.tableName === "deletion_jobs") {
      return {
        rows: insertedJob
          ? [
              jobRow({
                idempotency_key: "source-failed-materialization-run-1",
                target_id: targetId,
                target_revision: 9,
                target_type: "document_asset",
              }),
            ]
          : [],
        rowsAffected: 0,
      };
    }
    if (input.operation === "select" && input.tableName === "knowledge_spaces") {
      return {
        rows: [
          {
            deletion_job_id: null,
            lifecycle_state: "active",
            name: "Source cleanup space",
            revision: 2,
          },
        ],
        rowsAffected: 0,
      };
    }
    if (input.operation === "select" && input.tableName === "document_assets") {
      return {
        rows: [
          {
            deletion_job_id: null,
            lifecycle_state: "active",
            metadata: { [SOURCE_WORKFLOW_OWNERSHIP_METADATA_KEY]: ownership },
            object_key: "tenant-a/spaces/space/documents/asset/source.md",
            row_version: 9,
            source_id: sourceId,
            version: 4,
          },
        ],
        rowsAffected: 0,
      };
    }
    if (input.operation === "select" && input.tableName === "sources") {
      return {
        rows: [{ deletion_job_id: null, permission_scope: [], status: "idle", version: 1 }],
        rowsAffected: 0,
      };
    }
    if (input.operation === "select" && input.tableName === "logical_documents") {
      return {
        rows: [
          {
            active_revision: options.activeRevision ?? null,
            row_version: 1,
            source_id: sourceId,
            status: options.activeRevision ? "ready" : "failed",
          },
        ],
        rowsAffected: 0,
      };
    }
    if (input.operation === "select" && input.tableName === "document_revisions") {
      return {
        rows: [
          {
            activated_at: null,
            compilation_attempt_id: failedCompilationAttemptId,
            document_asset_version: 4,
            document_id: logicalDocumentId,
            revision: 1,
            state: "failed",
            system_metadata: { [SOURCE_WORKFLOW_OWNERSHIP_METADATA_KEY]: ownership },
          },
          ...(options.additionalReference
            ? [
                {
                  activated_at: createdAt,
                  compilation_attempt_id: "018f0d60-7a49-7cc2-9c1b-5b36f18f3f02",
                  document_asset_version: 3,
                  document_id: logicalDocumentId,
                  revision: 2,
                  state: "active",
                  system_metadata: {},
                },
              ]
            : []),
        ],
        rowsAffected: 0,
      };
    }
    if (input.operation === "select" && input.tableName === "deletion_tombstones") {
      return {
        rows: insertedTombstone
          ? [
              tombstoneRow({
                target_id: targetId,
                target_revision: 9,
                target_type: "document_asset",
              }),
            ]
          : [],
        rowsAffected: 0,
      };
    }
    if (input.operation === "select" && input.tableName === "deletion_outbox") {
      return {
        rows: insertedOutbox
          ? [outboxRow({ request_idempotency_key: "source-failed-materialization-run-1" })]
          : [],
        rowsAffected: 0,
      };
    }
    if (input.operation === "insert" && input.tableName === "deletion_jobs") {
      insertedJob = true;
    }
    if (input.operation === "insert" && input.tableName === "deletion_tombstones") {
      insertedTombstone = true;
    }
    if (input.operation === "insert" && input.tableName === "deletion_outbox") {
      insertedOutbox = true;
    }
    return { rows: [], rowsAffected: input.operation === "select" ? 0 : 1 };
  };
  const transaction = async <T>(callback: (executor: DatabaseExecutor) => Promise<T>): Promise<T> =>
    callback({ execute });
  return {
    calls,
    database: createSchemaDatabaseAdapter({ executor: execute, kind: dialect, transaction }),
  };
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
    expect(input).toMatchObject({ operation: expected.operation, tableName: expected.tableName });
    if (expected.contains) expect(input.sql).toContain(expected.contains);
    return expected.result;
  };
  const transaction = async <T>(callback: (executor: DatabaseExecutor) => Promise<T>): Promise<T> =>
    callback({ execute });
  return {
    calls,
    database: createSchemaDatabaseAdapter({ executor: execute, kind: dialect, transaction }),
    expectDone: () => expect(cursor).toBe(steps.length),
  };
}

function step(
  tableName: string,
  operation: DatabaseExecuteInput["operation"],
  rows: readonly DatabaseRow[],
  contains?: string,
): ScriptStep {
  return {
    ...(contains ? { contains } : {}),
    operation,
    result: { rows, rowsAffected: operation === "select" ? 0 : 1 },
    tableName,
  };
}

function jobRow(overrides: Partial<Record<string, unknown>> = {}): DatabaseRow {
  return {
    access_channel: "interactive",
    active_slot: 1,
    checkpoint: "requested",
    created_at: createdAt,
    delete_mode: "cascade",
    execution_attempts: 0,
    id: jobId,
    idempotency_key: "delete-source-a",
    inventory_complete: false,
    knowledge_space_id: knowledgeSpaceId,
    max_execution_attempts: 3,
    permission_snapshot_id: "018f0d60-7a49-7cc2-9c1b-5b36f18f3201",
    permission_snapshot_revision: 1,
    request_fingerprint: requestFingerprint,
    requested_by_subject_id: "user-a",
    row_version: 1,
    run_state: "dispatch_pending",
    target_id: targetId,
    target_revision: 4,
    target_type: "source",
    tenant_id: tenantId,
    updated_at: createdAt,
    ...overrides,
  };
}

function runningJobRow(): DatabaseRow {
  return jobRow({
    checkpoint: "deleting_primary_data",
    execution_attempts: 1,
    heartbeat_at: createdAt,
    lease_expires_at: "2026-07-14T12:10:00.000Z",
    lease_token: leaseToken,
    row_version: 9,
    run_state: "running",
    target_id: knowledgeSpaceId,
    target_revision: 2,
    target_type: "knowledge_space",
    worker_id: "worker-a",
  });
}

function tombstoneRow(overrides: Partial<Record<string, unknown>> = {}): DatabaseRow {
  return {
    created_at: createdAt,
    deletion_job_id: jobId,
    id: tombstoneId,
    knowledge_space_id: knowledgeSpaceId,
    row_version: 1,
    state: "active",
    target_id: targetId,
    target_revision: 4,
    target_type: "source",
    tenant_id: tenantId,
    ...overrides,
  };
}

function outboxRow(overrides: Partial<Record<string, unknown>> = {}): DatabaseRow {
  return {
    available_at: createdAt,
    created_at: createdAt,
    deletion_job_id: jobId,
    delivery_revision: 1,
    dispatch_attempts: 0,
    event_type: "deletion.job",
    id: outboxId,
    idempotency_key: `deletion:${jobId}:1`,
    payload: { deletionJobId: jobId },
    request_fingerprint: requestFingerprint,
    request_idempotency_key: "delete-source-a",
    schema_version: 1,
    status: "pending",
    updated_at: createdAt,
    ...overrides,
  };
}

function permissionSnapshotRow(id: string): DatabaseRow {
  return {
    access_channel: "interactive",
    access_policy_revision: 1,
    api_access_revision: 1,
    api_key_expires_at: null,
    api_key_id: null,
    api_key_revision: null,
    created_at: createdAt,
    expires_at: "2026-07-14T13:00:00.000Z",
    id,
    knowledge_space_id: knowledgeSpaceId,
    member_revision: 1,
    permission_scopes: [],
    revision: 1,
    revoked_at: null,
    role: "editor",
    status: "active",
    subject_id: "user-a",
    tenant_id: tenantId,
    updated_at: createdAt,
    visibility: "all_members",
  };
}

function identifier(dialect: DatabaseAdapter["dialect"], value: string): string {
  const quote = dialect === "postgres" ? '"' : "`";
  return `${quote}${value}${quote}`;
}

function placeholder(dialect: DatabaseAdapter["dialect"], index: number): string {
  return dialect === "postgres" ? `$${index}` : "?";
}
