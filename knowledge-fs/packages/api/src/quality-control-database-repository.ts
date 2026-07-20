import { randomUUID } from "node:crypto";

import type {
  DatabaseAdapter,
  DatabaseExecutor,
  DatabaseQueryValue,
  DatabaseRow,
} from "@knowledge/core";

import { numberColumn, optionalStringColumn, stringColumn } from "./database-row-utils";
import {
  databasePlaceholder,
  jsonInsertPlaceholder,
  quoteDatabaseIdentifier,
} from "./database-sql-utils";
import { jsonArrayColumn, jsonObjectColumn, jsonStringArrayColumn } from "./json-utils";
import {
  KnowledgeSpaceAccessError,
  assertDatabaseKnowledgeSpacePermissionFence,
} from "./knowledge-space-access-control";
import { lockKnowledgeSpaceForDeletionAdmission } from "./knowledge-space-deletion-admission";
import type {
  FrozenQualityRuntimeSnapshot,
  MissingEvidenceReview,
  ProductionBadCase,
  QualityAnswerTraceHistoryInput,
  QualityAnswerTraceHistoryResult,
  QualityAnswerTraceSummary,
  QualityBadCaseState,
  QualityControlRepository,
  QualityHistoryEvent,
  QualityPermissionBinding,
  QualityReplayItem,
  QualityReplayRun,
  QualityTrendReport,
} from "./quality-control";

export interface DatabaseQualityControlRepositoryOptions {
  readonly database: DatabaseAdapter;
  readonly generateId?: (() => string) | undefined;
  readonly maxListLimit: number;
  readonly now?: (() => string) | undefined;
}

export class QualityControlRevisionConflictError extends Error {
  constructor() {
    super("Quality resource revision conflict");
    this.name = "QualityControlRevisionConflictError";
  }
}

export class QualityControlIdempotencyConflictError extends Error {
  constructor() {
    super("Quality replay idempotency key conflicts with an existing request");
    this.name = "QualityControlIdempotencyConflictError";
  }
}

/**
 * SQL-backed quality repository. Every user-facing list applies tenant, space, subject and current
 * candidate grants in SQL before keyset pagination/LIMIT. The durable replay path additionally
 * owns the transactional outbox, recoverable lease, item checkpoints and final permission fence.
 */
