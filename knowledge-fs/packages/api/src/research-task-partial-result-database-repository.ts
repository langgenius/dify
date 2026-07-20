import { randomUUID } from "node:crypto";

import type {
  DatabaseAdapter,
  DatabaseExecutor,
  DatabaseQueryValue,
  DatabaseRow,
} from "@knowledge/core";
import { EvidenceBundleSchema } from "@knowledge/core";

import { numberColumn, stringColumn } from "./database-row-utils";
import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";
import { jsonObjectColumn } from "./json-utils";
import type {
  AppendResearchTaskPartialResultInput,
  ListResearchTaskPartialResultsInput,
  ResearchTaskPartialResult,
  ResearchTaskPartialResultRepository,
} from "./research-task-job";

export interface CreateDatabaseResearchTaskPartialResultRepositoryOptions {
  readonly database: DatabaseAdapter;
  readonly generateId?: (() => string) | undefined;
  readonly maxListLimit: number;
  readonly now?: (() => number) | undefined;
}

const partialTable = "research_task_partial_results";
const jobTable = "research_task_jobs";

export function createDatabaseResearchTaskPartialResultRepository({
  database,
  generateId = randomUUID,
  maxListLimit,
  now = Date.now,
}: CreateDatabaseResearchTaskPartialResultRepositoryOptions): ResearchTaskPartialResultRepository {
  if (!Number.isSafeInteger(maxListLimit) || maxListLimit < 1) {
    throw new Error("Research task partial maxListLimit must be a positive integer");
  }

  return {
    append: async (input) => {
      validateAppend(input);
      return database.transaction(async (transaction) => {
        await requireJobScope(database, transaction, input);
        const idempotencyKey =
          input.idempotencyKey?.trim() ?? `partial:${generateId()}:${input.researchTaskJobId}`;
        const existing = await getByIdempotencyKey(
          database,
          transaction,
          input.researchTaskJobId,
          idempotencyKey,
        );
        if (existing) {
          return existing;
        }
        const sequence = await nextSequence(database, transaction, input.researchTaskJobId);
        const evidenceBundle = EvidenceBundleSchema.parse(input.evidenceBundle);
        const params: DatabaseQueryValue[] = [
          generateId(),
          input.tenantId,
          input.knowledgeSpaceId,
          input.researchTaskJobId,
          sequence,
          idempotencyKey,
          JSON.stringify(evidenceBundle),
          now(),
        ];
        await transaction.execute({
          maxRows: 0,
          operation: "insert",
          params,
          sql: `INSERT INTO ${q(database, partialTable)} (${[
            "id",
            "tenant_id",
            "knowledge_space_id",
            "research_task_job_id",
            "sequence",
            "idempotency_key",
            "evidence_bundle",
            "created_at",
          ]
            .map((column) => q(database, column))
            .join(", ")}) VALUES (${params
            .map((_, index) =>
              index === 6
                ? database.dialect === "postgres"
                  ? `${p(database, index + 1)}::jsonb`
                  : `CAST(${p(database, index + 1)} AS JSON)`
                : p(database, index + 1),
            )
            .join(", ")})`,
          tableName: partialTable,
        });
        return {
          evidenceBundle,
          knowledgeSpaceId: input.knowledgeSpaceId,
          researchTaskJobId: input.researchTaskJobId,
          sequence,
          tenantId: input.tenantId,
        };
      });
    },
    list: async (input) => {
      const cursor = validateList(input, maxListLimit);
      const params: DatabaseQueryValue[] = [
        input.tenantId,
        input.researchTaskJobId,
        cursor,
        input.limit + 1,
      ];
      const result = await database.execute({
        maxRows: input.limit + 1,
        operation: "select",
        params,
        sql: `SELECT * FROM ${q(database, partialTable)} WHERE ${q(
          database,
          "tenant_id",
        )} = ${p(database, 1)} AND ${q(database, "research_task_job_id")} = ${p(
          database,
          2,
        )} AND ${q(database, "sequence")} > ${p(database, 3)} ORDER BY ${q(
          database,
          "sequence",
        )}, ${q(database, "id")} LIMIT ${p(database, 4)}`,
        tableName: partialTable,
      });
      const parsed = result.rows.map(partialFromRow);
      const items = parsed.slice(0, input.limit);
      return {
        items,
        ...(parsed.length > input.limit
          ? { nextCursor: String(items.at(-1)?.sequence ?? cursor) }
          : {}),
      };
    },
  };
}

