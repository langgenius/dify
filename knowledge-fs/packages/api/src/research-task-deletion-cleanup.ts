import type { DatabaseAdapter, DatabaseExecutor, DatabaseQueryValue } from "@knowledge/core";

import { stringColumn } from "./database-row-utils";
import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";

export interface ResearchTaskSpaceDeletionScope {
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;
}

/**
 * Research jobs accept arbitrary query/metadata/progress payloads, so document/source durable
 * deletion cannot prove per-document attribution. I2 therefore invalidates the complete space
 * Research history. Deleting the owning jobs makes every GET/partials/events endpoint return 404.
 */
export async function deleteResearchTaskSpaceResiduePage(
  database: DatabaseAdapter,
  input: ResearchTaskSpaceDeletionScope & { readonly limit: number },
): Promise<number> {
  return database.transaction((transaction) =>
    deleteResearchTaskSpaceResiduePageWithExecutor(database, transaction, input),
  );
}

/**
 * Executor form used by the durable-deletion processor. The caller must run this inside the same
 * transaction as its lease/attempt fence so a stale worker cannot commit a cleanup page.
 */
export async function deleteResearchTaskSpaceResiduePageWithExecutor(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: ResearchTaskSpaceDeletionScope & { readonly limit: number },
): Promise<number> {
  validateScope(input);
  validateLimit(input.limit);
  const jobIds = await selectScopedIds(
    database,
    executor,
    "research_task_jobs",
    input,
    input.limit,
    true,
  );
  if (jobIds.length > 0) {
    await deleteUnscopedJobChildren(
      database,
      executor,
      "research_task_outbox",
      "research_task_job_id",
      jobIds,
    );
    for (const table of [
      "research_task_partial_results",
      "research_task_progress_events",
    ] as const) {
      await deleteScopedJobChildren(database, executor, table, input, jobIds);
    }
    await deleteScopedIds(database, executor, "research_task_jobs", input, jobIds);
    return jobIds.length;
  }

  // Explicitly scrub tenant-attributable orphans for installations that temporarily ran with
  // FK enforcement disabled.
  for (const table of ["research_task_partial_results", "research_task_progress_events"] as const) {
    const orphanIds = await selectScopedIds(database, executor, table, input, input.limit, true);
    if (orphanIds.length > 0) {
      await deleteScopedIds(database, executor, table, input, orphanIds);
      return orphanIds.length;
    }
  }

  // The outbox deliberately has no tenant/space columns. Once its FK is absent or disabled an
  // orphan cannot be attributed safely, but deleting any row whose owning job does not exist is
  // globally safe. Keep it bounded so a damaged installation cannot monopolize a deletion lease.
  const orphanOutboxIds = await selectGlobalOrphanOutboxIds(database, executor, input.limit);
  if (orphanOutboxIds.length > 0) {
    await deleteIds(database, executor, "research_task_outbox", orphanOutboxIds);
    return orphanOutboxIds.length;
  }
  return 0;
}

export async function hasResearchTaskSpaceResidue(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: ResearchTaskSpaceDeletionScope,
): Promise<boolean> {
  validateScope(input);
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  for (const table of [
    "research_task_jobs",
    "research_task_partial_results",
    "research_task_progress_events",
  ] as const) {
    const result = await executor.execute({
      maxRows: 1,
      operation: "select",
      params: [input.tenantId, input.knowledgeSpaceId],
      sql: `SELECT ${q("id")} FROM ${q(table)} WHERE ${q("tenant_id")} = ${p(
        1,
      )} AND ${q("knowledge_space_id")} = ${p(2)} LIMIT 1;`,
      tableName: table,
    });
    if (result.rows.length > 0) return true;
  }
  const orphanOutbox = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [],
    sql: `SELECT orphan_outbox.${q("id")} FROM ${q(
      "research_task_outbox",
    )} AS orphan_outbox WHERE NOT EXISTS (SELECT 1 FROM ${q(
      "research_task_jobs",
    )} AS owning_job WHERE owning_job.${q("id")} = orphan_outbox.${q(
      "research_task_job_id",
    )}) LIMIT 1;`,
    tableName: "research_task_outbox",
  });
  return orphanOutbox.rows.length > 0;
}

