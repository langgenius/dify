import { randomUUID } from "node:crypto";

import {
  type DatabaseAdapter,
  type DatabaseExecutor,
  type DatabaseQueryValue,
  type DatabaseRow,
  type GoldenQuestion,
  GoldenQuestionSchema,
} from "@knowledge/core";

import { stringColumn } from "./database-row-utils";
import {
  databasePlaceholder,
  jsonInsertPlaceholder,
  quoteDatabaseIdentifier,
} from "./database-sql-utils";
import { cloneJsonObject, jsonObjectColumn, jsonStringArrayColumn } from "./json-utils";
import {
  KnowledgeSpaceAccessError,
  assertDatabaseKnowledgeSpacePermissionFence,
} from "./knowledge-space-access-control";
import { lockKnowledgeSpaceForDeletionAdmission } from "./knowledge-space-deletion-admission";

export interface GoldenQuestionPermissionBinding {
  readonly accessChannel: "interactive" | "service_api" | "mcp" | "agent";
  readonly candidateGrants: readonly string[];
  readonly permissionSnapshotId: string;
  readonly permissionSnapshotRevision: number;
  readonly requestedBySubjectId: string;
  readonly tenantId: string;
}

export interface GoldenQuestionReadScope {
  readonly candidateGrants: readonly string[];
  readonly tenantId: string;
}

export interface CreateGoldenQuestionInput {
  readonly expectedEvidenceIds?: readonly string[] | undefined;
  readonly knowledgeSpaceId: string;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly permission: GoldenQuestionPermissionBinding;
  readonly question: string;
  readonly requiredPermissionScope: readonly string[];
  readonly tags?: readonly string[] | undefined;
}

export interface UpdateGoldenQuestionInput {
  readonly expectedEvidenceIds?: readonly string[] | undefined;
  readonly id: string;
  readonly knowledgeSpaceId: string;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly permission: GoldenQuestionPermissionBinding;
  readonly question?: string | undefined;
  readonly requiredPermissionScope?: readonly string[] | undefined;
  readonly tags?: readonly string[] | undefined;
}

export interface TrustedGoldenQuestionLookupInput {
  readonly id: string;
  readonly knowledgeSpaceId: string;
}

export interface GoldenQuestionLookupInput
  extends TrustedGoldenQuestionLookupInput,
    GoldenQuestionReadScope {}

export interface DeleteGoldenQuestionInput extends TrustedGoldenQuestionLookupInput {
  readonly permission: GoldenQuestionPermissionBinding;
}

export interface GoldenQuestionCursor {
  readonly createdAt: string;
  readonly id: string;
}

export interface TrustedListGoldenQuestionsInput {
  readonly cursor?: GoldenQuestionCursor | undefined;
  readonly knowledgeSpaceId: string;
  readonly limit: number;
}

export interface ListGoldenQuestionsInput
  extends TrustedListGoldenQuestionsInput,
    GoldenQuestionReadScope {}

export interface ListGoldenQuestionsResult {
  readonly items: GoldenQuestion[];
  readonly nextCursor?: GoldenQuestionCursor;
}

export interface GoldenQuestionRepository {
  create(input: CreateGoldenQuestionInput): Promise<GoldenQuestion>;
  delete(input: DeleteGoldenQuestionInput): Promise<boolean>;
  get(input: GoldenQuestionLookupInput): Promise<GoldenQuestion | null>;
  getTrusted(input: TrustedGoldenQuestionLookupInput): Promise<GoldenQuestion | null>;
  list(input: ListGoldenQuestionsInput): Promise<ListGoldenQuestionsResult>;
  listTrusted(input: TrustedListGoldenQuestionsInput): Promise<ListGoldenQuestionsResult>;
  update(input: UpdateGoldenQuestionInput): Promise<GoldenQuestion | null>;
}

export interface TrustedGoldenQuestionVisibility {
  readonly requiredPermissionScope: readonly string[];
  readonly tenantId: string;
}

export type TrustedCreateGoldenQuestionInput = Omit<
  CreateGoldenQuestionInput,
  "permission" | "requiredPermissionScope"
> & {
  readonly visibility?: TrustedGoldenQuestionVisibility | undefined;
};
export type TrustedUpdateGoldenQuestionInput = Omit<UpdateGoldenQuestionInput, "permission">;
export type TrustedDeleteGoldenQuestionInput = TrustedGoldenQuestionLookupInput;

interface InMemoryGoldenQuestionProvenance {
  readonly requiredPermissionScope: readonly string[];
  readonly tenantId: string;
}

