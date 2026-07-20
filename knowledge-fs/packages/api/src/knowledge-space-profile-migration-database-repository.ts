import { createHash, randomUUID } from "node:crypto";

import type {
  DatabaseAdapter,
  DatabaseExecutor,
  DatabaseQueryValue,
  DatabaseRow,
} from "@knowledge/core";

import { deterministicChildId } from "./api-shared-utils";
import {
  numberColumn,
  optionalNumberColumn,
  optionalStringColumn,
  stringColumn,
} from "./database-row-utils";
import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";
import { jsonObjectColumn } from "./json-utils";
import {
  type DatabaseKnowledgeSpacePermissionFence,
  KnowledgeSpaceAccessError,
  assertDatabaseKnowledgeSpacePermissionFence,
} from "./knowledge-space-access-control";
import { lockKnowledgeSpaceForDeletionAdmission } from "./knowledge-space-deletion-admission";
import {
  KnowledgeSpaceProfileMigrationConflictError,
  type KnowledgeSpaceProfileMigrationFence,
  type KnowledgeSpaceProfileMigrationProfileReference,
  type KnowledgeSpaceProfileMigrationRepository,
  type KnowledgeSpaceProfileMigrationRun,
  type StartKnowledgeSpaceProfileMigrationInput,
  isTerminalKnowledgeSpaceProfileMigrationError,
} from "./knowledge-space-profile-migration";

const runTable = "knowledge_space_profile_migration_runs";
const outboxTable = "knowledge_space_profile_migration_outbox";
const revisionTable = "knowledge_space_profile_revisions";
const profileHeadTable = "knowledge_space_profile_heads";
const publicationTable = "projection_set_publications";
const publicationHeadTable = "projection_set_publication_heads";

export interface DatabaseKnowledgeSpaceProfileMigrationRepositoryOptions {
  readonly database: DatabaseAdapter;
  readonly generateLeaseToken?: (() => string) | undefined;
  readonly generateOutboxId?: (() => string) | undefined;
  readonly generateRunId?: (() => string) | undefined;
  readonly maxClaimBatchSize: number;
}

/**
 * SQL implementation of the run/outbox ledger. Start freezes and proves every candidate/base
 * reference under the same knowledge-space deletion lock. Claim, checkpoint, and terminal writes
 * all carry both lease-token and row-version fences.
 */