export function createDatabaseQualityControlRepository({
  database,
  generateId = randomUUID,
  maxListLimit,
  now = () => new Date().toISOString(),
}: DatabaseQualityControlRepositoryOptions): QualityControlRepository {
  if (!Number.isInteger(maxListLimit) || maxListLimit < 1) {
    throw new Error("Quality repository maxListLimit must be at least 1");
  }

  return {
    listTraces: async (input) => listTraces(database, maxListLimit, input),
    getMissingReview: async (input) => {
      const result = await database.execute({
        maxRows: 1,
        operation: "select",
        params: [
          input.tenantId,
          input.knowledgeSpaceId,
          input.traceId,
          input.itemKey,
          input.subjectId,
          JSON.stringify(input.candidateGrants),
        ],
        sql: `SELECT review.* FROM ${q(database, "quality_missing_evidence_reviews")} review INNER JOIN ${q(database, "answer_traces")} trace ON trace.${q(database, "id")} = review.${q(database, "trace_id")} AND trace.${q(database, "knowledge_space_id")} = review.${q(database, "knowledge_space_id")} AND trace.${q(database, "subject_id")} = ${p(database, 5)} INNER JOIN ${q(database, "knowledge_space_permission_snapshots")} permission ON permission.${q(database, "tenant_id")} = ${p(database, 1)} AND permission.${q(database, "id")} = trace.${q(database, "permission_snapshot_id")} AND permission.${q(database, "knowledge_space_id")} = trace.${q(database, "knowledge_space_id")} AND permission.${q(database, "subject_id")} = ${p(database, 5)} WHERE review.${q(database, "tenant_id")} = ${p(database, 1)} AND review.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND review.${q(database, "trace_id")} = ${p(database, 3)} AND review.${q(database, "item_key")} = ${p(database, 4)} AND review.${q(database, "actor_subject_id")} = ${p(database, 5)} AND ${permissionScopeSql(database, `review.${q(database, "required_permission_scope")}`, p(database, 6))} AND ${permissionScopeSql(database, `permission.${q(database, "permission_scopes")}`, p(database, 6))} LIMIT 1;`,
        tableName: "quality_missing_evidence_reviews",
      });
      return result.rows[0] ? mapMissingReview(result.rows[0]) : null;
    },
    upsertMissingReview: async (input) =>
      database.transaction(async (transaction) => {
        const timestamp = now();
        await lockActiveSpace(database, transaction, input.tenantId, input.knowledgeSpaceId);
        const candidateGrants = await assertQualityWritePermissionFence(database, transaction, {
          actorSubjectId: input.actorSubjectId,
          candidateGrants: input.candidateGrants,
          knowledgeSpaceId: input.knowledgeSpaceId,
          permission: input.permission,
          tenantId: input.tenantId,
          timestamp,
        });
        await assertTraceCandidateVisible(database, transaction, {
          actorSubjectId: input.actorSubjectId,
          candidateGrants,
          knowledgeSpaceId: input.knowledgeSpaceId,
          tenantId: input.tenantId,
          timestamp,
          traceId: input.traceId,
        });
        const current = await selectMissingReview(
          database,
          transaction,
          input.tenantId,
          input.knowledgeSpaceId,
          input.traceId,
          input.itemKey,
          input.actorSubjectId,
          candidateGrants,
          true,
        );
        if (!current) {
          if (input.expectedRevision !== 0) throw new QualityControlRevisionConflictError();
          const id = generateId();
          const revision = 1;
          await transaction.execute({
            maxRows: 0,
            operation: "insert",
            params: [
              id,
              input.tenantId,
              input.knowledgeSpaceId,
              input.traceId,
              input.itemKey,
              input.status,
              input.reason ?? null,
              input.actorSubjectId,
              revision,
              JSON.stringify(candidateGrants),
              timestamp,
              timestamp,
            ],
            sql: `INSERT INTO ${q(database, "quality_missing_evidence_reviews")} (${[
              "id",
              "tenant_id",
              "knowledge_space_id",
              "trace_id",
              "item_key",
              "status",
              "reason",
              "actor_subject_id",
              "revision",
              "required_permission_scope",
              "created_at",
              "updated_at",
            ]
              .map((column) => q(database, column))
              .join(
                ", ",
              )}) VALUES (${Array.from({ length: 12 }, (_, index) => (index === 9 ? jsonP(database, index + 1) : p(database, index + 1))).join(", ")});`,
            tableName: "quality_missing_evidence_reviews",
          });
          await appendHistory(database, transaction, {
            action: input.status === "dismissed" ? "dismissed" : "restored",
            actorSubjectId: input.actorSubjectId,
            aggregateId: id,
            aggregateType: "missing-evidence",
            generateId,
            knowledgeSpaceId: input.knowledgeSpaceId,
            reason: input.reason,
            revision,
            tenantId: input.tenantId,
            timestamp,
            toStatus: input.status,
          });
          return {
            actorSubjectId: input.actorSubjectId,
            createdAt: timestamp,
            id,
            itemKey: input.itemKey,
            knowledgeSpaceId: input.knowledgeSpaceId,
            ...(input.reason ? { reason: input.reason } : {}),
            revision,
            status: input.status,
            traceId: input.traceId,
            updatedAt: timestamp,
          };
        }
        const mapped = mapMissingReview(current);
        if (mapped.revision !== input.expectedRevision) {
          throw new QualityControlRevisionConflictError();
        }
        const revision = mapped.revision + 1;
        const update = await transaction.execute({
          maxRows: 0,
          operation: "update",
          params: [
            input.status,
            input.reason ?? null,
            input.actorSubjectId,
            revision,
            timestamp,
            mapped.id,
            input.expectedRevision,
          ],
          sql: `UPDATE ${q(database, "quality_missing_evidence_reviews")} SET ${q(database, "status")} = ${p(database, 1)}, ${q(database, "reason")} = ${p(database, 2)}, ${q(database, "actor_subject_id")} = ${p(database, 3)}, ${q(database, "revision")} = ${p(database, 4)}, ${q(database, "updated_at")} = ${p(database, 5)} WHERE ${q(database, "id")} = ${p(database, 6)} AND ${q(database, "revision")} = ${p(database, 7)};`,
          tableName: "quality_missing_evidence_reviews",
        });
        if (update.rowsAffected !== 1) throw new QualityControlRevisionConflictError();
        await appendHistory(database, transaction, {
          action: input.status === "dismissed" ? "dismissed" : "restored",
          actorSubjectId: input.actorSubjectId,
          aggregateId: mapped.id,
          aggregateType: "missing-evidence",
          fromStatus: mapped.status,
          generateId,
          knowledgeSpaceId: input.knowledgeSpaceId,
          reason: input.reason,
          revision,
          tenantId: input.tenantId,
          timestamp,
          toStatus: input.status,
        });
        return {
          ...mapped,
          actorSubjectId: input.actorSubjectId,
          ...(input.reason ? { reason: input.reason } : { reason: undefined }),
          revision,
          status: input.status,
          updatedAt: timestamp,
        };
      }),
    listHistory: async (input) => {
      assertLimit(input.limit, maxListLimit);
      const result = await database.execute({
        maxRows: input.limit,
        operation: "select",
        params: [
          input.tenantId,
          input.knowledgeSpaceId,
          input.aggregateType,
          input.aggregateId,
          input.subjectId,
          JSON.stringify(input.candidateGrants),
          input.limit,
        ],
        sql: `SELECT history.* FROM ${q(database, "quality_resource_history")} history WHERE history.${q(database, "tenant_id")} = ${p(database, 1)} AND history.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND history.${q(database, "aggregate_type")} = ${p(database, 3)} AND history.${q(database, "aggregate_id")} = ${p(database, 4)} AND ${historyAggregateVisibleSql(database, p(database, 5), p(database, 6))} ORDER BY history.${q(database, "revision")} DESC, history.${q(database, "id")} DESC LIMIT ${p(database, 7)};`,
        tableName: "quality_resource_history",
      });
      return result.rows.map(mapHistoryEvent);
    },
    createBadCase: async (input) =>
      database.transaction(async (transaction) => {
        const timestamp = now();
        await lockActiveSpace(database, transaction, input.tenantId, input.knowledgeSpaceId);
        const candidateGrants = await assertQualityWritePermissionFence(database, transaction, {
          actorSubjectId: input.actorSubjectId,
          candidateGrants: input.candidateGrants,
          knowledgeSpaceId: input.knowledgeSpaceId,
          permission: input.permission,
          tenantId: input.tenantId,
          timestamp,
        });
        await assertTraceCandidateVisible(database, transaction, {
          ...input,
          candidateGrants,
          timestamp,
        });
        const id = generateId();
        const revision = 1;
        await transaction.execute({
          maxRows: 0,
          operation: "insert",
          params: [
            id,
            input.tenantId,
            input.knowledgeSpaceId,
            input.traceId,
            "open",
            input.reason,
            JSON.stringify(input.tags),
            input.actorSubjectId,
            revision,
            JSON.stringify(candidateGrants),
            timestamp,
            timestamp,
          ],
          sql: `INSERT INTO ${q(database, "quality_bad_cases")} (${[
            "id",
            "tenant_id",
            "knowledge_space_id",
            "trace_id",
            "status",
            "reason",
            "tags",
            "actor_subject_id",
            "revision",
            "required_permission_scope",
            "created_at",
            "updated_at",
          ]
            .map((column) => q(database, column))
            .join(
              ", ",
            )}) VALUES (${Array.from({ length: 12 }, (_, index) => (index === 6 || index === 9 ? jsonP(database, index + 1) : p(database, index + 1))).join(", ")});`,
          tableName: "quality_bad_cases",
        });
        await appendHistory(database, transaction, {
          action: "captured",
          actorSubjectId: input.actorSubjectId,
          aggregateId: id,
          aggregateType: "bad-case",
          generateId,
          knowledgeSpaceId: input.knowledgeSpaceId,
          reason: input.reason,
          revision,
          tenantId: input.tenantId,
          timestamp,
          toStatus: "open",
        });
        return {
          actorSubjectId: input.actorSubjectId,
          createdAt: timestamp,
          id,
          knowledgeSpaceId: input.knowledgeSpaceId,
          reason: input.reason,
          revision,
          status: "open",
          tags: [...input.tags],
          traceId: input.traceId,
          updatedAt: timestamp,
        };
      }),
    getBadCase: async (input) => {
      const result = await database.execute({
        maxRows: 1,
        operation: "select",
        params: [
          input.tenantId,
          input.knowledgeSpaceId,
          input.id,
          input.subjectId,
          JSON.stringify(input.candidateGrants),
        ],
        sql: `SELECT bad_case.* FROM ${q(database, "quality_bad_cases")} bad_case WHERE bad_case.${q(database, "tenant_id")} = ${p(database, 1)} AND bad_case.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND bad_case.${q(database, "id")} = ${p(database, 3)} AND bad_case.${q(database, "actor_subject_id")} = ${p(database, 4)} AND ${permissionScopeSql(database, `bad_case.${q(database, "required_permission_scope")}`, p(database, 5))} LIMIT 1;`,
        tableName: "quality_bad_cases",
      });
      return result.rows[0] ? mapBadCase(result.rows[0]) : null;
    },
    listBadCases: async (input) => {
      assertLimit(input.limit, maxListLimit);
      const filters: string[] = [];
      const params: DatabaseQueryValue[] = [
        input.tenantId,
        input.knowledgeSpaceId,
        input.subjectId,
        JSON.stringify(input.candidateGrants),
      ];
      if (input.status) {
        params.push(input.status);
        filters.push(`bad_case.${q(database, "status")} = ${p(database, params.length)}`);
      }
      if (input.cursor) {
        params.push(input.cursor.createdAt, input.cursor.id);
        filters.push(
          `(bad_case.${q(database, "created_at")} < ${p(database, params.length - 1)} OR (bad_case.${q(database, "created_at")} = ${p(database, params.length - 1)} AND bad_case.${q(database, "id")} < ${p(database, params.length)}))`,
        );
      }
      params.push(input.limit + 1);
      const result = await database.execute({
        maxRows: input.limit + 1,
        operation: "select",
        params,
        sql: `SELECT bad_case.* FROM ${q(database, "quality_bad_cases")} bad_case WHERE bad_case.${q(database, "tenant_id")} = ${p(database, 1)} AND bad_case.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND bad_case.${q(database, "actor_subject_id")} = ${p(database, 3)} AND ${permissionScopeSql(database, `bad_case.${q(database, "required_permission_scope")}`, p(database, 4))}${filters.length ? ` AND ${filters.join(" AND ")}` : ""} ORDER BY bad_case.${q(database, "created_at")} DESC, bad_case.${q(database, "id")} DESC LIMIT ${p(database, params.length)};`,
        tableName: "quality_bad_cases",
      });
      const items = result.rows.slice(0, input.limit).map(mapBadCase);
      const last = items.at(-1);
      return {
        items,
        ...(result.rows.length > input.limit && last
          ? { nextCursor: { createdAt: last.createdAt, id: last.id } }
          : {}),
      };
    },
    updateBadCase: async (input) =>
      database.transaction(async (transaction) => {
        const timestamp = now();
        await lockActiveSpace(database, transaction, input.tenantId, input.knowledgeSpaceId);
        const candidateGrants = await assertQualityWritePermissionFence(database, transaction, {
          actorSubjectId: input.actorSubjectId,
          candidateGrants: input.candidateGrants,
          knowledgeSpaceId: input.knowledgeSpaceId,
          permission: input.permission,
          tenantId: input.tenantId,
          timestamp,
        });
        const row = await selectBadCase(
          database,
          transaction,
          input.tenantId,
          input.knowledgeSpaceId,
          input.id,
          input.actorSubjectId,
          candidateGrants,
          true,
        );
        if (!row) return null;
        const current = mapBadCase(row);
        if (current.revision !== input.expectedRevision) {
          throw new QualityControlRevisionConflictError();
        }
        validateBadCaseTransition(current.status, input.status);
        const linkedReplayId = input.replayRunId ?? current.replayRunId;
        if (input.status === "replaying" && !linkedReplayId) {
          throw new Error("A replaying bad case requires a replay run");
        }
        if (input.replayRunId) {
          const replay = await transaction.execute({
            maxRows: 1,
            operation: "select",
            params: [
              input.tenantId,
              input.knowledgeSpaceId,
              input.replayRunId,
              input.actorSubjectId,
              JSON.stringify(candidateGrants),
            ],
            sql: `SELECT ${q(database, "id")} FROM ${q(database, "quality_replay_runs")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "id")} = ${p(database, 3)} AND ${q(database, "requested_by_subject_id")} = ${p(database, 4)} AND ${permissionScopeSql(database, q(database, "required_permission_scope"), p(database, 5))} LIMIT 1 FOR UPDATE;`,
            tableName: "quality_replay_runs",
          });
          if (!replay.rows[0]) throw new Error("Linked replay run is not visible");
        }
        const revision = current.revision + 1;
        const result = await transaction.execute({
          maxRows: 0,
          operation: "update",
          params: [
            input.status,
            input.reason ?? current.reason,
            JSON.stringify(input.tags ?? current.tags),
            linkedReplayId ?? null,
            input.actorSubjectId,
            revision,
            timestamp,
            input.id,
            input.expectedRevision,
          ],
          sql: `UPDATE ${q(database, "quality_bad_cases")} SET ${q(database, "status")} = ${p(database, 1)}, ${q(database, "reason")} = ${p(database, 2)}, ${q(database, "tags")} = ${jsonP(database, 3)}, ${q(database, "replay_run_id")} = ${p(database, 4)}, ${q(database, "actor_subject_id")} = ${p(database, 5)}, ${q(database, "revision")} = ${p(database, 6)}, ${q(database, "updated_at")} = ${p(database, 7)} WHERE ${q(database, "id")} = ${p(database, 8)} AND ${q(database, "revision")} = ${p(database, 9)};`,
          tableName: "quality_bad_cases",
        });
        if (result.rowsAffected !== 1) throw new QualityControlRevisionConflictError();
        await appendHistory(database, transaction, {
          action: input.status,
          actorSubjectId: input.actorSubjectId,
          aggregateId: input.id,
          aggregateType: "bad-case",
          fromStatus: current.status,
          generateId,
          knowledgeSpaceId: input.knowledgeSpaceId,
          reason: input.reason,
          revision,
          tenantId: input.tenantId,
          timestamp,
          toStatus: input.status,
        });
        return {
          ...current,
          actorSubjectId: input.actorSubjectId,
          ...(input.replayRunId ? { replayRunId: input.replayRunId } : {}),
          reason: input.reason ?? current.reason,
          revision,
          status: input.status,
          tags: [...(input.tags ?? current.tags)],
          updatedAt: timestamp,
        };
      }),
    createReplay: async (input) =>
      database.transaction(async (transaction) => {
        const timestamp = now();
        await lockActiveSpace(database, transaction, input.tenantId, input.knowledgeSpaceId);
        const candidateGrants = await assertQualityWritePermissionFence(database, transaction, {
          actorSubjectId: input.permission.requestedBySubjectId,
          candidateGrants: input.permission.candidateGrants,
          knowledgeSpaceId: input.knowledgeSpaceId,
          permission: input.permission,
          tenantId: input.tenantId,
          timestamp,
        });
        const existing = await transaction.execute({
          maxRows: 1,
          operation: "select",
          params: [input.tenantId, input.knowledgeSpaceId, input.idempotencyKey],
          sql: `SELECT ${q(database, "id")}, ${q(database, "request_fingerprint")}, ${q(database, "requested_by_subject_id")}, ${q(database, "access_channel")} FROM ${q(database, "quality_replay_runs")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "idempotency_key")} = ${p(database, 3)} LIMIT 1 FOR UPDATE;`,
          tableName: "quality_replay_runs",
        });
        if (existing.rows[0]) {
          if (
            stringColumn(existing.rows[0], "request_fingerprint") !== input.requestFingerprint ||
            stringColumn(existing.rows[0], "requested_by_subject_id") !==
              input.permission.requestedBySubjectId ||
            stringColumn(existing.rows[0], "access_channel") !== input.permission.accessChannel
          ) {
            throw new QualityControlIdempotencyConflictError();
          }
          return requireReplayById(database, transaction, stringColumn(existing.rows[0], "id"));
        }
        const runId = generateId();
        await insertReplayRun(database, transaction, {
          frozenSnapshot: input.frozenSnapshot,
          id: runId,
          idempotencyKey: input.idempotencyKey,
          knowledgeSpaceId: input.knowledgeSpaceId,
          mode: input.mode,
          permission: { ...input.permission, candidateGrants },
          requestFingerprint: input.requestFingerprint,
          tenantId: input.tenantId,
          timestamp,
        });
        let ordinal = 0;
        for (const question of input.questions) {
          ordinal += 1;
          await transaction.execute({
            maxRows: 0,
            operation: "insert",
            params: [
              generateId(),
              runId,
              question.id,
              ordinal,
              question.question,
              JSON.stringify(question.expectedEvidenceIds),
              "queued",
              timestamp,
              timestamp,
            ],
            sql: `INSERT INTO ${q(database, "quality_replay_items")} (${[
              "id",
              "run_id",
              "golden_question_id",
              "ordinal",
              "question",
              "expected_evidence_ids",
              "state",
              "created_at",
              "updated_at",
            ]
              .map((column) => q(database, column))
              .join(
                ", ",
              )}) VALUES (${Array.from({ length: 9 }, (_, index) => (index === 5 ? jsonP(database, index + 1) : p(database, index + 1))).join(", ")});`,
            tableName: "quality_replay_items",
          });
        }
        await transaction.execute({
          maxRows: 0,
          operation: "insert",
          params: [
            generateId(),
            runId,
            1,
            "quality.replay.requested",
            "pending",
            0,
            timestamp,
            timestamp,
          ],
          sql: `INSERT INTO ${q(database, "quality_replay_outbox")} (${[
            "id",
            "run_id",
            "delivery_revision",
            "event_type",
            "delivery_state",
            "attempt",
            "created_at",
            "updated_at",
          ]
            .map((column) => q(database, column))
            .join(
              ", ",
            )}) VALUES (${Array.from({ length: 8 }, (_, index) => p(database, index + 1)).join(", ")});`,
          tableName: "quality_replay_outbox",
        });
        return requireReplayById(database, transaction, runId);
      }),
    getReplay: async (input) => {
      const result = await database.execute({
        maxRows: 1,
        operation: "select",
        params: [
          input.tenantId,
          input.knowledgeSpaceId,
          input.id,
          input.subjectId,
          JSON.stringify(input.candidateGrants),
        ],
        sql: `SELECT run.* FROM ${q(database, "quality_replay_runs")} run WHERE run.${q(database, "tenant_id")} = ${p(database, 1)} AND run.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND run.${q(database, "id")} = ${p(database, 3)} AND run.${q(database, "requested_by_subject_id")} = ${p(database, 4)} AND ${permissionScopeSql(database, `run.${q(database, "required_permission_scope")}`, p(database, 5))} LIMIT 1;`,
        tableName: "quality_replay_runs",
      });
      return result.rows[0] ? loadReplay(database, database, result.rows[0]) : null;
    },
    listReplays: async (input) => {
      assertLimit(input.limit, maxListLimit);
      const params: DatabaseQueryValue[] = [
        input.tenantId,
        input.knowledgeSpaceId,
        input.subjectId,
        JSON.stringify(input.candidateGrants),
      ];
      const filters: string[] = [];
      if (input.from) {
        params.push(input.from);
        filters.push(`run.${q(database, "created_at")} >= ${p(database, params.length)}`);
      }
      if (input.to) {
        params.push(input.to);
        filters.push(`run.${q(database, "created_at")} < ${p(database, params.length)}`);
      }
      if (input.mode) {
        params.push(input.mode);
        filters.push(`run.${q(database, "mode")} = ${p(database, params.length)}`);
      }
      if (input.state) {
        params.push(input.state);
        filters.push(`run.${q(database, "state")} = ${p(database, params.length)}`);
      }
      if (input.cursor) {
        params.push(input.cursor.createdAt, input.cursor.id);
        filters.push(
          `(run.${q(database, "created_at")} < ${p(database, params.length - 1)} OR (run.${q(database, "created_at")} = ${p(database, params.length - 1)} AND run.${q(database, "id")} < ${p(database, params.length)}))`,
        );
      }
      params.push(input.limit + 1);
      const result = await database.execute({
        maxRows: input.limit + 1,
        operation: "select",
        params,
        sql: `SELECT run.* FROM ${q(database, "quality_replay_runs")} run WHERE run.${q(database, "tenant_id")} = ${p(database, 1)} AND run.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND run.${q(database, "requested_by_subject_id")} = ${p(database, 3)} AND ${permissionScopeSql(database, `run.${q(database, "required_permission_scope")}`, p(database, 4))}${filters.length ? ` AND ${filters.join(" AND ")}` : ""} ORDER BY run.${q(database, "created_at")} DESC, run.${q(database, "id")} DESC LIMIT ${p(database, params.length)};`,
        tableName: "quality_replay_runs",
      });
      const pageRows = result.rows.slice(0, input.limit);
      const items = await Promise.all(pageRows.map((row) => loadReplay(database, database, row)));
      const last = items.at(-1);
      return {
        items,
        ...(result.rows.length > input.limit && last
          ? { nextCursor: { createdAt: last.createdAt, id: last.id } }
          : {}),
      };
    },
    claimReplay: async (input) =>
      database.transaction(async (transaction) => {
        // Locate without taking a child lock first. The canonical mutation order is
        // space/deletion -> durable permission -> replay/outbox.
        const candidate = await transaction.execute({
          maxRows: 1,
          operation: "select",
          params: [input.now],
          sql: `SELECT outbox.${q(database, "id")} AS ${q(database, "outbox_id")}, run.* FROM ${q(database, "quality_replay_outbox")} outbox INNER JOIN ${q(database, "quality_replay_runs")} run ON run.${q(database, "id")} = outbox.${q(database, "run_id")} INNER JOIN ${q(database, "knowledge_spaces")} space ON space.${q(database, "tenant_id")} = run.${q(database, "tenant_id")} AND space.${q(database, "id")} = run.${q(database, "knowledge_space_id")} WHERE (outbox.${q(database, "delivery_state")} = 'pending' OR (outbox.${q(database, "delivery_state")} = 'claimed' AND outbox.${q(database, "lease_expires_at")} < ${p(database, 1)})) AND run.${q(database, "state")} IN ('queued', 'running') AND space.${q(database, "lifecycle_state")} = 'active' AND space.${q(database, "deletion_job_id")} IS NULL AND NOT EXISTS (SELECT 1 FROM ${q(database, "deletion_jobs")} active_deletion WHERE active_deletion.${q(database, "tenant_id")} = run.${q(database, "tenant_id")} AND active_deletion.${q(database, "knowledge_space_id")} = run.${q(database, "knowledge_space_id")} AND active_deletion.${q(database, "active_slot")} = 1) ORDER BY outbox.${q(database, "created_at")} ASC, outbox.${q(database, "id")} ASC LIMIT 1;`,
          tableName: "quality_replay_outbox",
        });
        const candidateRow = candidate.rows[0];
        if (!candidateRow) return null;
        const candidateRun = mapReplayRunRow(candidateRow, []);
        const outboxId = stringColumn(candidateRow, "outbox_id");
        await lockActiveSpace(
          database,
          transaction,
          candidateRun.tenantId,
          candidateRun.knowledgeSpaceId,
        );
        await assertStoredReplayPermissionFence(database, transaction, candidateRun, input.now);
        const selected = await transaction.execute({
          maxRows: 1,
          operation: "select",
          params: [outboxId, candidateRun.id, input.now, candidateRun.revision],
          sql: `SELECT outbox.${q(database, "id")} AS ${q(database, "outbox_id")}, run.* FROM ${q(database, "quality_replay_outbox")} outbox INNER JOIN ${q(database, "quality_replay_runs")} run ON run.${q(database, "id")} = outbox.${q(database, "run_id")} WHERE outbox.${q(database, "id")} = ${p(database, 1)} AND run.${q(database, "id")} = ${p(database, 2)} AND (outbox.${q(database, "delivery_state")} = 'pending' OR (outbox.${q(database, "delivery_state")} = 'claimed' AND outbox.${q(database, "lease_expires_at")} < ${p(database, 3)})) AND run.${q(database, "state")} IN ('queued', 'running') AND run.${q(database, "revision")} = ${p(database, 4)} LIMIT 1 FOR UPDATE;`,
          tableName: "quality_replay_outbox",
        });
        if (!selected.rows[0]) return null;
        const runId = candidateRun.id;
        const leaseToken = generateId();
        const leaseExpiresAt = new Date(Date.parse(input.now) + input.leaseMs).toISOString();
        await transaction.execute({
          maxRows: 0,
          operation: "update",
          params: [input.workerId, leaseToken, leaseExpiresAt, input.now, outboxId],
          sql: `UPDATE ${q(database, "quality_replay_outbox")} SET ${q(database, "delivery_state")} = 'claimed', ${q(database, "lease_owner")} = ${p(database, 1)}, ${q(database, "lease_token")} = ${p(database, 2)}, ${q(database, "lease_expires_at")} = ${p(database, 3)}, ${q(database, "attempt")} = ${q(database, "attempt")} + 1, ${q(database, "updated_at")} = ${p(database, 4)} WHERE ${q(database, "id")} = ${p(database, 5)};`,
          tableName: "quality_replay_outbox",
        });
        await transaction.execute({
          maxRows: 0,
          operation: "update",
          params: [input.workerId, leaseToken, leaseExpiresAt, input.now, runId],
          sql: `UPDATE ${q(database, "quality_replay_runs")} SET ${q(database, "state")} = 'running', ${q(database, "lease_owner")} = ${p(database, 1)}, ${q(database, "lease_token")} = ${p(database, 2)}, ${q(database, "lease_expires_at")} = ${p(database, 3)}, ${q(database, "attempt")} = ${q(database, "attempt")} + 1, ${q(database, "revision")} = ${q(database, "revision")} + 1, ${q(database, "started_at")} = COALESCE(${q(database, "started_at")}, ${p(database, 4)}), ${q(database, "updated_at")} = ${p(database, 4)} WHERE ${q(database, "id")} = ${p(database, 5)} AND ${q(database, "state")} IN ('queued', 'running');`,
          tableName: "quality_replay_runs",
        });
        const run = await requireReplayById(database, transaction, runId);
        return Object.freeze({ ...run, leaseToken }) as QualityReplayRun;
      }),
    recordReplayItem: async (input) =>
      database.transaction(async (transaction) => {
        const candidate = await transaction.execute({
          maxRows: 1,
          operation: "select",
          params: [input.runId, input.expectedLeaseToken, input.now],
          sql: `SELECT * FROM ${q(database, "quality_replay_runs")} WHERE ${q(database, "id")} = ${p(database, 1)} AND ${q(database, "lease_token")} = ${p(database, 2)} AND ${q(database, "lease_expires_at")} >= ${p(database, 3)} AND ${q(database, "state")} = 'running' LIMIT 1;`,
          tableName: "quality_replay_runs",
        });
        const candidateRow = candidate.rows[0];
        if (!candidateRow) return false;
        const run = mapReplayRunRow(candidateRow, []);
        await lockActiveSpace(database, transaction, run.tenantId, run.knowledgeSpaceId);
        await assertStoredReplayPermissionFence(database, transaction, run, input.now);
        const lease = await transaction.execute({
          maxRows: 1,
          operation: "select",
          params: [input.runId, input.expectedLeaseToken, input.now, run.revision],
          sql: `SELECT ${q(database, "id")} FROM ${q(database, "quality_replay_runs")} WHERE ${q(database, "id")} = ${p(database, 1)} AND ${q(database, "lease_token")} = ${p(database, 2)} AND ${q(database, "lease_expires_at")} >= ${p(database, 3)} AND ${q(database, "state")} = 'running' AND ${q(database, "revision")} = ${p(database, 4)} LIMIT 1 FOR UPDATE;`,
          tableName: "quality_replay_runs",
        });
        if (!lease.rows[0]) return false;
        await assertReplayTraceVisible(database, transaction, run, input.traceId);
        const result = await transaction.execute({
          maxRows: 0,
          operation: "update",
          params: [
            input.state,
            JSON.stringify(input.result),
            input.traceId,
            input.now,
            input.itemId,
            input.runId,
          ],
          sql: `UPDATE ${q(database, "quality_replay_items")} SET ${q(database, "state")} = ${p(database, 1)}, ${q(database, "result")} = ${jsonP(database, 2)}, ${q(database, "trace_id")} = ${p(database, 3)}, ${q(database, "updated_at")} = ${p(database, 4)} WHERE ${q(database, "id")} = ${p(database, 5)} AND ${q(database, "run_id")} = ${p(database, 6)} AND ${q(database, "state")} = 'queued';`,
          tableName: "quality_replay_items",
        });
        return result.rowsAffected === 1;
      }),
    completeReplay: async (input) =>
      database.transaction(async (transaction) => {
        const candidate = await transaction.execute({
          maxRows: 1,
          operation: "select",
          params: [input.id, input.expectedLeaseToken, input.now],
          sql: `SELECT * FROM ${q(database, "quality_replay_runs")} WHERE ${q(database, "id")} = ${p(database, 1)} AND ${q(database, "lease_token")} = ${p(database, 2)} AND ${q(database, "lease_expires_at")} >= ${p(database, 3)} AND ${q(database, "state")} = 'running' LIMIT 1;`,
          tableName: "quality_replay_runs",
        });
        const candidateRow = candidate.rows[0];
        if (!candidateRow) return null;
        const candidateRun = mapReplayRunRow(candidateRow, []);
        await lockActiveSpace(
          database,
          transaction,
          candidateRun.tenantId,
          candidateRun.knowledgeSpaceId,
        );
        await assertStoredReplayPermissionFence(database, transaction, candidateRun, input.now);
        const selected = await transaction.execute({
          maxRows: 1,
          operation: "select",
          params: [input.id, input.expectedLeaseToken, input.now],
          sql: `SELECT * FROM ${q(database, "quality_replay_runs")} WHERE ${q(database, "id")} = ${p(database, 1)} AND ${q(database, "lease_token")} = ${p(database, 2)} AND ${q(database, "lease_expires_at")} >= ${p(database, 3)} AND ${q(database, "state")} = 'running' LIMIT 1 FOR UPDATE;`,
          tableName: "quality_replay_runs",
        });
        const row = selected.rows[0];
        if (!row) return null;
        const run = mapReplayRunRow(row, []);
        const counts = await transaction.execute({
          maxRows: 1,
          operation: "select",
          params: [run.id],
          sql: `SELECT ${countCase(database, `${q(database, "state")} <> 'passed'`)} AS ${q(database, "not_passed_count")} FROM ${q(database, "quality_replay_items")} WHERE ${q(database, "run_id")} = ${p(database, 1)};`,
          tableName: "quality_replay_items",
        });
        const notPassedCount = numeric(counts.rows[0]?.not_passed_count);
        const state =
          input.error || input.state === "failed" || notPassedCount > 0 ? "failed" : "passed";
        const completed = await transaction.execute({
          maxRows: 0,
          operation: "update",
          params: [state, input.error ?? null, input.now, run.id, input.expectedLeaseToken],
          sql: `UPDATE ${q(database, "quality_replay_runs")} SET ${q(database, "state")} = ${p(database, 1)}, ${q(database, "error_message")} = ${p(database, 2)}, ${q(database, "lease_owner")} = NULL, ${q(database, "lease_token")} = NULL, ${q(database, "lease_expires_at")} = NULL, ${q(database, "revision")} = ${q(database, "revision")} + 1, ${q(database, "completed_at")} = ${p(database, 3)}, ${q(database, "updated_at")} = ${p(database, 3)} WHERE ${q(database, "id")} = ${p(database, 4)} AND ${q(database, "lease_token")} = ${p(database, 5)};`,
          tableName: "quality_replay_runs",
        });
        if (completed.rowsAffected !== 1) return null;
        await transaction.execute({
          maxRows: 0,
          operation: "update",
          params: [input.now, run.id, input.expectedLeaseToken],
          sql: `UPDATE ${q(database, "quality_replay_outbox")} SET ${q(database, "delivery_state")} = 'delivered', ${q(database, "lease_owner")} = NULL, ${q(database, "lease_token")} = NULL, ${q(database, "lease_expires_at")} = NULL, ${q(database, "delivered_at")} = ${p(database, 1)}, ${q(database, "updated_at")} = ${p(database, 1)} WHERE ${q(database, "run_id")} = ${p(database, 2)} AND ${q(database, "lease_token")} = ${p(database, 3)};`,
          tableName: "quality_replay_outbox",
        });
        return requireReplayById(database, transaction, run.id);
      }),
    cancelReplay: async (input) =>
      database.transaction(async (transaction) => {
        const timestamp = now();
        await lockActiveSpace(database, transaction, input.tenantId, input.knowledgeSpaceId);
        const candidateGrants = await assertQualityWritePermissionFence(database, transaction, {
          actorSubjectId: input.actorSubjectId,
          candidateGrants: input.permission.candidateGrants,
          knowledgeSpaceId: input.knowledgeSpaceId,
          permission: input.permission,
          tenantId: input.tenantId,
          timestamp,
        });
        const selected = await selectReplayForMutation(
          database,
          transaction,
          input,
          candidateGrants,
        );
        if (!selected) return null;
        const current = mapReplayRunRow(selected, []);
        if (current.revision !== input.expectedRevision)
          throw new QualityControlRevisionConflictError();
        if (current.state === "passed" || current.state === "failed") return null;
        const canceled = await transaction.execute({
          maxRows: 0,
          operation: "update",
          params: [timestamp, input.id, input.expectedRevision],
          sql: `UPDATE ${q(database, "quality_replay_runs")} SET ${q(database, "state")} = 'canceled', ${q(database, "revision")} = ${q(database, "revision")} + 1, ${q(database, "lease_owner")} = NULL, ${q(database, "lease_token")} = NULL, ${q(database, "lease_expires_at")} = NULL, ${q(database, "completed_at")} = ${p(database, 1)}, ${q(database, "updated_at")} = ${p(database, 1)} WHERE ${q(database, "id")} = ${p(database, 2)} AND ${q(database, "revision")} = ${p(database, 3)};`,
          tableName: "quality_replay_runs",
        });
        if (canceled.rowsAffected !== 1) throw new QualityControlRevisionConflictError();
        await transaction.execute({
          maxRows: 0,
          operation: "update",
          params: [timestamp, input.id],
          sql: `UPDATE ${q(database, "quality_replay_items")} SET ${q(database, "state")} = 'canceled', ${q(database, "updated_at")} = ${p(database, 1)} WHERE ${q(database, "run_id")} = ${p(database, 2)} AND ${q(database, "state")} IN ('queued', 'running');`,
          tableName: "quality_replay_items",
        });
        await transaction.execute({
          maxRows: 0,
          operation: "update",
          params: [timestamp, input.id],
          sql: `UPDATE ${q(database, "quality_replay_outbox")} SET ${q(database, "delivery_state")} = 'delivered', ${q(database, "lease_owner")} = NULL, ${q(database, "lease_token")} = NULL, ${q(database, "lease_expires_at")} = NULL, ${q(database, "delivered_at")} = ${p(database, 1)}, ${q(database, "updated_at")} = ${p(database, 1)} WHERE ${q(database, "run_id")} = ${p(database, 2)} AND ${q(database, "delivery_state")} <> 'delivered';`,
          tableName: "quality_replay_outbox",
        });
        return requireReplayById(database, transaction, input.id);
      }),
    retryReplay: async (input) =>
      database.transaction(async (transaction) => {
        const timestamp = now();
        await lockActiveSpace(database, transaction, input.tenantId, input.knowledgeSpaceId);
        const candidateGrants = await assertQualityWritePermissionFence(database, transaction, {
          actorSubjectId: input.actorSubjectId,
          candidateGrants: input.permission.candidateGrants,
          knowledgeSpaceId: input.knowledgeSpaceId,
          permission: input.permission,
          tenantId: input.tenantId,
          timestamp,
        });
        const selected = await selectReplayForMutation(
          database,
          transaction,
          input,
          candidateGrants,
        );
        if (!selected) return null;
        const current = mapReplayRunRow(selected, []);
        if (current.revision !== input.expectedRevision)
          throw new QualityControlRevisionConflictError();
        if (current.state !== "failed" && current.state !== "canceled") return null;
        const nextRevision = current.revision + 1;
        await transaction.execute({
          maxRows: 0,
          operation: "update",
          params: [
            input.actorSubjectId,
            input.permission.accessChannel,
            input.permission.permissionSnapshotId,
            input.permission.permissionSnapshotRevision,
            JSON.stringify(candidateGrants),
            JSON.stringify(input.frozenSnapshot),
            nextRevision,
            timestamp,
            input.id,
            input.expectedRevision,
          ],
          sql: `UPDATE ${q(database, "quality_replay_runs")} SET ${q(database, "state")} = 'queued', ${q(database, "requested_by_subject_id")} = ${p(database, 1)}, ${q(database, "access_channel")} = ${p(database, 2)}, ${q(database, "permission_snapshot_id")} = ${p(database, 3)}, ${q(database, "permission_snapshot_revision")} = ${p(database, 4)}, ${q(database, "required_permission_scope")} = ${jsonP(database, 5)}, ${q(database, "frozen_snapshot")} = ${jsonP(database, 6)}, ${q(database, "revision")} = ${p(database, 7)}, ${q(database, "error_message")} = NULL, ${q(database, "started_at")} = NULL, ${q(database, "completed_at")} = NULL, ${q(database, "updated_at")} = ${p(database, 8)} WHERE ${q(database, "id")} = ${p(database, 9)} AND ${q(database, "revision")} = ${p(database, 10)};`,
          tableName: "quality_replay_runs",
        });
        await transaction.execute({
          maxRows: 0,
          operation: "update",
          params: [timestamp, input.id],
          sql: `UPDATE ${q(database, "quality_replay_items")} SET ${q(database, "state")} = 'queued', ${q(database, "result")} = NULL, ${q(database, "trace_id")} = NULL, ${q(database, "updated_at")} = ${p(database, 1)} WHERE ${q(database, "run_id")} = ${p(database, 2)};`,
          tableName: "quality_replay_items",
        });
        await transaction.execute({
          maxRows: 0,
          operation: "insert",
          params: [
            generateId(),
            input.id,
            nextRevision,
            "quality.replay.retried",
            "pending",
            0,
            timestamp,
            timestamp,
          ],
          sql: `INSERT INTO ${q(database, "quality_replay_outbox")} (${[
            "id",
            "run_id",
            "delivery_revision",
            "event_type",
            "delivery_state",
            "attempt",
            "created_at",
            "updated_at",
          ]
            .map((column) => q(database, column))
            .join(
              ", ",
            )}) VALUES (${Array.from({ length: 8 }, (_, index) => p(database, index + 1)).join(", ")});`,
          tableName: "quality_replay_outbox",
        });
        return requireReplayById(database, transaction, input.id);
      }),
    trends: async (input) => trends(database, input),
  };
}