interface PreparedInMemoryGoldenQuestionCreate {
  readonly provenance?: InMemoryGoldenQuestionProvenance | undefined;
  readonly question: GoldenQuestion;
}

/**
 * Private in-process transaction participant used by failed-query promotion. Its prepare phase
 * performs every operation that can fail; commitPreparedCreate is a no-throw Map write so the two
 * related in-memory records can be published synchronously without compensation.
 */
export const inMemoryGoldenQuestionPromotionParticipant = Symbol(
  "inMemoryGoldenQuestionPromotionParticipant",
);

export interface InMemoryGoldenQuestionPromotionParticipant {
  commitPreparedCreate(prepared: PreparedInMemoryGoldenQuestionCreate): void;
  prepareCreate(input: TrustedCreateGoldenQuestionInput): PreparedInMemoryGoldenQuestionCreate;
}

/** Test/bootstrap-only surface. Production request handlers receive GoldenQuestionRepository. */
export interface InMemoryGoldenQuestionRepository extends GoldenQuestionRepository {
  readonly [inMemoryGoldenQuestionPromotionParticipant]: InMemoryGoldenQuestionPromotionParticipant;
  createTrusted(input: TrustedCreateGoldenQuestionInput): Promise<GoldenQuestion>;
  deleteTrusted(input: TrustedDeleteGoldenQuestionInput): Promise<boolean>;
  updateTrusted(input: TrustedUpdateGoldenQuestionInput): Promise<GoldenQuestion | null>;
}

export interface InMemoryGoldenQuestionRepositoryOptions {
  readonly generateId?: () => string;
  readonly maxListLimit: number;
  readonly maxQuestions: number;
  readonly now?: () => string;
}

export interface DatabaseGoldenQuestionRepositoryOptions {
  readonly database: DatabaseAdapter;
  readonly generateId?: () => string;
  readonly maxListLimit: number;
  readonly now?: () => string;
}

export class GoldenQuestionCapacityExceededError extends Error {
  constructor(maxQuestions: number) {
    super(`Golden question repository maxQuestions=${maxQuestions} exceeded`);
  }
}

export class GoldenQuestionListLimitExceededError extends Error {
  constructor(maxListLimit: number) {
    super(`Golden question list limit exceeds maxListLimit=${maxListLimit}`);
  }
}

export class GoldenQuestionDeletionFenceActiveError extends Error {
  constructor() {
    super("Golden question writes are unavailable while durable deletion is active");
  }
}

