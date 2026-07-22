import { createHash, randomUUID } from "node:crypto";

import { numberColumn, optionalStringColumn, stringColumn } from "./database-row-utils";
import {
  databasePlaceholder,
  jsonInsertPlaceholder,
  quoteDatabaseIdentifier,
} from "./database-sql-utils";
import {
  type GoldenQuestionRepository,
  type InMemoryGoldenQuestionPromotionParticipant,
  inMemoryGoldenQuestionPromotionParticipant,
} from "./golden-question-repository";
import { cloneJsonObject, jsonObjectColumn, jsonStringArrayColumn } from "./json-utils";
import {
  KnowledgeSpaceAccessError,
  assertDatabaseKnowledgeSpacePermissionFence,
} from "./knowledge-space-access-control";
import { lockKnowledgeSpaceForDeletionAdmission } from "./knowledge-space-deletion-admission";

import {
  type DatabaseAdapter,
  type DatabaseExecutor,
  type DatabaseQueryValue,
  type DatabaseRow,
  type FailedQuery,
  FailedQuerySchema,
  type GoldenQuestion,
  GoldenQuestionSchema,
  stableJson,
} from "@knowledge/core";

export interface CreateFailedQueryInput {
  readonly answerTraceId?: string | undefined;
  readonly id?: string | undefined;
  readonly knowledgeSpaceId: string;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly mode: FailedQuery["mode"];
  readonly permission: FailedQueryPermissionBinding;
  readonly query: string;
  readonly status?: FailedQuery["status"] | undefined;
  readonly trigger: FailedQuery["trigger"];
  readonly tenantId: string;
}

export interface FailedQueryPermissionBinding {
  readonly accessChannel: "interactive" | "service_api" | "mcp" | "agent";
  readonly candidateGrants: readonly string[];
  readonly permissionSnapshotId: string;
  readonly permissionSnapshotRevision: number;
  readonly requestedBySubjectId: string;
}

export interface FailedQueryReadScope {
  readonly candidateGrants: readonly string[];
  readonly subjectId: string;
  readonly tenantId: string;
}

export interface FailedQueryLookupInput extends FailedQueryReadScope {
  readonly id: string;
  readonly knowledgeSpaceId: string;
}

export interface UpdateFailedQueryInput extends FailedQueryLookupInput {
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly permission: FailedQueryPermissionBinding;
  readonly status?: FailedQuery["status"] | undefined;
}

export interface PromoteFailedQueryInput extends FailedQueryLookupInput {
  readonly expectedEvidenceIds?: readonly string[] | undefined;
  readonly expectedEvidencePermissionScope: readonly string[];
  readonly note?: string | undefined;
  readonly permission: FailedQueryPermissionBinding;
  readonly promotedAt: string;
}

export interface PromoteFailedQueryResult {
  readonly failedQuery: FailedQuery;
  readonly goldenQuestion: GoldenQuestion;
}

export interface FailedQueryCursor {
  readonly id: string;
}

export interface ListFailedQueriesInput extends FailedQueryReadScope {
  readonly cursor?: FailedQueryCursor | undefined;
  readonly knowledgeSpaceId: string;
  readonly limit: number;
  readonly status?: FailedQuery["status"] | undefined;
}

export interface ListFailedQueriesResult {
  readonly items: FailedQuery[];
  readonly nextCursor?: FailedQueryCursor | undefined;
}

export interface FailedQueryRepository {
  countByStatus(
    input: FailedQueryReadScope & { readonly knowledgeSpaceId: string },
  ): Promise<Record<string, number>>;
  create(input: CreateFailedQueryInput): Promise<FailedQuery>;
  get(input: FailedQueryLookupInput): Promise<FailedQuery | null>;
  list(input: ListFailedQueriesInput): Promise<ListFailedQueriesResult>;
  promote(input: PromoteFailedQueryInput): Promise<PromoteFailedQueryResult | null>;
  update(input: UpdateFailedQueryInput): Promise<FailedQuery | null>;
}

export interface InMemoryFailedQueryRepositoryOptions {
  readonly generateId?: () => string;
  readonly goldenQuestions?: GoldenQuestionRepository | undefined;
  readonly maxFailedQueries: number;
  readonly now?: () => string;
}

export interface DatabaseFailedQueryRepositoryOptions {
  readonly database: DatabaseAdapter;
  readonly generateId?: () => string;
  readonly generateGoldenQuestionId?: () => string;
  readonly now?: () => string;
}

export class FailedQueryCapacityExceededError extends Error {
  constructor(maxFailedQueries: number) {
    super(`Failed query repository maxFailedQueries=${maxFailedQueries} exceeded`);
  }
}

export class FailedQueryPromotionConflictError extends Error {
  constructor(message = "Failed query was already promoted with different annotation input") {
    super(message);
  }
}