async function listTraces(
  database: DatabaseAdapter,
  maxListLimit: number,
  input: QualityAnswerTraceHistoryInput,
): Promise<QualityAnswerTraceHistoryResult> {
  assertLimit(input.limit, maxListLimit);
  const params: DatabaseQueryValue[] = [
    input.tenantId,
    input.knowledgeSpaceId,
    input.subjectId,
    JSON.stringify(input.candidateGrants),
  ];
  const filters: string[] = [];
  if (input.query) {
    params.push(`%${escapeLike(input.query)}%`);
    filters.push(
      `LOWER(trace.${q(database, "query")}) LIKE LOWER(${p(database, params.length)}) ESCAPE '\\'`,
    );
  }
  if (input.from) {
    params.push(input.from);
    filters.push(`trace.${q(database, "created_at")} >= ${p(database, params.length)}`);
  }
  if (input.to) {
    params.push(input.to);
    filters.push(`trace.${q(database, "created_at")} < ${p(database, params.length)}`);
  }
  if (input.mode) {
    params.push(input.mode);
    filters.push(`trace.${q(database, "mode")} = ${p(database, params.length)}`);
  }
  if (input.status) {
    filters.push(
      input.status === "completed"
        ? `trace.${q(database, "completed")} = ${booleanLiteral(database, true)} AND NOT EXISTS (SELECT 1 FROM ${q(database, "answer_trace_steps")} terminal_step WHERE terminal_step.${q(database, "trace_id")} = trace.${q(database, "id")} AND terminal_step.${q(database, "status")} = 'error')`
        : `EXISTS (SELECT 1 FROM ${q(database, "answer_trace_steps")} terminal_step WHERE terminal_step.${q(database, "trace_id")} = trace.${q(database, "id")} AND terminal_step.${q(database, "status")} = 'error')`,
    );
  }
  if (input.cursor) {
    params.push(input.cursor.createdAt, input.cursor.id);
    filters.push(
      `(trace.${q(database, "created_at")} < ${p(database, params.length - 1)} OR (trace.${q(database, "created_at")} = ${p(database, params.length - 1)} AND trace.${q(database, "id")} < ${p(database, params.length)}))`,
    );
  }
  params.push(input.limit + 1);
  const result = await database.execute({
    maxRows: input.limit + 1,
    operation: "select",
    params,
    sql: `SELECT trace.*, bundle.${q(database, "state")} AS ${q(database, "evidence_state")}, bundle.${q(database, "items")} AS ${q(database, "evidence_items")} FROM ${q(database, "answer_traces")} trace INNER JOIN ${q(database, "knowledge_spaces")} space ON space.${q(database, "tenant_id")} = ${p(database, 1)} AND space.${q(database, "id")} = trace.${q(database, "knowledge_space_id")} AND space.${q(database, "lifecycle_state")} = 'active' AND space.${q(database, "deletion_job_id")} IS NULL INNER JOIN ${q(database, "knowledge_space_permission_snapshots")} permission ON permission.${q(database, "tenant_id")} = ${p(database, 1)} AND permission.${q(database, "knowledge_space_id")} = trace.${q(database, "knowledge_space_id")} AND permission.${q(database, "id")} = trace.${q(database, "permission_snapshot_id")} AND permission.${q(database, "subject_id")} = trace.${q(database, "subject_id")} LEFT JOIN ${q(database, "evidence_bundles")} bundle ON bundle.${q(database, "tenant_id")} = ${p(database, 1)} AND bundle.${q(database, "knowledge_space_id")} = trace.${q(database, "knowledge_space_id")} AND bundle.${q(database, "id")} = trace.${q(database, "evidence_bundle_id")} WHERE trace.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND trace.${q(database, "subject_id")} = ${p(database, 3)} AND ${permissionScopeSql(database, `permission.${q(database, "permission_scopes")}`, p(database, 4))}${filters.length ? ` AND ${filters.join(" AND ")}` : ""} ORDER BY trace.${q(database, "created_at")} DESC, trace.${q(database, "id")} DESC LIMIT ${p(database, params.length)};`,
    tableName: "answer_traces",
  });
  const pageRows = result.rows.slice(0, input.limit);
  const stepsByTrace = await loadTraceSteps(
    database,
    pageRows.map((row) => stringColumn(row, "id")),
  );
  const items = pageRows.map((row) =>
    mapTraceSummary(row, stepsByTrace.get(stringColumn(row, "id")) ?? []),
  );
  const last = items.at(-1);
  return {
    items,
    ...(result.rows.length > input.limit && last
      ? { nextCursor: { createdAt: last.createdAt, id: last.id } }
      : {}),
  };
}