export function createInMemoryGoldenQuestionRepository({
  generateId = randomUUID,
  maxListLimit,
  maxQuestions,
  now = () => new Date().toISOString(),
}: InMemoryGoldenQuestionRepositoryOptions): InMemoryGoldenQuestionRepository {
  validateGoldenQuestionRepositoryBounds({ maxListLimit, maxQuestions });

  const questions = new Map<string, GoldenQuestion>();
  const provenance = new Map<string, InMemoryGoldenQuestionProvenance>();

  const prepareCreate = (
    input: CreateGoldenQuestionInput | TrustedCreateGoldenQuestionInput,
  ): PreparedInMemoryGoldenQuestionCreate => {
    if (questions.size >= maxQuestions) {
      throw new GoldenQuestionCapacityExceededError(maxQuestions);
    }

    const timestamp = now();
    const { visibility: _visibility, ...questionInput } = input as TrustedCreateGoldenQuestionInput;
    const question = GoldenQuestionSchema.parse({
      ...questionInput,
      createdAt: timestamp,
      expectedEvidenceIds: [...(input.expectedEvidenceIds ?? [])],
      id: generateId(),
      metadata: cloneJsonObject(input.metadata ?? {}),
      tags: [...(input.tags ?? [])],
      updatedAt: timestamp,
    });

    if (questions.has(question.id)) {
      throw new Error("Golden question id collision");
    }

    const permission = "permission" in input ? input.permission : undefined;
    const visibility = permission
      ? {
          requiredPermissionScope:
            "requiredPermissionScope" in input ? input.requiredPermissionScope : [],
          tenantId: permission.tenantId,
        }
      : "visibility" in input
        ? input.visibility
        : undefined;
    if (visibility) assertTrustedGoldenQuestionVisibility(visibility);
    return {
      ...(visibility
        ? {
            provenance: {
              requiredPermissionScope: [...visibility.requiredPermissionScope],
              tenantId: visibility.tenantId,
            },
          }
        : {}),
      question: cloneGoldenQuestion(question),
    };
  };
  const commitPreparedCreate = (prepared: PreparedInMemoryGoldenQuestionCreate): void => {
    questions.set(prepared.question.id, cloneGoldenQuestion(prepared.question));
    if (prepared.provenance) {
      provenance.set(prepared.question.id, cloneGoldenQuestionProvenance(prepared.provenance));
    }
  };
  const createStored = async (
    input: CreateGoldenQuestionInput | TrustedCreateGoldenQuestionInput,
  ): Promise<GoldenQuestion> => {
    const prepared = prepareCreate(input);
    commitPreparedCreate(prepared);
    return cloneGoldenQuestion(prepared.question);
  };
  const deleteStored = async ({ id, knowledgeSpaceId }: TrustedGoldenQuestionLookupInput) => {
    const question = questions.get(id);
    if (!question || question.knowledgeSpaceId !== knowledgeSpaceId) return false;
    provenance.delete(id);
    return questions.delete(id);
  };
  const updateStored = async ({
    id,
    knowledgeSpaceId,
    ...input
  }: TrustedUpdateGoldenQuestionInput): Promise<GoldenQuestion | null> => {
    const existing = questions.get(id);
    if (!existing || existing.knowledgeSpaceId !== knowledgeSpaceId) return null;
    const updated = GoldenQuestionSchema.parse({
      ...existing,
      ...input,
      expectedEvidenceIds: [...(input.expectedEvidenceIds ?? existing.expectedEvidenceIds)],
      metadata: cloneJsonObject(input.metadata ?? existing.metadata),
      tags: [...(input.tags ?? existing.tags)],
      updatedAt: now(),
    });
    questions.set(id, cloneGoldenQuestion(updated));
    return cloneGoldenQuestion(updated);
  };

  return {
    [inMemoryGoldenQuestionPromotionParticipant]: {
      commitPreparedCreate,
      prepareCreate,
    },
    create: async (input) => {
      assertGoldenQuestionPermissionBinding(input.permission);
      assertGoldenQuestionRequiredPermissionScope(
        input.requiredPermissionScope,
        input.permission.candidateGrants,
      );
      return createStored(input);
    },
    createTrusted: createStored,
    delete: async ({ id, knowledgeSpaceId, permission }) => {
      assertGoldenQuestionPermissionBinding(permission);
      if (!inMemoryGoldenQuestionVisible(provenance.get(id), permission)) return false;
      return deleteStored({ id, knowledgeSpaceId });
    },
    deleteTrusted: deleteStored,
    get: async ({ candidateGrants, id, knowledgeSpaceId, tenantId }) => {
      const question = questions.get(id);

      return question &&
        question.knowledgeSpaceId === knowledgeSpaceId &&
        inMemoryGoldenQuestionVisible(provenance.get(id), { candidateGrants, tenantId })
        ? cloneGoldenQuestion(question)
        : null;
    },
    getTrusted: async ({ id, knowledgeSpaceId }) => {
      const question = questions.get(id);
      return question && question.knowledgeSpaceId === knowledgeSpaceId
        ? cloneGoldenQuestion(question)
        : null;
    },
    list: async ({ candidateGrants, cursor, knowledgeSpaceId, limit, tenantId }) => {
      validateGoldenQuestionListLimit(limit, maxListLimit);

      const sortedQuestions = [...questions.values()]
        .filter((question) => question.knowledgeSpaceId === knowledgeSpaceId)
        .filter((question) =>
          inMemoryGoldenQuestionVisible(provenance.get(question.id), {
            candidateGrants,
            tenantId,
          }),
        )
        .filter((question) =>
          cursor
            ? question.createdAt > cursor.createdAt ||
              (question.createdAt === cursor.createdAt && question.id > cursor.id)
            : true,
        )
        .sort(
          (first, second) =>
            first.createdAt.localeCompare(second.createdAt) || first.id.localeCompare(second.id),
        )
        .slice(0, limit + 1);
      const items = sortedQuestions.slice(0, limit).map(cloneGoldenQuestion);
      const lastItem = items.at(-1);
      const nextCursor =
        sortedQuestions.length > limit && lastItem
          ? { createdAt: lastItem.createdAt, id: lastItem.id }
          : undefined;

      return {
        items,
        ...(nextCursor ? { nextCursor } : {}),
      };
    },
    listTrusted: async ({ cursor, knowledgeSpaceId, limit }) => {
      validateGoldenQuestionListLimit(limit, maxListLimit);
      return pagedGoldenQuestions([...questions.values()], { cursor, knowledgeSpaceId, limit });
    },
    update: async ({ id, knowledgeSpaceId, permission, ...input }) => {
      assertGoldenQuestionPermissionBinding(permission);
      if (!inMemoryGoldenQuestionVisible(provenance.get(id), permission)) return null;
      const existingProvenance = provenance.get(id);
      if (!existingProvenance) return null;
      const requiredPermissionScope = input.requiredPermissionScope
        ? assertGoldenQuestionRequiredPermissionScope(
            input.requiredPermissionScope,
            permission.candidateGrants,
          )
        : [...existingProvenance.requiredPermissionScope];
      const updated = await updateStored({ id, knowledgeSpaceId, ...input });
      if (updated) {
        provenance.set(id, { requiredPermissionScope, tenantId: permission.tenantId });
      }
      return updated;
    },
    updateTrusted: updateStored,
  };
}