function buildFailedQuery(
  input: CreateFailedQueryInput,
  id: string,
  timestamp: string,
): FailedQuery {
  return FailedQuerySchema.parse({
    ...(input.answerTraceId ? { answerTraceId: input.answerTraceId } : {}),
    createdAt: timestamp,
    id,
    knowledgeSpaceId: input.knowledgeSpaceId,
    metadata: cloneJsonObject(input.metadata ?? {}),
    mode: input.mode,
    query: input.query,
    status: input.status ?? "pending-triage",
    trigger: input.trigger,
    updatedAt: timestamp,
  });
}

export function createInMemoryFailedQueryRepository({
  generateId = randomUUID,
  goldenQuestions,
  maxFailedQueries,
  now = () => new Date().toISOString(),
}: InMemoryFailedQueryRepositoryOptions): FailedQueryRepository {
  if (maxFailedQueries < 1) {
    throw new Error("Failed query repository maxFailedQueries must be at least 1");
  }

  const failedQueries = new Map<string, FailedQuery>();
  const provenance = new Map<
    string,
    { readonly permission: FailedQueryPermissionBinding; readonly tenantId: string }
  >();

  return {
    countByStatus: async (input) => {
      const counts: Record<string, number> = {};

      for (const failedQuery of failedQueries.values()) {
        if (
          failedQuery.knowledgeSpaceId === input.knowledgeSpaceId &&
          inMemoryFailedQueryVisible(provenance.get(failedQuery.id), input)
        ) {
          counts[failedQuery.status] = (counts[failedQuery.status] ?? 0) + 1;
        }
      }

      return counts;
    },
    create: async (input) => {
      if (failedQueries.size >= maxFailedQueries) {
        throw new FailedQueryCapacityExceededError(maxFailedQueries);
      }

      const failedQuery = buildFailedQuery(input, input.id ?? generateId(), now());
      assertFailedQueryPermissionBinding(input.permission, {
        candidateGrants: input.permission.candidateGrants,
        subjectId: input.permission.requestedBySubjectId,
      });
      failedQueries.set(failedQuery.id, cloneFailedQuery(failedQuery));
      provenance.set(failedQuery.id, {
        permission: cloneFailedQueryPermission(input.permission),
        tenantId: input.tenantId,
      });

      return cloneFailedQuery(failedQuery);
    },
    get: async ({ id, knowledgeSpaceId, ...scope }) => {
      const failedQuery = failedQueries.get(id);

      return failedQuery &&
        failedQuery.knowledgeSpaceId === knowledgeSpaceId &&
        inMemoryFailedQueryVisible(provenance.get(id), scope)
        ? cloneFailedQuery(failedQuery)
        : null;
    },
    list: async ({ cursor, knowledgeSpaceId, limit, status, ...scope }) => {
      validateFailedQueryListLimit(limit);

      const rows = Array.from(failedQueries.values())
        .filter((failedQuery) => failedQuery.knowledgeSpaceId === knowledgeSpaceId)
        .filter((failedQuery) => inMemoryFailedQueryVisible(provenance.get(failedQuery.id), scope))
        .filter((failedQuery) => status === undefined || failedQuery.status === status)
        .filter((failedQuery) => !cursor || failedQuery.id > cursor.id)
        .sort((left, right) => left.id.localeCompare(right.id));
      const page = rows.slice(0, limit + 1);
      const items = page.slice(0, limit).map(cloneFailedQuery);
      const lastItem = items.at(-1);

      return {
        items,
        ...(page.length > limit && lastItem ? { nextCursor: { id: lastItem.id } } : {}),
      };
    },
    promote: async (input) => {
      assertFailedQueryPermissionBinding(input.permission, input);
      const expectedEvidencePermissionScope = assertFailedQueryExpectedEvidencePermissionScope(
        input.expectedEvidencePermissionScope,
        input.permission.candidateGrants,
      );
      const existing = failedQueries.get(input.id);
      const existingProvenance = provenance.get(input.id);
      if (
        !existing ||
        existing.knowledgeSpaceId !== input.knowledgeSpaceId ||
        !inMemoryFailedQueryVisible(existingProvenance, input)
      ) {
        return null;
      }
      const participant = goldenQuestions
        ? (
            goldenQuestions as Partial<{
              readonly [inMemoryGoldenQuestionPromotionParticipant]: InMemoryGoldenQuestionPromotionParticipant;
            }>
          )[inMemoryGoldenQuestionPromotionParticipant]
        : undefined;
      if (!participant) {
        throw new Error("Atomic in-memory failed-query promotion is unavailable");
      }
      const fingerprint = failedQueryPromotionFingerprint(input);
      const prior = priorPromotion(existing, fingerprint);
      if (prior) {
        const goldenQuestion = await goldenQuestions?.get({
          candidateGrants: input.permission.candidateGrants,
          id: prior.goldenQuestionId,
          knowledgeSpaceId: input.knowledgeSpaceId,
          tenantId: input.tenantId,
        });
        if (
          !goldenQuestion ||
          !goldenQuestionMatchesPromotion(goldenQuestion, existing, fingerprint)
        ) {
          throw new FailedQueryPromotionConflictError(
            "Failed-query promotion state does not match its golden question",
          );
        }
        return {
          failedQuery: cloneFailedQuery(existing),
          goldenQuestion,
        };
      }
      const preparedGoldenQuestion = participant.prepareCreate({
        ...(input.expectedEvidenceIds
          ? { expectedEvidenceIds: [...input.expectedEvidenceIds] }
          : {}),
        knowledgeSpaceId: input.knowledgeSpaceId,
        metadata: { failedQueryId: existing.id, promotionFingerprint: fingerprint },
        question: existing.query,
        tags: ["failed-query"],
        visibility: {
          requiredPermissionScope: mergeFailedQueryPermissionScopes(
            existingProvenance?.permission.candidateGrants ?? [],
            expectedEvidencePermissionScope,
          ),
          tenantId: input.tenantId,
        },
      });
      const goldenQuestion = preparedGoldenQuestion.question;
      const updated = promotedFailedQuery(existing, input, goldenQuestion.id, fingerprint);

      // Both commits are validated, synchronous, and no-throw. No partially visible Promise turn
      // or compensating delete exists in this non-durable implementation.
      participant.commitPreparedCreate(preparedGoldenQuestion);
      failedQueries.set(existing.id, cloneFailedQuery(updated));
      return {
        failedQuery: cloneFailedQuery(updated),
        goldenQuestion,
      };
    },
    update: async ({ id, knowledgeSpaceId, metadata, permission, status, ...scope }) => {
      assertFailedQueryPermissionBinding(permission, scope);
      const existing = failedQueries.get(id);

      if (
        !existing ||
        existing.knowledgeSpaceId !== knowledgeSpaceId ||
        !inMemoryFailedQueryVisible(provenance.get(id), scope)
      ) {
        return null;
      }

      const updated = FailedQuerySchema.parse({
        ...existing,
        ...(metadata === undefined ? {} : { metadata: cloneJsonObject(metadata) }),
        ...(status === undefined ? {} : { status }),
        updatedAt: now(),
      });
      failedQueries.set(id, cloneFailedQuery(updated));

      return cloneFailedQuery(updated);
    },
  };
}