export function createDatabaseKnowledgeSpaceProfileMigrationRepository({
  database,
  generateLeaseToken = randomUUID,
  generateOutboxId = randomUUID,
  generateRunId = randomUUID,
  maxClaimBatchSize,
}: DatabaseKnowledgeSpaceProfileMigrationRepositoryOptions): KnowledgeSpaceProfileMigrationRepository {
  positiveInteger(maxClaimBatchSize, "maxClaimBatchSize");

  return {
    start: async (input) =>
      database.transaction(async (tx) => {
        validateStart(input);
        if (!(await lockKnowledgeSpaceForDeletionAdmission(database, tx, input))) {
          throw conflict(
            "PROFILE_MIGRATION_SPACE_NOT_WRITABLE",
            "Knowledge space is missing, deleting, or deletion-fenced",
          );
        }
        await requireProfileMigrationPermissionFence(database, tx, input, input.createdAt);
        const existing = await getByIdempotency(database, tx, input, true);
        if (existing) {
          if (!sameStart(existing, input)) {
            throw conflict(
              "PROFILE_MIGRATION_IDEMPOTENCY_CONFLICT",
              "Idempotency key was already used for a different profile migration",
            );
          }
          return existing;
        }
        const active = await tx.execute({
          maxRows: 1,
          operation: "select",
          params: [input.tenantId, input.knowledgeSpaceId],
          sql: `SELECT ${q(database, "id")} FROM ${q(database, runTable)} WHERE ${q(
            database,
            "tenant_id",
          )} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(
            database,
            2,
          )} AND ${q(database, "active_slot")} = 1 LIMIT 1 FOR UPDATE;`,
          tableName: runTable,
        });
        if (active.rows.length > 0) {
          throw conflict(
            "PROFILE_MIGRATION_ALREADY_ACTIVE",
            "Another profile migration is already active for this knowledge space",
          );
        }
        await requireCandidate(database, tx, input);
        await requireBasePublication(database, tx, input);
        await requireBaseProfile(database, tx, input, "retrieval", input.baseRetrievalProfile);
        if (input.baseEmbeddingProfile) {
          await requireBaseProfile(database, tx, input, "embedding", input.baseEmbeddingProfile);
        } else {
          await requireNoProfileHead(database, tx, input, "embedding");
        }

        const id = nonempty(generateRunId(), "runId");
        const columns = [
          "id",
          "tenant_id",
          "knowledge_space_id",
          "changed_kind",
          "rebuild_scope",
          "candidate_profile_kind",
          "candidate_profile_revision_id",
          "candidate_profile_revision",
          "candidate_profile_snapshot_digest",
          "base_embedding_profile_kind",
          "base_embedding_profile_revision_id",
          "base_embedding_profile_revision",
          "base_embedding_profile_snapshot_digest",
          "base_retrieval_profile_kind",
          "base_retrieval_profile_revision_id",
          "base_retrieval_profile_revision",
          "base_retrieval_profile_snapshot_digest",
          "base_publication_id",
          "base_publication_fingerprint",
          "base_publication_head_revision",
          "candidate_publication_id",
          "candidate_publication_fingerprint",
          "permission_snapshot_id",
          "permission_snapshot_revision",
          "requested_by_subject_id",
          "access_channel",
          "idempotency_key",
          "idempotency_digest",
          "run_state",
          "active_slot",
          "checkpoint",
          "evaluation_summary",
          "execution_attempts",
          "max_execution_attempts",
          "worker_id",
          "lease_token",
          "lease_expires_at",
          "heartbeat_at",
          "row_version",
          "last_error_code",
          "last_error_message",
          "created_at",
          "updated_at",
          "completed_at",
          "canceled_at",
        ] as const;
        const params: readonly DatabaseQueryValue[] = [
          id,
          input.tenantId,
          input.knowledgeSpaceId,
          input.changedKind,
          input.rebuildScope,
          input.changedKind,
          input.candidateProfile.id,
          input.candidateProfile.revision,
          input.candidateProfile.snapshotDigest,
          input.baseEmbeddingProfile ? "embedding" : null,
          input.baseEmbeddingProfile?.id ?? null,
          input.baseEmbeddingProfile?.revision ?? null,
          input.baseEmbeddingProfile?.snapshotDigest ?? null,
          "retrieval",
          input.baseRetrievalProfile.id,
          input.baseRetrievalProfile.revision,
          input.baseRetrievalProfile.snapshotDigest,
          input.basePublication.id,
          input.basePublication.fingerprint,
          input.basePublication.headRevision,
          null,
          null,
          input.permissionSnapshotId,
          input.permissionSnapshotRevision,
          input.requestedBySubjectId,
          input.accessChannel,
          input.idempotencyKey,
          profileMigrationIdempotencyDigest(input),
          "queued",
          1,
          "queued",
          null,
          0,
          input.maxExecutionAttempts,
          null,
          null,
          null,
          null,
          1,
          null,
          null,
          input.createdAt,
          input.createdAt,
          null,
          null,
        ];
        await tx.execute({
          maxRows: 0,
          operation: "insert",
          params,
          sql: `INSERT INTO ${q(database, runTable)} (${columns
            .map((column) => q(database, column))
            .join(", ")}) VALUES (${columns
            .map((column, index) =>
              column === "evaluation_summary"
                ? jsonPlaceholder(database, index + 1)
                : p(database, index + 1),
            )
            .join(", ")});`,
          tableName: runTable,
        });
        await insertOutbox(database, tx, {
          availableAt: input.createdAt,
          deliveryRevision: 1,
          id: nonempty(generateOutboxId(), "outboxId"),
          runId: id,
        });
        return requiredRun(await getById(database, tx, id, false));
      }),

    get: (id) => getById(database, database, id, false),
    findByRequest: (input) => getByIdempotency(database, database, input, false),

    claim: async (input) => {
      positiveInteger(input.limit, "claim.limit");
      if (input.limit > maxClaimBatchSize) throw new Error("Profile migration claim exceeds limit");
      if (Date.parse(input.leaseExpiresAt) <= Date.parse(input.now)) {
        throw new Error("Profile migration lease must expire after now");
      }
      nonempty(input.workerId, "workerId");
      return database.transaction(async (tx) => {
        const result = await tx.execute({
          maxRows: input.limit,
          operation: "select",
          params: [input.now, input.now, input.limit],
          sql: `SELECT run.* FROM ${q(database, runTable)} run INNER JOIN ${q(
            database,
            outboxTable,
          )} outbox ON outbox.${q(database, "run_id")} = run.${q(
            database,
            "id",
          )} WHERE (run.${q(database, "run_state")} = 'queued' OR (run.${q(
            database,
            "run_state",
          )} = 'running' AND run.${q(database, "lease_expires_at")} <= ${p(
            database,
            1,
          )})) AND (outbox.${q(database, "status")} = 'pending' OR (outbox.${q(
            database,
            "status",
          )} = 'leased' AND outbox.${q(database, "locked_until")} <= ${p(
            database,
            2,
          )})) ORDER BY run.${q(database, "updated_at")} ASC, run.${q(
            database,
            "id",
          )} ASC LIMIT ${p(database, 3)} FOR UPDATE${
            database.dialect === "postgres" ? " SKIP LOCKED" : ""
          };`,
          tableName: runTable,
        });
        const claimed: KnowledgeSpaceProfileMigrationRun[] = [];
        for (const row of result.rows) {
          const current = mapRun(row);
          if (current.executionAttempts >= current.maxExecutionAttempts) {
            await failMigrationCandidate(
              database,
              tx,
              current,
              input.now,
              "PROFILE_MIGRATION_ATTEMPTS_EXHAUSTED",
              "Profile migration exhausted its execution-attempt budget",
            );
            await deactivateCanceledCandidatePublication(database, tx, current, input.now);
            await terminalUpdate(database, tx, current, {
              errorCode: "PROFILE_MIGRATION_ATTEMPTS_EXHAUSTED",
              errorMessage: "Profile migration exhausted its execution-attempt budget",
              now: input.now,
              state: "failed",
            });
            await completeOutbox(database, tx, current.id, "completed", input.now);
            continue;
          }
          const leaseToken = nonempty(generateLeaseToken(), "leaseToken");
          const updated = await tx.execute({
            maxRows: 0,
            operation: "update",
            params: [
              input.workerId,
              leaseToken,
              input.leaseExpiresAt,
              input.now,
              current.executionAttempts + 1,
              current.rowVersion + 1,
              current.id,
              current.rowVersion,
            ],
            sql: `UPDATE ${q(database, runTable)} SET ${q(
              database,
              "run_state",
            )} = 'running', ${q(database, "worker_id")} = ${p(database, 1)}, ${q(
              database,
              "lease_token",
            )} = ${p(database, 2)}, ${q(database, "lease_expires_at")} = ${p(
              database,
              3,
            )}, ${q(database, "heartbeat_at")} = ${p(database, 4)}, ${q(
              database,
              "execution_attempts",
            )} = ${p(database, 5)}, ${q(database, "row_version")} = ${p(
              database,
              6,
            )}, ${q(database, "updated_at")} = ${p(database, 4)} WHERE ${q(
              database,
              "id",
            )} = ${p(database, 7)} AND ${q(database, "row_version")} = ${p(database, 8)};`,
            tableName: runTable,
          });
          if (updated.rowsAffected !== 1) continue;
          const outbox = await tx.execute({
            maxRows: 0,
            operation: "update",
            params: [input.workerId, leaseToken, input.leaseExpiresAt, input.now, current.id],
            sql: `UPDATE ${q(database, outboxTable)} SET ${q(
              database,
              "status",
            )} = 'leased', ${q(database, "locked_by")} = ${p(database, 1)}, ${q(
              database,
              "lock_token",
            )} = ${p(database, 2)}, ${q(database, "locked_until")} = ${p(
              database,
              3,
            )}, ${q(database, "updated_at")} = ${p(database, 4)} WHERE ${q(
              database,
              "run_id",
            )} = ${p(database, 5)} AND ${q(database, "status")} IN ('pending', 'leased');`,
            tableName: outboxTable,
          });
          if (outbox.rowsAffected !== 1) throw new Error("Profile migration outbox claim lost");
          claimed.push(requiredRun(await getById(database, tx, current.id, false)));
        }
        return claimed;
      });
    },

    heartbeat: async (input) =>
      database.transaction(async (tx) => {
        const current = await getFenced(database, tx, input);
        if (!current || current.workerId !== input.workerId) return null;
        const updated = await tx.execute({
          maxRows: 0,
          operation: "update",
          params: [
            input.leaseExpiresAt,
            input.now,
            current.rowVersion + 1,
            current.id,
            current.rowVersion,
            input.leaseToken,
          ],
          sql: `UPDATE ${q(database, runTable)} SET ${q(
            database,
            "lease_expires_at",
          )} = ${p(database, 1)}, ${q(database, "heartbeat_at")} = ${p(
            database,
            2,
          )}, ${q(database, "updated_at")} = ${p(database, 2)}, ${q(
            database,
            "row_version",
          )} = ${p(database, 3)} WHERE ${q(database, "id")} = ${p(
            database,
            4,
          )} AND ${q(database, "row_version")} = ${p(database, 5)} AND ${q(
            database,
            "lease_token",
          )} = ${p(database, 6)};`,
          tableName: runTable,
        });
        if (updated.rowsAffected !== 1) return null;
        await tx.execute({
          maxRows: 0,
          operation: "update",
          params: [input.leaseExpiresAt, input.now, current.id, input.leaseToken],
          sql: `UPDATE ${q(database, outboxTable)} SET ${q(
            database,
            "locked_until",
          )} = ${p(database, 1)}, ${q(database, "updated_at")} = ${p(
            database,
            2,
          )} WHERE ${q(database, "run_id")} = ${p(database, 3)} AND ${q(
            database,
            "lock_token",
          )} = ${p(database, 4)} AND ${q(database, "status")} = 'leased';`,
          tableName: outboxTable,
        });
        return getById(database, tx, current.id, false);
      }),

    checkpoint: async (input) =>
      database.transaction(async (tx) => {
        const current = await getFenced(database, tx, input);
        if (!current) return null;
        if (checkpointOrder(input.checkpoint) < checkpointOrder(current.checkpoint)) {
          throw conflict(
            "PROFILE_MIGRATION_CHECKPOINT_CONFLICT",
            "Profile migration checkpoint cannot move backwards",
          );
        }
        const publicationId = input.candidatePublicationId ?? current.candidatePublicationId;
        const fingerprint =
          input.candidatePublicationFingerprint ?? current.candidatePublicationFingerprint;
        const evaluationSummary = input.evaluationSummary
          ? sanitizeSummary(input.evaluationSummary)
          : current.evaluationSummary;
        if (input.checkpoint !== "queued" && (!publicationId || !fingerprint)) {
          throw conflict(
            "PROFILE_MIGRATION_CANDIDATE_PUBLICATION_REQUIRED",
            "Candidate publication identity is required",
          );
        }
        if (input.checkpoint === "queued" && (publicationId || fingerprint || evaluationSummary)) {
          throw conflict(
            "PROFILE_MIGRATION_CHECKPOINT_CONFLICT",
            "Queued checkpoint cannot carry candidate publication or evaluation state",
          );
        }
        if (input.checkpoint === "candidate-built" && evaluationSummary) {
          throw conflict(
            "PROFILE_MIGRATION_CHECKPOINT_CONFLICT",
            "Candidate-built checkpoint cannot carry an evaluation summary",
          );
        }
        if (input.checkpoint === "evaluated" && !evaluationSummary) {
          throw conflict(
            "PROFILE_MIGRATION_EVALUATION_REQUIRED",
            "Evaluated checkpoint requires a persisted evaluation summary",
          );
        }
        const updated = await tx.execute({
          maxRows: 0,
          operation: "update",
          params: [
            input.checkpoint,
            publicationId ?? null,
            fingerprint ?? null,
            evaluationSummary ? JSON.stringify(evaluationSummary) : null,
            input.now,
            current.rowVersion + 1,
            current.id,
            current.rowVersion,
            input.leaseToken,
          ],
          sql: `UPDATE ${q(database, runTable)} SET ${q(
            database,
            "checkpoint",
          )} = ${p(database, 1)}, ${q(database, "candidate_publication_id")} = ${p(
            database,
            2,
          )}, ${q(database, "candidate_publication_fingerprint")} = ${p(
            database,
            3,
          )}, ${q(database, "evaluation_summary")} = ${jsonPlaceholder(
            database,
            4,
          )}, ${q(database, "updated_at")} = ${p(database, 5)}, ${q(
            database,
            "row_version",
          )} = ${p(database, 6)} WHERE ${q(database, "id")} = ${p(
            database,
            7,
          )} AND ${q(database, "row_version")} = ${p(database, 8)} AND ${q(
            database,
            "lease_token",
          )} = ${p(database, 9)};`,
          tableName: runTable,
        });
        return updated.rowsAffected === 1 ? getById(database, tx, current.id, false) : null;
      }),

    fail: async (input) =>
      database.transaction(async (tx) => {
        const current = await getFenced(database, tx, input);
        if (!current) return null;
        if (input.terminal) {
          await failMigrationCandidate(
            database,
            tx,
            current,
            input.now,
            input.errorCode,
            input.errorMessage,
          );
          await deactivateCanceledCandidatePublication(database, tx, current, input.now);
        }
        const failed = await terminalUpdate(database, tx, current, {
          errorCode: safeText(input.errorCode, 64),
          errorMessage: safeText(input.errorMessage, 2_000),
          now: input.now,
          state: "failed",
        });
        await completeOutbox(database, tx, current.id, "completed", input.now);
        return failed;
      }),

    succeed: async (input) =>
      database.transaction(async (tx) => {
        const current = await getFenced(database, tx, input);
        if (!current || current.checkpoint !== "evaluated") return null;
        const succeeded = await terminalUpdate(database, tx, current, {
          now: input.now,
          state: "succeeded",
        });
        await completeOutbox(database, tx, current.id, "completed", input.now);
        return succeeded;
      }),

    cancel: async (input) =>
      database.transaction(async (tx) => {
        const snapshot = await getById(database, tx, input.runId, false);
        if (!snapshot) return null;
        if (!(await lockKnowledgeSpaceForDeletionAdmission(database, tx, snapshot))) {
          throw conflict(
            "PROFILE_MIGRATION_SPACE_NOT_WRITABLE",
            "Knowledge space is missing, deleting, or deletion-fenced",
          );
        }
        await requireProfileMigrationPermissionFence(
          database,
          tx,
          {
            accessChannel: input.accessChannel,
            knowledgeSpaceId: snapshot.knowledgeSpaceId,
            permissionSnapshotId: input.permissionSnapshotId,
            permissionSnapshotRevision: input.permissionSnapshotRevision,
            requestedBySubjectId: input.requestedBySubjectId,
            tenantId: snapshot.tenantId,
          },
          input.now,
        );
        const current = await getById(database, tx, input.runId, true);
        if (!current) return null;
        if (current.runState === "succeeded" || current.runState === "canceled") return current;
        await failMigrationCandidate(
          database,
          tx,
          current,
          input.now,
          "PROFILE_MIGRATION_CANCELED",
          input.reason,
        );
        await deactivateCanceledCandidatePublication(database, tx, current, input.now);
        const canceled = await terminalUpdate(database, tx, current, {
          errorCode: "PROFILE_MIGRATION_CANCELED",
          errorMessage: safeText(input.reason, 2_000),
          now: input.now,
          state: "canceled",
        });
        await completeOutbox(database, tx, current.id, "canceled", input.now);
        return canceled;
      }),

    retry: async (input) =>
      database.transaction(async (tx) => {
        const snapshot = await getById(database, tx, input.runId, false);
        if (!snapshot) return null;
        if (!(await lockKnowledgeSpaceForDeletionAdmission(database, tx, snapshot))) {
          throw conflict(
            "PROFILE_MIGRATION_SPACE_NOT_WRITABLE",
            "Knowledge space is missing, deleting, or deletion-fenced",
          );
        }
        const current = await getById(database, tx, input.runId, true);
        if (!current || current.requestedBySubjectId !== input.requestedBySubjectId) return null;
        if (
          current.permissionSnapshotId !== input.expectedPermissionSnapshotId ||
          current.permissionSnapshotRevision !== input.expectedPermissionSnapshotRevision
        ) {
          throw conflict(
            "PROFILE_MIGRATION_PERMISSION_SNAPSHOT_CONFLICT",
            "Profile migration permission snapshot changed before retry",
          );
        }
        if (current.runState !== "failed") {
          throw conflict("PROFILE_MIGRATION_NOT_RETRYABLE", "Only failed migration can be retried");
        }
        if (isTerminalKnowledgeSpaceProfileMigrationError(current.lastErrorCode)) {
          throw conflict(
            "PROFILE_MIGRATION_NOT_RETRYABLE",
            "Terminal profile migration failures cannot be retried",
          );
        }
        const active = await tx.execute({
          maxRows: 1,
          operation: "select",
          params: [current.tenantId, current.knowledgeSpaceId, current.id],
          sql: `SELECT ${q(database, "id")} FROM ${q(database, runTable)} WHERE ${q(
            database,
            "tenant_id",
          )} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(
            database,
            2,
          )} AND ${q(database, "active_slot")} = 1 AND ${q(database, "id")} <> ${p(
            database,
            3,
          )} LIMIT 1 FOR UPDATE;`,
          tableName: runTable,
        });
        if (active.rows.length > 0) {
          throw conflict(
            "PROFILE_MIGRATION_ALREADY_ACTIVE",
            "Another profile migration is already active for this knowledge space",
          );
        }
        await requireCandidate(database, tx, current);
        await requireBasePublication(database, tx, current);
        await requireProfileMigrationPermissionFence(
          database,
          tx,
          {
            accessChannel: current.accessChannel,
            knowledgeSpaceId: current.knowledgeSpaceId,
            permissionSnapshotId: input.permissionSnapshotId,
            permissionSnapshotRevision: input.permissionSnapshotRevision,
            requestedBySubjectId: current.requestedBySubjectId,
            tenantId: current.tenantId,
          },
          input.now,
        );
        const updated = await tx.execute({
          maxRows: 0,
          operation: "update",
          params: [
            input.permissionSnapshotId,
            input.permissionSnapshotRevision,
            input.now,
            current.rowVersion + 1,
            current.id,
            current.rowVersion,
            current.permissionSnapshotId,
            current.permissionSnapshotRevision,
          ],
          sql: `UPDATE ${q(database, runTable)} SET ${q(
            database,
            "run_state",
          )} = 'queued', ${q(database, "active_slot")} = 1, ${q(
            database,
            "execution_attempts",
          )} = 0, ${q(database, "last_error_code")} = NULL, ${q(
            database,
            "last_error_message",
          )} = NULL, ${q(database, "completed_at")} = NULL, ${q(
            database,
            "permission_snapshot_id",
          )} = ${p(database, 1)}, ${q(database, "permission_snapshot_revision")} = ${p(
            database,
            2,
          )}, ${q(database, "updated_at")} = ${p(database, 3)}, ${q(database, "row_version")} = ${p(
            database,
            4,
          )} WHERE ${q(database, "id")} = ${p(database, 5)} AND ${q(
            database,
            "row_version",
          )} = ${p(database, 6)} AND ${q(database, "run_state")} = 'failed' AND ${q(
            database,
            "permission_snapshot_id",
          )} = ${p(database, 7)} AND ${q(database, "permission_snapshot_revision")} = ${p(
            database,
            8,
          )};`,
          tableName: runTable,
        });
        if (updated.rowsAffected !== 1) return null;
        const delivery = await nextDelivery(database, tx, current.id);
        await insertOutbox(database, tx, {
          availableAt: input.now,
          deliveryRevision: delivery,
          id: nonempty(generateOutboxId(), "outboxId"),
          runId: current.id,
        });
        return getById(database, tx, current.id, false);
      }),
  };
}

