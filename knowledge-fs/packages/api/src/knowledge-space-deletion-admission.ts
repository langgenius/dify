import type { DatabaseAdapter, DatabaseExecutor } from "@knowledge/core";

import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";

export interface KnowledgeSpaceDeletionAdmissionInput {
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;
}

export interface SourceWorkflowDeletionAdmissionInput extends KnowledgeSpaceDeletionAdmissionInput {
  readonly sourceId?: string | undefined;
}

export interface DocumentWriteDeletionAdmissionInput extends KnowledgeSpaceDeletionAdmissionInput {
  readonly documentAssetId?: string | undefined;
  readonly documentId?: string | undefined;
  readonly sourceId?: string | undefined;
}

type DeletionAdmissionScope =
  | {
      readonly kind: "document_write";
      readonly value: DocumentWriteDeletionAdmissionInput;
    }
  | {
      readonly kind: "source_workflow";
      readonly sourceId?: string | undefined;
    };

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
  return lockForDeletionAdmission(database, executor, input, {
    kind: "source_workflow",
    sourceId: input.sourceId,
  });
}

/**
 * Serializes a document write with deletion request creation without turning an unrelated
 * document deletion into a knowledge-space-wide outage. Space deletion always wins; Source,
 * logical-document and asset deletions fence only the matching aggregate hierarchy.
 */
export async function lockKnowledgeSpaceForDocumentWriteAdmission(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: DocumentWriteDeletionAdmissionInput,
): Promise<boolean> {
  return lockForDeletionAdmission(database, executor, input, {
    kind: "document_write",
    value: input,
  });
}

async function lockForDeletionAdmission(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: KnowledgeSpaceDeletionAdmissionInput,
  scope?: DeletionAdmissionScope,
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

  const activeDeletionParams = [input.tenantId, input.knowledgeSpaceId];
  let deletionScope = "";
  if (scope?.kind === "source_workflow" && scope.sourceId) {
    activeDeletionParams.push(scope.sourceId);
    deletionScope = ` AND (active_deletion.${q("target_type")} <> 'source' OR active_deletion.${q("target_id")} = ${p(3)})`;
  } else if (scope?.kind === "document_write") {
    deletionScope = documentWriteDeletionScopeSql(database, activeDeletionParams, scope.value);
  }
  const activeDeletion = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: activeDeletionParams,
    // Keep this a current locking read. In TiDB repeatable-read mode the transaction snapshot can
    // predate a deletion transaction that the space-row lock just waited for.
    sql: `SELECT active_deletion.${q("id")} FROM ${q("deletion_jobs")} active_deletion WHERE active_deletion.${q("tenant_id")} = ${p(1)} AND active_deletion.${q("knowledge_space_id")} = ${p(2)} AND active_deletion.${q("active_slot")} = 1${deletionScope} LIMIT 1 FOR UPDATE;`,
    tableName: "deletion_jobs",
  });
  return activeDeletion.rows.length === 0;
}

function documentWriteDeletionScopeSql(
  database: DatabaseAdapter,
  params: string[],
  input: DocumentWriteDeletionAdmissionInput,
): string {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const targetType = `active_deletion.${q("target_type")}`;
  const targetId = `active_deletion.${q("target_id")}`;
  const conditions = [`${targetType} = 'knowledge_space'`];
  const addParam = (value: string): string => {
    params.push(value);
    return p(params.length);
  };

  if (input.sourceId) {
    const source = addParam(input.sourceId);
    conditions.push(`(${targetType} = 'source' AND ${targetId} = ${source})`);
  }
  if (input.documentId) {
    const document = addParam(input.documentId);
    conditions.push(`(${targetType} = 'logical_document' AND ${targetId} = ${document})`);
    conditions.push(
      `(${targetType} = 'source' AND EXISTS (SELECT 1 FROM ${q("logical_documents")} admission_document WHERE admission_document.${q("tenant_id")} = ${p(1)} AND admission_document.${q("knowledge_space_id")} = ${p(2)} AND admission_document.${q("id")} = ${document} AND admission_document.${q("source_id")} = ${targetId}))`,
    );
    conditions.push(
      `(${targetType} = 'document_asset' AND EXISTS (SELECT 1 FROM ${q("document_revisions")} admission_revision WHERE admission_revision.${q("tenant_id")} = ${p(1)} AND admission_revision.${q("knowledge_space_id")} = ${p(2)} AND admission_revision.${q("document_id")} = ${document} AND admission_revision.${q("document_asset_id")} = ${targetId}))`,
    );
  }
  if (input.documentAssetId) {
    const asset = addParam(input.documentAssetId);
    conditions.push(`(${targetType} = 'document_asset' AND ${targetId} = ${asset})`);
    conditions.push(
      `(${targetType} = 'source' AND EXISTS (SELECT 1 FROM ${q("document_assets")} admission_asset WHERE admission_asset.${q("knowledge_space_id")} = ${p(2)} AND admission_asset.${q("id")} = ${asset} AND admission_asset.${q("source_id")} = ${targetId}))`,
    );
    conditions.push(
      `(${targetType} = 'logical_document' AND EXISTS (SELECT 1 FROM ${q("document_revisions")} admission_revision WHERE admission_revision.${q("tenant_id")} = ${p(1)} AND admission_revision.${q("knowledge_space_id")} = ${p(2)} AND admission_revision.${q("document_asset_id")} = ${asset} AND admission_revision.${q("document_id")} = ${targetId}))`,
    );
  }
  return ` AND (${conditions.join(" OR ")})`;
}