export function createDatabaseFailedQueryRepository({
  database,
  generateId = randomUUID,
  generateGoldenQuestionId = randomUUID,
  now = () => new Date().toISOString(),
}: DatabaseFailedQueryRepositoryOptions): FailedQueryRepository {
  const tableName = "failed_queries";

  return {
    countByStatus: async (input) => {
      const result = await database.execute({
        maxRows: 100,
        operation: "select",
        params: [
          input.tenantId,
          input.knowledgeSpaceId,
          input.subjectId,
          JSON.stringify(input.candidateGrants),
        ],
        sql: `SELECT failed.${q(database, "status")} AS ${q(database, "status")}, COUNT(*) AS ${q(database, "count")} FROM ${q(database, tableName)} failed WHERE failed.${q(database, "tenant_id")} = ${p(database, 1)} AND failed.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND failed.${q(database, "requested_by_subject_id")} = ${p(database, 3)} AND ${failedQueryVisibleSql(database, "failed", p(database, 4))} GROUP BY failed.${q(database, "status")};`,
        tableName,
      });
      const counts: Record<string, number> = {};

      for (const row of result.rows) {
        counts[stringColumn(row, "status")] = Number(row.count ?? 0);
      }

      return counts;
    },
    create: async (input) =>
      database.transaction(async (transaction) => {
        const timestamp = now();
        const failedQuery = buildFailedQuery(input, input.id ?? generateId(), timestamp);
        await lockFailedQuerySpace(
          database,
          transaction,
          input.tenantId,
          failedQuery.knowledgeSpaceId,
        );
        assertFailedQueryPermissionBinding(input.permission, {
          candidateGrants: input.permission.candidateGrants,
          subjectId: input.permission.requestedBySubjectId,
        });
        const validatedPermission = await assertDatabaseKnowledgeSpacePermissionFence({
          database,
          executor: transaction,
          fence: {
            accessChannel: input.permission.accessChannel,
            knowledgeSpaceId: failedQuery.knowledgeSpaceId,
            permissionSnapshotId: input.permission.permissionSnapshotId,
            permissionSnapshotRevision: input.permission.permissionSnapshotRevision,
            requestedBySubjectId: input.permission.requestedBySubjectId,
            tenantId: input.tenantId,
          },
          now: timestamp,
          requiredAccess: "read",
        });
        assertFailedQueryPermissionBinding(input.permission, {
          candidateGrants: validatedPermission.permissionScopes,
          subjectId: validatedPermission.subjectId,
        });
        const columns = [
          "id",
          "tenant_id",
          "knowledge_space_id",
          "answer_trace_id",
          "query",
          "mode",
          "trigger",
          "status",
          "metadata",
          "requested_by_subject_id",
          "access_channel",
          "permission_snapshot_id",
          "permission_snapshot_revision",
          "required_permission_scope",
          "revision",
          "created_at",
          "updated_at",
        ];
        const params = [
          failedQuery.id,
          input.tenantId,
          failedQuery.knowledgeSpaceId,
          failedQuery.answerTraceId ?? null,
          failedQuery.query,
          failedQuery.mode,
          failedQuery.trigger,
          failedQuery.status,
          JSON.stringify(failedQuery.metadata),
          input.permission.requestedBySubjectId,
          input.permission.accessChannel,
          input.permission.permissionSnapshotId,
          input.permission.permissionSnapshotRevision,
          JSON.stringify(validatedPermission.permissionScopes),
          1,
          failedQuery.createdAt,
          failedQuery.updatedAt,
        ] satisfies readonly DatabaseQueryValue[];
        const candidateAlias = "failed_query_candidate";
        const result = await transaction.execute({
          maxRows: 1,
          operation: "insert",
          params,
          sql: `INSERT INTO ${quoteDatabaseIdentifier(database, tableName)} (${columns
            .map((column) => quoteDatabaseIdentifier(database, column))
            .join(", ")}) SELECT ${columns
            .map(
              (column) =>
                `${quoteDatabaseIdentifier(database, candidateAlias)}.${quoteDatabaseIdentifier(database, column)}`,
            )
            .join(", ")} FROM (SELECT ${params
            .map(
              (_, index) =>
                `${jsonInsertPlaceholder(database, index + 1, columns[index])} AS ${quoteDatabaseIdentifier(
                  database,
                  columns[index] ?? "missing",
                )}`,
            )
            .join(", ")}) AS ${quoteDatabaseIdentifier(
            database,
            candidateAlias,
          )} WHERE NOT EXISTS (SELECT 1 FROM ${quoteDatabaseIdentifier(
            database,
            "deletion_jobs",
          )} AS active_deletion WHERE active_deletion.${quoteDatabaseIdentifier(
            database,
            "knowledge_space_id",
          )} = ${quoteDatabaseIdentifier(database, candidateAlias)}.${quoteDatabaseIdentifier(
            database,
            "knowledge_space_id",
          )} AND active_deletion.${quoteDatabaseIdentifier(
            database,
            "tenant_id",
          )} = ${quoteDatabaseIdentifier(database, candidateAlias)}.${quoteDatabaseIdentifier(
            database,
            "tenant_id",
          )} AND active_deletion.${quoteDatabaseIdentifier(
            database,
            "active_slot",
          )} = 1) AND (${quoteDatabaseIdentifier(database, candidateAlias)}.${quoteDatabaseIdentifier(
            database,
            "answer_trace_id",
          )} IS NULL OR EXISTS (SELECT 1 FROM ${quoteDatabaseIdentifier(
            database,
            "answer_traces",
          )} AS owning_trace WHERE owning_trace.${quoteDatabaseIdentifier(
            database,
            "id",
          )} = ${quoteDatabaseIdentifier(database, candidateAlias)}.${quoteDatabaseIdentifier(
            database,
            "answer_trace_id",
          )} AND owning_trace.${quoteDatabaseIdentifier(
            database,
            "knowledge_space_id",
          )} = ${quoteDatabaseIdentifier(database, candidateAlias)}.${quoteDatabaseIdentifier(
            database,
            "knowledge_space_id",
          )} AND owning_trace.${quoteDatabaseIdentifier(
            database,
            "subject_id",
          )} = ${quoteDatabaseIdentifier(database, candidateAlias)}.${quoteDatabaseIdentifier(
            database,
            "requested_by_subject_id",
          )} AND owning_trace.${quoteDatabaseIdentifier(
            database,
            "permission_snapshot_id",
          )} = ${quoteDatabaseIdentifier(database, candidateAlias)}.${quoteDatabaseIdentifier(
            database,
            "permission_snapshot_id",
          )} AND owning_trace.${quoteDatabaseIdentifier(
            database,
            "permission_snapshot_revision",
          )} = ${quoteDatabaseIdentifier(database, candidateAlias)}.${quoteDatabaseIdentifier(
            database,
            "permission_snapshot_revision",
          )} AND owning_trace.${quoteDatabaseIdentifier(
            database,
            "access_channel",
          )} = ${quoteDatabaseIdentifier(database, candidateAlias)}.${quoteDatabaseIdentifier(
            database,
            "access_channel",
          )}))${database.dialect === "postgres" ? " RETURNING *" : ""};`,
          tableName,
        });

        if (result.rowsAffected !== 1) {
          throw new Error(
            "Failed query creation rejected by deletion fence or missing same-space answer trace",
          );
        }

        return result.rows[0] ? mapFailedQueryRow(result.rows[0]) : failedQuery;
      }),
    get: async (input) => databaseFailedQueryGet(database, input),
    list: async ({
      candidateGrants,
      cursor,
      knowledgeSpaceId,
      limit,
      status,
      subjectId,
      tenantId,
    }) => {
      validateFailedQueryListLimit(limit);

      const readLimit = limit + 1;
      const params: DatabaseQueryValue[] = [
        tenantId,
        knowledgeSpaceId,
        subjectId,
        JSON.stringify(candidateGrants),
      ];
      const conditions = [
        `failed.${q(database, "tenant_id")} = ${p(database, 1)}`,
        `failed.${q(database, "knowledge_space_id")} = ${p(database, 2)}`,
        `failed.${q(database, "requested_by_subject_id")} = ${p(database, 3)}`,
        failedQueryVisibleSql(database, "failed", p(database, 4)),
      ];

      if (status !== undefined) {
        params.push(status);
        conditions.push(`failed.${q(database, "status")} = ${p(database, params.length)}`);
      }

      if (cursor) {
        params.push(cursor.id);
        conditions.push(`failed.${q(database, "id")} > ${p(database, params.length)}`);
      }

      params.push(readLimit);
      const result = await database.execute({
        maxRows: readLimit,
        operation: "select",
        params,
        sql: `SELECT failed.* FROM ${q(database, tableName)} failed WHERE ${conditions.join(" AND ")} ORDER BY failed.${q(database, "id")} ASC LIMIT ${p(database, params.length)};`,
        tableName,
      });
      const rows = result.rows.map(mapFailedQueryRow);
      const items = rows.slice(0, limit).map(cloneFailedQuery);
      const lastItem = items.at(-1);

      return {
        items,
        ...(rows.length > limit && lastItem ? { nextCursor: { id: lastItem.id } } : {}),
      };
    },
    promote: async (input) =>
      database.transaction(async (transaction) => {
        await lockFailedQuerySpace(database, transaction, input.tenantId, input.knowledgeSpaceId);
        assertFailedQueryPermissionBinding(input.permission, input);
        const validatedPermission = await assertDatabaseKnowledgeSpacePermissionFence({
          database,
          executor: transaction,
          fence: {
            accessChannel: input.permission.accessChannel,
            knowledgeSpaceId: input.knowledgeSpaceId,
            permissionSnapshotId: input.permission.permissionSnapshotId,
            permissionSnapshotRevision: input.permission.permissionSnapshotRevision,
            requestedBySubjectId: input.permission.requestedBySubjectId,
            tenantId: input.tenantId,
          },
          now: input.promotedAt,
          requiredAccess: "write",
        });
        assertFailedQueryPermissionBinding(input.permission, {
          candidateGrants: validatedPermission.permissionScopes,
          subjectId: validatedPermission.subjectId,
        });
        const expectedEvidencePermissionScope = assertFailedQueryExpectedEvidencePermissionScope(
          input.expectedEvidencePermissionScope,
          validatedPermission.permissionScopes,
        );
        const row = await selectDatabaseFailedQuery(
          database,
          transaction,
          { ...input, candidateGrants: validatedPermission.permissionScopes },
          true,
        );
        if (!row) return null;
        const existing = mapFailedQueryRow(row);
        const goldenQuestionRequiredPermissionScope = mergeFailedQueryPermissionScopes(
          jsonStringArrayColumn(row, "required_permission_scope"),
          expectedEvidencePermissionScope,
        );
        const fingerprint = failedQueryPromotionFingerprint(input);
        const prior = priorPromotion(existing, fingerprint);
        if (prior) {
          const goldenQuestion = await selectPromotionGoldenQuestion(
            database,
            transaction,
            input.tenantId,
            input.knowledgeSpaceId,
            prior.goldenQuestionId,
            validatedPermission.permissionScopes,
          );
          if (
            !goldenQuestion ||
            !goldenQuestionMatchesPromotion(goldenQuestion, existing, fingerprint)
          ) {
            throw new FailedQueryPromotionConflictError(
              "Failed-query promotion state does not match its golden question",
            );
          }
          return {
            failedQuery: cloneFailedQuery(existing),
            goldenQuestion,
          };
        }

        const goldenQuestion = GoldenQuestionSchema.parse({
          createdAt: input.promotedAt,
          expectedEvidenceIds: [...(input.expectedEvidenceIds ?? [])],
          id: generateGoldenQuestionId(),
          knowledgeSpaceId: input.knowledgeSpaceId,
          metadata: { failedQueryId: existing.id, promotionFingerprint: fingerprint },
          question: existing.query,
          tags: ["failed-query"],
          updatedAt: input.promotedAt,
        });
        await insertPromotionGoldenQuestion(
          database,
          transaction,
          goldenQuestion,
          input.tenantId,
          goldenQuestionRequiredPermissionScope,
        );
        const updated = promotedFailedQuery(existing, input, goldenQuestion.id, fingerprint);
        const revision = numberColumn(row, "revision");
        const result = await transaction.execute({
          maxRows: 0,
          operation: "update",
          params: [
            updated.status,
            JSON.stringify(updated.metadata),
            input.promotedAt,
            input.id,
            input.tenantId,
            input.knowledgeSpaceId,
            input.subjectId,
            revision,
          ],
          sql: `UPDATE ${q(database, tableName)} SET ${q(database, "status")} = ${p(database, 1)}, ${q(database, "metadata")} = ${jsonInsertPlaceholder(database, 2, "metadata")}, ${q(database, "updated_at")} = ${p(database, 3)}, ${q(database, "revision")} = ${q(database, "revision")} + 1 WHERE ${q(database, "id")} = ${p(database, 4)} AND ${q(database, "tenant_id")} = ${p(database, 5)} AND ${q(database, "knowledge_space_id")} = ${p(database, 6)} AND ${q(database, "requested_by_subject_id")} = ${p(database, 7)} AND ${q(database, "revision")} = ${p(database, 8)};`,
          tableName,
        });
        if (result.rowsAffected !== 1) {
          throw new Error("Failed-query promotion lost its revision fence");
        }
        return {
          failedQuery: cloneFailedQuery(updated),
          goldenQuestion,
        };
      }),
    update: async (input) =>
      database.transaction(async (transaction) => {
        const timestamp = now();
        await lockFailedQuerySpace(database, transaction, input.tenantId, input.knowledgeSpaceId);
        assertFailedQueryPermissionBinding(input.permission, input);
        const validatedPermission = await assertDatabaseKnowledgeSpacePermissionFence({
          database,
          executor: transaction,
          fence: {
            accessChannel: input.permission.accessChannel,
            knowledgeSpaceId: input.knowledgeSpaceId,
            permissionSnapshotId: input.permission.permissionSnapshotId,
            permissionSnapshotRevision: input.permission.permissionSnapshotRevision,
            requestedBySubjectId: input.permission.requestedBySubjectId,
            tenantId: input.tenantId,
          },
          now: timestamp,
          requiredAccess: "write",
        });
        assertFailedQueryPermissionBinding(input.permission, {
          candidateGrants: validatedPermission.permissionScopes,
          subjectId: validatedPermission.subjectId,
        });
        const row = await selectDatabaseFailedQuery(
          database,
          transaction,
          { ...input, candidateGrants: validatedPermission.permissionScopes },
          true,
        );
        if (!row) return null;
        const existing = mapFailedQueryRow(row);
        const revision = numberColumn(row, "revision");
        const updated = FailedQuerySchema.parse({
          ...existing,
          ...(input.metadata === undefined ? {} : { metadata: cloneJsonObject(input.metadata) }),
          ...(input.status === undefined ? {} : { status: input.status }),
          updatedAt: timestamp,
        });
        const result = await transaction.execute({
          maxRows: 0,
          operation: "update",
          params: [
            updated.status,
            JSON.stringify(updated.metadata),
            timestamp,
            input.id,
            input.tenantId,
            input.knowledgeSpaceId,
            input.subjectId,
            revision,
          ],
          sql: `UPDATE ${q(database, tableName)} SET ${q(database, "status")} = ${p(database, 1)}, ${q(database, "metadata")} = ${jsonInsertPlaceholder(database, 2, "metadata")}, ${q(database, "updated_at")} = ${p(database, 3)}, ${q(database, "revision")} = ${q(database, "revision")} + 1 WHERE ${q(database, "id")} = ${p(database, 4)} AND ${q(database, "tenant_id")} = ${p(database, 5)} AND ${q(database, "knowledge_space_id")} = ${p(database, 6)} AND ${q(database, "requested_by_subject_id")} = ${p(database, 7)} AND ${q(database, "revision")} = ${p(database, 8)};`,
          tableName,
        });
        if (result.rowsAffected !== 1) {
          throw new Error("Failed query mutation lost its revision fence");
        }
        return cloneFailedQuery(updated);
      }),
  };
}