async function selectGlobalOrphanOutboxIds(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  limit: number,
): Promise<readonly string[]> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const result = await executor.execute({
    maxRows: limit,
    operation: "select",
    params: [limit],
    sql: `SELECT orphan_outbox.${q("id")} FROM ${q(
      "research_task_outbox",
    )} AS orphan_outbox WHERE NOT EXISTS (SELECT 1 FROM ${q(
      "research_task_jobs",
    )} AS owning_job WHERE owning_job.${q("id")} = orphan_outbox.${q(
      "research_task_job_id",
    )}) ORDER BY orphan_outbox.${q("id")} ASC LIMIT ${p(1)} FOR UPDATE;`,
    tableName: "research_task_outbox",
  });
  return result.rows.map((row) => stringColumn(row, "id"));
}

async function selectScopedIds(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  table: string,
  input: ResearchTaskSpaceDeletionScope,
  limit: number,
  forUpdate: boolean,
): Promise<readonly string[]> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const result = await executor.execute({
    maxRows: limit,
    operation: "select",
    params: [input.tenantId, input.knowledgeSpaceId, limit],
    sql: `SELECT ${q("id")} FROM ${q(table)} WHERE ${q("tenant_id")} = ${p(
      1,
    )} AND ${q("knowledge_space_id")} = ${p(2)} ORDER BY ${q("id")} ASC LIMIT ${p(3)}${
      forUpdate ? " FOR UPDATE" : ""
    };`,
    tableName: table,
  });
  return result.rows.map((row) => stringColumn(row, "id"));
}

async function deleteScopedJobChildren(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  table: string,
  input: ResearchTaskSpaceDeletionScope,
  jobIds: readonly string[],
): Promise<void> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const params: DatabaseQueryValue[] = [input.tenantId, input.knowledgeSpaceId, ...jobIds];
  const placeholders = jobIds.map((_, index) => databasePlaceholder(database, index + 3));
  await executor.execute({
    maxRows: 0,
    operation: "delete",
    params,
    sql: `DELETE FROM ${q(table)} WHERE ${q("tenant_id")} = ${databasePlaceholder(
      database,
      1,
    )} AND ${q("knowledge_space_id")} = ${databasePlaceholder(database, 2)} AND ${q(
      "research_task_job_id",
    )} IN (${placeholders.join(", ")});`,
    tableName: table,
  });
}

async function deleteUnscopedJobChildren(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  table: string,
  jobColumn: string,
  jobIds: readonly string[],
): Promise<void> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  await executor.execute({
    maxRows: 0,
    operation: "delete",
    params: jobIds,
    sql: `DELETE FROM ${q(table)} WHERE ${q(jobColumn)} IN (${jobIds
      .map((_, index) => databasePlaceholder(database, index + 1))
      .join(", ")});`,
    tableName: table,
  });
}

async function deleteScopedIds(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  table: string,
  input: ResearchTaskSpaceDeletionScope,
  ids: readonly string[],
): Promise<void> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const params: DatabaseQueryValue[] = [input.tenantId, input.knowledgeSpaceId, ...ids];
  const placeholders = ids.map((_, index) => databasePlaceholder(database, index + 3));
  await executor.execute({
    maxRows: 0,
    operation: "delete",
    params,
    sql: `DELETE FROM ${q(table)} WHERE ${q("tenant_id")} = ${databasePlaceholder(
      database,
      1,
    )} AND ${q("knowledge_space_id")} = ${databasePlaceholder(database, 2)} AND ${q(
      "id",
    )} IN (${placeholders.join(", ")});`,
    tableName: table,
  });
}

async function deleteIds(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  table: string,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  await executor.execute({
    maxRows: 0,
    operation: "delete",
    params: ids,
    sql: `DELETE FROM ${q(table)} WHERE ${q("id")} IN (${ids
      .map((_, index) => databasePlaceholder(database, index + 1))
      .join(", ")});`,
    tableName: table,
  });
}

function validateScope(input: ResearchTaskSpaceDeletionScope): void {
  if (!input.tenantId.trim() || !input.knowledgeSpaceId.trim()) {
    throw new Error("Research task deletion scope is required");
  }
}

function validateLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
    throw new Error("Research task deletion limit must be between 1 and 10000");
  }
}
