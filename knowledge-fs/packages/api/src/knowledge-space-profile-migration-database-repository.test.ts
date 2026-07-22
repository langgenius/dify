import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type { DatabaseExecuteInput, DatabaseExecuteResult } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { createDatabaseKnowledgeSpaceProfileMigrationRepository } from "./knowledge-space-profile-migration-database-repository";

const tenantId = "tenant-migration";
const spaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f4a01";
const runId = "018f0d60-7a49-7cc2-9c1b-5b36f18f4a02";
const outboxId = "018f0d60-7a49-7cc2-9c1b-5b36f18f4a03";
const permissionId = "018f0d60-7a49-7cc2-9c1b-5b36f18f4a04";
const freshPermissionId = "018f0d60-7a49-7cc2-9c1b-5b36f18f4a09";
const embeddingId = "018f0d60-7a49-7cc2-9c1b-5b36f18f4a05";
const retrievalId = "018f0d60-7a49-7cc2-9c1b-5b36f18f4a06";
const candidateId = "018f0d60-7a49-7cc2-9c1b-5b36f18f4a07";
const publicationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f4a08";
const digestA = "a".repeat(64);
const digestB = "b".repeat(64);
const fingerprint = `projection-set-sha256:${"c".repeat(64)}`;
const now = "2026-07-14T12:00:00.000Z";
const capabilityGrantId = "capability-profile-migration";