async function requireCandidate(
  database: DatabaseAdapter,
  tx: DatabaseExecutor,
  input: StartKnowledgeSpaceProfileMigrationInput,
): Promise<void> {
  const result = await tx.execute({
    maxRows: 1,
    operation: "select",
    params: [
      input.tenantId,
      input.knowledgeSpaceId,
      input.changedKind,
      input.candidateProfile.id,
      input.candidateProfile.revision,
      input.candidateProfile.snapshotDigest,
    ],
    sql: `SELECT ${q(database, "id")} FROM ${q(database, revisionTable)} WHERE ${q(
      database,
      "tenant_id",
    )} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(
      database,
      2,
    )} AND ${q(database, "kind")} = ${p(database, 3)} AND ${q(
      database,
      "id",
    )} = ${p(database, 4)} AND ${q(database, "revision")} = ${p(
      database,
      5,
    )} AND ${q(database, "snapshot_digest")} = ${p(database, 6)} AND ${q(
      database,
      "state",
    )} = 'candidate' LIMIT 1 FOR UPDATE;`,
    tableName: revisionTable,
  });
  if (result.rows.length !== 1) {
    throw conflict(
      "PROFILE_MIGRATION_CANDIDATE_INVALID",
      "Candidate profile revision is missing, changed, or not a candidate",
    );
  }
}