async function lockFailedQuerySpace(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  tenantId: string,
  knowledgeSpaceId: string,
): Promise<void> {
  if (
    !(await lockKnowledgeSpaceForDeletionAdmission(database, executor, {
      knowledgeSpaceId,
      tenantId,
    }))
  ) {
    throw new Error("Failed query write rejected because knowledge space is unavailable");
  }
}

async function databaseFailedQueryGet(
  database: DatabaseAdapter,
  input: FailedQueryLookupInput,
): Promise<FailedQuery | null> {
  const row = await selectDatabaseFailedQuery(database, database, input, false);
  return row ? mapFailedQueryRow(row) : null;
}

async function selectDatabaseFailedQuery(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: FailedQueryLookupInput,
  forUpdate: boolean,
): Promise<DatabaseRow | undefined> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [
      input.tenantId,
      input.knowledgeSpaceId,
      input.id,
      input.subjectId,
      JSON.stringify(input.candidateGrants),
    ],
    sql: `SELECT failed.* FROM ${q(database, "failed_queries")} failed WHERE failed.${q(database, "tenant_id")} = ${p(database, 1)} AND failed.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND failed.${q(database, "id")} = ${p(database, 3)} AND failed.${q(database, "requested_by_subject_id")} = ${p(database, 4)} AND ${failedQueryVisibleSql(database, "failed", p(database, 5))} LIMIT 1${forUpdate ? " FOR UPDATE" : ""};`,
    tableName: "failed_queries",
  });
  return result.rows[0];
}