export function createDatabaseGoldenQuestionRepository({
  database,
  generateId = randomUUID,
  maxListLimit,
  now = () => new Date().toISOString(),
}: DatabaseGoldenQuestionRepositoryOptions): GoldenQuestionRepository {
  if (maxListLimit < 1) {
    throw new Error("Golden question repository maxListLimit must be at least 1");
  }

  const tableName = "golden_questions";

  return {
    create: async (input) => {
      const timestamp = now();
      const id = generateId();
      const expectedEvidenceIds = JSON.stringify([...(input.expectedEvidenceIds ?? [])]);
      const tags = JSON.stringify([...(input.tags ?? [])]);
      const metadata = JSON.stringify(input.metadata ?? {});
      const params = [
        id,
        input.permission.tenantId,
        input.knowledgeSpaceId,
        input.question,
        expectedEvidenceIds,
        tags,
        metadata,
        JSON.stringify(input.requiredPermissionScope),
        timestamp,
        timestamp,
      ] satisfies readonly DatabaseQueryValue[];
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
      const result = await database.transaction(async (transaction) => {
        assertGoldenQuestionPermissionBinding(input.permission);
        assertGoldenQuestionRequiredPermissionScope(
          input.requiredPermissionScope,
          input.permission.candidateGrants,
        );
        const tenantId = input.permission.tenantId;
        if (
          !(await lockKnowledgeSpaceForDeletionAdmission(database, transaction, {
            knowledgeSpaceId: input.knowledgeSpaceId,
            tenantId,
          }))
        ) {
          return { rows: [], rowsAffected: 0 } as const;
        }
        await assertGoldenQuestionDatabasePermission(
          database,
          transaction,
          input.knowledgeSpaceId,
          input.permission,
          timestamp,
        );
        return transaction.execute({
          maxRows: 1,
          operation: "insert",
          params,
          sql: `INSERT INTO ${quoteDatabaseIdentifier(database, tableName)} (${columns
            .map((column) => quoteDatabaseIdentifier(database, column))
            .join(", ")}) SELECT ${params
            .map((_, index) => jsonInsertPlaceholder(database, index + 1, columns[index]))
            .join(", ")}${database.dialect === "postgres" ? " RETURNING *" : ""};`,
          tableName,
        });
      });

      if (result.rowsAffected !== 1 && result.rows.length !== 1) {
        throw new GoldenQuestionDeletionFenceActiveError();
      }

      return result.rows[0]
        ? mapGoldenQuestionRow(result.rows[0])
        : GoldenQuestionSchema.parse({
            createdAt: timestamp,
            expectedEvidenceIds: JSON.parse(expectedEvidenceIds),
            id,
            knowledgeSpaceId: input.knowledgeSpaceId,
            metadata: JSON.parse(metadata),
            question: input.question,
            tags: JSON.parse(tags),
            updatedAt: timestamp,
          });
    },
    delete: async ({ id, knowledgeSpaceId, permission }) =>
      database.transaction(async (transaction) => {
        const timestamp = now();
        assertGoldenQuestionPermissionBinding(permission);
        if (
          !(await lockKnowledgeSpaceForDeletionAdmission(database, transaction, {
            knowledgeSpaceId,
            tenantId: permission.tenantId,
          }))
        ) {
          throw new GoldenQuestionDeletionFenceActiveError();
        }
        await assertGoldenQuestionDatabasePermission(
          database,
          transaction,
          knowledgeSpaceId,
          permission,
          timestamp,
        );
        const existing = await databaseGoldenQuestionGet(
          database,
          {
            candidateGrants: permission.candidateGrants,
            id,
            knowledgeSpaceId,
            tenantId: permission.tenantId,
          },
          transaction,
          true,
        );
        if (!existing) return false;
        const result = await transaction.execute({
          maxRows: 0,
          operation: "delete",
          params: [permission.tenantId, knowledgeSpaceId, id],
          sql: `DELETE FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
            database,
            "tenant_id",
          )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
            database,
            "knowledge_space_id",
          )} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(
            database,
            "id",
          )} = ${databasePlaceholder(database, 3)};`,
          tableName,
        });
        return result.rowsAffected > 0;
      }),
    get: async (input) => databaseGoldenQuestionGet(database, input),
    getTrusted: async (input) => databaseGoldenQuestionGetTrusted(database, input),
    list: async (input) =>
      databaseGoldenQuestionList(database, input, maxListLimit, {
        candidateGrants: input.candidateGrants,
        tenantId: input.tenantId,
      }),
    listTrusted: async (input) => databaseGoldenQuestionList(database, input, maxListLimit),
    update: async ({ id, knowledgeSpaceId, permission, ...input }) => {
      return database.transaction(async (transaction) => {
        const timestamp = now();
        assertGoldenQuestionPermissionBinding(permission);
        if (
          !(await lockKnowledgeSpaceForDeletionAdmission(database, transaction, {
            knowledgeSpaceId,
            tenantId: permission.tenantId,
          }))
        ) {
          throw new GoldenQuestionDeletionFenceActiveError();
        }
        await assertGoldenQuestionDatabasePermission(
          database,
          transaction,
          knowledgeSpaceId,
          permission,
          timestamp,
        );
        const existing = await databaseGoldenQuestionGet(
          database,
          {
            candidateGrants: permission.candidateGrants,
            id,
            knowledgeSpaceId,
            tenantId: permission.tenantId,
          },
          transaction,
          true,
        );
        if (!existing) return null;
        const updatedAt = timestamp;
        const expectedEvidenceIds = JSON.stringify(
          input.expectedEvidenceIds ?? existing.expectedEvidenceIds,
        );
        const tags = JSON.stringify(input.tags ?? existing.tags);
        const metadata = JSON.stringify(input.metadata ?? existing.metadata);
        const requiredPermissionScope = input.requiredPermissionScope
          ? assertGoldenQuestionRequiredPermissionScope(
              input.requiredPermissionScope,
              permission.candidateGrants,
            )
          : null;
        const params = [
          input.question ?? existing.question,
          expectedEvidenceIds,
          tags,
          metadata,
          requiredPermissionScope ? JSON.stringify(requiredPermissionScope) : null,
          updatedAt,
          permission.tenantId,
          knowledgeSpaceId,
          id,
        ] satisfies readonly DatabaseQueryValue[];
        const result = await transaction.execute({
          maxRows: 1,
          operation: "update",
          params,
          sql: `UPDATE ${quoteDatabaseIdentifier(database, tableName)} SET ${quoteDatabaseIdentifier(database, "question")} = ${databasePlaceholder(database, 1)}, ${quoteDatabaseIdentifier(database, "expected_evidence_ids")} = ${jsonInsertPlaceholder(database, 2, "expected_evidence_ids")}, ${quoteDatabaseIdentifier(database, "tags")} = ${jsonInsertPlaceholder(database, 3, "tags")}, ${quoteDatabaseIdentifier(database, "metadata")} = ${jsonInsertPlaceholder(database, 4, "metadata")}, ${quoteDatabaseIdentifier(database, "required_permission_scope")} = COALESCE(${jsonInsertPlaceholder(database, 5, "required_permission_scope")}, ${quoteDatabaseIdentifier(database, "required_permission_scope")}), ${quoteDatabaseIdentifier(database, "updated_at")} = ${databasePlaceholder(database, 6)} WHERE ${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(database, 7)} AND ${quoteDatabaseIdentifier(database, "knowledge_space_id")} = ${databasePlaceholder(database, 8)} AND ${quoteDatabaseIdentifier(database, "id")} = ${databasePlaceholder(database, 9)}${database.dialect === "postgres" ? " RETURNING *" : ""};`,
          tableName,
        });
        if (result.rows[0]) return mapGoldenQuestionRow(result.rows[0]);
        return result.rowsAffected > 0
          ? GoldenQuestionSchema.parse({
              ...existing,
              expectedEvidenceIds: JSON.parse(expectedEvidenceIds),
              metadata: JSON.parse(metadata),
              question: input.question ?? existing.question,
              tags: JSON.parse(tags),
              updatedAt,
            })
          : null;
      });
    },
  };
}