async function failMigrationCandidate(
  database: DatabaseAdapter,
  tx: DatabaseExecutor,
  run: KnowledgeSpaceProfileMigrationRun,
  now: string,
  errorCode: string,
  errorMessage: string,
): Promise<void> {
  const result = await tx.execute({
    maxRows: 0,
    operation: "update",
    params: [
      safeText(errorCode, 64),
      safeText(errorMessage, 2_000),
      now,
      run.tenantId,
      run.knowledgeSpaceId,
      run.changedKind,
      run.candidateProfile.id,
      run.candidateProfile.revision,
      run.candidateProfile.snapshotDigest,
    ],
    sql: `UPDATE ${q(database, revisionTable)} SET ${q(
      database,
      "state",
    )} = 'failed', ${q(database, "failure_code")} = ${p(database, 1)}, ${q(
      database,
      "failure_message",
    )} = ${p(database, 2)}, ${q(database, "failed_at")} = ${p(
      database,
      3,
    )}, ${q(database, "updated_at")} = ${p(database, 3)} WHERE ${q(
      database,
      "tenant_id",
    )} = ${p(database, 4)} AND ${q(database, "knowledge_space_id")} = ${p(
      database,
      5,
    )} AND ${q(database, "kind")} = ${p(database, 6)} AND ${q(
      database,
      "id",
    )} = ${p(database, 7)} AND ${q(database, "revision")} = ${p(
      database,
      8,
    )} AND ${q(database, "snapshot_digest")} = ${p(database, 9)} AND ${q(
      database,
      "state",
    )} = 'candidate';`,
    tableName: revisionTable,
  });
  if (result.rowsAffected !== 1) {
    const candidate = await tx.execute({
      maxRows: 1,
      operation: "select",
      params: [run.candidateProfile.id, run.candidateProfile.revision],
      sql: `SELECT ${q(database, "state")} FROM ${q(database, revisionTable)} WHERE ${q(
        database,
        "id",
      )} = ${p(database, 1)} AND ${q(database, "revision")} = ${p(
        database,
        2,
      )} LIMIT 1 FOR UPDATE;`,
      tableName: revisionTable,
    });
    if (candidate.rows[0] && stringColumn(candidate.rows[0], "state") !== "failed") {
      throw conflict(
        "PROFILE_MIGRATION_CANDIDATE_CHANGED",
        "Migration candidate changed before terminal cleanup",
      );
    }
  }
}