async function loadTraceSteps(database: DatabaseAdapter, traceIds: readonly string[]) {
  const grouped = new Map<string, DatabaseRow[]>();
  if (traceIds.length === 0) return grouped;
  const result = await database.execute({
    maxRows: traceIds.length * 100,
    operation: "select",
    params: [...traceIds],
    sql: `SELECT * FROM ${q(database, "answer_trace_steps")} WHERE ${q(database, "trace_id")} IN (${traceIds.map((_, index) => p(database, index + 1)).join(", ")}) ORDER BY ${q(database, "started_at")} ASC, ${q(database, "id")} ASC LIMIT ${traceIds.length * 100};`,
    tableName: "answer_trace_steps",
  });
  for (const row of result.rows) {
    const id = stringColumn(row, "trace_id");
    grouped.set(id, [...(grouped.get(id) ?? []), row]);
  }
  return grouped;
}

function mapTraceSummary(
  row: DatabaseRow,
  steps: readonly DatabaseRow[],
): QualityAnswerTraceSummary {
  const evidenceItems = row.evidence_items == null ? [] : jsonArrayColumn(row, "evidence_items");
  const allScores = evidenceItems.flatMap((item) => {
    if (!isObject(item) || !isObject(item.scores)) return [];
    return [item.scores];
  });
  const score = (name: string) => maxFinite(allScores.map((scores) => scores[name]));
  const metadata = steps.map((step) => jsonObjectColumn(step, "metadata"));
  const profileMetadataValue = metadata.find((value) =>
    isObject(value.retrievalProfile),
  )?.retrievalProfile;
  const profileMetadata = isObject(profileMetadataValue) ? profileMetadataValue : undefined;
  const publicationMetadataValue = metadata.find((value) =>
    isObject(value.projectionSnapshot),
  )?.projectionSnapshot;
  const publicationMetadata = isObject(publicationMetadataValue)
    ? publicationMetadataValue
    : undefined;
  const embeddingMetadata = metadata.find(
    (value) =>
      typeof value.model === "string" &&
      typeof value.vectorSpaceId === "string" &&
      (typeof value.dimension === "number" || value.dimension === undefined),
  );
  const rerank =
    profileMetadata && isObject(profileMetadata.rerank) ? profileMetadata.rerank : undefined;
  return {
    completed: databaseBoolean(row.completed),
    createdAt: stringColumn(row, "created_at"),
    ...(optionalStringColumn(row, "evidence_bundle_id")
      ? { evidenceBundleId: optionalStringColumn(row, "evidence_bundle_id") }
      : {}),
    ...(optionalStringColumn(row, "evidence_state")
      ? { evidenceState: optionalStringColumn(row, "evidence_state") }
      : {}),
    ...(score("final") !== undefined ? { finalScore: score("final") } : {}),
    id: stringColumn(row, "id"),
    mode: stringColumn(row, "mode") as QualityAnswerTraceSummary["mode"],
    profile: {
      ...(profileMetadata && typeof profileMetadata.revision === "number"
        ? { retrievalProfileRevision: profileMetadata.revision }
        : {}),
      ...(profileMetadata &&
      isObject(profileMetadata.reasoningModel) &&
      typeof profileMetadata.reasoningModel.model === "string"
        ? { reasoningModel: profileMetadata.reasoningModel.model }
        : {}),
      ...(rerank && isObject(rerank.model) && typeof rerank.model.model === "string"
        ? { rerankModel: rerank.model.model }
        : {}),
      ...(embeddingMetadata && typeof embeddingMetadata.model === "string"
        ? { embeddingModel: embeddingMetadata.model }
        : {}),
      ...(embeddingMetadata && typeof embeddingMetadata.vectorSpaceId === "string"
        ? { embeddingVectorSpaceId: embeddingMetadata.vectorSpaceId }
        : {}),
      ...(publicationMetadata && typeof publicationMetadata.publicationId === "string"
        ? { projectionPublicationId: publicationMetadata.publicationId }
        : {}),
      ...(publicationMetadata && typeof publicationMetadata.projectionVersion === "number"
        ? { projectionVersion: publicationMetadata.projectionVersion }
        : {}),
    },
    query: stringColumn(row, "query"),
    scores: {
      ...(score("final") !== undefined ? { final: score("final") } : {}),
      ...(score("rerank") !== undefined ? { rerank: score("rerank") } : {}),
      ...(score("retrieval") !== undefined ? { retrieval: score("retrieval") } : {}),
    },
    stages: steps.map((step) => {
      const value = jsonObjectColumn(step, "metadata");
      return {
        ...(typeof value.candidateCount === "number"
          ? { candidateCount: value.candidateCount }
          : {}),
        name: stringColumn(step, "name"),
        status: stringColumn(step, "status") as "error" | "ok" | "skipped",
      };
    }),
  };
}