function mapFailedQueryRow(row: DatabaseRow): FailedQuery {
  const answerTraceId = optionalStringColumn(row, "answer_trace_id");

  return FailedQuerySchema.parse({
    ...(answerTraceId ? { answerTraceId } : {}),
    createdAt: stringColumn(row, "created_at"),
    id: stringColumn(row, "id"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    metadata: jsonObjectColumn(row, "metadata"),
    mode: stringColumn(row, "mode"),
    query: stringColumn(row, "query"),
    status: stringColumn(row, "status"),
    trigger: stringColumn(row, "trigger"),
    updatedAt: stringColumn(row, "updated_at"),
  });
}

function failedQueryPromotionFingerprint(input: PromoteFailedQueryInput): string {
  return createHash("sha256")
    .update(
      stableJson({
        annotatedBy: input.subjectId,
        expectedEvidenceIds: [...(input.expectedEvidenceIds ?? [])].sort(),
        failedQueryId: input.id,
        knowledgeSpaceId: input.knowledgeSpaceId,
        note: input.note ?? null,
        tenantId: input.tenantId,
        verdict: "retrieval-miss",
      }),
    )
    .digest("hex");
}

function priorPromotion(
  existing: FailedQuery,
  expectedFingerprint: string,
): { readonly goldenQuestionId: string } | null {
  const annotation = existing.metadata.annotation;
  const record =
    annotation && typeof annotation === "object" && !Array.isArray(annotation)
      ? (annotation as Readonly<Record<string, unknown>>)
      : null;
  if (existing.status !== "promoted") {
    if (record?.goldenQuestionId !== undefined || record?.promotionFingerprint !== undefined) {
      throw new FailedQueryPromotionConflictError(
        "Failed query contains incomplete durable promotion state",
      );
    }
    return null;
  }
  if (
    record?.verdict !== "retrieval-miss" ||
    typeof record.goldenQuestionId !== "string" ||
    record.promotionFingerprint !== expectedFingerprint
  ) {
    throw new FailedQueryPromotionConflictError();
  }
  return { goldenQuestionId: record.goldenQuestionId };
}

function promotedFailedQuery(
  existing: FailedQuery,
  input: PromoteFailedQueryInput,
  goldenQuestionId: string,
  promotionFingerprint: string,
): FailedQuery {
  return FailedQuerySchema.parse({
    ...existing,
    metadata: {
      ...existing.metadata,
      annotation: {
        annotatedAt: input.promotedAt,
        annotatedBy: input.subjectId,
        ...(input.expectedEvidenceIds
          ? { expectedEvidenceIds: [...input.expectedEvidenceIds] }
          : {}),
        goldenQuestionId,
        ...(input.note ? { note: input.note } : {}),
        promotionFingerprint,
        verdict: "retrieval-miss",
      },
    },
    status: "promoted",
    updatedAt: input.promotedAt,
  });
}

function goldenQuestionMatchesPromotion(
  question: GoldenQuestion,
  failedQuery: FailedQuery,
  promotionFingerprint: string,
): boolean {
  return (
    question.knowledgeSpaceId === failedQuery.knowledgeSpaceId &&
    question.question === failedQuery.query &&
    question.metadata.failedQueryId === failedQuery.id &&
    question.metadata.promotionFingerprint === promotionFingerprint
  );
}

async function insertPromotionGoldenQuestion(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  question: GoldenQuestion,
  tenantId: string,
  requiredPermissionScope: readonly string[],
): Promise<void> {
  const columns = [
    "id",
    "tenant_id",
    "knowledge_space_id",
    "question",
    "expected_evidence_ids",
    "tags",
    "metadata",
    "required_permission_scope",
    "created_at",
    "updated_at",
  ];
  const result = await executor.execute({
    maxRows: 0,
    operation: "insert",
    params: [
      question.id,
      tenantId,
      question.knowledgeSpaceId,
      question.question,
      JSON.stringify(question.expectedEvidenceIds),
      JSON.stringify(question.tags),
      JSON.stringify(question.metadata),
      JSON.stringify(requiredPermissionScope),
      question.createdAt,
      question.updatedAt,
    ],
    sql: `INSERT INTO ${q(database, "golden_questions")} (${columns
      .map((column) => q(database, column))
      .join(", ")}) VALUES (${columns
      .map((column, index) => jsonInsertPlaceholder(database, index + 1, column))
      .join(", ")});`,
    tableName: "golden_questions",
  });
  if (result.rowsAffected !== 1) {
    throw new Error("Failed-query promotion did not create its golden question");
  }
}

async function selectPromotionGoldenQuestion(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  tenantId: string,
  knowledgeSpaceId: string,
  id: string,
  candidateGrants: readonly string[],
): Promise<GoldenQuestion | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [tenantId, knowledgeSpaceId, id, JSON.stringify(candidateGrants)],
    sql: `SELECT * FROM ${q(database, "golden_questions")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "id")} = ${p(database, 3)} AND ${permissionScopeSql(database, q(database, "required_permission_scope"), p(database, 4))} LIMIT 1 FOR UPDATE;`,
    tableName: "golden_questions",
  });
  const row = result.rows[0];
  return row
    ? GoldenQuestionSchema.parse({
        createdAt: stringColumn(row, "created_at"),
        expectedEvidenceIds: jsonStringArrayColumn(row, "expected_evidence_ids"),
        id: stringColumn(row, "id"),
        knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
        metadata: jsonObjectColumn(row, "metadata"),
        question: stringColumn(row, "question"),
        tags: jsonStringArrayColumn(row, "tags"),
        updatedAt: stringColumn(row, "updated_at"),
      })
    : null;
}

