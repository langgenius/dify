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