async function requireJobScope(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: AppendResearchTaskPartialResultInput,
): Promise<void> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [input.researchTaskJobId, input.tenantId, input.knowledgeSpaceId],
    sql: `SELECT ${q(database, "id")} FROM ${q(database, jobTable)} WHERE ${q(
      database,
      "id",
    )} = ${p(database, 1)} AND ${q(database, "tenant_id")} = ${p(
      database,
      2,
    )} AND ${q(database, "knowledge_space_id")} = ${p(database, 3)} FOR UPDATE`,
    tableName: jobTable,
  });
  if (result.rows.length !== 1) {
    throw new Error("Research task partial result job scope was not found");
  }
}

async function nextSequence(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  jobId: string,
): Promise<number> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [jobId],
    sql: `SELECT ${q(database, "sequence")} FROM ${q(
      database,
      partialTable,
    )} WHERE ${q(database, "research_task_job_id")} = ${p(
      database,
      1,
    )} ORDER BY ${q(database, "sequence")} DESC LIMIT 1`,
    tableName: partialTable,
  });
  return result.rows[0] ? numberColumn(result.rows[0], "sequence") + 1 : 1;
}

async function getByIdempotencyKey(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  jobId: string,
  idempotencyKey: string,
): Promise<ResearchTaskPartialResult | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [jobId, idempotencyKey],
    sql: `SELECT * FROM ${q(database, partialTable)} WHERE ${q(
      database,
      "research_task_job_id",
    )} = ${p(database, 1)} AND ${q(database, "idempotency_key")} = ${p(database, 2)}`,
    tableName: partialTable,
  });
  return result.rows[0] ? partialFromRow(result.rows[0]) : null;
}

function partialFromRow(row: DatabaseRow): ResearchTaskPartialResult {
  return {
    evidenceBundle: EvidenceBundleSchema.parse(jsonObjectColumn(row, "evidence_bundle")),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    researchTaskJobId: stringColumn(row, "research_task_job_id"),
    sequence: numberColumn(row, "sequence"),
    tenantId: stringColumn(row, "tenant_id"),
  };
}

function validateAppend(input: AppendResearchTaskPartialResultInput): void {
  for (const [field, value] of [
    ["tenantId", input.tenantId],
    ["knowledgeSpaceId", input.knowledgeSpaceId],
    ["researchTaskJobId", input.researchTaskJobId],
  ] as const) {
    if (!value.trim()) {
      throw new Error(`Research task partial ${field} is required`);
    }
  }
  if (input.idempotencyKey !== undefined && !input.idempotencyKey.trim()) {
    throw new Error("Research task partial idempotencyKey must not be empty");
  }
}

function validateList(input: ListResearchTaskPartialResultsInput, maxListLimit: number): number {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > maxListLimit) {
    throw new Error(`Research task partial limit must be between 1 and ${maxListLimit}`);
  }
  const cursor = input.cursor === undefined ? 0 : Number(input.cursor);
  if (!Number.isSafeInteger(cursor) || cursor < 0 || String(cursor) !== (input.cursor ?? "0")) {
    throw new Error("Research task partial cursor is invalid");
  }
  return cursor;
}

function q(database: DatabaseAdapter, identifier: string): string {
  return quoteDatabaseIdentifier(database, identifier);
}

function p(database: DatabaseAdapter, position: number): string {
  return databasePlaceholder(database, position);
}