async function deactivateCanceledCandidatePublication(
  database: DatabaseAdapter,
  tx: DatabaseExecutor,
  run: KnowledgeSpaceProfileMigrationRun,
  now: string,
): Promise<void> {
  const candidatePublicationId =
    run.candidatePublicationId ?? deterministicChildId(run.id, "profile-migration-publication");
  await tx.execute({
    maxRows: 0,
    operation: "delete",
    params: [run.tenantId, run.knowledgeSpaceId, candidatePublicationId],
    sql: `DELETE FROM ${q(
      database,
      "knowledge_space_profile_publication_bindings",
    )} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(
      database,
      "knowledge_space_id",
    )} = ${p(database, 2)} AND ${q(database, "publication_id")} = ${p(
      database,
      3,
    )} AND ${q(database, "activated_at")} IS NULL;`,
    tableName: "knowledge_space_profile_publication_bindings",
  });
  await tx.execute({
    maxRows: 0,
    operation: "update",
    params: [now, run.tenantId, run.knowledgeSpaceId, candidatePublicationId],
    sql: `UPDATE ${q(database, publicationTable)} SET ${q(
      database,
      "status",
    )} = 'inactive', ${q(database, "updated_at")} = ${p(database, 1)} WHERE ${q(
      database,
      "tenant_id",
    )} = ${p(database, 2)} AND ${q(database, "knowledge_space_id")} = ${p(
      database,
      3,
    )} AND ${q(database, "id")} = ${p(database, 4)} AND ${q(
      database,
      "status",
    )} IN ('candidate', 'validating');`,
    tableName: publicationTable,
  });
}

async function requireBasePublication(
  database: DatabaseAdapter,
  tx: DatabaseExecutor,
  input: StartKnowledgeSpaceProfileMigrationInput,
): Promise<void> {
  const result = await tx.execute({
    maxRows: 1,
    operation: "select",
    params: [
      input.tenantId,
      input.knowledgeSpaceId,
      input.basePublication.id,
      input.basePublication.fingerprint,
      input.basePublication.headRevision,
    ],
    sql: `SELECT pub.${q(database, "id")} FROM ${q(
      database,
      publicationHeadTable,
    )} head INNER JOIN ${q(database, publicationTable)} pub ON pub.${q(
      database,
      "tenant_id",
    )} = head.${q(database, "tenant_id")} AND pub.${q(
      database,
      "knowledge_space_id",
    )} = head.${q(database, "knowledge_space_id")} AND pub.${q(
      database,
      "id",
    )} = head.${q(database, "publication_id")} WHERE head.${q(
      database,
      "tenant_id",
    )} = ${p(database, 1)} AND head.${q(database, "knowledge_space_id")} = ${p(
      database,
      2,
    )} AND pub.${q(database, "id")} = ${p(database, 3)} AND pub.${q(
      database,
      "fingerprint",
    )} = ${p(database, 4)} AND head.${q(database, "head_revision")} = ${p(
      database,
      5,
    )} AND pub.${q(database, "status")} = 'published' LIMIT 1 FOR UPDATE;`,
    tableName: publicationHeadTable,
  });
  if (result.rows.length !== 1) {
    throw conflict(
      "PROFILE_MIGRATION_BASE_PUBLICATION_CHANGED",
      "Published projection head changed before migration admission",
    );
  }
}