function cloneFailedQuery(failedQuery: FailedQuery): FailedQuery {
  return {
    ...failedQuery,
    metadata: cloneJsonObject(failedQuery.metadata),
  };
}

function validateFailedQueryListLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("Failed query list limit must be at least 1");
  }
}

function failedQueryVisibleSql(database: DatabaseAdapter, alias: string, grants: string) {
  const column = (name: string) => `${alias}.${q(database, name)}`;
  return `${column("access_channel")} IN ('interactive', 'service_api', 'mcp', 'agent') AND ${column("permission_snapshot_id")} IS NOT NULL AND ${column("permission_snapshot_revision")} >= 1 AND ${column("revision")} >= 1 AND ${permissionScopeSql(database, column("required_permission_scope"), grants)}`;
}

function permissionScopeSql(database: DatabaseAdapter, column: string, grants: string) {
  return database.dialect === "postgres"
    ? `(jsonb_typeof(${column}) = 'array' AND ${grants}::jsonb @> ${column})`
    : `(JSON_TYPE(${column}) = 'ARRAY' AND JSON_CONTAINS(CAST(${grants} AS JSON), ${column}))`;
}

function assertFailedQueryPermissionBinding(
  permission: FailedQueryPermissionBinding,
  scope: Pick<FailedQueryReadScope, "candidateGrants" | "subjectId">,
) {
  if (
    permission.requestedBySubjectId !== scope.subjectId ||
    !normalizeFailedQueryPermissionScope(permission.candidateGrants) ||
    !normalizeFailedQueryPermissionScope(scope.candidateGrants) ||
    !sameStringSet(permission.candidateGrants, scope.candidateGrants)
  ) {
    throw new KnowledgeSpaceAccessError(
      "space_access_permission_snapshot_invalid",
      "Failed-query permission binding does not match the current actor and candidate grants",
    );
  }
}