async function databaseGoldenQuestionGet(
  database: DatabaseAdapter,
  input: GoldenQuestionLookupInput,
  executor: DatabaseExecutor = database,
  forUpdate = false,
): Promise<GoldenQuestion | null> {
  assertGoldenQuestionReadScope(input);
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [
      input.tenantId,
      input.knowledgeSpaceId,
      input.id,
      JSON.stringify(input.candidateGrants),
    ],
    sql: `SELECT golden.* FROM ${quoteDatabaseIdentifier(database, "golden_questions")} golden WHERE golden.${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(database, 1)} AND golden.${quoteDatabaseIdentifier(database, "knowledge_space_id")} = ${databasePlaceholder(database, 2)} AND golden.${quoteDatabaseIdentifier(database, "id")} = ${databasePlaceholder(database, 3)} AND ${goldenQuestionPermissionScopeSql(database, `golden.${quoteDatabaseIdentifier(database, "required_permission_scope")}`, databasePlaceholder(database, 4))} AND ${goldenQuestionSpaceReadableSql(database, "golden")} LIMIT 1${forUpdate ? " FOR UPDATE" : ""};`,
    tableName: "golden_questions",
  });

  return result.rows[0] ? mapGoldenQuestionRow(result.rows[0]) : null;
}

async function databaseGoldenQuestionGetTrusted(
  database: DatabaseAdapter,
  input: TrustedGoldenQuestionLookupInput,
  executor: DatabaseExecutor = database,
  forUpdate = false,
): Promise<GoldenQuestion | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [input.knowledgeSpaceId, input.id],
    sql: `SELECT golden.* FROM ${quoteDatabaseIdentifier(database, "golden_questions")} golden WHERE golden.${quoteDatabaseIdentifier(database, "knowledge_space_id")} = ${databasePlaceholder(database, 1)} AND golden.${quoteDatabaseIdentifier(database, "id")} = ${databasePlaceholder(database, 2)} AND ${goldenQuestionSpaceReadableSql(database, "golden")} LIMIT 1${forUpdate ? " FOR UPDATE" : ""};`,
    tableName: "golden_questions",
  });
  return result.rows[0] ? mapGoldenQuestionRow(result.rows[0]) : null;
}