async function requireProfileMigrationPermissionFence(
  database: DatabaseAdapter,
  tx: DatabaseExecutor,
  fence: DatabaseKnowledgeSpacePermissionFence,
  now: string,
): Promise<void> {
  try {
    await assertDatabaseKnowledgeSpacePermissionFence({
      database,
      executor: tx,
      fence,
      now,
      requiredAccess: "admin",
    });
  } catch (error) {
    if (!(error instanceof KnowledgeSpaceAccessError)) throw error;
    throw conflict(
      "PROFILE_MIGRATION_PERMISSION_INVALID",
      "Fresh owner permission is missing, revoked, expired, or has incompatible provenance",
    );
  }
}

async function requireBaseProfile(
  database: DatabaseAdapter,
  tx: DatabaseExecutor,
  input: StartKnowledgeSpaceProfileMigrationInput,
  kind: "embedding" | "retrieval",
  reference: KnowledgeSpaceProfileMigrationProfileReference,
): Promise<void> {
  const result = await tx.execute({
    maxRows: 1,
    operation: "select",
    params: [
      input.tenantId,
      input.knowledgeSpaceId,
      kind,
      reference.id,
      reference.revision,
      reference.snapshotDigest,
    ],
    sql: `SELECT revision.${q(database, "id")} FROM ${q(
      database,
      profileHeadTable,
    )} head INNER JOIN ${q(database, revisionTable)} revision ON revision.${q(
      database,
      "id",
    )} = head.${q(database, "profile_revision_id")} AND revision.${q(
      database,
      "revision",
    )} = head.${q(database, "active_revision")} WHERE head.${q(
      database,
      "tenant_id",
    )} = ${p(database, 1)} AND head.${q(database, "knowledge_space_id")} = ${p(
      database,
      2,
    )} AND head.${q(database, "kind")} = ${p(database, 3)} AND revision.${q(
      database,
      "id",
    )} = ${p(database, 4)} AND revision.${q(database, "revision")} = ${p(
      database,
      5,
    )} AND revision.${q(database, "snapshot_digest")} = ${p(
      database,
      6,
    )} AND revision.${q(database, "state")} = 'active' LIMIT 1 FOR UPDATE;`,
    tableName: profileHeadTable,
  });
  if (result.rows.length !== 1) {
    throw conflict(
      "PROFILE_MIGRATION_BASE_PROFILE_CHANGED",
      `Active ${kind} profile changed before migration admission`,
    );
  }
}

async function requireNoProfileHead(
  database: DatabaseAdapter,
  tx: DatabaseExecutor,
  input: StartKnowledgeSpaceProfileMigrationInput,
  kind: "embedding",
): Promise<void> {
  const result = await tx.execute({
    maxRows: 1,
    operation: "select",
    params: [input.tenantId, input.knowledgeSpaceId, kind],
    sql: `SELECT ${q(database, "id")} FROM ${q(database, profileHeadTable)} WHERE ${q(
      database,
      "tenant_id",
    )} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(
      database,
      2,
    )} AND ${q(database, "kind")} = ${p(database, 3)} LIMIT 1 FOR UPDATE;`,
    tableName: profileHeadTable,
  });
  if (result.rows.length > 0) {
    throw conflict(
      "PROFILE_MIGRATION_BASE_PROFILE_CHANGED",
      "An embedding profile appeared before migration admission",
    );
  }
}

async function getByIdempotency(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: Pick<
    StartKnowledgeSpaceProfileMigrationInput,
    "idempotencyKey" | "knowledgeSpaceId" | "requestedBySubjectId" | "tenantId"
  >,
  lock: boolean,
): Promise<KnowledgeSpaceProfileMigrationRun | null> {
  const digest = profileMigrationIdempotencyDigest(input);
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [digest],
    sql: `SELECT * FROM ${q(database, runTable)} WHERE ${q(
      database,
      "idempotency_digest",
    )} = ${p(database, 1)} LIMIT 1${lock ? " FOR UPDATE" : ""};`,
    tableName: runTable,
  });
  if (!result.rows[0]) return null;
  const replay = mapRun(result.rows[0]);
  if (
    replay.tenantId !== input.tenantId ||
    replay.knowledgeSpaceId !== input.knowledgeSpaceId ||
    replay.requestedBySubjectId !== input.requestedBySubjectId ||
    replay.idempotencyKey !== input.idempotencyKey
  ) {
    throw conflict(
      "PROFILE_MIGRATION_IDEMPOTENCY_CONFLICT",
      "Profile migration idempotency digest collided with a different request key",
    );
  }
  return replay;
}

function profileMigrationIdempotencyDigest(input: {
  readonly idempotencyKey: string;
  readonly knowledgeSpaceId: string;
  readonly requestedBySubjectId: string;
  readonly tenantId: string;
}): string {
  const hash = createHash("sha256");
  hash.update("v1|");
  for (const value of [
    input.tenantId,
    input.knowledgeSpaceId,
    input.requestedBySubjectId,
    input.idempotencyKey,
  ]) {
    hash.update(`${Buffer.byteLength(value, "utf8")}:`);
    hash.update(value, "utf8");
    hash.update("|");
  }
  return hash.digest("hex");
}

async function getById(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  id: string,
  lock: boolean,
): Promise<KnowledgeSpaceProfileMigrationRun | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [id],
    sql: `SELECT * FROM ${q(database, runTable)} WHERE ${q(database, "id")} = ${p(
      database,
      1,
    )} LIMIT 1${lock ? " FOR UPDATE" : ""};`,
    tableName: runTable,
  });
  return result.rows[0] ? mapRun(result.rows[0]) : null;
}

async function getFenced(
  database: DatabaseAdapter,
  tx: DatabaseExecutor,
  input: KnowledgeSpaceProfileMigrationFence,
): Promise<KnowledgeSpaceProfileMigrationRun | null> {
  const current = await getById(database, tx, input.runId, true);
  if (
    !current ||
    current.runState !== "running" ||
    current.rowVersion !== input.expectedRowVersion ||
    current.leaseToken !== input.leaseToken ||
    !current.leaseExpiresAt ||
    Date.parse(current.leaseExpiresAt) <= Date.parse(input.now)
  ) {
    return null;
  }
  return current;
}