async function trends(
  database: DatabaseAdapter,
  input: Parameters<QualityControlRepository["trends"]>[0],
): Promise<QualityTrendReport> {
  const fromMs = Date.parse(input.from);
  const toMs = Date.parse(input.to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) {
    throw new Error("Quality trend window is invalid");
  }
  const baselineFrom = new Date(fromMs - (toMs - fromMs)).toISOString();
  const grants = JSON.stringify(input.candidateGrants);
  const result = await database.execute({
    maxRows: 1,
    operation: "select",
    params: [
      input.tenantId,
      input.knowledgeSpaceId,
      grants,
      input.from,
      input.to,
      baselineFrom,
      input.subjectId,
    ],
    sql: `SELECT ${countCase(database, `run.${q(database, "created_at")} >= ${p(database, 4)} AND run.${q(database, "created_at")} < ${p(database, 5)}`)} AS ${q(database, "current_total")}, ${countCase(database, `run.${q(database, "state")} = 'passed' AND run.${q(database, "created_at")} >= ${p(database, 4)} AND run.${q(database, "created_at")} < ${p(database, 5)}`)} AS ${q(database, "current_passed")}, ${countCase(database, `run.${q(database, "created_at")} >= ${p(database, 6)} AND run.${q(database, "created_at")} < ${p(database, 4)}`)} AS ${q(database, "baseline_total")}, ${countCase(database, `run.${q(database, "state")} = 'passed' AND run.${q(database, "created_at")} >= ${p(database, 6)} AND run.${q(database, "created_at")} < ${p(database, 4)}`)} AS ${q(database, "baseline_passed")} FROM ${q(database, "quality_replay_runs")} run WHERE run.${q(database, "tenant_id")} = ${p(database, 1)} AND run.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND run.${q(database, "requested_by_subject_id")} = ${p(database, 7)} AND ${permissionScopeSql(database, `run.${q(database, "required_permission_scope")}`, p(database, 3))} AND run.${q(database, "created_at")} >= ${p(database, 6)} AND run.${q(database, "created_at")} < ${p(database, 5)};`,
    tableName: "quality_replay_runs",
  });
  const failed = await database.execute({
    maxRows: 2,
    operation: "select",
    params: [
      input.tenantId,
      input.knowledgeSpaceId,
      input.from,
      input.to,
      baselineFrom,
      grants,
      input.subjectId,
    ],
    sql: `SELECT ${countCase(database, `failed.${q(database, "created_at")} >= ${p(database, 3)} AND failed.${q(database, "created_at")} < ${p(database, 4)}`)} AS ${q(database, "current_failed")}, ${countCase(database, `failed.${q(database, "created_at")} >= ${p(database, 5)} AND failed.${q(database, "created_at")} < ${p(database, 3)}`)} AS ${q(database, "baseline_failed")} FROM ${q(database, "failed_queries")} failed INNER JOIN ${q(database, "answer_traces")} trace ON trace.${q(database, "knowledge_space_id")} = failed.${q(database, "knowledge_space_id")} AND trace.${q(database, "id")} = failed.${q(database, "answer_trace_id")} AND trace.${q(database, "subject_id")} = ${p(database, 7)} INNER JOIN ${q(database, "knowledge_space_permission_snapshots")} permission ON permission.${q(database, "tenant_id")} = ${p(database, 1)} AND permission.${q(database, "knowledge_space_id")} = trace.${q(database, "knowledge_space_id")} AND permission.${q(database, "id")} = trace.${q(database, "permission_snapshot_id")} WHERE failed.${q(database, "tenant_id")} = ${p(database, 1)} AND failed.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${qualityFailedQueryVisibleSql(database, "failed", p(database, 7), p(database, 6))} AND failed.${q(database, "created_at")} >= ${p(database, 5)} AND failed.${q(database, "created_at")} < ${p(database, 4)} AND ${permissionScopeSql(database, `permission.${q(database, "permission_scopes")}`, p(database, 6))};`,
    tableName: "failed_queries",
  });
  const badCases = await database.execute({
    maxRows: 10,
    operation: "select",
    params: [input.tenantId, input.knowledgeSpaceId, grants, input.from, input.to, input.subjectId],
    sql: `SELECT ${q(database, "status")}, ${countAll(database)} AS ${q(database, "count")} FROM ${q(database, "quality_bad_cases")} bad_case WHERE bad_case.${q(database, "tenant_id")} = ${p(database, 1)} AND bad_case.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND bad_case.${q(database, "actor_subject_id")} = ${p(database, 6)} AND ${permissionScopeSql(database, `bad_case.${q(database, "required_permission_scope")}`, p(database, 3))} AND bad_case.${q(database, "created_at")} >= ${p(database, 4)} AND bad_case.${q(database, "created_at")} < ${p(database, 5)} GROUP BY ${q(database, "status")};`,
    tableName: "quality_bad_cases",
  });
  const slices = await database.execute({
    maxRows: 100,
    operation: "select",
    params: [input.tenantId, input.knowledgeSpaceId, grants, input.from, input.to, input.subjectId],
    sql: `SELECT run.${q(database, "mode")}, ${snapshotTextSql(database, `run.${q(database, "frozen_snapshot")}`, "$.retrievalProfile.reasoningModel.model")} AS ${q(database, "model")}, ${snapshotIntegerSql(database, `run.${q(database, "frozen_snapshot")}`, "$.retrievalProfile.revision")} AS ${q(database, "profile_revision")}, ${countAll(database)} AS ${q(database, "replay_runs")}, ${countCase(database, `run.${q(database, "state")} = 'passed'`)} AS ${q(database, "passed_runs")} FROM ${q(database, "quality_replay_runs")} run WHERE run.${q(database, "tenant_id")} = ${p(database, 1)} AND run.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND run.${q(database, "requested_by_subject_id")} = ${p(database, 6)} AND ${permissionScopeSql(database, `run.${q(database, "required_permission_scope")}`, p(database, 3))} AND run.${q(database, "created_at")} >= ${p(database, 4)} AND run.${q(database, "created_at")} < ${p(database, 5)} GROUP BY run.${q(database, "mode")}, ${snapshotTextSql(database, `run.${q(database, "frozen_snapshot")}`, "$.retrievalProfile.reasoningModel.model")}, ${snapshotIntegerSql(database, `run.${q(database, "frozen_snapshot")}`, "$.retrievalProfile.revision")} ORDER BY ${q(database, "replay_runs")} DESC LIMIT 100;`,
    tableName: "quality_replay_runs",
  });
  const failedModel = traceStepTextSql(
    database,
    "trace",
    "$.retrievalProfile.reasoningModel.model",
  );
  const failedProfileRevision = traceStepIntegerSql(
    database,
    "trace",
    "$.retrievalProfile.revision",
  );
  const failedSlices = await database.execute({
    maxRows: 100,
    operation: "select",
    params: [input.tenantId, input.knowledgeSpaceId, input.from, input.to, grants, input.subjectId],
    sql: `SELECT trace.${q(database, "mode")}, COALESCE(${failedModel}, 'unknown') AS ${q(database, "model")}, COALESCE(${failedProfileRevision}, 0) AS ${q(database, "profile_revision")}, ${countAll(database)} AS ${q(database, "failed_queries")} FROM ${q(database, "failed_queries")} failed INNER JOIN ${q(database, "answer_traces")} trace ON trace.${q(database, "knowledge_space_id")} = failed.${q(database, "knowledge_space_id")} AND trace.${q(database, "id")} = failed.${q(database, "answer_trace_id")} AND trace.${q(database, "subject_id")} = ${p(database, 6)} INNER JOIN ${q(database, "knowledge_space_permission_snapshots")} permission ON permission.${q(database, "tenant_id")} = ${p(database, 1)} AND permission.${q(database, "knowledge_space_id")} = trace.${q(database, "knowledge_space_id")} AND permission.${q(database, "id")} = trace.${q(database, "permission_snapshot_id")} WHERE failed.${q(database, "tenant_id")} = ${p(database, 1)} AND failed.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${qualityFailedQueryVisibleSql(database, "failed", p(database, 6), p(database, 5))} AND failed.${q(database, "created_at")} >= ${p(database, 3)} AND failed.${q(database, "created_at")} < ${p(database, 4)} AND ${permissionScopeSql(database, `permission.${q(database, "permission_scopes")}`, p(database, 5))} GROUP BY trace.${q(database, "mode")}, COALESCE(${failedModel}, 'unknown'), COALESCE(${failedProfileRevision}, 0) ORDER BY ${q(database, "failed_queries")} DESC LIMIT 100;`,
    tableName: "failed_queries",
  });
  const top = await database.execute({
    maxRows: input.topLimit,
    operation: "select",
    params: [
      input.tenantId,
      input.knowledgeSpaceId,
      input.from,
      input.to,
      grants,
      input.topLimit,
      input.subjectId,
    ],
    sql: `SELECT failed.${q(database, "query")}, ${countAll(database)} AS ${q(database, "count")} FROM ${q(database, "failed_queries")} failed INNER JOIN ${q(database, "answer_traces")} trace ON trace.${q(database, "knowledge_space_id")} = failed.${q(database, "knowledge_space_id")} AND trace.${q(database, "id")} = failed.${q(database, "answer_trace_id")} AND trace.${q(database, "subject_id")} = ${p(database, 7)} INNER JOIN ${q(database, "knowledge_space_permission_snapshots")} permission ON permission.${q(database, "tenant_id")} = ${p(database, 1)} AND permission.${q(database, "knowledge_space_id")} = trace.${q(database, "knowledge_space_id")} AND permission.${q(database, "id")} = trace.${q(database, "permission_snapshot_id")} WHERE failed.${q(database, "tenant_id")} = ${p(database, 1)} AND failed.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${qualityFailedQueryVisibleSql(database, "failed", p(database, 7), p(database, 5))} AND failed.${q(database, "created_at")} >= ${p(database, 3)} AND failed.${q(database, "created_at")} < ${p(database, 4)} AND failed.${q(database, "status")} NOT IN ('dismissed', 'promoted') AND ${permissionScopeSql(database, `permission.${q(database, "permission_scopes")}`, p(database, 5))} GROUP BY failed.${q(database, "query")} ORDER BY ${q(database, "count")} DESC, failed.${q(database, "query")} ASC LIMIT ${p(database, 6)};`,
    tableName: "failed_queries",
  });
  const row = result.rows[0] ?? {};
  const failedRow = failed.rows[0] ?? {};
  const currentTotal = numeric(row.current_total);
  const baselineTotal = numeric(row.baseline_total);
  const byStatus: Record<QualityBadCaseState, number> = {
    dismissed: 0,
    fixed: 0,
    open: 0,
    replaying: 0,
  };
  for (const statusRow of badCases.rows) {
    const status = stringColumn(statusRow, "status") as QualityBadCaseState;
    if (status in byStatus) byStatus[status] = numeric(statusRow.count);
  }
  const sliceMap = new Map<string, QualityTrendReport["slices"][number]>();
  for (const slice of slices.rows) {
    const total = numeric(slice.replay_runs);
    const mapped = {
      failedQueries: 0,
      mode: stringColumn(slice, "mode"),
      model: optionalStringColumn(slice, "model") ?? "unknown",
      passRate: total === 0 ? 0 : numeric(slice.passed_runs) / total,
      profileRevision: numeric(slice.profile_revision),
      replayRuns: total,
    };
    sliceMap.set(sliceKey(mapped), mapped);
  }
  for (const slice of failedSlices.rows) {
    const identity = {
      mode: stringColumn(slice, "mode"),
      model: optionalStringColumn(slice, "model") ?? "unknown",
      profileRevision: numeric(slice.profile_revision),
    };
    const key = sliceKey(identity);
    const existing = sliceMap.get(key);
    sliceMap.set(key, {
      failedQueries: numeric(slice.failed_queries),
      mode: identity.mode,
      model: identity.model,
      passRate: existing?.passRate ?? 0,
      profileRevision: identity.profileRevision,
      replayRuns: existing?.replayRuns ?? 0,
    });
  }
  return {
    baseline: {
      failedQueries: numeric(failedRow.baseline_failed),
      passRate: baselineTotal === 0 ? 0 : numeric(row.baseline_passed) / baselineTotal,
      totalReplays: baselineTotal,
    },
    current: {
      badCases: byStatus,
      failedQueries: numeric(failedRow.current_failed),
      passRate: currentTotal === 0 ? 0 : numeric(row.current_passed) / currentTotal,
      totalReplays: currentTotal,
    },
    from: input.from,
    slices: [...sliceMap.values()].sort(
      (left, right) =>
        right.replayRuns - left.replayRuns ||
        right.failedQueries - left.failedQueries ||
        left.mode.localeCompare(right.mode) ||
        left.model.localeCompare(right.model) ||
        left.profileRevision - right.profileRevision,
    ),
    to: input.to,
    topUnanswered: top.rows.map((item) => ({
      count: numeric(item.count),
      query: stringColumn(item, "query"),
    })),
  };
}