async function databaseGoldenQuestionList(
  database: DatabaseAdapter,
  input: TrustedListGoldenQuestionsInput,
  maxListLimit: number,
  scope?: GoldenQuestionReadScope,
): Promise<ListGoldenQuestionsResult> {
  validateGoldenQuestionListLimit(input.limit, maxListLimit);
  if (scope) assertGoldenQuestionReadScope(scope);

  const readLimit = input.limit + 1;
  const params: DatabaseQueryValue[] = scope
    ? [scope.tenantId, input.knowledgeSpaceId, JSON.stringify(scope.candidateGrants)]
    : [input.knowledgeSpaceId];
  const conditions = scope
    ? [
        `golden.${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(database, 1)}`,
        `golden.${quoteDatabaseIdentifier(database, "knowledge_space_id")} = ${databasePlaceholder(database, 2)}`,
        goldenQuestionPermissionScopeSql(
          database,
          `golden.${quoteDatabaseIdentifier(database, "required_permission_scope")}`,
          databasePlaceholder(database, 3),
        ),
      ]
    : [
        `golden.${quoteDatabaseIdentifier(database, "knowledge_space_id")} = ${databasePlaceholder(database, 1)}`,
      ];
  if (input.cursor) {
    params.push(input.cursor.createdAt, input.cursor.id);
    const createdAt = databasePlaceholder(database, params.length - 1);
    const id = databasePlaceholder(database, params.length);
    conditions.push(
      `(golden.${quoteDatabaseIdentifier(database, "created_at")} > ${createdAt} OR (golden.${quoteDatabaseIdentifier(database, "created_at")} = ${createdAt} AND golden.${quoteDatabaseIdentifier(database, "id")} > ${id}))`,
    );
  }
  conditions.push(goldenQuestionSpaceReadableSql(database, "golden"));
  params.push(readLimit);
  const result = await database.execute({
    maxRows: readLimit,
    operation: "select",
    params,
    sql: `SELECT golden.* FROM ${quoteDatabaseIdentifier(database, "golden_questions")} golden WHERE ${conditions.join(" AND ")} ORDER BY golden.${quoteDatabaseIdentifier(database, "created_at")} ASC, golden.${quoteDatabaseIdentifier(database, "id")} ASC LIMIT ${databasePlaceholder(database, params.length)};`,
    tableName: "golden_questions",
  });
  const rows = result.rows.map(mapGoldenQuestionRow);
  const items = rows.slice(0, input.limit).map(cloneGoldenQuestion);
  const lastItem = items.at(-1);
  return {
    items,
    ...(rows.length > input.limit && lastItem
      ? { nextCursor: { createdAt: lastItem.createdAt, id: lastItem.id } }
      : {}),
  };
}