async function terminalUpdate(
  database: DatabaseAdapter,
  tx: DatabaseExecutor,
  current: KnowledgeSpaceProfileMigrationRun,
  input:
    | {
        readonly errorCode: string;
        readonly errorMessage: string;
        readonly now: string;
        readonly state: "canceled" | "failed";
      }
    | { readonly now: string; readonly state: "succeeded" },
): Promise<KnowledgeSpaceProfileMigrationRun> {
  const succeeded = input.state === "succeeded";
  const canceled = input.state === "canceled";
  const result = await tx.execute({
    maxRows: 0,
    operation: "update",
    params: [
      input.state,
      succeeded ? "activated" : current.checkpoint,
      "errorCode" in input ? input.errorCode : null,
      "errorMessage" in input ? input.errorMessage : null,
      input.now,
      canceled ? input.now : null,
      current.rowVersion + 1,
      current.id,
      current.rowVersion,
    ],
    sql: `UPDATE ${q(database, runTable)} SET ${q(database, "run_state")} = ${p(
      database,
      1,
    )}, ${q(database, "active_slot")} = NULL, ${q(database, "checkpoint")} = ${p(
      database,
      2,
    )}, ${q(database, "last_error_code")} = ${p(database, 3)}, ${q(
      database,
      "last_error_message",
    )} = ${p(database, 4)}, ${q(database, "worker_id")} = NULL, ${q(
      database,
      "lease_token",
    )} = NULL, ${q(database, "lease_expires_at")} = NULL, ${q(
      database,
      "heartbeat_at",
    )} = NULL, ${q(database, "completed_at")} = ${p(database, 5)}, ${q(
      database,
      "canceled_at",
    )} = ${p(database, 6)}, ${q(database, "updated_at")} = ${p(
      database,
      5,
    )}, ${q(database, "row_version")} = ${p(database, 7)} WHERE ${q(
      database,
      "id",
    )} = ${p(database, 8)} AND ${q(database, "row_version")} = ${p(database, 9)};`,
    tableName: runTable,
  });
  if (result.rowsAffected !== 1)
    throw new Error("Profile migration terminal transition lost fence");
  return requiredRun(await getById(database, tx, current.id, false));
}

async function insertOutbox(
  database: DatabaseAdapter,
  tx: DatabaseExecutor,
  input: {
    readonly availableAt: string;
    readonly deliveryRevision: number;
    readonly id: string;
    readonly runId: string;
  },
): Promise<void> {
  await tx.execute({
    maxRows: 0,
    operation: "insert",
    params: [
      input.id,
      input.runId,
      input.deliveryRevision,
      "pending",
      input.availableAt,
      null,
      null,
      null,
      null,
      input.availableAt,
      input.availableAt,
      null,
    ],
    sql: `INSERT INTO ${q(database, outboxTable)} (${[
      "id",
      "run_id",
      "delivery_revision",
      "status",
      "available_at",
      "locked_by",
      "lock_token",
      "locked_until",
      "last_error",
      "created_at",
      "updated_at",
      "delivered_at",
    ]
      .map((column) => q(database, column))
      .join(
        ", ",
      )}) VALUES (${Array.from({ length: 12 }, (_, index) => p(database, index + 1)).join(", ")});`,
    tableName: outboxTable,
  });
}

async function completeOutbox(
  database: DatabaseAdapter,
  tx: DatabaseExecutor,
  runId: string,
  status: "canceled" | "completed",
  now: string,
): Promise<void> {
  await tx.execute({
    maxRows: 0,
    operation: "update",
    params: [status, now, now, runId],
    sql: `UPDATE ${q(database, outboxTable)} SET ${q(database, "status")} = ${p(
      database,
      1,
    )}, ${q(database, "locked_by")} = NULL, ${q(database, "lock_token")} = NULL, ${q(
      database,
      "locked_until",
    )} = NULL, ${q(database, "delivered_at")} = ${p(database, 2)}, ${q(
      database,
      "updated_at",
    )} = ${p(database, 3)} WHERE ${q(database, "run_id")} = ${p(
      database,
      4,
    )} AND ${q(database, "status")} IN ('pending', 'leased');`,
    tableName: outboxTable,
  });
}

async function nextDelivery(
  database: DatabaseAdapter,
  tx: DatabaseExecutor,
  runId: string,
): Promise<number> {
  const result = await tx.execute({
    maxRows: 1,
    operation: "select",
    params: [runId],
    sql: `SELECT ${q(database, "delivery_revision")} AS ${q(
      database,
      "revision",
    )} FROM ${q(database, outboxTable)} WHERE ${q(database, "run_id")} = ${p(
      database,
      1,
    )} ORDER BY ${q(database, "delivery_revision")} DESC LIMIT 1 FOR UPDATE;`,
    tableName: outboxTable,
  });
  return ((result.rows[0] ? optionalNumberColumn(result.rows[0], "revision") : undefined) ?? 0) + 1;
}