function assertFailedQueryExpectedEvidencePermissionScope(
  required: readonly string[],
  candidate: readonly string[],
): readonly string[] {
  const normalizedRequired = normalizeFailedQueryPermissionScope(required);
  const normalizedCandidate = normalizeFailedQueryPermissionScope(candidate);
  if (!normalizedRequired || !normalizedCandidate) {
    throw new KnowledgeSpaceAccessError(
      "space_access_permission_snapshot_invalid",
      "Failed-query evidence permission scope is invalid",
    );
  }
  const candidateSet = new Set(normalizedCandidate);
  if (!normalizedRequired.every((grant) => candidateSet.has(grant))) {
    throw new KnowledgeSpaceAccessError(
      "space_access_permission_snapshot_invalid",
      "Failed-query expected evidence is not visible to the current actor",
    );
  }
  return normalizedRequired;
}

function mergeFailedQueryPermissionScopes(
  first: readonly string[],
  second: readonly string[],
): readonly string[] {
  const normalizedFirst = normalizeFailedQueryPermissionScope(first);
  const normalizedSecond = normalizeFailedQueryPermissionScope(second);
  if (!normalizedFirst || !normalizedSecond) {
    throw new KnowledgeSpaceAccessError(
      "space_access_permission_snapshot_invalid",
      "Failed-query frozen permission scope is invalid",
    );
  }
  return [...new Set([...normalizedFirst, ...normalizedSecond])].sort();
}