describe.each(["postgres", "tidb"] as const)(
  "database profile migration repository (%s)",
  (dialect) => {
    it("admits one exact frozen tuple and atomically inserts its outbox", async () => {
      const calls: DatabaseExecuteInput[] = [];
      let inserted = false;
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.tableName === "knowledge_spaces") {
          return {
            rows: [{ deletion_job_id: null, id: spaceId, lifecycle_state: "active" }],
            rowsAffected: 1,
          };
        }
        if (input.tableName === "deletion_jobs") return { rows: [], rowsAffected: 0 };
        if (input.tableName === "knowledge_space_permission_snapshots") {
          return { rows: [permissionRow(permissionId)], rowsAffected: 1 };
        }
        if (
          input.tableName === "knowledge_space_members" ||
          input.tableName === "knowledge_space_access_policies" ||
          input.tableName === "knowledge_space_api_access"
        ) {
          return { rows: [{ id: "permission-lock" }], rowsAffected: 1 };
        }
        if (input.tableName === "knowledge_space_profile_migration_runs") {
          if (input.operation === "insert") {
            inserted = true;
            return { rows: [], rowsAffected: 1 };
          }
          if (input.sql.includes("idempotency_key") || input.sql.includes("active_slot")) {
            return { rows: [], rowsAffected: 0 };
          }
          return inserted ? { rows: [runRow()], rowsAffected: 1 } : { rows: [], rowsAffected: 0 };
        }
        if (input.tableName === "knowledge_space_profile_revisions") {
          return { rows: [{ id: candidateId }], rowsAffected: 1 };
        }
        if (input.tableName === "projection_set_publication_heads") {
          return { rows: [{ id: publicationId }], rowsAffected: 1 };
        }
        if (input.tableName === "knowledge_space_profile_heads") {
          return { rows: [{ id: "head" }], rowsAffected: 1 };
        }
        if (input.tableName === "knowledge_space_profile_migration_outbox") {
          return { rows: [], rowsAffected: 1 };
        }
        throw new Error(`Unexpected SQL table=${input.tableName}`);
      };
      const database = createSchemaDatabaseAdapter({
        executor: execute,
        kind: dialect,
        transaction: async (callback) => callback({ execute }),
      });
      const repository = createDatabaseKnowledgeSpaceProfileMigrationRepository({
        database,
        generateOutboxId: () => outboxId,
        generateRunId: () => runId,
        maxClaimBatchSize: 10,
      });

      await expect(repository.start(startInput())).resolves.toMatchObject({
        candidateProfile: { id: candidateId, revision: 2, snapshotDigest: digestB },
        runState: "queued",
      });
      await expect(repository.start(startInput())).resolves.toMatchObject({
        id: runId,
        rowVersion: 1,
        runState: "queued",
      });
      await expect(
        repository.start({
          ...startInput(),
          candidateProfile: { id: candidateId, revision: 3, snapshotDigest: digestB },
        }),
      ).rejects.toMatchObject({ code: "PROFILE_MIGRATION_IDEMPOTENCY_CONFLICT" });
      const insert = calls.find(
        (call) =>
          call.tableName === "knowledge_space_profile_migration_runs" &&
          call.operation === "insert",
      );
      expect(insert?.params).toEqual(
        expect.arrayContaining([
          "embedding",
          candidateId,
          2,
          digestB,
          embeddingId,
          retrievalId,
          publicationId,
          fingerprint,
          permissionId,
          1,
        ]),
      );
      expect(insert?.sql).toContain(
        dialect === "postgres"
          ? '"candidate_profile_snapshot_digest"'
          : "`candidate_profile_snapshot_digest`",
      );
      expect(insert?.sql).toContain(
        dialect === "postgres" ? '"idempotency_digest"' : "`idempotency_digest`",
      );
      expect(
        insert?.params.some((value) => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)),
      ).toBe(true);
      expect(
        calls.some(
          (call) =>
            call.tableName === "knowledge_space_profile_migration_outbox" &&
            call.operation === "insert",
        ),
      ).toBe(true);
    });

    it("rejects malformed admissions and unsafe claim leases before database access", async () => {
      const execute = async (): Promise<DatabaseExecuteResult> => {
        throw new Error("database should not be called");
      };
      const database = createSchemaDatabaseAdapter({
        executor: execute,
        kind: dialect,
        transaction: async (callback) => callback({ execute }),
      });
      const repository = createDatabaseKnowledgeSpaceProfileMigrationRepository({
        database,
        maxClaimBatchSize: 2,
      });

      await expect(
        repository.start({ ...startInput(), rebuildScope: "clone-publication" }),
      ).rejects.toThrow("Embedding migration requires full-vector-space rebuild");
      await expect(
        repository.start({
          ...startInput(),
          changedKind: "retrieval",
          rebuildScope: "full-vector-space",
        }),
      ).rejects.toThrow("Retrieval migration rebuild scope is invalid");
      await expect(
        repository.start({ ...startInput(), permissionSnapshotId: undefined }),
      ).rejects.toThrow("Profile migration requires exactly one authorization binding");
      await expect(repository.start({ ...startInput(), accessChannel: undefined })).rejects.toThrow(
        "Profile migration requires exactly one authorization binding",
      );
      await expect(
        repository.start({
          ...startInput(),
          accessChannel: undefined,
          permissionSnapshotId: undefined,
        }),
      ).rejects.toThrow("Profile migration requires exactly one authorization binding");
      await expect(
        repository.start({
          ...startInput(),
          accessChannel: undefined,
          permissionSnapshotId: undefined,
          permissionSnapshotRevision: undefined,
        }),
      ).rejects.toThrow("Profile migration requires exactly one authorization binding");
      await expect(
        repository.start({
          ...startInput(),
          capabilityGrantId: "capability-migration",
        }),
      ).rejects.toThrow("Profile migration requires exactly one authorization binding");
      await expect(repository.start({ ...startInput(), maxExecutionAttempts: 0 })).rejects.toThrow(
        "maxExecutionAttempts must be positive",
      );
      await expect(
        repository.start({ ...startInput(), permissionSnapshotRevision: -1 }),
      ).rejects.toThrow("permissionSnapshotRevision must be positive");
      await expect(repository.start({ ...startInput(), createdAt: "not-a-date" })).rejects.toThrow(
        "Profile migration createdAt must be an ISO date-time",
      );
      await expect(
        repository.claim({
          leaseExpiresAt: "2026-07-14T12:10:00.000Z",
          limit: 0,
          now,
          workerId: "worker-a",
        }),
      ).rejects.toThrow("claim.limit must be positive");
      await expect(
        repository.claim({
          leaseExpiresAt: "2026-07-14T12:10:00.000Z",
          limit: 3,
          now,
          workerId: "worker-a",
        }),
      ).rejects.toThrow("Profile migration claim exceeds limit");
      await expect(
        repository.claim({
          leaseExpiresAt: now,
          limit: 1,
          now,
          workerId: "worker-a",
        }),
      ).rejects.toThrow("Profile migration lease must expire after now");
      await expect(
        repository.claim({
          leaseExpiresAt: "2026-07-14T12:10:00.000Z",
          limit: 1,
          now,
          workerId: "",
        }),
      ).rejects.toThrow("workerId must not be empty");
    });

    it("admits an embedding migration when no prior embedding head exists", async () => {
      let inserted = false;
      const withoutEmbedding = runRow({
        base_embedding_profile_revision: null,
        base_embedding_profile_revision_id: null,
        base_embedding_profile_snapshot_digest: null,
      });
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        if (input.tableName === "knowledge_spaces") {
          return {
            rows: [{ deletion_job_id: null, id: spaceId, lifecycle_state: "active" }],
            rowsAffected: 1,
          };
        }
        if (input.tableName === "deletion_jobs") return { rows: [], rowsAffected: 0 };
        if (input.tableName === "knowledge_space_permission_snapshots") {
          return { rows: [permissionRow(permissionId)], rowsAffected: 1 };
        }
        if (
          input.tableName === "knowledge_space_members" ||
          input.tableName === "knowledge_space_access_policies" ||
          input.tableName === "knowledge_space_api_access"
        ) {
          return { rows: [{ id: "permission-lock" }], rowsAffected: 1 };
        }
        if (input.tableName === "knowledge_space_profile_migration_runs") {
          if (input.operation === "insert") {
            inserted = true;
            return { rows: [], rowsAffected: 1 };
          }
          if (input.sql.includes("idempotency_digest") || input.sql.includes("active_slot")) {
            return { rows: [], rowsAffected: 0 };
          }
          return inserted
            ? { rows: [withoutEmbedding], rowsAffected: 1 }
            : { rows: [], rowsAffected: 0 };
        }
        if (input.tableName === "knowledge_space_profile_revisions") {
          return { rows: [{ id: candidateId }], rowsAffected: 1 };
        }
        if (input.tableName === "projection_set_publication_heads") {
          return { rows: [{ id: publicationId }], rowsAffected: 1 };
        }
        if (input.tableName === "knowledge_space_profile_heads") {
          return input.params[2] === "embedding"
            ? { rows: [], rowsAffected: 0 }
            : { rows: [{ id: "retrieval-head" }], rowsAffected: 1 };
        }
        if (input.tableName === "knowledge_space_profile_migration_outbox") {
          return { rows: [], rowsAffected: 1 };
        }
        throw new Error(`Unexpected SQL table=${input.tableName}`);
      };
      const database = createSchemaDatabaseAdapter({
        executor: execute,
        kind: dialect,
        transaction: async (callback) => callback({ execute }),
      });
      const repository = createDatabaseKnowledgeSpaceProfileMigrationRepository({
        database,
        generateOutboxId: () => outboxId,
        generateRunId: () => runId,
        maxClaimBatchSize: 10,
      });

      const admitted = await repository.start({
        ...startInput(),
        baseEmbeddingProfile: undefined,
      });
      expect(admitted).toMatchObject({ id: runId, runState: "queued" });
      expect("baseEmbeddingProfile" in admitted).toBe(false);
      await expect(
        repository.start({ ...startInput(), baseEmbeddingProfile: undefined }),
      ).resolves.toMatchObject({ id: runId, runState: "queued" });
    });

    it("fails closed when admission references drift under the deletion lock", async () => {
      let mode: "active-run" | "base-missing" | "candidate-missing" | "space-missing" =
        "space-missing";
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        if (input.tableName === "knowledge_spaces") {
          return mode === "space-missing"
            ? { rows: [], rowsAffected: 0 }
            : {
                rows: [{ deletion_job_id: null, id: spaceId, lifecycle_state: "active" }],
                rowsAffected: 1,
              };
        }
        if (input.tableName === "deletion_jobs") return { rows: [], rowsAffected: 0 };
        if (input.tableName === "knowledge_space_permission_snapshots") {
          return { rows: [permissionRow(permissionId)], rowsAffected: 1 };
        }
        if (
          input.tableName === "knowledge_space_members" ||
          input.tableName === "knowledge_space_access_policies" ||
          input.tableName === "knowledge_space_api_access"
        ) {
          return { rows: [{ id: "permission-lock" }], rowsAffected: 1 };
        }
        if (input.tableName === "knowledge_space_profile_migration_runs") {
          if (input.sql.includes("idempotency_digest")) return { rows: [], rowsAffected: 0 };
          return mode === "active-run"
            ? { rows: [{ id: "other-run" }], rowsAffected: 1 }
            : { rows: [], rowsAffected: 0 };
        }
        if (input.tableName === "knowledge_space_profile_revisions") {
          return mode === "candidate-missing"
            ? { rows: [], rowsAffected: 0 }
            : { rows: [{ id: candidateId }], rowsAffected: 1 };
        }
        if (input.tableName === "projection_set_publication_heads") {
          return mode === "base-missing"
            ? { rows: [], rowsAffected: 0 }
            : { rows: [{ id: publicationId }], rowsAffected: 1 };
        }
        throw new Error(`Unexpected SQL table=${input.tableName}`);
      };
      const database = createSchemaDatabaseAdapter({
        executor: execute,
        kind: dialect,
        transaction: async (callback) => callback({ execute }),
      });
      const repository = createDatabaseKnowledgeSpaceProfileMigrationRepository({
        database,
        maxClaimBatchSize: 10,
      });

      await expect(repository.start(startInput())).rejects.toMatchObject({
        code: "PROFILE_MIGRATION_SPACE_NOT_WRITABLE",
      });
      mode = "active-run";
      await expect(repository.start(startInput())).rejects.toMatchObject({
        code: "PROFILE_MIGRATION_ALREADY_ACTIVE",
      });
      mode = "candidate-missing";
      await expect(repository.start(startInput())).rejects.toMatchObject({
        code: "PROFILE_MIGRATION_CANDIDATE_INVALID",
      });
      mode = "base-missing";
      await expect(repository.start(startInput())).rejects.toMatchObject({
        code: "PROFILE_MIGRATION_BASE_PUBLICATION_CHANGED",
      });
    });

    it("rejects a digest collision after comparing the original idempotency tuple", async () => {
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        if (input.tableName === "knowledge_spaces") {
          return {
            rows: [{ deletion_job_id: null, id: spaceId, lifecycle_state: "active" }],
            rowsAffected: 1,
          };
        }
        if (input.tableName === "deletion_jobs") return { rows: [], rowsAffected: 0 };
        if (input.tableName === "knowledge_space_permission_snapshots") {
          return { rows: [permissionRow(permissionId)], rowsAffected: 1 };
        }
        if (
          input.tableName === "knowledge_space_members" ||
          input.tableName === "knowledge_space_access_policies" ||
          input.tableName === "knowledge_space_api_access"
        ) {
          return { rows: [{ id: "permission-lock" }], rowsAffected: 1 };
        }
        if (input.tableName === "knowledge_space_profile_migration_runs") {
          expect(input.sql).toContain(
            dialect === "postgres" ? '"idempotency_digest"' : "`idempotency_digest`",
          );
          return {
            rows: [runRow({ idempotency_key: "a-different-original-key" })],
            rowsAffected: 1,
          };
        }
        throw new Error(`Unexpected SQL table=${input.tableName}`);
      };
      const database = createSchemaDatabaseAdapter({
        executor: execute,
        kind: dialect,
        transaction: async (callback) => callback({ execute }),
      });
      const repository = createDatabaseKnowledgeSpaceProfileMigrationRepository({
        database,
        maxClaimBatchSize: 10,
      });

      await expect(repository.start(startInput())).rejects.toMatchObject({
        code: "PROFILE_MIGRATION_IDEMPOTENCY_CONFLICT",
      });
    });

    it("atomically binds a fresh exact owner permission snapshot when retrying", async () => {
      const calls: DatabaseExecuteInput[] = [];
      let current = runRow({
        completed_at: now,
        last_error_code: "PROFILE_MIGRATION_PERMISSION_INVALID",
        last_error_message: "permission expired",
        row_version: 4,
        run_state: "failed",
      });
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.tableName === "knowledge_spaces") {
          return {
            rows: [{ deletion_job_id: null, id: spaceId, lifecycle_state: "active" }],
            rowsAffected: 1,
          };
        }
        if (input.tableName === "deletion_jobs") return { rows: [], rowsAffected: 0 };
        if (
          input.tableName === "knowledge_space_members" ||
          input.tableName === "knowledge_space_access_policies" ||
          input.tableName === "knowledge_space_api_access"
        ) {
          return { rows: [{ id: "permission-lock" }], rowsAffected: 1 };
        }
        if (input.tableName === "knowledge_space_profile_migration_runs") {
          if (input.operation === "update") {
            current = {
              ...current,
              completed_at: null,
              last_error_code: null,
              last_error_message: null,
              permission_snapshot_id: String(input.params[0]),
              permission_snapshot_revision: Number(input.params[1]),
              row_version: Number(input.params[3]),
              run_state: "queued",
              updated_at: String(input.params[2]),
            };
            return { rows: [], rowsAffected: 1 };
          }
          if (input.sql.includes("active_slot") && input.sql.includes("<>")) {
            return { rows: [], rowsAffected: 0 };
          }
          return { rows: [current], rowsAffected: 1 };
        }
        if (input.tableName === "knowledge_space_profile_revisions") {
          return { rows: [{ id: candidateId }], rowsAffected: 1 };
        }
        if (input.tableName === "projection_set_publication_heads") {
          return { rows: [{ id: publicationId }], rowsAffected: 1 };
        }
        if (input.tableName === "knowledge_space_permission_snapshots") {
          return { rows: [permissionRow(freshPermissionId)], rowsAffected: 1 };
        }
        if (input.tableName === "knowledge_space_profile_migration_outbox") {
          return input.operation === "select"
            ? { rows: [{ revision: 1 }], rowsAffected: 1 }
            : { rows: [], rowsAffected: 1 };
        }
        throw new Error(`Unexpected SQL table=${input.tableName}`);
      };
      const database = createSchemaDatabaseAdapter({
        executor: execute,
        kind: dialect,
        transaction: async (callback) => callback({ execute }),
      });
      const repository = createDatabaseKnowledgeSpaceProfileMigrationRepository({
        database,
        generateOutboxId: () => outboxId,
        maxClaimBatchSize: 10,
      });

      await expect(
        repository.retry({
          expectedPermissionSnapshotId: permissionId,
          expectedPermissionSnapshotRevision: 1,
          now,
          permissionSnapshotId: freshPermissionId,
          permissionSnapshotRevision: 1,
          requestedBySubjectId: "owner-1",
          runId,
        }),
      ).resolves.toMatchObject({
        permissionSnapshotId: freshPermissionId,
        permissionSnapshotRevision: 1,
        runState: "queued",
      });
      const update = calls.find(
        (call) =>
          call.tableName === "knowledge_space_profile_migration_runs" &&
          call.operation === "update",
      );
      expect(update?.params.slice(0, 2)).toEqual([freshPermissionId, 1]);
      expect(update?.sql).toContain(
        dialect === "postgres" ? '"permission_snapshot_id"' : "`permission_snapshot_id`",
      );
    });

    it("fails cancellation closed when the fresh transaction permission is no longer owner", async () => {
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        if (input.tableName === "knowledge_space_profile_migration_runs") {
          return { rows: [runRow({ run_state: "running" })], rowsAffected: 1 };
        }
        if (input.tableName === "knowledge_spaces") {
          return {
            rows: [{ deletion_job_id: null, id: spaceId, lifecycle_state: "active" }],
            rowsAffected: 1,
          };
        }
        if (input.tableName === "deletion_jobs") return { rows: [], rowsAffected: 0 };
        if (input.tableName === "knowledge_space_permission_snapshots") {
          return { rows: [permissionRow(freshPermissionId, { role: "editor" })], rowsAffected: 1 };
        }
        if (
          input.tableName === "knowledge_space_members" ||
          input.tableName === "knowledge_space_access_policies" ||
          input.tableName === "knowledge_space_api_access"
        ) {
          return { rows: [{ id: "permission-lock" }], rowsAffected: 1 };
        }
        throw new Error(`Unexpected SQL table=${input.tableName}`);
      };
      const database = createSchemaDatabaseAdapter({
        executor: execute,
        kind: dialect,
        transaction: async (callback) => callback({ execute }),
      });
      const repository = createDatabaseKnowledgeSpaceProfileMigrationRepository({
        database,
        maxClaimBatchSize: 10,
      });

      await expect(
        repository.cancel({
          accessChannel: "interactive",
          now,
          permissionSnapshotId: freshPermissionId,
          permissionSnapshotRevision: 1,
          reason: "cancel",
          requestedBySubjectId: "owner-1",
          runId,
        }),
      ).rejects.toMatchObject({ code: "PROFILE_MIGRATION_PERMISSION_INVALID" });
    });

    it("fences the complete leased lifecycle through evaluation and success", async () => {
      const workerId = "migration-worker-a";
      const leaseToken = "migration-lease-a";
      const initialLeaseExpiry = "2026-07-14T12:10:00.000Z";
      const extendedLeaseExpiry = "2026-07-14T12:20:00.000Z";
      const candidateFingerprint = `projection-set-sha256:${"d".repeat(64)}`;
      const evaluationSummary = { passed: true, score: 0.98, ignored: { nested: true } };
      let current: Record<string, unknown> = runRow();
      const calls: DatabaseExecuteInput[] = [];
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.tableName === "knowledge_space_profile_migration_runs") {
          if (input.operation === "select" && input.sql.includes("INNER JOIN")) {
            return { rows: [current], rowsAffected: 1 };
          }
          if (input.operation === "select") return { rows: [current], rowsAffected: 1 };
          if (input.sql.includes("run_state") && input.sql.includes("'running'")) {
            current = {
              ...current,
              execution_attempts: Number(input.params[4]),
              heartbeat_at: String(input.params[3]),
              lease_expires_at: String(input.params[2]),
              lease_token: String(input.params[1]),
              row_version: Number(input.params[5]),
              run_state: "running",
              updated_at: String(input.params[3]),
              worker_id: String(input.params[0]),
            };
            return { rows: [], rowsAffected: 1 };
          }
          if (input.sql.includes("candidate_publication_id")) {
            current = {
              ...current,
              candidate_publication_fingerprint: input.params[2],
              candidate_publication_id: input.params[1],
              checkpoint: String(input.params[0]),
              evaluation_summary: input.params[3],
              row_version: Number(input.params[5]),
              updated_at: String(input.params[4]),
            };
            return { rows: [], rowsAffected: 1 };
          }
          if (input.sql.includes("active_slot")) {
            current = {
              ...current,
              canceled_at: input.params[5],
              checkpoint: String(input.params[1]),
              completed_at: String(input.params[4]),
              heartbeat_at: null,
              last_error_code: input.params[2],
              last_error_message: input.params[3],
              lease_expires_at: null,
              lease_token: null,
              row_version: Number(input.params[6]),
              run_state: String(input.params[0]),
              updated_at: String(input.params[4]),
              worker_id: null,
            };
            return { rows: [], rowsAffected: 1 };
          }
          current = {
            ...current,
            heartbeat_at: String(input.params[1]),
            lease_expires_at: String(input.params[0]),
            row_version: Number(input.params[2]),
            updated_at: String(input.params[1]),
          };
          return { rows: [], rowsAffected: 1 };
        }
        if (input.tableName === "knowledge_space_profile_migration_outbox") {
          return { rows: [], rowsAffected: 1 };
        }
        throw new Error(`Unexpected SQL table=${input.tableName}`);
      };
      const database = createSchemaDatabaseAdapter({
        executor: execute,
        kind: dialect,
        transaction: async (callback) => callback({ execute }),
      });
      const repository = createDatabaseKnowledgeSpaceProfileMigrationRepository({
        database,
        generateLeaseToken: () => leaseToken,
        maxClaimBatchSize: 10,
      });

      const [claimed] = await repository.claim({
        leaseExpiresAt: initialLeaseExpiry,
        limit: 1,
        now,
        workerId,
      });
      expect(claimed).toMatchObject({
        executionAttempts: 1,
        leaseToken,
        rowVersion: 2,
        runState: "running",
        workerId,
      });

      await expect(
        repository.heartbeat({
          expectedRowVersion: 2,
          leaseExpiresAt: extendedLeaseExpiry,
          leaseToken,
          now: "2026-07-14T12:01:00.000Z",
          runId,
          workerId,
        }),
      ).resolves.toMatchObject({ leaseExpiresAt: extendedLeaseExpiry, rowVersion: 3 });

      await expect(
        repository.checkpoint({
          candidatePublicationFingerprint: candidateFingerprint,
          candidatePublicationId: publicationId,
          checkpoint: "candidate-built",
          expectedRowVersion: 3,
          leaseToken,
          now: "2026-07-14T12:02:00.000Z",
          runId,
        }),
      ).resolves.toMatchObject({
        candidatePublicationFingerprint: candidateFingerprint,
        candidatePublicationId: publicationId,
        checkpoint: "candidate-built",
        rowVersion: 4,
      });

      await expect(
        repository.checkpoint({
          checkpoint: "evaluated",
          evaluationSummary,
          expectedRowVersion: 4,
          leaseToken,
          now: "2026-07-14T12:03:00.000Z",
          runId,
        }),
      ).resolves.toMatchObject({
        checkpoint: "evaluated",
        evaluationSummary: { passed: true, score: 0.98 },
        rowVersion: 5,
      });

      await expect(
        repository.succeed({
          expectedRowVersion: 5,
          leaseToken,
          now: "2026-07-14T12:04:00.000Z",
          runId,
        }),
      ).resolves.toMatchObject({
        checkpoint: "activated",
        completedAt: "2026-07-14T12:04:00.000Z",
        rowVersion: 6,
        runState: "succeeded",
      });
      expect(
        calls.some(
          (call) =>
            call.tableName === "knowledge_space_profile_migration_outbox" &&
            call.operation === "update" &&
            call.params[0] === "completed",
        ),
      ).toBe(true);
    });

    it("rejects checkpoint regressions and incomplete persisted evaluation state", async () => {
      const leaseToken = "migration-lease-validation";
      let current: Record<string, unknown> = runRow({
        checkpoint: "candidate-built",
        lease_expires_at: "2026-07-14T12:10:00.000Z",
        lease_token: leaseToken,
        row_version: 4,
        run_state: "running",
        worker_id: "worker-a",
      });
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        if (input.tableName === "knowledge_space_profile_migration_runs") {
          return { rows: [current], rowsAffected: 1 };
        }
        throw new Error(`Unexpected SQL table=${input.tableName}`);
      };
      const database = createSchemaDatabaseAdapter({
        executor: execute,
        kind: dialect,
        transaction: async (callback) => callback({ execute }),
      });
      const repository = createDatabaseKnowledgeSpaceProfileMigrationRepository({
        database,
        maxClaimBatchSize: 10,
      });
      const fence = { expectedRowVersion: 4, leaseToken, now, runId };

      await expect(repository.checkpoint({ ...fence, checkpoint: "queued" })).rejects.toMatchObject(
        {
          code: "PROFILE_MIGRATION_CHECKPOINT_CONFLICT",
        },
      );
      current = runRow({
        lease_expires_at: "2026-07-14T12:10:00.000Z",
        lease_token: leaseToken,
        row_version: 4,
        run_state: "running",
        worker_id: "worker-a",
      });
      await expect(
        repository.checkpoint({ ...fence, checkpoint: "candidate-built" }),
      ).rejects.toMatchObject({ code: "PROFILE_MIGRATION_CANDIDATE_PUBLICATION_REQUIRED" });
      await expect(
        repository.checkpoint({
          ...fence,
          candidatePublicationFingerprint: fingerprint,
          candidatePublicationId: publicationId,
          checkpoint: "queued",
        }),
      ).rejects.toMatchObject({ code: "PROFILE_MIGRATION_CHECKPOINT_CONFLICT" });
      await expect(
        repository.checkpoint({
          ...fence,
          candidatePublicationFingerprint: fingerprint,
          candidatePublicationId: publicationId,
          checkpoint: "candidate-built",
          evaluationSummary: { passed: true },
        }),
      ).rejects.toMatchObject({ code: "PROFILE_MIGRATION_CHECKPOINT_CONFLICT" });
      await expect(
        repository.checkpoint({
          ...fence,
          candidatePublicationFingerprint: fingerprint,
          candidatePublicationId: publicationId,
          checkpoint: "evaluated",
        }),
      ).rejects.toMatchObject({ code: "PROFILE_MIGRATION_EVALUATION_REQUIRED" });
    });

    it("terminally closes an exhausted queued run without leasing it", async () => {
      let current: Record<string, unknown> = runRow({
        execution_attempts: 3,
        max_execution_attempts: 3,
      });
      const calls: DatabaseExecuteInput[] = [];
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.tableName === "knowledge_space_profile_migration_runs") {
          if (input.operation === "select" && input.sql.includes("INNER JOIN")) {
            return { rows: [current], rowsAffected: 1 };
          }
          if (input.operation === "update") {
            current = {
              ...current,
              checkpoint: String(input.params[1]),
              completed_at: String(input.params[4]),
              last_error_code: input.params[2],
              last_error_message: input.params[3],
              row_version: Number(input.params[6]),
              run_state: String(input.params[0]),
              updated_at: String(input.params[4]),
            };
            return { rows: [], rowsAffected: 1 };
          }
          return { rows: [current], rowsAffected: 1 };
        }
        if (
          input.tableName === "knowledge_space_profile_revisions" ||
          input.tableName === "knowledge_space_profile_publication_bindings" ||
          input.tableName === "projection_set_publications" ||
          input.tableName === "knowledge_space_profile_migration_outbox"
        ) {
          return { rows: [], rowsAffected: 1 };
        }
        throw new Error(`Unexpected SQL table=${input.tableName}`);
      };
      const database = createSchemaDatabaseAdapter({
        executor: execute,
        kind: dialect,
        transaction: async (callback) => callback({ execute }),
      });
      const repository = createDatabaseKnowledgeSpaceProfileMigrationRepository({
        database,
        maxClaimBatchSize: 10,
      });

      await expect(
        repository.claim({
          leaseExpiresAt: "2026-07-14T12:10:00.000Z",
          limit: 1,
          now,
          workerId: "worker-a",
        }),
      ).resolves.toEqual([]);
      await expect(repository.get(runId)).resolves.toMatchObject({
        lastErrorCode: "PROFILE_MIGRATION_ATTEMPTS_EXHAUSTED",
        rowVersion: 2,
        runState: "failed",
      });
      expect(
        calls.some(
          (call) =>
            call.tableName === "knowledge_space_profile_migration_runs" &&
            call.operation === "update" &&
            call.params[0] === "failed",
        ),
      ).toBe(true);
    });

    it("cancels an authorized active run and clears its candidate publication", async () => {
      let current: Record<string, unknown> = runRow({ run_state: "running" });
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        if (input.tableName === "knowledge_space_profile_migration_runs") {
          if (input.operation === "update") {
            current = {
              ...current,
              canceled_at: String(input.params[5]),
              checkpoint: String(input.params[1]),
              completed_at: String(input.params[4]),
              last_error_code: input.params[2],
              last_error_message: input.params[3],
              row_version: Number(input.params[6]),
              run_state: String(input.params[0]),
              updated_at: String(input.params[4]),
            };
            return { rows: [], rowsAffected: 1 };
          }
          return { rows: [current], rowsAffected: 1 };
        }
        if (input.tableName === "knowledge_spaces") {
          return {
            rows: [{ deletion_job_id: null, id: spaceId, lifecycle_state: "active" }],
            rowsAffected: 1,
          };
        }
        if (input.tableName === "deletion_jobs") return { rows: [], rowsAffected: 0 };
        if (input.tableName === "knowledge_space_permission_snapshots") {
          return { rows: [permissionRow(permissionId)], rowsAffected: 1 };
        }
        if (
          input.tableName === "knowledge_space_members" ||
          input.tableName === "knowledge_space_access_policies" ||
          input.tableName === "knowledge_space_api_access"
        ) {
          return { rows: [{ id: "permission-lock" }], rowsAffected: 1 };
        }
        if (
          input.tableName === "knowledge_space_profile_revisions" ||
          input.tableName === "knowledge_space_profile_publication_bindings" ||
          input.tableName === "projection_set_publications" ||
          input.tableName === "knowledge_space_profile_migration_outbox"
        ) {
          return { rows: [], rowsAffected: 1 };
        }
        throw new Error(`Unexpected SQL table=${input.tableName}`);
      };
      const database = createSchemaDatabaseAdapter({
        executor: execute,
        kind: dialect,
        transaction: async (callback) => callback({ execute }),
      });
      const repository = createDatabaseKnowledgeSpaceProfileMigrationRepository({
        database,
        maxClaimBatchSize: 10,
      });

      await expect(
        repository.cancel({
          accessChannel: "interactive",
          now,
          permissionSnapshotId: permissionId,
          permissionSnapshotRevision: 1,
          reason: "operator canceled migration",
          requestedBySubjectId: "owner-1",
          runId,
        }),
      ).resolves.toMatchObject({
        canceledAt: now,
        lastErrorCode: "PROFILE_MIGRATION_CANCELED",
        rowVersion: 2,
        runState: "canceled",
      });
    });

    it("terminally fails the candidate and removes its unactivated publication binding", async () => {
      const lease = "lease-terminal";
      let current: Record<string, unknown> = runRow({
        candidate_publication_fingerprint: fingerprint,
        candidate_publication_id: publicationId,
        checkpoint: "candidate-built",
        execution_attempts: 1,
        heartbeat_at: now,
        lease_expires_at: "2026-07-14T12:10:00.000Z",
        lease_token: lease,
        row_version: 4,
        run_state: "running",
        worker_id: "worker-a",
      });
      const calls: DatabaseExecuteInput[] = [];
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.tableName === "knowledge_space_profile_migration_runs") {
          if (input.operation === "update") {
            current = {
              ...current,
              checkpoint: String(input.params[1]),
              completed_at: String(input.params[4]),
              heartbeat_at: null,
              last_error_code: String(input.params[2]),
              last_error_message: String(input.params[3]),
              lease_expires_at: null,
              lease_token: null,
              row_version: Number(input.params[6]),
              run_state: String(input.params[0]),
              updated_at: String(input.params[4]),
              worker_id: null,
            };
            return { rows: [], rowsAffected: 1 };
          }
          return { rows: [current], rowsAffected: 1 };
        }
        if (
          input.tableName === "knowledge_space_profile_revisions" ||
          input.tableName === "projection_set_publications" ||
          input.tableName === "knowledge_space_profile_migration_outbox"
        ) {
          return { rows: [], rowsAffected: 1 };
        }
        if (input.tableName === "knowledge_space_profile_publication_bindings") {
          return { rows: [], rowsAffected: 1 };
        }
        throw new Error(`Unexpected SQL table=${input.tableName}`);
      };
      const database = createSchemaDatabaseAdapter({
        executor: execute,
        kind: dialect,
        transaction: async (callback) => callback({ execute }),
      });
      const repository = createDatabaseKnowledgeSpaceProfileMigrationRepository({
        database,
        maxClaimBatchSize: 10,
      });

      await expect(
        repository.fail({
          errorCode: "PROFILE_MIGRATION_EVALUATION_FAILED",
          errorMessage: "candidate did not pass evaluation",
          expectedRowVersion: 4,
          leaseToken: lease,
          now,
          runId,
          terminal: true,
        }),
      ).resolves.toMatchObject({
        lastErrorCode: "PROFILE_MIGRATION_EVALUATION_FAILED",
        runState: "failed",
      });

      const candidateFailure = calls.find(
        (call) =>
          call.tableName === "knowledge_space_profile_revisions" && call.operation === "update",
      );
      expect(candidateFailure?.sql).toContain("'failed'");
      expect(candidateFailure?.params).toEqual(
        expect.arrayContaining(["PROFILE_MIGRATION_EVALUATION_FAILED", candidateId, 2, digestB]),
      );
      expect(
        calls.some(
          (call) =>
            call.tableName === "knowledge_space_profile_publication_bindings" &&
            call.operation === "delete" &&
            call.params.includes(publicationId),
        ),
      ).toBe(true);
      expect(
        calls.some(
          (call) =>
            call.tableName === "projection_set_publications" &&
            call.operation === "update" &&
            call.params.includes(publicationId),
        ),
      ).toBe(true);
    });

    it("admits and replays a capability-bound request without legacy authorization fields", async () => {
      let inserted = false;
      const durableRow = capabilityRunRow();
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        if (input.tableName === "knowledge_spaces") {
          return {
            rows: [{ deletion_job_id: null, id: spaceId, lifecycle_state: "active" }],
            rowsAffected: 1,
          };
        }
        if (input.tableName === "deletion_jobs") return { rows: [], rowsAffected: 0 };
        if (input.tableName === "capability_grants") {
          return { rows: [{ grant_id: capabilityGrantId }], rowsAffected: 1 };
        }
        if (input.tableName === "knowledge_space_profile_migration_runs") {
          if (input.operation === "insert") {
            inserted = true;
            return { rows: [], rowsAffected: 1 };
          }
          if (input.params[0] === "missing-run") return { rows: [], rowsAffected: 0 };
          if (input.sql.includes("idempotency_digest")) {
            return inserted
              ? { rows: [durableRow], rowsAffected: 1 }
              : { rows: [], rowsAffected: 0 };
          }
          if (input.sql.includes("active_slot")) return { rows: [], rowsAffected: 0 };
          return inserted ? { rows: [durableRow], rowsAffected: 1 } : { rows: [], rowsAffected: 0 };
        }
        if (input.tableName === "knowledge_space_profile_revisions") {
          return { rows: [{ id: candidateId }], rowsAffected: 1 };
        }
        if (input.tableName === "projection_set_publication_heads") {
          return { rows: [{ id: publicationId }], rowsAffected: 1 };
        }
        if (input.tableName === "knowledge_space_profile_heads") {
          return { rows: [{ id: "profile-head" }], rowsAffected: 1 };
        }
        if (input.tableName === "knowledge_space_profile_migration_outbox") {
          return { rows: [], rowsAffected: 1 };
        }
        throw new Error(`Unexpected SQL table=${input.tableName}`);
      };
      const repository = createTestRepository(dialect, execute, {
        generateOutboxId: () => outboxId,
        generateRunId: () => runId,
      });

      await expect(repository.start(capabilityStartInput())).resolves.toMatchObject({
        capabilityGrantId,
        id: runId,
      });
      await expect(repository.start(capabilityStartInput())).resolves.toMatchObject({
        capabilityGrantId,
        id: runId,
      });
      await expect(
        repository.findByRequest({
          capabilityGrantId,
          idempotencyKey: "settings-embedding-request",
          knowledgeSpaceId: spaceId,
          tenantId,
        }),
      ).resolves.toMatchObject({ capabilityGrantId, id: runId });
      await expect(repository.get("missing-run")).resolves.toBeNull();

      const fencedRepository = createTestRepository(dialect, async (input) => {
        if (input.tableName === "knowledge_spaces") {
          return {
            rows: [{ deletion_job_id: null, id: spaceId, lifecycle_state: "active" }],
            rowsAffected: 1,
          };
        }
        if (input.tableName === "deletion_jobs" || input.tableName === "capability_grants") {
          return { rows: [], rowsAffected: 0 };
        }
        throw new Error(`Unexpected SQL table=${input.tableName}`);
      });
      await expect(fencedRepository.start(capabilityStartInput())).rejects.toMatchObject({
        code: "PROFILE_MIGRATION_PERMISSION_INVALID",
      });

      const storageFailure = new Error("permission storage unavailable");
      const storageFailureRepository = createTestRepository(dialect, async (input) => {
        if (input.tableName === "knowledge_spaces") {
          return {
            rows: [{ deletion_job_id: null, id: spaceId, lifecycle_state: "active" }],
            rowsAffected: 1,
          };
        }
        if (input.tableName === "deletion_jobs") return { rows: [], rowsAffected: 0 };
        throw storageFailure;
      });
      await expect(storageFailureRepository.start(startInput())).rejects.toBe(storageFailure);
    });

    it("fences claim replay and every claim-side CAS loss", async () => {
      type Scenario =
        | "capability-fenced"
        | "capability-valid"
        | "empty-lease"
        | "outbox-lost"
        | "run-disappeared"
        | "run-lost";
      let scenario: Scenario = "run-lost";
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        if (
          input.tableName === "knowledge_space_profile_migration_runs" &&
          input.operation === "select" &&
          input.sql.includes("INNER JOIN")
        ) {
          const row = scenario.startsWith("capability") ? capabilityRunRow() : runRow();
          return { rows: [row], rowsAffected: 1 };
        }
        if (input.tableName === "capability_grants") {
          return scenario === "capability-fenced"
            ? { rows: [], rowsAffected: 0 }
            : { rows: [{ grant_id: capabilityGrantId }], rowsAffected: 1 };
        }
        if (
          input.tableName === "knowledge_space_profile_migration_runs" &&
          input.operation === "update"
        ) {
          return scenario === "run-lost" || scenario === "capability-valid"
            ? { rows: [], rowsAffected: 0 }
            : { rows: [], rowsAffected: 1 };
        }
        if (input.tableName === "knowledge_space_profile_migration_outbox") {
          return scenario === "outbox-lost"
            ? { rows: [], rowsAffected: 0 }
            : { rows: [], rowsAffected: 1 };
        }
        if (input.tableName === "knowledge_space_profile_migration_runs") {
          return scenario === "run-disappeared"
            ? { rows: [], rowsAffected: 0 }
            : { rows: [runRow()], rowsAffected: 1 };
        }
        throw new Error(`Unexpected SQL table=${input.tableName}`);
      };
      const repository = createTestRepository(dialect, execute, {
        generateLeaseToken: () => (scenario === "empty-lease" ? " " : "claim-lease"),
      });
      const claim = () =>
        repository.claim({
          leaseExpiresAt: "2026-07-14T12:10:00.000Z",
          limit: 1,
          now,
          workerId: "worker-a",
        });

      scenario = "empty-lease";
      await expect(claim()).rejects.toThrow("leaseToken must not be empty");
      scenario = "run-lost";
      await expect(claim()).resolves.toEqual([]);
      scenario = "outbox-lost";
      await expect(claim()).rejects.toThrow("Profile migration outbox claim lost");
      scenario = "run-disappeared";
      await expect(claim()).rejects.toThrow("Profile migration run disappeared");
      scenario = "capability-valid";
      await expect(claim()).resolves.toEqual([]);
      scenario = "capability-fenced";
      await expect(claim()).rejects.toMatchObject({ code: "PROFILE_MIGRATION_PERMISSION_INVALID" });
    });

    it("returns null for stale lease fences and fails closed on write CAS loss", async () => {
      type Scenario =
        | "expired"
        | "fail-sanitized"
        | "missing"
        | "terminal-lost"
        | "update-lost"
        | "wrong-worker";
      let scenario: Scenario = "missing";
      let current: Record<string, unknown> = runRow();
      const runningRow = (overrides: Record<string, unknown> = {}) =>
        runRow({
          lease_expires_at: "2026-07-14T13:00:00.000Z",
          lease_token: "lease-fence",
          run_state: "running",
          worker_id: "worker-a",
          ...overrides,
        });
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        if (
          input.tableName === "knowledge_space_profile_migration_runs" &&
          input.operation === "select"
        ) {
          return scenario === "missing"
            ? { rows: [], rowsAffected: 0 }
            : { rows: [current], rowsAffected: 1 };
        }
        if (
          input.tableName === "knowledge_space_profile_migration_runs" &&
          input.operation === "update"
        ) {
          if (scenario === "update-lost" || scenario === "terminal-lost") {
            return { rows: [], rowsAffected: 0 };
          }
          if (scenario === "fail-sanitized") {
            current = {
              ...current,
              checkpoint: input.params[1],
              completed_at: input.params[4],
              last_error_code: input.params[2],
              last_error_message: input.params[3],
              row_version: input.params[6],
              run_state: input.params[0],
              updated_at: input.params[4],
            };
          }
          return { rows: [], rowsAffected: 1 };
        }
        if (input.tableName === "knowledge_space_profile_migration_outbox") {
          return { rows: [], rowsAffected: 1 };
        }
        throw new Error(`Unexpected SQL table=${input.tableName}`);
      };
      const repository = createTestRepository(dialect, execute);
      const fence = {
        expectedRowVersion: 1,
        leaseToken: "lease-fence",
        now,
        runId,
      };

      scenario = "missing";
      await expect(
        repository.heartbeat({
          ...fence,
          leaseExpiresAt: "2026-07-14T14:00:00.000Z",
          workerId: "worker-a",
        }),
      ).resolves.toBeNull();
      await expect(repository.checkpoint({ ...fence, checkpoint: "queued" })).resolves.toBeNull();
      await expect(
        repository.fail({
          ...fence,
          errorCode: "retryable",
          errorMessage: "temporary",
          terminal: false,
        }),
      ).resolves.toBeNull();
      await expect(repository.succeed(fence)).resolves.toBeNull();

      scenario = "expired";
      current = runningRow({ lease_expires_at: now });
      await expect(
        repository.heartbeat({
          ...fence,
          leaseExpiresAt: "2026-07-14T14:00:00.000Z",
          workerId: "worker-a",
        }),
      ).resolves.toBeNull();

      scenario = "wrong-worker";
      current = runningRow();
      await expect(
        repository.heartbeat({
          ...fence,
          leaseExpiresAt: "2026-07-14T14:00:00.000Z",
          workerId: "worker-b",
        }),
      ).resolves.toBeNull();

      scenario = "update-lost";
      current = runningRow();
      await expect(
        repository.heartbeat({
          ...fence,
          leaseExpiresAt: "2026-07-14T14:00:00.000Z",
          workerId: "worker-a",
        }),
      ).resolves.toBeNull();
      await expect(repository.checkpoint({ ...fence, checkpoint: "queued" })).resolves.toBeNull();
      current = runningRow({ checkpoint: "candidate-built" });
      await expect(repository.succeed(fence)).resolves.toBeNull();

      scenario = "terminal-lost";
      current = runningRow();
      await expect(
        repository.fail({
          ...fence,
          errorCode: "retryable",
          errorMessage: "temporary",
          terminal: false,
        }),
      ).rejects.toThrow("Profile migration terminal transition lost fence");

      scenario = "fail-sanitized";
      current = runningRow();
      await expect(
        repository.fail({
          ...fence,
          errorCode: " \n\t ",
          errorMessage: " \r\n ",
          terminal: false,
        }),
      ).resolves.toMatchObject({
        lastErrorCode: "Profile migration failed",
        lastErrorMessage: "Profile migration failed",
        runState: "failed",
      });

      expect(() => createTestRepository(dialect, execute, { maxClaimBatchSize: 0 })).toThrow(
        "maxClaimBatchSize must be positive",
      );
    });

    it("short-circuits cancel safely across missing, terminal, and capability-bound runs", async () => {
      type Scenario =
        | "capability-terminal"
        | "current-missing"
        | "incomplete-authorization"
        | "snapshot-missing"
        | "space-fenced"
        | "terminal";
      let scenario: Scenario = "snapshot-missing";
      let runReads = 0;
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        if (input.tableName === "knowledge_space_profile_migration_runs") {
          runReads += 1;
          if (scenario === "snapshot-missing") return { rows: [], rowsAffected: 0 };
          if (scenario === "current-missing" && runReads > 1) {
            return { rows: [], rowsAffected: 0 };
          }
          if (scenario === "capability-terminal") {
            return {
              rows: [capabilityRunRow({ canceled_at: now, run_state: "canceled" })],
              rowsAffected: 1,
            };
          }
          return {
            rows: [runRow({ run_state: scenario === "terminal" ? "succeeded" : "running" })],
            rowsAffected: 1,
          };
        }
        if (input.tableName === "knowledge_spaces") {
          return scenario === "space-fenced"
            ? { rows: [], rowsAffected: 0 }
            : {
                rows: [{ deletion_job_id: null, id: spaceId, lifecycle_state: "active" }],
                rowsAffected: 1,
              };
        }
        if (input.tableName === "deletion_jobs") return { rows: [], rowsAffected: 0 };
        if (input.tableName === "capability_grants") {
          return { rows: [{ grant_id: capabilityGrantId }], rowsAffected: 1 };
        }
        if (input.tableName === "knowledge_space_permission_snapshots") {
          return { rows: [permissionRow(permissionId)], rowsAffected: 1 };
        }
        if (
          input.tableName === "knowledge_space_members" ||
          input.tableName === "knowledge_space_access_policies" ||
          input.tableName === "knowledge_space_api_access"
        ) {
          return { rows: [{ id: "permission-lock" }], rowsAffected: 1 };
        }
        throw new Error(`Unexpected SQL table=${input.tableName}`);
      };
      const repository = createTestRepository(dialect, execute);
      const legacyCancel = {
        accessChannel: "interactive" as const,
        now,
        permissionSnapshotId: permissionId,
        permissionSnapshotRevision: 1,
        reason: "cancel migration",
        requestedBySubjectId: "owner-1",
        runId,
      };

      scenario = "snapshot-missing";
      runReads = 0;
      await expect(repository.cancel(legacyCancel)).resolves.toBeNull();
      scenario = "space-fenced";
      runReads = 0;
      await expect(repository.cancel(legacyCancel)).rejects.toMatchObject({
        code: "PROFILE_MIGRATION_SPACE_NOT_WRITABLE",
      });
      scenario = "current-missing";
      runReads = 0;
      await expect(repository.cancel(legacyCancel)).resolves.toBeNull();
      scenario = "terminal";
      runReads = 0;
      await expect(repository.cancel(legacyCancel)).resolves.toMatchObject({
        runState: "succeeded",
      });
      scenario = "capability-terminal";
      runReads = 0;
      await expect(
        repository.cancel({ capabilityGrantId, now, reason: "cancel migration", runId }),
      ).resolves.toMatchObject({ capabilityGrantId, runState: "canceled" });
      scenario = "incomplete-authorization";
      runReads = 0;
      await expect(repository.cancel({ now, reason: "cancel migration", runId })).rejects.toThrow(
        "Profile migration authorization binding is incomplete",
      );
    });

    it("fences retry replay, authorization mode, terminal errors, and retry CAS", async () => {
      type Scenario =
        | "active"
        | "capability-mismatch"
        | "capability-success"
        | "current-missing"
        | "legacy-incomplete"
        | "mode-change"
        | "not-failed"
        | "permission-mismatch"
        | "snapshot-missing"
        | "space-fenced"
        | "terminal"
        | "update-lost";
      let scenario: Scenario = "snapshot-missing";
      let runReads = 0;
      let current: Record<string, unknown> = runRow();
      const failedRow = (overrides: Record<string, unknown> = {}) =>
        runRow({
          completed_at: now,
          last_error_code: "PROFILE_MIGRATION_PERMISSION_INVALID",
          last_error_message: "permission expired",
          row_version: 4,
          run_state: "failed",
          ...overrides,
        });
      const reset = (
        next: Scenario,
        overrides: Record<string, unknown> = {},
        capability = false,
      ) => {
        scenario = next;
        runReads = 0;
        current = capability
          ? capabilityRunRow({
              completed_at: now,
              last_error_code: "PROFILE_MIGRATION_PERMISSION_INVALID",
              last_error_message: "capability revoked",
              row_version: 4,
              run_state: "failed",
              ...overrides,
            })
          : failedRow(overrides);
      };
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        if (input.tableName === "knowledge_space_profile_migration_runs") {
          if (input.sql.includes("active_slot") && input.sql.includes("<>")) {
            return scenario === "active"
              ? { rows: [{ id: "another-active-run" }], rowsAffected: 1 }
              : { rows: [], rowsAffected: 0 };
          }
          if (input.operation === "update") {
            if (scenario === "update-lost") return { rows: [], rowsAffected: 0 };
            if (current.capability_grant_id) {
              current = {
                ...current,
                completed_at: null,
                row_version: input.params[2],
                run_state: "queued",
                updated_at: input.params[1],
              };
            } else {
              current = {
                ...current,
                completed_at: null,
                permission_snapshot_id: input.params[0],
                permission_snapshot_revision: input.params[1],
                row_version: input.params[3],
                run_state: "queued",
                updated_at: input.params[2],
              };
            }
            return { rows: [], rowsAffected: 1 };
          }
          runReads += 1;
          if (scenario === "snapshot-missing") return { rows: [], rowsAffected: 0 };
          if (scenario === "current-missing" && runReads > 1) {
            return { rows: [], rowsAffected: 0 };
          }
          return { rows: [current], rowsAffected: 1 };
        }
        if (input.tableName === "knowledge_spaces") {
          return scenario === "space-fenced"
            ? { rows: [], rowsAffected: 0 }
            : {
                rows: [{ deletion_job_id: null, id: spaceId, lifecycle_state: "active" }],
                rowsAffected: 1,
              };
        }
        if (input.tableName === "deletion_jobs") return { rows: [], rowsAffected: 0 };
        if (input.tableName === "knowledge_space_profile_revisions") {
          return { rows: [{ id: candidateId }], rowsAffected: 1 };
        }
        if (input.tableName === "projection_set_publication_heads") {
          return { rows: [{ id: publicationId }], rowsAffected: 1 };
        }
        if (input.tableName === "capability_grants") {
          return { rows: [{ grant_id: capabilityGrantId }], rowsAffected: 1 };
        }
        if (input.tableName === "knowledge_space_permission_snapshots") {
          return { rows: [permissionRow(freshPermissionId)], rowsAffected: 1 };
        }
        if (
          input.tableName === "knowledge_space_members" ||
          input.tableName === "knowledge_space_access_policies" ||
          input.tableName === "knowledge_space_api_access"
        ) {
          return { rows: [{ id: "permission-lock" }], rowsAffected: 1 };
        }
        if (input.tableName === "knowledge_space_profile_migration_outbox") {
          return input.operation === "select"
            ? { rows: [], rowsAffected: 0 }
            : { rows: [], rowsAffected: 1 };
        }
        throw new Error(`Unexpected SQL table=${input.tableName}`);
      };
      const repository = createTestRepository(dialect, execute, {
        generateOutboxId: () => outboxId,
      });
      const legacyRetry = {
        expectedPermissionSnapshotId: permissionId,
        expectedPermissionSnapshotRevision: 1,
        now,
        permissionSnapshotId: freshPermissionId,
        permissionSnapshotRevision: 1,
        requestedBySubjectId: "owner-1",
        runId,
      };

      reset("snapshot-missing");
      await expect(repository.retry(legacyRetry)).resolves.toBeNull();
      reset("space-fenced");
      await expect(repository.retry(legacyRetry)).rejects.toMatchObject({
        code: "PROFILE_MIGRATION_SPACE_NOT_WRITABLE",
      });
      reset("current-missing");
      await expect(repository.retry(legacyRetry)).resolves.toBeNull();
      reset("permission-mismatch");
      await expect(
        repository.retry({ ...legacyRetry, expectedPermissionSnapshotId: "stale-snapshot" }),
      ).rejects.toMatchObject({ code: "PROFILE_MIGRATION_PERMISSION_SNAPSHOT_CONFLICT" });
      reset("not-failed", { run_state: "queued" });
      await expect(repository.retry(legacyRetry)).rejects.toMatchObject({
        code: "PROFILE_MIGRATION_NOT_RETRYABLE",
      });
      reset("terminal", { last_error_code: "PROFILE_MIGRATION_EVALUATION_FAILED" });
      await expect(repository.retry(legacyRetry)).rejects.toMatchObject({
        code: "PROFILE_MIGRATION_NOT_RETRYABLE",
      });
      reset("active");
      await expect(repository.retry(legacyRetry)).rejects.toMatchObject({
        code: "PROFILE_MIGRATION_ALREADY_ACTIVE",
      });
      reset("legacy-incomplete", {
        permission_snapshot_id: null,
        permission_snapshot_revision: null,
      });
      await expect(
        repository.retry({
          ...legacyRetry,
          expectedPermissionSnapshotId: undefined,
          expectedPermissionSnapshotRevision: undefined,
        }),
      ).rejects.toThrow("Profile migration legacy retry authorization binding is incomplete");
      reset("mode-change");
      await expect(repository.retry({ ...legacyRetry, capabilityGrantId })).rejects.toMatchObject({
        code: "PROFILE_MIGRATION_PERMISSION_SNAPSHOT_CONFLICT",
      });
      reset("update-lost");
      await expect(repository.retry(legacyRetry)).resolves.toBeNull();
      reset("capability-mismatch", {}, true);
      await expect(
        repository.retry({
          capabilityGrantId,
          expectedCapabilityGrantId: "stale-capability-grant",
          now,
          runId,
        }),
      ).rejects.toMatchObject({ code: "PROFILE_MIGRATION_PERMISSION_SNAPSHOT_CONFLICT" });
      reset("capability-success", {}, true);
      await expect(
        repository.retry({
          capabilityGrantId,
          expectedCapabilityGrantId: capabilityGrantId,
          now,
          runId,
        }),
      ).resolves.toMatchObject({
        capabilityGrantId,
        rowVersion: 5,
        runState: "queued",
      });
    });

    it("rejects drifted profile heads and malformed durable run rows", async () => {
      type Scenario = "bad-json" | "bad-number" | "base-profile-missing" | "embedding-appeared";
      let scenario: Scenario = "base-profile-missing";
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        if (input.tableName === "knowledge_spaces") {
          return {
            rows: [{ deletion_job_id: null, id: spaceId, lifecycle_state: "active" }],
            rowsAffected: 1,
          };
        }
        if (input.tableName === "deletion_jobs") return { rows: [], rowsAffected: 0 };
        if (input.tableName === "knowledge_space_permission_snapshots") {
          return { rows: [permissionRow(permissionId)], rowsAffected: 1 };
        }
        if (
          input.tableName === "knowledge_space_members" ||
          input.tableName === "knowledge_space_access_policies" ||
          input.tableName === "knowledge_space_api_access"
        ) {
          return { rows: [{ id: "permission-lock" }], rowsAffected: 1 };
        }
        if (input.tableName === "knowledge_space_profile_migration_runs") {
          if (scenario === "bad-json") {
            return { rows: [runRow({ evaluation_summary: "not-json" })], rowsAffected: 1 };
          }
          if (scenario === "bad-number") {
            return { rows: [runRow({ row_version: "not-a-number" })], rowsAffected: 1 };
          }
          return { rows: [], rowsAffected: 0 };
        }
        if (input.tableName === "knowledge_space_profile_revisions") {
          return { rows: [{ id: candidateId }], rowsAffected: 1 };
        }
        if (input.tableName === "projection_set_publication_heads") {
          return { rows: [{ id: publicationId }], rowsAffected: 1 };
        }
        if (input.tableName === "knowledge_space_profile_heads") {
          if (scenario === "base-profile-missing") return { rows: [], rowsAffected: 0 };
          return input.sql.includes("INNER JOIN")
            ? { rows: [{ id: retrievalId }], rowsAffected: 1 }
            : { rows: [{ id: "unexpected-embedding-head" }], rowsAffected: 1 };
        }
        throw new Error(`Unexpected SQL table=${input.tableName}`);
      };
      const repository = createTestRepository(dialect, execute);

      scenario = "base-profile-missing";
      await expect(repository.start(startInput())).rejects.toMatchObject({
        code: "PROFILE_MIGRATION_BASE_PROFILE_CHANGED",
      });
      scenario = "embedding-appeared";
      await expect(
        repository.start({ ...startInput(), baseEmbeddingProfile: undefined }),
      ).rejects.toMatchObject({ code: "PROFILE_MIGRATION_BASE_PROFILE_CHANGED" });
      scenario = "bad-json";
      await expect(repository.get(runId)).rejects.toThrow();
      scenario = "bad-number";
      await expect(repository.get(runId)).rejects.toThrow();
    });
  },
);

