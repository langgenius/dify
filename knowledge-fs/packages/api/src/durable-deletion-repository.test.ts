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
const capabilityGrantId = "018f0d60-7a49-7cc2-9c1b-5b36f18f3103";
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

    it("persists only capability provenance for a newly admitted source deletion", async () => {
      const calls: DatabaseExecuteInput[] = [];
      let insertedJob = false;
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.operation === "select" && input.tableName === "deletion_jobs") {
          return { rows: insertedJob ? [capabilityJobRow()] : [], rowsAffected: 0 };
        }
        if (input.operation === "select" && input.tableName === "knowledge_spaces") {
          return {
            rows: [
              {
                deletion_job_id: null,
                lifecycle_state: "active",
                name: "Capability source space",
                revision: 2,
              },
            ],
            rowsAffected: 0,
          };
        }
        if (input.operation === "select" && input.tableName === "capability_grants") {
          return {
            rows: [{ content_scope_ids: ["team:camera"], subject_id: "user-a" }],
            rowsAffected: 0,
          };
        }
        if (input.operation === "select" && input.tableName === "sources") {
          return {
            rows: [
              {
                deletion_job_id: null,
                permission_scope: ["team:camera"],
                status: "idle",
                version: 4,
              },
            ],
            rowsAffected: 0,
          };
        }
        if (input.operation === "select" && input.tableName === "deletion_tombstones") {
          return { rows: [], rowsAffected: 0 };
        }
        if (input.operation === "insert" && input.tableName === "deletion_jobs") {
          insertedJob = true;
        }
        return { rows: [], rowsAffected: input.operation === "select" ? 0 : 1 };
      };
      const database = createSchemaDatabaseAdapter({
        executor: execute,
        kind: dialect,
        transaction: async (callback) => callback({ execute }),
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
          capabilityGrantId,
          createdAt,
          deleteMode: "keep",
          expectedVersion: 4,
          idempotencyKey: "delete-source-a",
          knowledgeSpaceId,
          sourceId: targetId,
          tenantId,
        }),
      ).resolves.toMatchObject({
        created: true,
        job: { capabilityGrantId, id: jobId },
      });

      const jobInsert = calls.find(
        (call) => call.operation === "insert" && call.tableName === "deletion_jobs",
      );
      expect(jobInsert?.params.slice(0, 6)).toEqual([null, 1, null, null, null, capabilityGrantId]);
      expect(jobInsert?.params).not.toContain("user-a");
      expect(calls.some((call) => call.tableName === "knowledge_space_permission_snapshots")).toBe(
        false,
      );
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

    it("fails a queued capability job terminally when its grant was revoked before claim", async () => {
      const script = scriptedDatabase(dialect, [
        step("deletion_jobs", "select", [], "execution_attempts"),
        step(
          "deletion_jobs",
          "select",
          [capabilityJobRow({ run_state: "queued" })],
          "lease_expires_at",
        ),
        step("capability_grants", "select", []),
        step("deletion_jobs", "update", []),
        step("deletion_outbox", "update", []),
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

      const jobFailure = script.calls.find(
        (call) => call.operation === "update" && call.tableName === "deletion_jobs",
      );
      expect(jobFailure?.params).toContain("CAPABILITY_REVOKED");
      expect(jobFailure?.sql).toContain(`${identifier(dialect, "run_state")} = 'failed'`);
      expect(
        script.calls.find(
          (call) => call.operation === "update" && call.tableName === "deletion_outbox",
        )?.sql,
      ).toContain(`${identifier(dialect, "status")} = 'dead'`);
      script.expectDone();
    });

    it("revalidates capability provenance before the final deletion transaction", async () => {
      const running = capabilityJobRow({
        checkpoint: "deleting_primary_data",
        execution_attempts: 1,
        heartbeat_at: createdAt,
        lease_expires_at: "2026-07-14T12:10:00.000Z",
        lease_token: leaseToken,
        row_version: 9,
        run_state: "running",
        worker_id: "worker-a",
      });
      const script = scriptedDatabase(dialect, [
        step("deletion_jobs", "select", [running], "FOR UPDATE"),
        step("deletion_job_items", "select", []),
        step("capability_grants", "select", []),
      ]);
      const repository = repositoryFor(script.database, requestFingerprint);
      let deleted = false;

      await expect(
        repository.completeJob({
          deleteAndProbePrimaryData: async () => {
            deleted = true;
            return { clean: true };
          },
          deletionJobId: jobId,
          expectedRowVersion: 9,
          leaseToken,
          now: "2026-07-14T12:00:01.000Z",
        }),
      ).rejects.toThrow();

      expect(deleted).toBe(false);
      expect(script.calls.some((call) => call.operation !== "select")).toBe(false);
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

    it("retries a failed capability job without reconstructing a local permission snapshot", async () => {
      const failed = capabilityJobRow({
        checkpoint: "deleting_objects",
        last_error_code: "OBJECT_DELETE_FAILED",
        last_error_message: "storage unavailable",
        row_version: 5,
        run_state: "failed",
      });
      const retried = capabilityJobRow({
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
        if (input.operation === "select" && input.tableName === "capability_grants") {
          return { rows: [{ grant_id: capabilityGrantId }], rowsAffected: 0 };
        }
        if (input.operation === "select" && input.tableName === "deletion_tombstones") {
          return { rows: [tombstoneRow()], rowsAffected: 0 };
        }
        return { rows: [], rowsAffected: input.operation === "select" ? 0 : 1 };
      };
      const database = createSchemaDatabaseAdapter({
        executor: execute,
        kind: dialect,
        transaction: async (callback) => callback({ execute }),
      });
      const repository = createDatabaseDurableDeletionRepository({
        database,
        fingerprinter: () => requestFingerprint,
        generateOutboxId: () => outboxId,
        generateRetryAuditId: () => retryAuditId,
      });

      await expect(
        repository.retryFailedJob({
          capabilityGrantId,
          expectedRowVersion: 5,
          idempotencyKey: "capability-retry",
          jobId,
          now: createdAt,
          requestFingerprint,
          retryAuthority: "original_requester",
          tenantId,
        }),
      ).resolves.toMatchObject({
        created: true,
        job: { capabilityGrantId, rowVersion: 6, runState: "dispatch_pending" },
      });

      const auditInsert = calls.find(
        (call) => call.operation === "insert" && call.tableName === "deletion_retry_audits",
      );
      expect(auditInsert?.params).toEqual([
        null,
        null,
        null,
        null,
        null,
        capabilityGrantId,
        createdAt,
        jobId,
        retryAuditId,
        knowledgeSpaceId,
        outboxId,
        null,
        null,
        requestFingerprint,
        "capability-retry",
        "original_requester",
        tenantId,
      ]);
      expect(calls.some((call) => call.tableName === "knowledge_space_permission_snapshots")).toBe(
        false,
      );
      expect(calls.findIndex((call) => call.tableName === "capability_grants")).toBeLessThan(
        calls.findIndex(
          (call) => call.operation === "insert" && call.tableName === "deletion_retry_audits",
        ),
      );
    });

    it("persists bounded inventory before advancing from quiescing", async () => {
      const inventoryJob = runningJobRow({
        checkpoint: "quiescing",
        inventory_complete: false,
        row_version: 9,
        target_id: targetId,
        target_type: "document_asset",
      });
      const inventoriedJob = {
        ...inventoryJob,
        inventory_complete: true,
        row_version: 10,
        scan_phase: "document_objects",
      };
      const inventoryScript = scriptedDatabase(dialect, [
        step("deletion_jobs", "select", [inventoryJob], "FOR UPDATE"),
        step("deletion_job_items", "select", [], "idempotency_key"),
        step("deletion_job_items", "insert", []),
        step("deletion_jobs", "update", []),
        step("deletion_jobs", "select", [inventoriedJob]),
      ]);
      const repository = createDatabaseDurableDeletionRepository({
        database: inventoryScript.database,
        fingerprinter: () => requestFingerprint,
        generateItemId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f3203",
      });

      await expect(
        repository.appendInventory({
          deletionJobId: jobId,
          expectedRowVersion: 9,
          inventoryComplete: true,
          items: [
            {
              idempotencyKey: "object:raw",
              kind: "object",
              maxAttempts: 3,
              objectKey: "tenant-a/spaces/space-a/documents/raw.md",
              ordinal: 1,
            },
          ],
          leaseToken,
          now: createdAt,
          scanPhase: "document_objects",
        }),
      ).resolves.toMatchObject({
        checkpoint: "quiescing",
        inventoryComplete: true,
        rowVersion: 10,
        scanPhase: "document_objects",
      });
      expect(
        inventoryScript.calls.find(
          (call) => call.operation === "insert" && call.tableName === "deletion_job_items",
        )?.params,
      ).toEqual(
        expect.arrayContaining([
          "object:raw",
          "object",
          "tenant-a/spaces/space-a/documents/raw.md",
          "pending",
        ]),
      );
      inventoryScript.expectDone();

      const advancedJob = {
        ...inventoriedJob,
        checkpoint: "deleting_objects",
        row_version: 11,
        scan_phase: null,
      };
      const advanceScript = scriptedDatabase(dialect, [
        step("deletion_jobs", "select", [inventoriedJob], "FOR UPDATE"),
        step("deletion_jobs", "update", []),
        step("deletion_jobs", "select", [advancedJob]),
      ]);

      await expect(
        repositoryFor(advanceScript.database, requestFingerprint).advanceCheckpoint({
          deletionJobId: jobId,
          expectedRowVersion: 10,
          leaseToken,
          nextCheckpoint: "deleting_objects",
          now: createdAt,
        }),
      ).resolves.toMatchObject({ checkpoint: "deleting_objects", rowVersion: 11 });
      expect(
        advanceScript.calls
          .find((call) => call.operation === "update" && call.tableName === "deletion_jobs")
          ?.params.slice(0, 3),
      ).toEqual(["deleting_objects", createdAt, 11]);
      advanceScript.expectDone();
    });

    it("retries and then completes a fenced external item with redaction", async () => {
      const running = runningJobRow({ checkpoint: "deleting_objects" });
      const itemId = "del-item-1";
      const pending = itemRow({ id: itemId });
      const retryAt = "2026-07-14T12:01:00.000Z";
      const retrying = itemRow({
        attempts: 1,
        last_error_code: "OBJECT_DELETE_FAILED",
        last_error_message:
          "Durable deletion external cleanup failed [diagnostic:aaaaaaaaaaaaaaaa]",
        next_attempt_at: retryAt,
        row_version: 2,
        status: "retry_wait",
      });
      const completedAt = "2026-07-14T12:02:00.000Z";
      const completed = itemRow({
        attempts: 2,
        completed_at: completedAt,
        last_error_code: null,
        last_error_message: null,
        next_attempt_at: null,
        object_key: null,
        redacted_at: completedAt,
        row_version: 3,
        status: "completed",
      });

      const claimScript = scriptedDatabase(dialect, [
        step("deletion_jobs", "select", [running], "FOR UPDATE"),
        step("deletion_job_items", "select", [pending], "retry_wait"),
      ]);
      await expect(
        repositoryFor(claimScript.database, requestFingerprint).claimItems({
          deletionJobId: jobId,
          expectedRowVersion: 9,
          leaseToken,
          limit: 10,
          now: createdAt,
        }),
      ).resolves.toMatchObject([
        { attempts: 0, id: itemId, objectKey: pending.object_key, status: "pending" },
      ]);
      claimScript.expectDone();

      const sensitive = "object tenant/private/raw.md failed with credential=top-secret";
      const retryScript = scriptedDatabase(dialect, [
        step("deletion_jobs", "select", [running], "FOR UPDATE"),
        step("deletion_job_items", "select", [pending], "FOR UPDATE"),
        step("deletion_job_items", "update", []),
        step("deletion_job_items", "select", [retrying]),
      ]);
      await expect(
        repositoryFor(retryScript.database, requestFingerprint).scheduleItemRetry({
          deletionJobId: jobId,
          errorCode: "OBJECT_DELETE_FAILED",
          errorMessage: sensitive,
          expectedItemRowVersion: 1,
          expectedRowVersion: 9,
          itemId,
          leaseToken,
          now: createdAt,
          retryAt,
        }),
      ).resolves.toMatchObject({ attempts: 1, nextAttemptAt: retryAt, status: "retry_wait" });
      expect(JSON.stringify(retryScript.calls)).not.toContain("top-secret");
      retryScript.expectDone();

      const completeScript = scriptedDatabase(dialect, [
        step("deletion_jobs", "select", [running], "FOR UPDATE"),
        step("deletion_job_items", "select", [retrying], "FOR UPDATE"),
        step("deletion_job_items", "update", []),
        step("deletion_job_items", "select", [completed]),
      ]);
      await expect(
        repositoryFor(completeScript.database, requestFingerprint).completeItem({
          deletionJobId: jobId,
          expectedItemRowVersion: 2,
          expectedRowVersion: 9,
          itemId,
          leaseToken,
          now: completedAt,
        }),
      ).resolves.toMatchObject({
        attempts: 2,
        completedAt,
        redactedAt: completedAt,
        status: "completed",
      });
      expect(
        completeScript.calls.find(
          (call) => call.operation === "update" && call.tableName === "deletion_job_items",
        )?.sql,
      ).toContain("redacted_at");
      completeScript.expectDone();
    });

    it("claims, dispatches, retries, and dead-letters outbox delivery", async () => {
      const dispatching = outboxRow({
        dispatch_attempts: 1,
        locked_by: "dispatcher-a",
        locked_until: "2026-07-14T12:05:00.000Z",
        lock_token: leaseToken,
        status: "dispatching",
      });
      const claimScript = scriptedDatabase(dialect, [
        step("deletion_outbox", "select", [outboxRow()]),
        step("deletion_outbox", "update", []),
        step("deletion_outbox", "select", [dispatching]),
      ]);
      await expect(
        repositoryFor(claimScript.database, requestFingerprint).claimOutbox({
          limit: 10,
          lockedUntil: "2026-07-14T12:05:00.000Z",
          lockToken: leaseToken,
          now: createdAt,
          workerId: "dispatcher-a",
        }),
      ).resolves.toMatchObject([
        { dispatchAttempts: 1, lockedBy: "dispatcher-a", status: "dispatching" },
      ]);
      claimScript.expectDone();

      const dispatched = outboxRow({
        delivered_at: "2026-07-14T12:00:01.000Z",
        dispatch_attempts: 1,
        queue_job_id: "queue-a",
        status: "dispatched",
      });
      const dispatchScript = scriptedDatabase(dialect, [
        step("deletion_outbox", "select", [dispatching], "FOR UPDATE"),
        step("deletion_outbox", "update", []),
        step("deletion_jobs", "update", []),
        step("deletion_outbox", "select", [dispatched]),
      ]);
      await expect(
        repositoryFor(dispatchScript.database, requestFingerprint).markOutboxDispatched({
          deliveredAt: "2026-07-14T12:00:01.000Z",
          lockToken: leaseToken,
          now: createdAt,
          outboxId,
          queueJobId: "queue-a",
        }),
      ).resolves.toMatchObject({ queueJobId: "queue-a", status: "dispatched" });
      dispatchScript.expectDone();

      const rawError = "broker rejected payload credential=top-secret";
      const safeError = "Durable deletion external cleanup failed [diagnostic:aaaaaaaaaaaaaaaa]";
      const pending = outboxRow({
        available_at: "2026-07-14T12:01:00.000Z",
        dispatch_attempts: 1,
        last_error: safeError,
        status: "pending",
      });
      const releaseScript = scriptedDatabase(dialect, [
        step("deletion_outbox", "select", [dispatching], "FOR UPDATE"),
        step("deletion_jobs", "select", [jobRow()]),
        step("deletion_outbox", "update", []),
        step("deletion_outbox", "select", [pending]),
      ]);
      await expect(
        repositoryFor(releaseScript.database, requestFingerprint).releaseOutbox({
          availableAt: "2026-07-14T12:01:00.000Z",
          error: rawError,
          lockToken: leaseToken,
          now: createdAt,
          outboxId,
        }),
      ).resolves.toMatchObject({ lastError: safeError, status: "pending" });
      expect(JSON.stringify(releaseScript.calls)).not.toContain("top-secret");
      releaseScript.expectDone();

      const dead = outboxRow({
        dispatch_attempts: 1,
        last_error: safeError,
        status: "dead",
      });
      const deadScript = scriptedDatabase(dialect, [
        step("deletion_outbox", "select", [dispatching], "FOR UPDATE"),
        step("deletion_jobs", "select", [jobRow()]),
        step("deletion_outbox", "update", []),
        step("deletion_jobs", "update", []),
        step("deletion_outbox", "select", [dead]),
      ]);
      await expect(
        repositoryFor(deadScript.database, requestFingerprint).releaseOutbox({
          availableAt: "2026-07-14T12:01:00.000Z",
          deadLetter: true,
          error: rawError,
          lockToken: leaseToken,
          now: createdAt,
          outboxId,
        }),
      ).resolves.toMatchObject({ status: "dead" });
      expect(
        deadScript.calls.find(
          (call) => call.operation === "update" && call.tableName === "deletion_jobs",
        )?.sql,
      ).toContain("OUTBOX_DISPATCH_EXHAUSTED");
      deadScript.expectDone();
    });

    it("rejects unsafe worker bounds and kind-mismatched inventory before mutation", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        return input.operation === "select" && input.tableName === "deletion_jobs"
          ? { rows: [runningJobRow({ checkpoint: "quiescing" })], rowsAffected: 0 }
          : { rows: [], rowsAffected: input.operation === "select" ? 0 : 1 };
      };
      const database = createSchemaDatabaseAdapter({
        executor: execute,
        kind: dialect,
        transaction: async (callback) => callback({ execute }),
      });
      expect(() =>
        createDatabaseDurableDeletionRepository({
          database,
          fingerprinter: undefined as never,
        }),
      ).toThrow("fingerprinter is required");
      const repository = createDatabaseDurableDeletionRepository({
        database,
        fingerprinter: () => requestFingerprint,
        maxClaimBatchSize: 2,
        maxInventoryBatchSize: 2,
      });
      const fence = {
        deletionJobId: jobId,
        expectedRowVersion: 9,
        leaseToken,
        now: createdAt,
      };
      const objectItem = {
        idempotencyKey: "object-a",
        kind: "object" as const,
        maxAttempts: 3,
        objectKey: "tenant-a/spaces/space-a/a.bin",
        ordinal: 1,
      };

      const invalidCommands: readonly (() => Promise<unknown>)[] = [
        () =>
          repository.claimJobs({
            leaseExpiresAt: "2026-07-14T12:01:00.000Z",
            limit: 0,
            now: createdAt,
            workerId: "worker-a",
          }),
        () =>
          repository.claimJobs({
            leaseExpiresAt: "2026-07-14T12:01:00.000Z",
            limit: 3,
            now: createdAt,
            workerId: "worker-a",
          }),
        () =>
          repository.claimJobs({
            leaseExpiresAt: createdAt,
            limit: 1,
            now: createdAt,
            workerId: "worker-a",
          }),
        () =>
          repository.heartbeatJob({
            ...fence,
            leaseExpiresAt: createdAt,
            workerId: "worker-a",
          }),
        () =>
          repository.appendInventory({
            ...fence,
            inventoryComplete: false,
            items: [objectItem, { ...objectItem, idempotencyKey: "b", ordinal: 2 }, objectItem],
            scanPhase: "objects",
          }),
        () =>
          repository.appendInventory({
            ...fence,
            inventoryComplete: false,
            items: [objectItem],
            resetExistingInventory: true,
            scanPhase: "objects",
          }),
        () => repository.claimItems({ ...fence, limit: 3 }),
        () =>
          repository.scheduleJobRetry({
            ...fence,
            errorCode: "TRANSIENT",
            errorMessage: "retry",
            retryAt: createdAt,
          }),
        () =>
          repository.scheduleJobRetry({
            ...fence,
            errorCode: "TRANSIENT",
            errorMessage: "retry",
            resetExecutionAttempts: true,
            retryAt: "2026-07-14T12:01:00.000Z",
          }),
      ];
      for (const command of invalidCommands) await expect(command()).rejects.toThrow();
      expect(calls).toHaveLength(0);

      for (const item of [
        { ...objectItem, objectKey: undefined },
        { ...objectItem, kind: "secret_ref" as const, objectKey: undefined },
        { ...objectItem, kind: "cache_key" as const, objectKey: undefined },
        { ...objectItem, kind: "document_cascade" as const, objectKey: undefined },
      ]) {
        await expect(
          repository.appendInventory({
            ...fence,
            inventoryComplete: false,
            items: [item],
            scanPhase: "objects",
          }),
        ).rejects.toThrow("inventory payload does not match its kind");
      }
      expect(calls).toHaveLength(4);
      expect(calls.every((call) => call.operation === "select")).toBe(true);
    });

    it("returns null for every lease-fenced mutation after the job disappears", async () => {
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
      const repository = repositoryFor(database, requestFingerprint);
      const fence = {
        deletionJobId: jobId,
        expectedRowVersion: 9,
        leaseToken,
        now: createdAt,
      };

      await expect(
        repository.heartbeatJob({
          ...fence,
          leaseExpiresAt: "2026-07-14T12:15:00.000Z",
          workerId: "worker-a",
        }),
      ).resolves.toBeNull();
      await expect(
        repository.appendInventory({
          ...fence,
          inventoryComplete: false,
          items: [],
          scanPhase: "objects",
        }),
      ).resolves.toBeNull();
      await expect(repository.claimItems({ ...fence, limit: 1 })).resolves.toEqual([]);
      await expect(
        repository.completeItem({ ...fence, expectedItemRowVersion: 1, itemId: "item-a" }),
      ).resolves.toBeNull();
      await expect(
        repository.scheduleItemRetry({
          ...fence,
          errorCode: "OBJECT_DELETE_FAILED",
          errorMessage: "provider unavailable",
          expectedItemRowVersion: 1,
          itemId: "item-a",
          retryAt: "2026-07-14T12:15:00.000Z",
        }),
      ).resolves.toBeNull();
      await expect(
        repository.advanceCheckpoint({ ...fence, nextCheckpoint: "quiescing" }),
      ).resolves.toBeNull();
      await expect(repository.reconcileDirtyPrimary(fence)).resolves.toBeNull();
      await expect(
        repository.scheduleJobRetry({
          ...fence,
          errorCode: "TRANSIENT",
          errorMessage: "try later",
          retryAt: "2026-07-14T12:15:00.000Z",
        }),
      ).resolves.toBeNull();
      await expect(
        repository.failJob({
          ...fence,
          errorCode: "PRIMARY_DELETE_FAILED",
          errorMessage: "database unavailable",
        }),
      ).resolves.toBeNull();
      await expect(
        repository.completeJob({
          ...fence,
          deleteAndProbePrimaryData: async () => ({ clean: true }),
        }),
      ).resolves.toBeNull();

      expect(calls).toHaveLength(10);
      expect(calls.every((call) => call.operation === "select")).toBe(true);
    });

    it("maps complete persisted job, tombstone, and inventory representations", async () => {
      const completeJob = runningJobRow({
        api_key_expires_at: "2026-07-14T13:00:00.000Z",
        api_key_id: "api-key-a",
        api_key_revision: 2,
        inventory_complete: 1,
        name_challenge_digest: "b".repeat(64),
        queue_job_id: "queue-job-a",
        scan_cursor: "cursor-a",
        scan_phase: "objects",
        started_at: createdAt,
      });
      const completeTombstone = tombstoneRow({ completed_at: createdAt, state: "completed" });
      const completeItem = itemRow({
        cache_key: "cache-a",
        credential_ref: "credential-a",
        resource_id: "resource-a",
      });
      let itemSelect = false;
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        if (input.tableName === "deletion_jobs") {
          return { rows: [completeJob], rowsAffected: 0 };
        }
        if (input.tableName === "deletion_tombstones") {
          return { rows: [completeTombstone], rowsAffected: 0 };
        }
        if (input.tableName === "deletion_job_items") {
          itemSelect = true;
          return { rows: [completeItem], rowsAffected: 0 };
        }
        throw new Error(`Unexpected SQL table=${input.tableName}`);
      };
      const database = createSchemaDatabaseAdapter({
        executor: execute,
        kind: dialect,
        transaction: async (callback) => callback({ execute }),
      });
      const repository = repositoryFor(database, requestFingerprint);

      await expect(repository.getJob({ id: jobId, tenantId })).resolves.toMatchObject({
        apiKeyExpiresAt: "2026-07-14T13:00:00.000Z",
        apiKeyId: "api-key-a",
        apiKeyRevision: 2,
        inventoryComplete: true,
        nameChallengeDigest: "b".repeat(64),
        queueJobId: "queue-job-a",
        scanCursor: "cursor-a",
        startedAt: createdAt,
      });
      await expect(
        repository.getTombstone({ targetId, targetType: "source", tenantId }),
      ).resolves.toMatchObject({ completedAt: createdAt, state: "completed" });
      await expect(
        repository.claimItems({
          deletionJobId: jobId,
          expectedRowVersion: 9,
          leaseToken,
          limit: 1,
          now: createdAt,
        }),
      ).resolves.toEqual([
        expect.objectContaining({
          cacheKey: "cache-a",
          credentialRef: "credential-a",
          resourceId: "resource-a",
        }),
      ]);
      expect(itemSelect).toBe(true);
    });

    it("rejects corrupted persisted enum, outbox payload, event, and schema values", async () => {
      let corrupted: "enum" | "event" | "payload" | "schema" = "enum";
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        if (input.tableName === "deletion_jobs") {
          return {
            rows: [jobRow({ run_state: corrupted === "enum" ? "unknown" : "queued" })],
            rowsAffected: 0,
          };
        }
        if (input.tableName === "deletion_outbox" && input.operation === "select") {
          return {
            rows: [
              outboxRow({
                event_type: corrupted === "event" ? "wrong.event" : "deletion.job",
                payload:
                  corrupted === "payload"
                    ? { deletionJobId: "other-job" }
                    : { deletionJobId: jobId },
                schema_version: corrupted === "schema" ? 2 : 1,
              }),
            ],
            rowsAffected: 0,
          };
        }
        return { rows: [], rowsAffected: 1 };
      };
      const database = createSchemaDatabaseAdapter({
        executor: execute,
        kind: dialect,
        transaction: async (callback) => callback({ execute }),
      });
      const repository = repositoryFor(database, requestFingerprint);

      await expect(repository.getJob({ id: jobId, tenantId })).rejects.toThrow(
        "run_state is invalid",
      );
      for (const [value, message] of [
        ["payload", "payload does not match its job"],
        ["event", "event_type is invalid"],
        ["schema", "schema_version is invalid"],
      ] as const) {
        corrupted = value;
        await expect(
          repository.claimOutbox({
            limit: 1,
            lockedUntil: "2026-07-14T12:15:00.000Z",
            lockToken: "outbox-lock-a",
            now: createdAt,
            workerId: "worker-a",
          }),
        ).rejects.toThrow(message);
      }
    });

    it("admits knowledge-space deletion and fails closed across every admission race", async () => {
      type Mode =
        | "active-child"
        | "existing-tombstone"
        | "insert-race"
        | "mark-lost"
        | "name-mismatch"
        | "replay-after-lock"
        | "revision-mismatch"
        | "space-missing"
        | "success"
        | "unobservable-insert";
      const request = {
        accessChannel: "interactive" as const,
        createdAt,
        expectedRevision: 2,
        idempotencyKey: "delete-space-a",
        knowledgeSpaceId,
        nameChallenge: "Knowledge Space A",
        permissionSnapshotId: "permission-space-a",
        permissionSnapshotRevision: 1,
        requestedBySubjectId: "owner-a",
        tenantId,
      };
      const storedJob = (id = jobId) =>
        jobRow({
          id,
          idempotency_key: request.idempotencyKey,
          name_challenge_digest: requestFingerprint,
          target_id: knowledgeSpaceId,
          target_revision: 2,
          target_type: "knowledge_space",
        });
      const run = async (mode: Mode) => {
        const calls: DatabaseExecuteInput[] = [];
        let inserted = false;
        let jobReads = 0;
        let tombstoneReads = 0;
        const racedJobId = "raced-space-job";
        const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
          calls.push(input);
          if (input.tableName === "deletion_jobs" && input.operation === "select") {
            jobReads += 1;
            if (mode === "replay-after-lock" && jobReads === 2) {
              return { rows: [storedJob()], rowsAffected: 0 };
            }
            if (!inserted || mode === "unobservable-insert") {
              return { rows: [], rowsAffected: 0 };
            }
            return {
              rows: [storedJob(mode === "insert-race" ? racedJobId : jobId)],
              rowsAffected: 0,
            };
          }
          if (input.tableName === "knowledge_spaces" && input.operation === "select") {
            if (mode === "space-missing") return { rows: [], rowsAffected: 0 };
            return {
              rows: [
                {
                  deletion_job_id: null,
                  lifecycle_state: "active",
                  name: mode === "name-mismatch" ? "Different Space" : request.nameChallenge,
                  revision: mode === "revision-mismatch" ? 3 : 2,
                },
              ],
              rowsAffected: 0,
            };
          }
          if (input.tableName === "deletion_tombstones" && input.operation === "select") {
            tombstoneReads += 1;
            if (mode === "active-child" && tombstoneReads === 1) {
              return { rows: [{ deletion_job_id: "child-job" }], rowsAffected: 0 };
            }
            if (
              mode === "replay-after-lock" ||
              (mode === "insert-race" && inserted) ||
              (mode === "existing-tombstone" && tombstoneReads === 2)
            ) {
              const linkedJobId = mode === "insert-race" ? racedJobId : jobId;
              return {
                rows: [
                  tombstoneRow({
                    deletion_job_id: linkedJobId,
                    target_id: knowledgeSpaceId,
                    target_revision: 2,
                    target_type: "knowledge_space",
                  }),
                ],
                rowsAffected: 0,
              };
            }
            return { rows: [], rowsAffected: 0 };
          }
          if (input.tableName === "deletion_outbox" && input.operation === "select") {
            const linkedJobId = mode === "insert-race" ? racedJobId : jobId;
            return {
              rows: [
                outboxRow({
                  deletion_job_id: linkedJobId,
                  payload: { deletionJobId: linkedJobId },
                  request_idempotency_key: request.idempotencyKey,
                }),
              ],
              rowsAffected: 0,
            };
          }
          if (input.tableName === "deletion_jobs" && input.operation === "insert") {
            inserted = true;
            return { rows: [], rowsAffected: 1 };
          }
          if (input.tableName === "knowledge_spaces" && input.operation === "update") {
            return { rows: [], rowsAffected: mode === "mark-lost" ? 0 : 1 };
          }
          return { rows: [], rowsAffected: input.operation === "select" ? 0 : 1 };
        };
        const database = createSchemaDatabaseAdapter({
          executor: execute,
          kind: dialect,
          transaction: async (callback) => callback({ execute }),
        });
        const repository = createDatabaseDurableDeletionRepository({
          database,
          fingerprinter: () => requestFingerprint,
          generateJobId: () => jobId,
          generateOutboxId: () => outboxId,
          generateTombstoneId: () => tombstoneId,
        });
        return { calls, result: repository.requestKnowledgeSpaceDeletion(request) };
      };

      const admitted = await run("success");
      await expect(admitted.result).resolves.toMatchObject({
        created: true,
        job: {
          nameChallengeDigest: requestFingerprint,
          targetId: knowledgeSpaceId,
          targetType: "knowledge_space",
        },
      });
      expect(
        admitted.calls.some(
          (call) => call.operation === "update" && call.tableName === "agent_workspace_snapshots",
        ),
      ).toBe(true);

      await expect((await run("replay-after-lock")).result).resolves.toMatchObject({
        created: false,
        job: { id: jobId },
      });
      await expect((await run("insert-race")).result).resolves.toMatchObject({
        created: false,
        job: { id: "raced-space-job" },
      });
      for (const [mode, errorName] of [
        ["space-missing", "DurableDeletionTargetRevisionConflictError"],
        ["name-mismatch", "DurableDeletionNameChallengeMismatchError"],
        ["revision-mismatch", "DurableDeletionTargetRevisionConflictError"],
        ["active-child", "DurableDeletionTargetConflictError"],
        ["existing-tombstone", "DurableDeletionTargetConflictError"],
        ["unobservable-insert", "Error"],
        ["mark-lost", "DurableDeletionTargetRevisionConflictError"],
      ] as const) {
        await expect((await run(mode)).result).rejects.toMatchObject({ name: errorName });
      }
    });

    it("rejects malformed public values and inconsistent API-key provenance before mutation", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.tableName === "deletion_jobs") {
          return input.params.includes("numeric-inventory")
            ? {
                rows: [jobRow({ id: "numeric-inventory", inventory_complete: 0 })],
                rowsAffected: 0,
              }
            : { rows: [runningJobRow()], rowsAffected: 0 };
        }
        if (input.tableName === "deletion_job_items") {
          return { rows: [itemRow()], rowsAffected: 0 };
        }
        return { rows: [], rowsAffected: 0 };
      };
      const database = createSchemaDatabaseAdapter({
        executor: execute,
        kind: dialect,
        transaction: async (callback) => callback({ execute }),
      });
      const repository = repositoryFor(database, requestFingerprint);
      const sourceRequest = {
        accessChannel: "interactive" as const,
        createdAt,
        deleteMode: "cascade" as const,
        expectedVersion: 4,
        idempotencyKey: "invalid-input",
        knowledgeSpaceId,
        permissionSnapshotId: "permission-a",
        permissionSnapshotRevision: 1,
        requestedBySubjectId: "user-a",
        sourceId,
        tenantId,
      };

      await expect(repository.getJob({ id: " ", tenantId })).rejects.toThrow("job id is required");
      await expect(
        repository.getJobByIdempotency({ idempotencyKey: "key", tenantId: "t".repeat(256) }),
      ).rejects.toThrow("tenantId exceeds 255 characters");
      await expect(
        repository.getTombstone({
          targetId,
          targetType: "invalid" as never,
          tenantId,
        }),
      ).rejects.toThrow("targetType is invalid");
      await expect(
        repository.requestSourceDeletion({ ...sourceRequest, createdAt: "bad" }),
      ).rejects.toThrow("createdAt must be an ISO date-time");
      await expect(
        repository.requestSourceDeletion({
          ...sourceRequest,
          permissionSnapshotId: undefined,
        } as never),
      ).rejects.toThrow("legacy permission provenance is incomplete");
      await expect(
        repository.requestSourceDeletion({
          ...sourceRequest,
          apiKeyRevision: 1,
        }),
      ).rejects.toThrow("API-key provenance is inconsistent");
      await expect(
        repository.requestSourceDeletion({
          ...sourceRequest,
          apiKeyId: "api-key-a",
        }),
      ).rejects.toThrow("API-key provenance is inconsistent");
      await expect(
        repository.requestSourceDeletion({
          ...sourceRequest,
          apiKeyId: "api-key-a",
          apiKeyRevision: 1,
        }),
      ).rejects.toThrow("API-key provenance is inconsistent");
      await expect(
        repository.completeItem({
          deletionJobId: jobId,
          expectedItemRowVersion: -1,
          expectedRowVersion: 9,
          itemId: "item-a",
          leaseToken,
          now: createdAt,
        }),
      ).rejects.toThrow("expectedItemRowVersion must be a non-negative integer");
      await expect(repository.getJob({ id: "numeric-inventory", tenantId })).resolves.toMatchObject(
        {
          inventoryComplete: false,
        },
      );

      const invalidFingerprintRepository = repositoryFor(database, "not-a-fingerprint");
      await expect(
        invalidFingerprintRepository.requestSourceDeletion({
          ...sourceRequest,
          apiKeyId: " ",
        }),
      ).rejects.toThrow("request fingerprint must be a lowercase SHA-256 HMAC");
      await expect(
        invalidFingerprintRepository.requestSourceDeletion({
          ...sourceRequest,
          accessChannel: "service_api",
          apiKeyExpiresAt: "2026-07-14T13:00:00.000Z",
          apiKeyId: "api-key-a",
          apiKeyRevision: 1,
        }),
      ).rejects.toThrow("request fingerprint must be a lowercase SHA-256 HMAC");
      await expect(
        invalidFingerprintRepository.requestDocumentDeletion({
          ...sourceRequest,
          documentAssetId: targetId,
          expectedDocumentVersion: 4,
          failedSourceMaterialization: {
            documentId: logicalDocumentId,
            ownership: {
              contentHash: "INVALID",
              itemKey: "item-a",
              runId: "run-a",
            },
            revision: 1,
            sourceId,
          },
        }),
      ).rejects.toThrow("ownership contentHash must be lowercase SHA-256");

      const retryBase = {
        accessChannel: "interactive" as const,
        idempotencyKey: "retry-invalid",
        jobId,
        now: createdAt,
        permissionSnapshotId: "permission-a",
        permissionSnapshotRevision: 1,
        requestedBySubjectId: "user-a",
        requestFingerprint,
        retryAuthority: "original_requester" as const,
        tenantId,
      };
      await expect(repository.retryFailedJob({ ...retryBase, apiKeyRevision: 1 })).rejects.toThrow(
        "API-key provenance is inconsistent",
      );
      await expect(
        repository.retryFailedJob({ ...retryBase, apiKeyId: "api-key-a" }),
      ).rejects.toThrow("API-key provenance is inconsistent");
      await expect(
        repository.retryFailedJob({
          ...retryBase,
          apiKeyId: "api-key-a",
          apiKeyRevision: 1,
        }),
      ).rejects.toThrow("API-key provenance is inconsistent");
      await expect(
        repository.retryFailedJob({
          ...retryBase,
          accessChannel: "service_api",
          apiKeyExpiresAt: "2026-07-14T13:00:00.000Z",
          apiKeyId: "api-key-a",
          apiKeyRevision: 1,
          requestFingerprint: "bad",
        }),
      ).rejects.toThrow("original request fingerprint must be a lowercase SHA-256 HMAC");
      await expect(
        repository.retryFailedJob({
          capabilityGrantId,
          idempotencyKey: "retry-owner-rescue",
          jobId,
          now: createdAt,
          requestFingerprint,
          retryAuthority: "interactive_owner_rescue",
          tenantId,
        }),
      ).rejects.toThrow("owner rescue requires an interactive non-API-key actor");
    });

    it("surfaces item, checkpoint, and job CAS losses without accepting stale progress", async () => {
      const fence = {
        deletionJobId: jobId,
        expectedRowVersion: 9,
        leaseToken,
        now: createdAt,
      };
      const itemId = "item-cas-a";
      const running = runningJobRow();
      const quiescing = runningJobRow({ checkpoint: "quiescing" });
      const pending = itemRow({ id: itemId });

      const heartbeatLost = scriptedDatabase(dialect, [
        step("deletion_jobs", "select", [running], "FOR UPDATE"),
        stepAffected("deletion_jobs", "update", 0),
      ]);
      await expect(
        repositoryFor(heartbeatLost.database, requestFingerprint).heartbeatJob({
          ...fence,
          leaseExpiresAt: "2026-07-14T12:15:00.000Z",
          workerId: "worker-a",
        }),
      ).resolves.toBeNull();
      heartbeatLost.expectDone();

      const resetLost = scriptedDatabase(dialect, [
        step("deletion_jobs", "select", [quiescing], "FOR UPDATE"),
        step("deletion_job_items", "delete", []),
        stepAffected("deletion_jobs", "update", 0),
      ]);
      await expect(
        repositoryFor(resetLost.database, requestFingerprint).appendInventory({
          ...fence,
          inventoryComplete: false,
          items: [],
          resetExistingInventory: true,
          scanCursor: "restart-cursor",
          scanPhase: "objects",
        }),
      ).rejects.toThrow("inventory lease fence was lost");
      resetLost.expectDone();

      const existingInventory = scriptedDatabase(dialect, [
        step("deletion_jobs", "select", [quiescing], "FOR UPDATE"),
        step("deletion_job_items", "select", [pending], "idempotency_key"),
        step("deletion_jobs", "update", []),
        step("deletion_jobs", "select", [{ ...quiescing, row_version: 10 }]),
      ]);
      const inventoryRepository = repositoryFor(existingInventory.database, requestFingerprint);
      const inventoryItem = {
        idempotencyKey: "object:raw",
        kind: "object" as const,
        maxAttempts: 3,
        objectKey: "tenant-a/spaces/space-a/documents/raw.md",
        ordinal: 1,
      };
      await expect(
        inventoryRepository.appendInventory({
          ...fence,
          inventoryComplete: false,
          items: [inventoryItem],
          scanCursor: "cursor-a",
          scanPhase: "objects",
        }),
      ).resolves.toMatchObject({ rowVersion: 10 });
      existingInventory.expectDone();

      const inventoryConflict = scriptedDatabase(dialect, [
        step("deletion_jobs", "select", [quiescing], "FOR UPDATE"),
        step(
          "deletion_job_items",
          "select",
          [itemRow({ payload_digest: "b".repeat(64) })],
          "idempotency_key",
        ),
      ]);
      await expect(
        repositoryFor(inventoryConflict.database, requestFingerprint).appendInventory({
          ...fence,
          inventoryComplete: false,
          items: [inventoryItem],
          scanPhase: "objects",
        }),
      ).rejects.toBeInstanceOf(DurableDeletionIdempotencyConflictError);
      inventoryConflict.expectDone();

      const completeLost = scriptedDatabase(dialect, [
        step("deletion_jobs", "select", [running], "FOR UPDATE"),
        step("deletion_job_items", "select", [pending], "FOR UPDATE"),
        stepAffected("deletion_job_items", "update", 0),
      ]);
      await expect(
        repositoryFor(completeLost.database, requestFingerprint).completeItem({
          ...fence,
          expectedItemRowVersion: 1,
          itemId,
        }),
      ).resolves.toBeNull();
      completeLost.expectDone();

      const exhaustedItem = scriptedDatabase(dialect, [
        step("deletion_jobs", "select", [running], "FOR UPDATE"),
        step(
          "deletion_job_items",
          "select",
          [itemRow({ attempts: 3, id: itemId, max_attempts: 3 })],
          "FOR UPDATE",
        ),
      ]);
      await expect(
        repositoryFor(exhaustedItem.database, requestFingerprint).completeItem({
          ...fence,
          expectedItemRowVersion: 1,
          itemId,
        }),
      ).resolves.toBeNull();
      exhaustedItem.expectDone();

      const retryItemLost = scriptedDatabase(dialect, [
        step("deletion_jobs", "select", [running], "FOR UPDATE"),
        step("deletion_job_items", "select", [pending], "FOR UPDATE"),
        stepAffected("deletion_job_items", "update", 0),
      ]);
      await expect(
        repositoryFor(retryItemLost.database, requestFingerprint).scheduleItemRetry({
          ...fence,
          errorCode: "OBJECT_DELETE_FAILED",
          errorMessage: "provider unavailable",
          expectedItemRowVersion: 1,
          itemId,
          retryAt: "2026-07-14T12:15:00.000Z",
        }),
      ).resolves.toBeNull();
      retryItemLost.expectDone();

      const terminalItem = itemRow({
        attempts: 1,
        completed_at: createdAt,
        id: itemId,
        last_error_code: "OBJECT_DELETE_FAILED",
        max_attempts: 1,
        row_version: 2,
        status: "dead",
      });
      const failedJob = runningJobRow({
        last_error_code: "OBJECT_DELETE_FAILED",
        row_version: 10,
        run_state: "failed",
      });
      const deadItem = scriptedDatabase(dialect, [
        step("deletion_jobs", "select", [running], "FOR UPDATE"),
        step(
          "deletion_job_items",
          "select",
          [itemRow({ id: itemId, max_attempts: 1 })],
          "FOR UPDATE",
        ),
        step("deletion_job_items", "update", []),
        step("deletion_jobs", "update", []),
        step("deletion_outbox", "update", []),
        step("deletion_jobs", "select", [failedJob]),
        step("deletion_job_items", "select", [terminalItem]),
      ]);
      await expect(
        repositoryFor(deadItem.database, requestFingerprint).scheduleItemRetry({
          ...fence,
          errorCode: "OBJECT_DELETE_FAILED",
          errorMessage: "permanent provider failure",
          expectedItemRowVersion: 1,
          itemId,
          retryAt: createdAt,
        }),
      ).resolves.toMatchObject({ attempts: 1, status: "dead" });
      deadItem.expectDone();

      for (const [current, next, extraStep, message] of [
        [runningJobRow({ checkpoint: "requested" }), "deleting_objects", undefined, undefined],
        [quiescing, "deleting_objects", undefined, "inventory is not complete"],
        [
          runningJobRow({ checkpoint: "deleting_objects", inventory_complete: true }),
          "deleting_derived_data",
          step("deletion_job_items", "select", [{ id: "pending-item" }]),
          "external items are incomplete",
        ],
      ] as const) {
        const checkpointScript = scriptedDatabase(dialect, [
          step("deletion_jobs", "select", [current], "FOR UPDATE"),
          ...(extraStep ? [extraStep] : []),
        ]);
        const expectation = expect(
          repositoryFor(checkpointScript.database, requestFingerprint).advanceCheckpoint({
            ...fence,
            nextCheckpoint: next,
          }),
        ).rejects;
        if (message) await expectation.toThrow(message);
        else await expectation.toBeInstanceOf(DurableDeletionCheckpointConflictError);
        checkpointScript.expectDone();
      }

      const checkpointLost = scriptedDatabase(dialect, [
        step("deletion_jobs", "select", [runningJobRow({ checkpoint: "requested" })], "FOR UPDATE"),
        stepAffected("deletion_jobs", "update", 0),
      ]);
      await expect(
        repositoryFor(checkpointLost.database, requestFingerprint).advanceCheckpoint({
          ...fence,
          nextCheckpoint: "quiescing",
        }),
      ).rejects.toThrow("checkpoint lease fence was lost");
      checkpointLost.expectDone();

      const reconcileWrong = scriptedDatabase(dialect, [
        step("deletion_jobs", "select", [quiescing], "FOR UPDATE"),
      ]);
      await expect(
        repositoryFor(reconcileWrong.database, requestFingerprint).reconcileDirtyPrimary(fence),
      ).rejects.toThrow("requires the final checkpoint");
      reconcileWrong.expectDone();

      const reconcileLost = scriptedDatabase(dialect, [
        step("deletion_jobs", "select", [running], "FOR UPDATE"),
        step("deletion_job_items", "delete", []),
        stepAffected("deletion_jobs", "update", 0),
      ]);
      await expect(
        repositoryFor(reconcileLost.database, requestFingerprint).reconcileDirtyPrimary(fence),
      ).rejects.toThrow("reconciliation lease fence was lost");
      reconcileLost.expectDone();

      const retryUpdateLost = scriptedDatabase(dialect, [
        step("deletion_jobs", "select", [running], "FOR UPDATE"),
        stepAffected("deletion_jobs", "update", 0),
      ]);
      await expect(
        repositoryFor(retryUpdateLost.database, requestFingerprint).scheduleJobRetry({
          ...fence,
          errorCode: "TRANSIENT",
          errorMessage: "try later",
          retryAt: "2026-07-14T12:15:00.000Z",
        }),
      ).resolves.toBeNull();
      retryUpdateLost.expectDone();

      const retryOutboxLost = scriptedDatabase(dialect, [
        step("deletion_jobs", "select", [running], "FOR UPDATE"),
        step("deletion_jobs", "update", []),
        stepAffected("deletion_outbox", "update", 0),
      ]);
      await expect(
        repositoryFor(retryOutboxLost.database, requestFingerprint).scheduleJobRetry({
          ...fence,
          errorCode: "TRANSIENT",
          errorMessage: "try later",
          retryAt: "2026-07-14T12:15:00.000Z",
        }),
      ).rejects.toThrow("retry did not release exactly one outbox event");
      retryOutboxLost.expectDone();

      const failUpdateLost = scriptedDatabase(dialect, [
        step("deletion_jobs", "select", [running], "FOR UPDATE"),
        stepAffected("deletion_jobs", "update", 0),
      ]);
      await expect(
        repositoryFor(failUpdateLost.database, requestFingerprint).failJob({
          ...fence,
          errorCode: "PRIMARY_DELETE_FAILED",
          errorMessage: "database unavailable",
        }),
      ).resolves.toBeNull();
      failUpdateLost.expectDone();

      const failOutboxLost = scriptedDatabase(dialect, [
        step("deletion_jobs", "select", [running], "FOR UPDATE"),
        step("deletion_jobs", "update", []),
        stepAffected("deletion_outbox", "update", 0),
      ]);
      await expect(
        repositoryFor(failOutboxLost.database, requestFingerprint).failJob({
          ...fence,
          errorCode: "PRIMARY_DELETE_FAILED",
          errorMessage: "database unavailable",
        }),
      ).rejects.toThrow("failure did not terminate exactly one outbox event");
      failOutboxLost.expectDone();
    });

    it("validates outbox leases and preserves dispatch state across CAS losses", async () => {
      const dispatching = outboxRow({
        dispatch_attempts: 1,
        locked_by: "dispatcher-a",
        locked_until: "2026-07-14T12:10:00.000Z",
        lock_token: leaseToken,
        status: "dispatching",
      });
      const noCalls = async (): Promise<DatabaseExecuteResult> => {
        throw new Error("database should not be called");
      };
      const validationDatabase = createSchemaDatabaseAdapter({
        executor: noCalls,
        kind: dialect,
        transaction: async (callback) => callback({ execute: noCalls }),
      });
      const validationRepository = createDatabaseDurableDeletionRepository({
        database: validationDatabase,
        fingerprinter: () => requestFingerprint,
        maxClaimBatchSize: 2,
      });
      await expect(
        validationRepository.claimOutbox({
          limit: 3,
          lockedUntil: "2026-07-14T12:10:00.000Z",
          lockToken: leaseToken,
          now: createdAt,
          workerId: "dispatcher-a",
        }),
      ).rejects.toThrow("outbox claim limit exceeds 2");
      await expect(
        validationRepository.claimOutbox({
          limit: 1,
          lockedUntil: createdAt,
          lockToken: leaseToken,
          now: createdAt,
          workerId: "dispatcher-a",
        }),
      ).rejects.toThrow("lockedUntil must be after now");

      const claimLost = scriptedDatabase(dialect, [
        step("deletion_outbox", "select", [outboxRow()]),
        stepAffected("deletion_outbox", "update", 0),
      ]);
      await expect(
        repositoryFor(claimLost.database, requestFingerprint).claimOutbox({
          limit: 1,
          lockedUntil: "2026-07-14T12:10:00.000Z",
          lockToken: leaseToken,
          now: createdAt,
          workerId: "dispatcher-a",
        }),
      ).resolves.toEqual([]);
      claimLost.expectDone();

      const expiredMark = scriptedDatabase(dialect, [
        step(
          "deletion_outbox",
          "select",
          [{ ...dispatching, locked_until: createdAt }],
          "FOR UPDATE",
        ),
      ]);
      await expect(
        repositoryFor(expiredMark.database, requestFingerprint).markOutboxDispatched({
          deliveredAt: createdAt,
          lockToken: leaseToken,
          now: createdAt,
          outboxId,
          queueJobId: "queue-a",
        }),
      ).resolves.toBeNull();
      expiredMark.expectDone();

      const markLost = scriptedDatabase(dialect, [
        step("deletion_outbox", "select", [dispatching], "FOR UPDATE"),
        stepAffected("deletion_outbox", "update", 0),
      ]);
      await expect(
        repositoryFor(markLost.database, requestFingerprint).markOutboxDispatched({
          deliveredAt: createdAt,
          lockToken: leaseToken,
          now: createdAt,
          outboxId,
          queueJobId: "queue-a",
        }),
      ).resolves.toBeNull();
      markLost.expectDone();

      const invalidRelease = scriptedDatabase(dialect, [
        step("deletion_outbox", "select", [outboxRow()], "FOR UPDATE"),
      ]);
      await expect(
        repositoryFor(invalidRelease.database, requestFingerprint).releaseOutbox({
          availableAt: "2026-07-14T12:15:00.000Z",
          error: "dispatch failed",
          lockToken: leaseToken,
          now: createdAt,
          outboxId,
        }),
      ).resolves.toBeNull();
      invalidRelease.expectDone();

      const missingParent = scriptedDatabase(dialect, [
        step("deletion_outbox", "select", [dispatching], "FOR UPDATE"),
        step("deletion_jobs", "select", []),
      ]);
      await expect(
        repositoryFor(missingParent.database, requestFingerprint).releaseOutbox({
          availableAt: "2026-07-14T12:15:00.000Z",
          error: "dispatch failed",
          lockToken: leaseToken,
          now: createdAt,
          outboxId,
        }),
      ).rejects.toThrow("lost its parent job");
      missingParent.expectDone();

      const releaseLost = scriptedDatabase(dialect, [
        step("deletion_outbox", "select", [dispatching], "FOR UPDATE"),
        step("deletion_jobs", "select", [jobRow()]),
        stepAffected("deletion_outbox", "update", 0),
      ]);
      await expect(
        repositoryFor(releaseLost.database, requestFingerprint).releaseOutbox({
          availableAt: "2026-07-14T12:15:00.000Z",
          error: "dispatch failed",
          lockToken: leaseToken,
          now: createdAt,
          outboxId,
        }),
      ).resolves.toBeNull();
      releaseLost.expectDone();

      const deadJobLost = scriptedDatabase(dialect, [
        step("deletion_outbox", "select", [dispatching], "FOR UPDATE"),
        step("deletion_jobs", "select", [jobRow()]),
        step("deletion_outbox", "update", []),
        stepAffected("deletion_jobs", "update", 0),
      ]);
      await expect(
        repositoryFor(deadJobLost.database, requestFingerprint).releaseOutbox({
          availableAt: "2026-07-14T12:15:00.000Z",
          deadLetter: true,
          error: "dispatch exhausted",
          lockToken: leaseToken,
          now: createdAt,
          outboxId,
        }),
      ).rejects.toThrow("dead outbox did not fail its job");
      deadJobLost.expectDone();
    });

    it("persists every external inventory kind with its exact sensitive locator", async () => {
      const quiescing = runningJobRow({ checkpoint: "quiescing" });
      const inventoried = {
        ...quiescing,
        inventory_complete: true,
        row_version: 10,
        scan_phase: "all-external-kinds",
      };
      const script = scriptedDatabase(dialect, [
        step("deletion_jobs", "select", [quiescing], "FOR UPDATE"),
        step("deletion_job_items", "select", [], "idempotency_key"),
        step("deletion_job_items", "insert", []),
        step("deletion_job_items", "select", [], "idempotency_key"),
        step("deletion_job_items", "insert", []),
        step("deletion_job_items", "select", [], "idempotency_key"),
        step("deletion_job_items", "insert", []),
        step("deletion_job_items", "select", [], "idempotency_key"),
        step("deletion_job_items", "insert", []),
        step("deletion_jobs", "update", []),
        step("deletion_jobs", "select", [inventoried]),
      ]);
      let generated = 0;
      const repository = createDatabaseDurableDeletionRepository({
        database: script.database,
        fingerprinter: () => requestFingerprint,
        generateItemId: () => {
          generated += 1;
          return `generated-item-${generated}`;
        },
      });

      await expect(
        repository.appendInventory({
          deletionJobId: jobId,
          expectedRowVersion: 9,
          inventoryComplete: true,
          items: [
            {
              credentialRef: " vault://credential-a ",
              idempotencyKey: "secret-a",
              kind: "secret_ref",
              maxAttempts: 3,
              ordinal: 1,
            },
            {
              cacheKey: " cache:tenant-a ",
              idempotencyKey: "cache-a",
              kind: "cache_key",
              maxAttempts: 3,
              ordinal: 2,
            },
            {
              idempotencyKey: "cascade-a",
              kind: "document_cascade",
              maxAttempts: 3,
              ordinal: 3,
              resourceId: " document-a ",
            },
            {
              idempotencyKey: "detach-a",
              kind: "document_detach",
              maxAttempts: 3,
              ordinal: 4,
              resourceId: " document-b ",
            },
          ],
          leaseToken,
          now: createdAt,
          scanPhase: "all-external-kinds",
        }),
      ).resolves.toMatchObject({ inventoryComplete: true, rowVersion: 10 });
      const itemInserts = script.calls.filter(
        (call) => call.operation === "insert" && call.tableName === "deletion_job_items",
      );
      expect(itemInserts).toHaveLength(4);
      expect(itemInserts.map((call) => call.params)).toEqual(
        expect.arrayContaining([
          expect.arrayContaining(["secret_ref", "vault://credential-a"]),
          expect.arrayContaining(["cache_key", "cache:tenant-a"]),
          expect.arrayContaining(["document_cascade", "document-a"]),
          expect.arrayContaining(["document_detach", "document-b"]),
        ]),
      );
      script.expectDone();
    });

    it("fails completion on unfinished work, target drift, residue, and terminal CAS losses", async () => {
      const fence = {
        deletionJobId: jobId,
        expectedRowVersion: 9,
        leaseToken,
        now: createdAt,
      };
      const finalJob = runningJobRow({ checkpoint: "deleting_primary_data" });
      const complete = (script: ReturnType<typeof scriptedDatabase>) =>
        repositoryFor(script.database, requestFingerprint).completeJob({
          ...fence,
          deleteAndProbePrimaryData: async () => ({ clean: true }),
        });

      const wrongCheckpoint = scriptedDatabase(dialect, [
        step(
          "deletion_jobs",
          "select",
          [runningJobRow({ checkpoint: "deleting_objects" })],
          "FOR UPDATE",
        ),
      ]);
      await expect(complete(wrongCheckpoint)).rejects.toThrow(
        "primary-data checkpoint has not been reached",
      );
      wrongCheckpoint.expectDone();

      const unfinished = scriptedDatabase(dialect, [
        step("deletion_jobs", "select", [finalJob], "FOR UPDATE"),
        step("deletion_job_items", "select", [{ id: "unfinished-item" }]),
      ]);
      await expect(complete(unfinished)).rejects.toThrow("unfinished items");
      unfinished.expectDone();

      const wrongTargetLink = scriptedDatabase(dialect, [
        step("deletion_jobs", "select", [finalJob], "FOR UPDATE"),
        step("deletion_job_items", "select", []),
        step("knowledge_spaces", "select", [{ deletion_job_id: "other-job" }], "FOR UPDATE"),
      ]);
      await expect(complete(wrongTargetLink)).rejects.toThrow("not linked to this job");
      wrongTargetLink.expectDone();

      const targetRemained = scriptedDatabase(dialect, [
        step("deletion_jobs", "select", [finalJob], "FOR UPDATE"),
        step("deletion_job_items", "select", []),
        step("knowledge_spaces", "select", [{ deletion_job_id: jobId }], "FOR UPDATE"),
        step("knowledge_spaces", "select", [{ deletion_job_id: jobId }]),
      ]);
      await expect(complete(targetRemained)).rejects.toThrow("still exists after delete");
      targetRemained.expectDone();

      const tombstoneLost = scriptedDatabase(dialect, [
        step("deletion_jobs", "select", [finalJob], "FOR UPDATE"),
        step("deletion_job_items", "select", []),
        step("knowledge_spaces", "select", [{ deletion_job_id: jobId }], "FOR UPDATE"),
        step("knowledge_spaces", "select", []),
        stepAffected("deletion_tombstones", "update", 0),
      ]);
      await expect(complete(tombstoneLost)).rejects.toThrow("tombstone completion fence was lost");
      tombstoneLost.expectDone();

      const outboxLost = scriptedDatabase(dialect, [
        step("deletion_jobs", "select", [finalJob], "FOR UPDATE"),
        step("deletion_job_items", "select", []),
        step("knowledge_spaces", "select", [{ deletion_job_id: jobId }], "FOR UPDATE"),
        step("knowledge_spaces", "select", []),
        step("deletion_tombstones", "update", []),
        stepAffected("deletion_outbox", "update", 0),
      ]);
      await expect(complete(outboxLost)).rejects.toThrow(
        "completion did not terminate exactly one outbox event",
      );
      outboxLost.expectDone();

      const jobLost = scriptedDatabase(dialect, [
        step("deletion_jobs", "select", [finalJob], "FOR UPDATE"),
        step("deletion_job_items", "select", []),
        step("knowledge_spaces", "select", [{ deletion_job_id: jobId }], "FOR UPDATE"),
        step("knowledge_spaces", "select", []),
        step("deletion_tombstones", "update", []),
        step("deletion_outbox", "update", []),
        stepAffected("deletion_jobs", "update", 0),
      ]);
      await expect(complete(jobLost)).rejects.toThrow("completion lease fence was lost");
      jobLost.expectDone();
    });

    it("rejects missing, unauthorized, or already-deleting source and document targets", async () => {
      type Mode =
        | "document-deleting"
        | "document-missing"
        | "logical-deleting"
        | "logical-missing"
        | "source-deleting"
        | "source-missing"
        | "source-scope";
      const attempt = (mode: Mode) => {
        const permissionSnapshotId = "permission-target-a";
        const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
          if (input.tableName === "deletion_jobs") return { rows: [], rowsAffected: 0 };
          if (input.tableName === "knowledge_spaces") {
            return {
              rows: [
                {
                  deletion_job_id: null,
                  lifecycle_state: "active",
                  name: "Target space",
                  revision: 2,
                },
              ],
              rowsAffected: 0,
            };
          }
          if (input.tableName === "knowledge_space_permission_snapshots") {
            return {
              rows: [
                {
                  ...permissionSnapshotRow(permissionSnapshotId),
                  permission_scopes: mode === "source-scope" ? ["other-scope"] : [],
                },
              ],
              rowsAffected: 0,
            };
          }
          if (
            [
              "knowledge_space_members",
              "knowledge_space_access_policies",
              "knowledge_space_api_access",
            ].includes(input.tableName)
          ) {
            return { rows: [{ id: `${input.tableName}-row` }], rowsAffected: 0 };
          }
          if (input.tableName === "sources") {
            if (mode === "source-missing") return { rows: [], rowsAffected: 0 };
            return {
              rows: [
                {
                  deletion_job_id: null,
                  permission_scope: mode === "source-scope" ? ["restricted-scope"] : [],
                  status: mode === "source-deleting" ? "deleting" : "idle",
                  version: 4,
                },
              ],
              rowsAffected: 0,
            };
          }
          if (input.tableName === "logical_documents") {
            if (mode === "logical-missing") return { rows: [], rowsAffected: 0 };
            return {
              rows: [
                {
                  active_revision: null,
                  row_version: 4,
                  source_id: null,
                  status: mode === "logical-deleting" ? "deleting" : "failed",
                },
              ],
              rowsAffected: 0,
            };
          }
          if (input.tableName === "document_assets") {
            if (mode === "document-missing") return { rows: [], rowsAffected: 0 };
            return {
              rows: [
                {
                  deletion_job_id: null,
                  lifecycle_state: mode === "document-deleting" ? "deleting" : "active",
                  metadata: {},
                  object_key: "tenant-a/raw.md",
                  row_version: 4,
                  source_id: null,
                  version: 4,
                },
              ],
              rowsAffected: 0,
            };
          }
          return { rows: [], rowsAffected: 0 };
        };
        const database = createSchemaDatabaseAdapter({
          executor: execute,
          kind: dialect,
          transaction: async (callback) => callback({ execute }),
        });
        const repository = repositoryFor(database, requestFingerprint);
        const common = {
          accessChannel: "interactive" as const,
          createdAt,
          idempotencyKey: `target-${mode}`,
          knowledgeSpaceId,
          permissionSnapshotId,
          permissionSnapshotRevision: 1,
          requestedBySubjectId: "user-a",
          tenantId,
        };
        if (mode.startsWith("source")) {
          return repository.requestSourceDeletion({
            ...common,
            deleteMode: "cascade",
            expectedVersion: 4,
            sourceId,
          });
        }
        if (mode.startsWith("logical")) {
          return repository.requestLogicalDocumentDeletion({
            ...common,
            documentId: logicalDocumentId,
            expectedDocumentRowVersion: 4,
          });
        }
        return repository.requestDocumentDeletion({
          ...common,
          documentAssetId: targetId,
          expectedDocumentVersion: 4,
        });
      };

      for (const [mode, errorName] of [
        ["source-missing", "DurableDeletionTargetRevisionConflictError"],
        ["source-scope", "DurableDeletionPermissionFenceError"],
        ["source-deleting", "DurableDeletionTargetConflictError"],
        ["logical-missing", "DurableDeletionTargetRevisionConflictError"],
        ["logical-deleting", "DurableDeletionTargetConflictError"],
        ["document-missing", "DurableDeletionTargetRevisionConflictError"],
        ["document-deleting", "DurableDeletionTargetConflictError"],
      ] as const) {
        await expect(attempt(mode)).rejects.toMatchObject({ name: errorName });
      }
    });

    it("heartbeats a matching worker and reads the exact job and tombstone", async () => {
      const running = runningJobRow();
      const heartbeatAt = "2026-07-14T12:00:30.000Z";
      const extended = {
        ...running,
        heartbeat_at: heartbeatAt,
        lease_expires_at: "2026-07-14T12:15:00.000Z",
        row_version: 10,
      };
      const heartbeatScript = scriptedDatabase(dialect, [
        step("deletion_jobs", "select", [running], "FOR UPDATE"),
        step("deletion_jobs", "update", []),
        step("deletion_jobs", "select", [extended]),
      ]);
      await expect(
        repositoryFor(heartbeatScript.database, requestFingerprint).heartbeatJob({
          deletionJobId: jobId,
          expectedRowVersion: 9,
          leaseExpiresAt: "2026-07-14T12:15:00.000Z",
          leaseToken,
          now: heartbeatAt,
          workerId: "worker-a",
        }),
      ).resolves.toMatchObject({ heartbeatAt, rowVersion: 10 });
      heartbeatScript.expectDone();

      const lookupScript = scriptedDatabase(dialect, [
        step("deletion_jobs", "select", [extended]),
        step("deletion_tombstones", "select", [tombstoneRow()]),
      ]);
      const repository = repositoryFor(lookupScript.database, requestFingerprint);
      await expect(repository.getJob({ id: jobId, tenantId })).resolves.toMatchObject({
        id: jobId,
      });
      await expect(
        repository.getTombstone({
          knowledgeSpaceId,
          targetId,
          targetType: "source",
          tenantId,
        }),
      ).resolves.toMatchObject({ deletionJobId: jobId, targetId });
      lookupScript.expectDone();
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

function stepAffected(
  tableName: string,
  operation: DatabaseExecuteInput["operation"],
  rowsAffected: number,
  rows: readonly DatabaseRow[] = [],
  contains?: string,
): ScriptStep {
  return {
    ...(contains ? { contains } : {}),
    operation,
    result: { rows, rowsAffected },
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

function capabilityJobRow(overrides: Partial<Record<string, unknown>> = {}): DatabaseRow {
  return jobRow({
    access_channel: null,
    capability_grant_id: capabilityGrantId,
    permission_snapshot_id: null,
    permission_snapshot_revision: null,
    requested_by_subject_id: null,
    ...overrides,
  });
}

function runningJobRow(overrides: Partial<Record<string, unknown>> = {}): DatabaseRow {
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
    ...overrides,
  });
}

function itemRow(overrides: Partial<Record<string, unknown>> = {}): DatabaseRow {
  return {
    attempts: 0,
    created_at: createdAt,
    deletion_job_id: jobId,
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f3203",
    idempotency_key: "object:raw",
    kind: "object",
    max_attempts: 3,
    object_key: "tenant-a/spaces/space-a/documents/raw.md",
    ordinal: 1,
    payload_digest: requestFingerprint,
    row_version: 1,
    status: "pending",
    updated_at: createdAt,
    ...overrides,
  };
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