function normalizeFailedQueryPermissionScope(scope: readonly string[]): readonly string[] | null {
  if (!Array.isArray(scope)) return null;
  const normalized = scope.map((grant) => grant.trim());
  if (
    normalized.some((grant, index) => !grant || grant !== scope[index] || grant.length > 512) ||
    new Set(normalized).size !== normalized.length
  ) {
    return null;
  }
  return [...normalized].sort();
}

function inMemoryFailedQueryVisible(
  provenance:
    | { readonly permission: FailedQueryPermissionBinding; readonly tenantId: string }
    | undefined,
  scope: FailedQueryReadScope,
) {
  return Boolean(
    provenance &&
      provenance.tenantId === scope.tenantId &&
      provenance.permission.requestedBySubjectId === scope.subjectId &&
      permissionScopeAllows(provenance.permission.candidateGrants, scope.candidateGrants),
  );
}

function permissionScopeAllows(required: readonly string[], candidate: readonly string[]) {
  const grants = new Set(candidate);
  return required.every((grant) => grants.has(grant));
}

function cloneFailedQueryPermission(
  permission: FailedQueryPermissionBinding,
): FailedQueryPermissionBinding {
  return { ...permission, candidateGrants: [...permission.candidateGrants] };
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

function q(database: DatabaseAdapter, identifier: string) {
  return quoteDatabaseIdentifier(database, identifier);
}

function p(database: DatabaseAdapter, position: number) {
  return databasePlaceholder(database, position);
}