async function insertReplayRun(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: {
    readonly frozenSnapshot: FrozenQualityRuntimeSnapshot;
    readonly id: string;
    readonly idempotencyKey: string;
    readonly knowledgeSpaceId: string;
    readonly mode: string;
    readonly permission: QualityPermissionBinding;
    readonly requestFingerprint: string;
    readonly tenantId: string;
    readonly timestamp: string;
  },
) {
  const params: DatabaseQueryValue[] = [
    input.id,
    input.tenantId,
    input.knowledgeSpaceId,
    input.idempotencyKey,
    input.requestFingerprint,
    input.mode,
    "queued",
    input.permission.requestedBySubjectId,
    input.permission.accessChannel,
    input.permission.permissionSnapshotId,
    input.permission.permissionSnapshotRevision,
    JSON.stringify(input.permission.candidateGrants),
    JSON.stringify(input.frozenSnapshot),
    1,
    0,
    input.timestamp,
    input.timestamp,
  ];
  await executor.execute({
    maxRows: 0,
    operation: "insert",
    params,
    sql: `INSERT INTO ${q(database, "quality_replay_runs")} (${[
      "id",
      "tenant_id",
      "knowledge_space_id",
      "idempotency_key",
      "request_fingerprint",
      "mode",
      "state",
      "requested_by_subject_id",
      "access_channel",
      "permission_snapshot_id",
      "permission_snapshot_revision",
      "required_permission_scope",
      "frozen_snapshot",
      "revision",
      "attempt",
      "created_at",
      "updated_at",
    ]
      .map((column) => q(database, column))
      .join(
        ", ",
      )}) VALUES (${params.map((_, index) => (index === 11 || index === 12 ? jsonP(database, index + 1) : p(database, index + 1))).join(", ")});`,
    tableName: "quality_replay_runs",
  });
}

