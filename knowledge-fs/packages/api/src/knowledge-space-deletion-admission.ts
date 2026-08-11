import type { DatabaseAdapter, DatabaseExecutor } from "@knowledge/core";

import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";

export interface KnowledgeSpaceDeletionAdmissionInput {
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;
}

export interface SourceWorkflowDeletionAdmissionInput extends KnowledgeSpaceDeletionAdmissionInput {
  readonly sourceId?: string | undefined;
}

/**
 * Serializes writers with durable-deletion request creation. The deletion repository uses the
 * same exact space-row lock before installing its active job, so the lifecycle/active-job check
 * and the caller's mutation must remain in this transaction.
 */
export async function lockKnowledgeSpaceForDeletionAdmission(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: KnowledgeSpaceDeletionAdmissionInput,
): Promise<boolean> {
  return lockForDeletionAdmission(database, executor, input);
}

/**
 * Keeps Source workflow admission scoped to its Source while preserving the space-row ordering
 * used by durable deletion. An active deletion for a different Source cannot overlap this
 * workflow's rows, while space, document, and matching-Source deletions must still fence it.
 */
export async function lockKnowledgeSpaceForSourceWorkflowAdmission(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: SourceWorkflowDeletionAdmissionInput,
): Promise<boolean> {
  return lockForDeletionAdmission(database, executor, input, input.sourceId);
}

async function lockForDeletionAdmission(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: KnowledgeSpaceDeletionAdmissionInput,
  sourceId?: string,
): Promise<boolean> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const space = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [input.tenantId, input.knowledgeSpaceId],
    sql: `SELECT ${q("id")}, ${q("lifecycle_state")}, ${q("deletion_job_id")} FROM ${q("knowledge_spaces")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("id")} = ${p(2)} FOR UPDATE;`,
    tableName: "knowledge_spaces",
  });
  const row = space.rows[0];
  if (!row || row.lifecycle_state !== "active" || row.deletion_job_id != null) return false;

  const activeDeletionParams = sourceId
    ? [input.tenantId, input.knowledgeSpaceId, sourceId]
    : [input.tenantId, input.knowledgeSpaceId];
  const sourceScope = sourceId
    ? ` AND (${q("target_type")} <> 'source' OR ${q("target_id")} = ${p(3)})`
    : "";
  const activeDeletion = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: activeDeletionParams,
    // Keep this a current locking read. In TiDB repeatable-read mode the transaction snapshot can
    // predate a deletion transaction that the space-row lock just waited for.
    sql: `SELECT ${q("id")} FROM ${q("deletion_jobs")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("active_slot")} = 1${sourceScope} LIMIT 1 FOR UPDATE;`,
    tableName: "deletion_jobs",
  });
  return activeDeletion.rows.length === 0;
}