function goldenQuestionSpaceReadableSql(database: DatabaseAdapter, alias: string): string {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const spaceId = `${alias}.${q("knowledge_space_id")}`;
  const tenantId = `${alias}.${q("tenant_id")}`;
  return `EXISTS (SELECT 1 FROM ${q("knowledge_spaces")} AS golden_space WHERE golden_space.${q("tenant_id")} = ${tenantId} AND golden_space.${q("id")} = ${spaceId} AND golden_space.${q("lifecycle_state")} = 'active' AND golden_space.${q("deletion_job_id")} IS NULL AND NOT EXISTS (SELECT 1 FROM ${q("deletion_jobs")} AS active_deletion WHERE active_deletion.${q("tenant_id")} = ${tenantId} AND active_deletion.${q("knowledge_space_id")} = ${spaceId} AND active_deletion.${q("active_slot")} = 1))`;
}

function goldenQuestionPermissionScopeSql(
  database: DatabaseAdapter,
  column: string,
  grants: string,
): string {
  return database.dialect === "postgres"
    ? `(jsonb_typeof(${column}) = 'array' AND ${grants}::jsonb @> ${column})`
    : `(JSON_TYPE(${column}) = 'ARRAY' AND JSON_CONTAINS(CAST(${grants} AS JSON), ${column}))`;
}

function mapGoldenQuestionRow(row: DatabaseRow): GoldenQuestion {
  return GoldenQuestionSchema.parse({
    createdAt: stringColumn(row, "created_at"),
    expectedEvidenceIds: jsonStringArrayColumn(row, "expected_evidence_ids"),
    id: stringColumn(row, "id"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    metadata: jsonObjectColumn(row, "metadata"),
    question: stringColumn(row, "question"),
    tags: jsonStringArrayColumn(row, "tags"),
    updatedAt: stringColumn(row, "updated_at"),
  });
}

function cloneGoldenQuestion(question: GoldenQuestion): GoldenQuestion {
  return GoldenQuestionSchema.parse(JSON.parse(JSON.stringify(question)) as unknown);
}

function cloneGoldenQuestionProvenance(
  provenance: InMemoryGoldenQuestionProvenance,
): InMemoryGoldenQuestionProvenance {
  return {
    requiredPermissionScope: [...provenance.requiredPermissionScope],
    tenantId: provenance.tenantId,
  };
}

function inMemoryGoldenQuestionVisible(
  provenance: InMemoryGoldenQuestionProvenance | undefined,
  scope: GoldenQuestionReadScope,
): boolean {
  if (!provenance || provenance.tenantId !== scope.tenantId) return false;
  const candidates = new Set(scope.candidateGrants);
  return provenance.requiredPermissionScope.every((grant) => candidates.has(grant));
}

function pagedGoldenQuestions(
  questions: readonly GoldenQuestion[],
  input: TrustedListGoldenQuestionsInput,
): ListGoldenQuestionsResult {
  const page = questions
    .filter((question) => question.knowledgeSpaceId === input.knowledgeSpaceId)
    .filter((question) =>
      input.cursor
        ? question.createdAt > input.cursor.createdAt ||
          (question.createdAt === input.cursor.createdAt && question.id > input.cursor.id)
        : true,
    )
    .sort(
      (first, second) =>
        first.createdAt.localeCompare(second.createdAt) || first.id.localeCompare(second.id),
    )
    .slice(0, input.limit + 1);
  const items = page.slice(0, input.limit).map(cloneGoldenQuestion);
  const lastItem = items.at(-1);
  return {
    items,
    ...(page.length > input.limit && lastItem
      ? { nextCursor: { createdAt: lastItem.createdAt, id: lastItem.id } }
      : {}),
  };
}

function validateGoldenQuestionRepositoryBounds({
  maxListLimit,
  maxQuestions,
}: {
  readonly maxListLimit: number;
  readonly maxQuestions: number;
}): void {
  if (maxQuestions < 1) {
    throw new Error("Golden question repository maxQuestions must be at least 1");
  }

  if (maxListLimit < 1) {
    throw new Error("Golden question repository maxListLimit must be at least 1");
  }
}

function validateGoldenQuestionListLimit(limit: number, maxListLimit: number): void {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("Golden question list limit must be at least 1");
  }

  if (limit > maxListLimit) {
    throw new GoldenQuestionListLimitExceededError(maxListLimit);
  }
}