function startInput() {
  return {
    accessChannel: "interactive" as const,
    baseEmbeddingProfile: { id: embeddingId, revision: 1, snapshotDigest: digestA },
    basePublication: { fingerprint, headRevision: 9, id: publicationId },
    baseRetrievalProfile: { id: retrievalId, revision: 1, snapshotDigest: digestA },
    candidateProfile: { id: candidateId, revision: 2, snapshotDigest: digestB },
    changedKind: "embedding" as const,
    createdAt: now,
    idempotencyKey: "settings-embedding-request",
    knowledgeSpaceId: spaceId,
    maxExecutionAttempts: 3,
    permissionSnapshotId: permissionId,
    permissionSnapshotRevision: 1,
    rebuildScope: "full-vector-space" as const,
    requestedBySubjectId: "owner-1",
    tenantId,
  };
}

function runRow(overrides: Record<string, unknown> = {}) {
  return {
    access_channel: "interactive",
    base_embedding_profile_revision: 1,
    base_embedding_profile_revision_id: embeddingId,
    base_embedding_profile_snapshot_digest: digestA,
    base_publication_fingerprint: fingerprint,
    base_publication_head_revision: 9,
    base_publication_id: publicationId,
    base_retrieval_profile_revision: 1,
    base_retrieval_profile_revision_id: retrievalId,
    base_retrieval_profile_snapshot_digest: digestA,
    canceled_at: null,
    candidate_profile_revision: 2,
    candidate_profile_revision_id: candidateId,
    candidate_profile_snapshot_digest: digestB,
    candidate_publication_fingerprint: null,
    candidate_publication_id: null,
    changed_kind: "embedding",
    checkpoint: "queued",
    completed_at: null,
    created_at: now,
    evaluation_summary: null,
    execution_attempts: 0,
    heartbeat_at: null,
    id: runId,
    idempotency_key: "settings-embedding-request",
    knowledge_space_id: spaceId,
    last_error_code: null,
    last_error_message: null,
    lease_expires_at: null,
    lease_token: null,
    max_execution_attempts: 3,
    permission_snapshot_id: permissionId,
    permission_snapshot_revision: 1,
    rebuild_scope: "full-vector-space",
    requested_by_subject_id: "owner-1",
    row_version: 1,
    run_state: "queued",
    tenant_id: tenantId,
    updated_at: now,
    worker_id: null,
    ...overrides,
  };
}

function permissionRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    access_channel: "interactive",
    access_policy_revision: 1,
    api_access_revision: 1,
    api_key_expires_at: null,
    api_key_id: null,
    api_key_revision: null,
    created_at: now,
    expires_at: "2026-07-14T13:00:00.000Z",
    id,
    knowledge_space_id: spaceId,
    member_revision: 1,
    permission_scopes: JSON.stringify([]),
    revision: 1,
    revoked_at: null,
    role: "owner",
    status: "active",
    subject_id: "owner-1",
    tenant_id: tenantId,
    updated_at: now,
    visibility: "only_me",
    ...overrides,
  };
}

interface TestRepositoryOverrides {
  readonly generateLeaseToken?: (() => string) | undefined;
  readonly generateOutboxId?: (() => string) | undefined;
  readonly generateRunId?: (() => string) | undefined;
  readonly maxClaimBatchSize?: number | undefined;
}

function createTestRepository(
  dialect: "postgres" | "tidb",
  execute: (input: DatabaseExecuteInput) => Promise<DatabaseExecuteResult>,
  overrides: TestRepositoryOverrides = {},
) {
  const database = createSchemaDatabaseAdapter({
    executor: execute,
    kind: dialect,
    transaction: async (callback) => callback({ execute }),
  });
  return createDatabaseKnowledgeSpaceProfileMigrationRepository({
    database,
    ...(overrides.generateLeaseToken ? { generateLeaseToken: overrides.generateLeaseToken } : {}),
    ...(overrides.generateOutboxId ? { generateOutboxId: overrides.generateOutboxId } : {}),
    ...(overrides.generateRunId ? { generateRunId: overrides.generateRunId } : {}),
    maxClaimBatchSize: overrides.maxClaimBatchSize ?? 10,
  });
}

function capabilityStartInput() {
  return {
    baseEmbeddingProfile: { id: embeddingId, revision: 1, snapshotDigest: digestA },
    basePublication: { fingerprint, headRevision: 9, id: publicationId },
    baseRetrievalProfile: { id: retrievalId, revision: 1, snapshotDigest: digestA },
    candidateProfile: { id: candidateId, revision: 2, snapshotDigest: digestB },
    capabilityGrantId,
    changedKind: "embedding" as const,
    createdAt: now,
    idempotencyKey: "settings-embedding-request",
    knowledgeSpaceId: spaceId,
    maxExecutionAttempts: 3,
    rebuildScope: "full-vector-space" as const,
    tenantId,
  };
}

function capabilityRunRow(overrides: Record<string, unknown> = {}) {
  return runRow({
    access_channel: null,
    capability_grant_id: capabilityGrantId,
    permission_snapshot_id: null,
    permission_snapshot_revision: null,
    requested_by_subject_id: null,
    ...overrides,
  });
}