function mapRun(row: DatabaseRow): KnowledgeSpaceProfileMigrationRun {
  const embeddingId = optionalStringColumn(row, "base_embedding_profile_revision_id");
  const evaluation =
    row.evaluation_summary == null ? undefined : jsonObjectColumn(row, "evaluation_summary");
  return Object.freeze({
    accessChannel: stringColumn(
      row,
      "access_channel",
    ) as KnowledgeSpaceProfileMigrationRun["accessChannel"],
    ...(embeddingId
      ? {
          baseEmbeddingProfile: Object.freeze({
            id: embeddingId,
            revision: numberColumn(row, "base_embedding_profile_revision"),
            snapshotDigest: stringColumn(row, "base_embedding_profile_snapshot_digest"),
          }),
        }
      : {}),
    basePublication: Object.freeze({
      fingerprint: stringColumn(row, "base_publication_fingerprint"),
      headRevision: numberColumn(row, "base_publication_head_revision"),
      id: stringColumn(row, "base_publication_id"),
    }),
    baseRetrievalProfile: Object.freeze({
      id: stringColumn(row, "base_retrieval_profile_revision_id"),
      revision: numberColumn(row, "base_retrieval_profile_revision"),
      snapshotDigest: stringColumn(row, "base_retrieval_profile_snapshot_digest"),
    }),
    ...(optionalStringColumn(row, "canceled_at")
      ? { canceledAt: stringColumn(row, "canceled_at") }
      : {}),
    candidateProfile: Object.freeze({
      id: stringColumn(row, "candidate_profile_revision_id"),
      revision: numberColumn(row, "candidate_profile_revision"),
      snapshotDigest: stringColumn(row, "candidate_profile_snapshot_digest"),
    }),
    ...(optionalStringColumn(row, "candidate_publication_id")
      ? { candidatePublicationId: stringColumn(row, "candidate_publication_id") }
      : {}),
    ...(optionalStringColumn(row, "candidate_publication_fingerprint")
      ? { candidatePublicationFingerprint: stringColumn(row, "candidate_publication_fingerprint") }
      : {}),
    changedKind: stringColumn(
      row,
      "changed_kind",
    ) as KnowledgeSpaceProfileMigrationRun["changedKind"],
    checkpoint: stringColumn(row, "checkpoint") as KnowledgeSpaceProfileMigrationRun["checkpoint"],
    ...(optionalStringColumn(row, "completed_at")
      ? { completedAt: stringColumn(row, "completed_at") }
      : {}),
    createdAt: stringColumn(row, "created_at"),
    ...(evaluation ? { evaluationSummary: Object.freeze(evaluation) } : {}),
    executionAttempts: numberColumn(row, "execution_attempts"),
    ...(optionalStringColumn(row, "heartbeat_at")
      ? { heartbeatAt: stringColumn(row, "heartbeat_at") }
      : {}),
    id: stringColumn(row, "id"),
    idempotencyKey: stringColumn(row, "idempotency_key"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    ...(optionalStringColumn(row, "last_error_code")
      ? { lastErrorCode: stringColumn(row, "last_error_code") }
      : {}),
    ...(optionalStringColumn(row, "last_error_message")
      ? { lastErrorMessage: stringColumn(row, "last_error_message") }
      : {}),
    ...(optionalStringColumn(row, "lease_expires_at")
      ? { leaseExpiresAt: stringColumn(row, "lease_expires_at") }
      : {}),
    ...(optionalStringColumn(row, "lease_token")
      ? { leaseToken: stringColumn(row, "lease_token") }
      : {}),
    maxExecutionAttempts: numberColumn(row, "max_execution_attempts"),
    permissionSnapshotId: stringColumn(row, "permission_snapshot_id"),
    permissionSnapshotRevision: numberColumn(row, "permission_snapshot_revision"),
    rebuildScope: stringColumn(
      row,
      "rebuild_scope",
    ) as KnowledgeSpaceProfileMigrationRun["rebuildScope"],
    requestedBySubjectId: stringColumn(row, "requested_by_subject_id"),
    rowVersion: numberColumn(row, "row_version"),
    runState: stringColumn(row, "run_state") as KnowledgeSpaceProfileMigrationRun["runState"],
    tenantId: stringColumn(row, "tenant_id"),
    updatedAt: stringColumn(row, "updated_at"),
    ...(optionalStringColumn(row, "worker_id") ? { workerId: stringColumn(row, "worker_id") } : {}),
  });
}

function validateStart(input: StartKnowledgeSpaceProfileMigrationInput): void {
  if (input.changedKind === "embedding" && input.rebuildScope !== "full-vector-space") {
    throw new Error("Embedding migration requires full-vector-space rebuild");
  }
  if (
    input.changedKind === "retrieval" &&
    input.rebuildScope !== "clone-publication" &&
    input.rebuildScope !== "full-page-index-summary-outline"
  ) {
    throw new Error("Retrieval migration rebuild scope is invalid");
  }
  positiveInteger(input.maxExecutionAttempts, "maxExecutionAttempts");
  positiveInteger(input.permissionSnapshotRevision, "permissionSnapshotRevision");
  if (!Number.isFinite(Date.parse(input.createdAt))) {
    throw new Error("Profile migration createdAt must be an ISO date-time");
  }
}

function sameStart(
  run: KnowledgeSpaceProfileMigrationRun,
  input: StartKnowledgeSpaceProfileMigrationInput,
): boolean {
  return (
    run.changedKind === input.changedKind &&
    run.rebuildScope === input.rebuildScope &&
    run.candidateProfile.id === input.candidateProfile.id &&
    run.candidateProfile.revision === input.candidateProfile.revision &&
    run.candidateProfile.snapshotDigest === input.candidateProfile.snapshotDigest &&
    run.basePublication.id === input.basePublication.id &&
    run.basePublication.fingerprint === input.basePublication.fingerprint &&
    run.basePublication.headRevision === input.basePublication.headRevision &&
    run.baseRetrievalProfile.id === input.baseRetrievalProfile.id &&
    run.baseRetrievalProfile.revision === input.baseRetrievalProfile.revision &&
    run.baseRetrievalProfile.snapshotDigest === input.baseRetrievalProfile.snapshotDigest &&
    (run.baseEmbeddingProfile?.id ?? null) === (input.baseEmbeddingProfile?.id ?? null) &&
    (run.baseEmbeddingProfile?.revision ?? null) ===
      (input.baseEmbeddingProfile?.revision ?? null) &&
    (run.baseEmbeddingProfile?.snapshotDigest ?? null) ===
      (input.baseEmbeddingProfile?.snapshotDigest ?? null) &&
    run.permissionSnapshotId === input.permissionSnapshotId &&
    run.permissionSnapshotRevision === input.permissionSnapshotRevision &&
    run.accessChannel === input.accessChannel
  );
}

function sanitizeSummary(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 32)
      .flatMap(([key, item]) =>
        typeof item === "boolean" || typeof item === "number" || typeof item === "string"
          ? [[key.slice(0, 64), typeof item === "string" ? item.slice(0, 512) : item]]
          : [],
      ),
  );
}

function checkpointOrder(value: KnowledgeSpaceProfileMigrationRun["checkpoint"]): number {
  return ["queued", "candidate-built", "evaluated", "activated"].indexOf(value);
}

function requiredRun(
  value: KnowledgeSpaceProfileMigrationRun | null,
): KnowledgeSpaceProfileMigrationRun {
  if (!value) throw new Error("Profile migration run disappeared");
  return value;
}

function conflict(code: string, message: string, _cause?: unknown) {
  return new KnowledgeSpaceProfileMigrationConflictError(code, message);
}

function positiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be positive`);
}

function nonempty(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} must not be empty`);
  return normalized;
}

function safeText(value: string, max: number): string {
  return (value.trim().replaceAll(/[\r\n\t]+/g, " ") || "Profile migration failed").slice(0, max);
}

function q(database: DatabaseAdapter, identifier: string): string {
  return quoteDatabaseIdentifier(database, identifier);
}

function p(database: DatabaseAdapter, position: number): string {
  return databasePlaceholder(database, position);
}

function jsonPlaceholder(database: DatabaseAdapter, position: number): string {
  const placeholder = p(database, position);
  return database.dialect === "postgres"
    ? `CAST(${placeholder} AS JSONB)`
    : `CAST(${placeholder} AS JSON)`;
}