async function assertGoldenQuestionDatabasePermission(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  knowledgeSpaceId: string,
  permission: GoldenQuestionPermissionBinding,
  now: string,
) {
  const validated = await assertDatabaseKnowledgeSpacePermissionFence({
    database,
    executor,
    fence: {
      accessChannel: permission.accessChannel,
      knowledgeSpaceId,
      permissionSnapshotId: permission.permissionSnapshotId,
      permissionSnapshotRevision: permission.permissionSnapshotRevision,
      requestedBySubjectId: permission.requestedBySubjectId,
      tenantId: permission.tenantId,
    },
    now,
    requiredAccess: "write",
  });
  if (!sameStringSet(validated.permissionScopes, permission.candidateGrants)) {
    throw new KnowledgeSpaceAccessError(
      "space_access_permission_snapshot_invalid",
      "Golden-question permission scopes no longer match the server-issued binding",
    );
  }
  return validated;
}

function assertGoldenQuestionPermissionBinding(permission: GoldenQuestionPermissionBinding): void {
  if (
    !permission.tenantId ||
    !permission.requestedBySubjectId ||
    !permission.permissionSnapshotId ||
    permission.permissionSnapshotRevision < 1 ||
    permission.candidateGrants.length === 0 ||
    new Set(permission.candidateGrants).size !== permission.candidateGrants.length
  ) {
    throw new KnowledgeSpaceAccessError(
      "space_access_permission_snapshot_invalid",
      "Golden-question permission binding is invalid",
    );
  }
}

function assertGoldenQuestionReadScope(scope: GoldenQuestionReadScope): void {
  if (
    !scope.tenantId ||
    scope.candidateGrants.length === 0 ||
    new Set(scope.candidateGrants).size !== scope.candidateGrants.length
  ) {
    throw new KnowledgeSpaceAccessError(
      "space_access_permission_snapshot_invalid",
      "Golden-question read scope is invalid",
    );
  }
}

function assertTrustedGoldenQuestionVisibility(visibility: TrustedGoldenQuestionVisibility): void {
  if (!visibility.tenantId) {
    throw new KnowledgeSpaceAccessError(
      "space_access_permission_snapshot_invalid",
      "Golden-question trusted visibility has no tenant",
    );
  }
  assertGoldenQuestionRequiredPermissionScope(
    visibility.requiredPermissionScope,
    visibility.requiredPermissionScope,
  );
}

function assertGoldenQuestionRequiredPermissionScope(
  requiredPermissionScope: readonly string[],
  candidateGrants: readonly string[],
): readonly string[] {
  const required = normalizeGoldenQuestionPermissionScope(requiredPermissionScope);
  const candidates = normalizeGoldenQuestionPermissionScope(candidateGrants);
  const candidateSet = new Set(candidates);
  if (!required.every((grant) => candidateSet.has(grant))) {
    throw new KnowledgeSpaceAccessError(
      "space_access_permission_snapshot_invalid",
      "Golden-question evidence scope is not visible to the current permission",
    );
  }
  return required;
}

function normalizeGoldenQuestionPermissionScope(scope: readonly string[]): readonly string[] {
  if (!Array.isArray(scope)) {
    throw new KnowledgeSpaceAccessError(
      "space_access_permission_snapshot_invalid",
      "Golden-question permission scope is invalid",
    );
  }
  const normalized = scope.map((grant) => grant.trim());
  if (
    normalized.some((grant, index) => !grant || grant !== scope[index] || grant.length > 512) ||
    new Set(normalized).size !== normalized.length
  ) {
    throw new KnowledgeSpaceAccessError(
      "space_access_permission_snapshot_invalid",
      "Golden-question permission scope is invalid",
    );
  }
  return [...normalized].sort();
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const expected = new Set(left);
  return (
    expected.size === left.length &&
    new Set(right).size === right.length &&
    right.every((value) => expected.has(value))
  );
}