async function requireReplayById(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  id: string,
): Promise<QualityReplayRun> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [id],
    sql: `SELECT * FROM ${q(database, "quality_replay_runs")} WHERE ${q(database, "id")} = ${p(database, 1)} LIMIT 1;`,
    tableName: "quality_replay_runs",
  });
  if (!result.rows[0]) throw new Error("Quality replay run disappeared");
  return loadReplay(database, executor, result.rows[0]);
}

async function loadReplay(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  row: DatabaseRow,
): Promise<QualityReplayRun> {
  const items = await executor.execute({
    maxRows: 10_000,
    operation: "select",
    params: [stringColumn(row, "id")],
    sql: `SELECT * FROM ${q(database, "quality_replay_items")} WHERE ${q(database, "run_id")} = ${p(database, 1)} ORDER BY ${q(database, "ordinal")} ASC LIMIT 10000;`,
    tableName: "quality_replay_items",
  });
  return mapReplayRunRow(row, items.rows.map(mapReplayItem));
}

function mapReplayRunRow(row: DatabaseRow, items: readonly QualityReplayItem[]): QualityReplayRun {
  return {
    attempt: numberColumn(row, "attempt"),
    createdAt: stringColumn(row, "created_at"),
    ...(optionalStringColumn(row, "error_message")
      ? { error: optionalStringColumn(row, "error_message") }
      : {}),
    frozenSnapshot: jsonObjectColumn(
      row,
      "frozen_snapshot",
    ) as unknown as FrozenQualityRuntimeSnapshot,
    id: stringColumn(row, "id"),
    items,
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    mode: stringColumn(row, "mode") as QualityReplayRun["mode"],
    permission: {
      accessChannel: stringColumn(
        row,
        "access_channel",
      ) as QualityPermissionBinding["accessChannel"],
      candidateGrants: jsonStringArrayColumn(row, "required_permission_scope"),
      permissionSnapshotId: stringColumn(row, "permission_snapshot_id"),
      permissionSnapshotRevision: numberColumn(row, "permission_snapshot_revision"),
      requestedBySubjectId: stringColumn(row, "requested_by_subject_id"),
    },
    revision: numberColumn(row, "revision"),
    state: stringColumn(row, "state") as QualityReplayRun["state"],
    tenantId: stringColumn(row, "tenant_id"),
    updatedAt: stringColumn(row, "updated_at"),
  };
}

function mapReplayItem(row: DatabaseRow): QualityReplayItem {
  return {
    expectedEvidenceIds: jsonStringArrayColumn(row, "expected_evidence_ids"),
    goldenQuestionId: stringColumn(row, "golden_question_id"),
    id: stringColumn(row, "id"),
    ordinal: numberColumn(row, "ordinal"),
    question: stringColumn(row, "question"),
    ...(row.result == null ? {} : { result: jsonObjectColumn(row, "result") }),
    state: stringColumn(row, "state") as QualityReplayItem["state"],
    ...(optionalStringColumn(row, "trace_id")
      ? { traceId: optionalStringColumn(row, "trace_id") }
      : {}),
  };
}

async function selectReplayForMutation(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: {
    readonly actorSubjectId: string;
    readonly id: string;
    readonly knowledgeSpaceId: string;
    readonly tenantId: string;
  },
  candidateGrants: readonly string[],
) {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [
      input.tenantId,
      input.knowledgeSpaceId,
      input.id,
      input.actorSubjectId,
      JSON.stringify(candidateGrants),
    ],
    sql: `SELECT run.* FROM ${q(database, "quality_replay_runs")} run INNER JOIN ${q(database, "knowledge_spaces")} space ON space.${q(database, "tenant_id")} = run.${q(database, "tenant_id")} AND space.${q(database, "id")} = run.${q(database, "knowledge_space_id")} AND space.${q(database, "lifecycle_state")} = 'active' AND space.${q(database, "deletion_job_id")} IS NULL WHERE run.${q(database, "tenant_id")} = ${p(database, 1)} AND run.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND run.${q(database, "id")} = ${p(database, 3)} AND run.${q(database, "requested_by_subject_id")} = ${p(database, 4)} AND ${permissionScopeSql(database, `run.${q(database, "required_permission_scope")}`, p(database, 5))} LIMIT 1 FOR UPDATE;`,
    tableName: "quality_replay_runs",
  });
  return result.rows[0];
}

async function selectMissingReview(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  tenantId: string,
  knowledgeSpaceId: string,
  traceId: string,
  itemKey: string,
  actorSubjectId: string,
  candidateGrants: readonly string[],
  forUpdate: boolean,
) {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [
      tenantId,
      knowledgeSpaceId,
      traceId,
      itemKey,
      actorSubjectId,
      JSON.stringify(candidateGrants),
    ],
    sql: `SELECT * FROM ${q(database, "quality_missing_evidence_reviews")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "trace_id")} = ${p(database, 3)} AND ${q(database, "item_key")} = ${p(database, 4)} AND ${q(database, "actor_subject_id")} = ${p(database, 5)} AND ${permissionScopeSql(database, q(database, "required_permission_scope"), p(database, 6))} LIMIT 1${forUpdate ? " FOR UPDATE" : ""};`,
    tableName: "quality_missing_evidence_reviews",
  });
  return result.rows[0];
}

async function selectBadCase(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  tenantId: string,
  knowledgeSpaceId: string,
  id: string,
  actorSubjectId: string,
  candidateGrants: readonly string[],
  forUpdate: boolean,
) {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [tenantId, knowledgeSpaceId, id, actorSubjectId, JSON.stringify(candidateGrants)],
    sql: `SELECT * FROM ${q(database, "quality_bad_cases")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "id")} = ${p(database, 3)} AND ${q(database, "actor_subject_id")} = ${p(database, 4)} AND ${permissionScopeSql(database, q(database, "required_permission_scope"), p(database, 5))} LIMIT 1${forUpdate ? " FOR UPDATE" : ""};`,
    tableName: "quality_bad_cases",
  });
  return result.rows[0];
}

async function assertTraceCandidateVisible(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: {
    readonly actorSubjectId: string;
    readonly candidateGrants: readonly string[];
    readonly knowledgeSpaceId: string;
    readonly tenantId: string;
    readonly timestamp: string;
    readonly traceId: string;
  },
) {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [
      input.tenantId,
      input.knowledgeSpaceId,
      input.traceId,
      input.actorSubjectId,
      JSON.stringify(input.candidateGrants),
      input.timestamp,
    ],
    sql: `SELECT trace.${q(database, "id")} FROM ${q(database, "answer_traces")} trace INNER JOIN ${q(database, "knowledge_space_permission_snapshots")} permission ON permission.${q(database, "tenant_id")} = ${p(database, 1)} AND permission.${q(database, "knowledge_space_id")} = trace.${q(database, "knowledge_space_id")} AND permission.${q(database, "id")} = trace.${q(database, "permission_snapshot_id")} AND permission.${q(database, "subject_id")} = trace.${q(database, "subject_id")} AND permission.${q(database, "access_channel")} = trace.${q(database, "access_channel")} AND permission.${q(database, "revision")} = trace.${q(database, "permission_snapshot_revision")} WHERE trace.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND trace.${q(database, "id")} = ${p(database, 3)} AND trace.${q(database, "subject_id")} = ${p(database, 4)} AND permission.${q(database, "status")} = 'active' AND permission.${q(database, "revoked_at")} IS NULL AND permission.${q(database, "expires_at")} > ${p(database, 6)} AND ${permissionScopeSql(database, `permission.${q(database, "permission_scopes")}`, p(database, 5))} LIMIT 1 FOR UPDATE;`,
    tableName: "answer_traces",
  });
  if (!result.rows[0]) throw new Error("Answer trace is not visible");
}

async function assertReplayTraceVisible(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  run: QualityReplayRun,
  traceId: string,
): Promise<void> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [
      run.tenantId,
      run.knowledgeSpaceId,
      traceId,
      run.permission.requestedBySubjectId,
      run.permission.accessChannel,
      run.permission.permissionSnapshotId,
      run.permission.permissionSnapshotRevision,
      JSON.stringify(run.permission.candidateGrants),
    ],
    sql: `SELECT trace.${q(database, "id")} FROM ${q(database, "answer_traces")} trace INNER JOIN ${q(database, "knowledge_space_permission_snapshots")} permission ON permission.${q(database, "tenant_id")} = ${p(database, 1)} AND permission.${q(database, "knowledge_space_id")} = trace.${q(database, "knowledge_space_id")} AND permission.${q(database, "id")} = trace.${q(database, "permission_snapshot_id")} AND permission.${q(database, "subject_id")} = trace.${q(database, "subject_id")} AND permission.${q(database, "access_channel")} = trace.${q(database, "access_channel")} WHERE trace.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND trace.${q(database, "id")} = ${p(database, 3)} AND trace.${q(database, "subject_id")} = ${p(database, 4)} AND trace.${q(database, "access_channel")} = ${p(database, 5)} AND trace.${q(database, "permission_snapshot_id")} = ${p(database, 6)} AND trace.${q(database, "permission_snapshot_revision")} = ${p(database, 7)} AND ${permissionScopeSql(database, `permission.${q(database, "permission_scopes")}`, p(database, 8))} LIMIT 1 FOR UPDATE;`,
    tableName: "answer_traces",
  });
  if (!result.rows[0]) throw new Error("Quality replay answer trace is not visible");
}

async function assertQualityWritePermissionFence(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: {
    readonly actorSubjectId: string;
    readonly candidateGrants: readonly string[];
    readonly knowledgeSpaceId: string;
    readonly permission: QualityPermissionBinding;
    readonly tenantId: string;
    readonly timestamp: string;
  },
) {
  if (
    input.permission.requestedBySubjectId !== input.actorSubjectId ||
    !sameStringSet(input.permission.candidateGrants, input.candidateGrants)
  ) {
    throw new KnowledgeSpaceAccessError(
      "space_access_permission_snapshot_invalid",
      "Quality write permission binding does not match the current actor and candidate grants",
    );
  }
  const validated = await assertDatabaseKnowledgeSpacePermissionFence({
    database,
    executor,
    fence: {
      accessChannel: input.permission.accessChannel,
      knowledgeSpaceId: input.knowledgeSpaceId,
      permissionSnapshotId: input.permission.permissionSnapshotId,
      permissionSnapshotRevision: input.permission.permissionSnapshotRevision,
      requestedBySubjectId: input.permission.requestedBySubjectId,
      tenantId: input.tenantId,
    },
    now: input.timestamp,
    requiredAccess: "write",
  });
  if (!sameStringSet(validated.permissionScopes, input.permission.candidateGrants)) {
    throw new KnowledgeSpaceAccessError(
      "space_access_permission_snapshot_invalid",
      "Quality write permission scopes no longer match the server-issued binding",
    );
  }
  return [...validated.permissionScopes];
}

async function assertStoredReplayPermissionFence(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  run: QualityReplayRun,
  timestamp: string,
): Promise<void> {
  const validated = await assertDatabaseKnowledgeSpacePermissionFence({
    database,
    executor,
    fence: {
      accessChannel: run.permission.accessChannel,
      knowledgeSpaceId: run.knowledgeSpaceId,
      permissionSnapshotId: run.permission.permissionSnapshotId,
      permissionSnapshotRevision: run.permission.permissionSnapshotRevision,
      requestedBySubjectId: run.permission.requestedBySubjectId,
      tenantId: run.tenantId,
    },
    now: timestamp,
    requiredAccess: "write",
  });
  if (!sameStringSet(validated.permissionScopes, run.permission.candidateGrants)) {
    throw new KnowledgeSpaceAccessError(
      "space_access_permission_snapshot_invalid",
      "Quality replay permission scopes no longer match the frozen run",
    );
  }
}

function sameStringSet(left: readonly string[], right: readonly string[]) {
  if (left.length !== right.length) return false;
  const expected = new Set(left);
  return (
    expected.size === left.length &&
    new Set(right).size === right.length &&
    right.every((value) => expected.has(value))
  );
}

async function lockActiveSpace(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  tenantId: string,
  knowledgeSpaceId: string,
) {
  if (
    !(await lockKnowledgeSpaceForDeletionAdmission(database, executor, {
      knowledgeSpaceId,
      tenantId,
    }))
  ) {
    throw new Error("Quality write rejected by durable deletion");
  }
}

async function appendHistory(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: {
    readonly action: string;
    readonly actorSubjectId: string;
    readonly aggregateId: string;
    readonly aggregateType: string;
    readonly fromStatus?: string | undefined;
    readonly generateId: () => string;
    readonly knowledgeSpaceId: string;
    readonly reason?: string | undefined;
    readonly revision: number;
    readonly tenantId: string;
    readonly timestamp: string;
    readonly toStatus: string;
  },
) {
  await executor.execute({
    maxRows: 0,
    operation: "insert",
    params: [
      input.generateId(),
      input.tenantId,
      input.knowledgeSpaceId,
      input.aggregateType,
      input.aggregateId,
      input.action,
      input.actorSubjectId,
      input.fromStatus ?? null,
      input.toStatus,
      input.reason ?? null,
      input.revision,
      input.timestamp,
    ],
    sql: `INSERT INTO ${q(database, "quality_resource_history")} (${[
      "id",
      "tenant_id",
      "knowledge_space_id",
      "aggregate_type",
      "aggregate_id",
      "action",
      "actor_subject_id",
      "from_status",
      "to_status",
      "reason",
      "revision",
      "created_at",
    ]
      .map((column) => q(database, column))
      .join(
        ", ",
      )}) VALUES (${Array.from({ length: 12 }, (_, index) => p(database, index + 1)).join(", ")});`,
    tableName: "quality_resource_history",
  });
}

function mapMissingReview(row: DatabaseRow): MissingEvidenceReview {
  return {
    actorSubjectId: stringColumn(row, "actor_subject_id"),
    createdAt: stringColumn(row, "created_at"),
    id: stringColumn(row, "id"),
    itemKey: stringColumn(row, "item_key"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    ...(optionalStringColumn(row, "reason") ? { reason: optionalStringColumn(row, "reason") } : {}),
    revision: numberColumn(row, "revision"),
    status: stringColumn(row, "status") as MissingEvidenceReview["status"],
    traceId: stringColumn(row, "trace_id"),
    updatedAt: stringColumn(row, "updated_at"),
  };
}

function mapBadCase(row: DatabaseRow): ProductionBadCase {
  return {
    actorSubjectId: stringColumn(row, "actor_subject_id"),
    createdAt: stringColumn(row, "created_at"),
    id: stringColumn(row, "id"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    reason: stringColumn(row, "reason"),
    ...(optionalStringColumn(row, "replay_run_id")
      ? { replayRunId: optionalStringColumn(row, "replay_run_id") }
      : {}),
    revision: numberColumn(row, "revision"),
    status: stringColumn(row, "status") as QualityBadCaseState,
    tags: jsonStringArrayColumn(row, "tags"),
    traceId: stringColumn(row, "trace_id"),
    updatedAt: stringColumn(row, "updated_at"),
  };
}

function mapHistoryEvent(row: DatabaseRow): QualityHistoryEvent {
  return {
    action: stringColumn(row, "action"),
    actorSubjectId: stringColumn(row, "actor_subject_id"),
    createdAt: stringColumn(row, "created_at"),
    ...(optionalStringColumn(row, "from_status")
      ? { fromStatus: optionalStringColumn(row, "from_status") }
      : {}),
    id: stringColumn(row, "id"),
    ...(optionalStringColumn(row, "reason") ? { reason: optionalStringColumn(row, "reason") } : {}),
    revision: numberColumn(row, "revision"),
    toStatus: stringColumn(row, "to_status"),
  };
}

function validateBadCaseTransition(from: QualityBadCaseState, to: QualityBadCaseState) {
  const allowed: Readonly<Record<QualityBadCaseState, readonly QualityBadCaseState[]>> = {
    dismissed: ["open"],
    fixed: ["open", "replaying"],
    open: ["dismissed", "replaying"],
    replaying: ["dismissed", "fixed", "open"],
  };
  if (from !== to && !allowed[from].includes(to)) {
    throw new Error(`Invalid bad-case transition ${from} -> ${to}`);
  }
}

function historyAggregateVisibleSql(database: DatabaseAdapter, subject: string, grants: string) {
  return `((history.${q(database, "aggregate_type")} = 'bad-case' AND EXISTS (SELECT 1 FROM ${q(database, "quality_bad_cases")} bad_case WHERE bad_case.${q(database, "tenant_id")} = history.${q(database, "tenant_id")} AND bad_case.${q(database, "knowledge_space_id")} = history.${q(database, "knowledge_space_id")} AND bad_case.${q(database, "id")} = history.${q(database, "aggregate_id")} AND bad_case.${q(database, "actor_subject_id")} = ${subject} AND ${permissionScopeSql(database, `bad_case.${q(database, "required_permission_scope")}`, grants)})) OR (history.${q(database, "aggregate_type")} = 'missing-evidence' AND EXISTS (SELECT 1 FROM ${q(database, "quality_missing_evidence_reviews")} review WHERE review.${q(database, "tenant_id")} = history.${q(database, "tenant_id")} AND review.${q(database, "knowledge_space_id")} = history.${q(database, "knowledge_space_id")} AND review.${q(database, "id")} = history.${q(database, "aggregate_id")} AND review.${q(database, "actor_subject_id")} = ${subject} AND ${permissionScopeSql(database, `review.${q(database, "required_permission_scope")}`, grants)})))`;
}

function permissionScopeSql(database: DatabaseAdapter, column: string, grants: string) {
  return database.dialect === "postgres"
    ? `(jsonb_typeof(${column}) = 'array' AND ${grants}::jsonb @> ${column})`
    : `(JSON_TYPE(${column}) = 'ARRAY' AND JSON_CONTAINS(CAST(${grants} AS JSON), ${column}))`;
}

function snapshotTextSql(database: DatabaseAdapter, column: string, path: string) {
  const keys = path.replace(/^\$\./, "").split(".");
  return database.dialect === "postgres"
    ? `${keys.reduce((value, key, index) => `${value} ${index === keys.length - 1 ? "->>" : "->"} '${key}'`, column)}`
    : `JSON_UNQUOTE(JSON_EXTRACT(${column}, '${path}'))`;
}

function snapshotIntegerSql(database: DatabaseAdapter, column: string, path: string) {
  const text = snapshotTextSql(database, column, path);
  return database.dialect === "postgres" ? `CAST(${text} AS INTEGER)` : `CAST(${text} AS SIGNED)`;
}

function traceStepTextSql(database: DatabaseAdapter, traceAlias: string, path: string) {
  const value = snapshotTextSql(database, `provenance_step.${q(database, "metadata")}`, path);
  return `(SELECT ${value} FROM ${q(database, "answer_trace_steps")} provenance_step WHERE provenance_step.${q(database, "trace_id")} = ${traceAlias}.${q(database, "id")} AND ${value} IS NOT NULL ORDER BY provenance_step.${q(database, "started_at")} DESC, provenance_step.${q(database, "id")} DESC LIMIT 1)`;
}

function traceStepIntegerSql(database: DatabaseAdapter, traceAlias: string, path: string) {
  const text = traceStepTextSql(database, traceAlias, path);
  return database.dialect === "postgres" ? `CAST(${text} AS INTEGER)` : `CAST(${text} AS SIGNED)`;
}

function sliceKey(input: {
  readonly mode: string;
  readonly model: string;
  readonly profileRevision: number;
}) {
  return `${input.mode}\u0000${input.model}\u0000${input.profileRevision}`;
}

function countAll(database: DatabaseAdapter) {
  return database.dialect === "postgres" ? "CAST(COUNT(*) AS INTEGER)" : "CAST(COUNT(*) AS SIGNED)";
}

function countCase(database: DatabaseAdapter, predicate: string) {
  return database.dialect === "postgres"
    ? `CAST(COALESCE(SUM(CASE WHEN ${predicate} THEN 1 ELSE 0 END), 0) AS INTEGER)`
    : `CAST(COALESCE(SUM(CASE WHEN ${predicate} THEN 1 ELSE 0 END), 0) AS SIGNED)`;
}

function booleanLiteral(database: DatabaseAdapter, value: boolean) {
  return database.dialect === "postgres" ? (value ? "TRUE" : "FALSE") : value ? "1" : "0";
}

function databaseBoolean(value: unknown): boolean {
  if (value === true || value === 1 || value === "1") return true;
  if (value === false || value === 0 || value === "0") return false;
  throw new Error("Database boolean column has an invalid value");
}

function qualityFailedQueryVisibleSql(
  database: DatabaseAdapter,
  alias: string,
  subject: string,
  grants: string,
) {
  const column = (name: string) => `${alias}.${q(database, name)}`;
  return `${column("requested_by_subject_id")} = ${subject} AND ${column("access_channel")} IN ('interactive', 'service_api', 'mcp', 'agent') AND ${column("permission_snapshot_id")} IS NOT NULL AND ${column("permission_snapshot_revision")} >= 1 AND ${column("revision")} >= 1 AND ${permissionScopeSql(database, column("required_permission_scope"), grants)}`;
}

function assertLimit(limit: number, maxListLimit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > maxListLimit) {
    throw new Error(`Quality list limit must be between 1 and ${maxListLimit}`);
  }
}

function escapeLike(value: string) {
  return value.toLowerCase().replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function numeric(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && Number.isFinite(Number(value))) return Number(value);
  return 0;
}

function maxFinite(values: readonly unknown[]): number | undefined {
  const finite = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
  return finite.length > 0 ? Math.max(...finite) : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function q(database: DatabaseAdapter, identifier: string) {
  return quoteDatabaseIdentifier(database, identifier);
}

function p(database: DatabaseAdapter, position: number) {
  return databasePlaceholder(database, position);
}

function jsonP(database: DatabaseAdapter, position: number) {
  return jsonInsertPlaceholder(database, position, undefined);
}
