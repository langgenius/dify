import type { DatabaseAdapter, DatabaseExecutor, DatabaseQueryValue } from "@knowledge/core";

import {
  createReusableDatabaseParameter,
  databasePlaceholder,
  quoteDatabaseIdentifier,
} from "./database-sql-utils";

export interface KnowledgeSpaceDeletionAdmissionInput {
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;
}

export interface SourceWorkflowDeletionAdmissionInput extends KnowledgeSpaceDeletionAdmissionInput {
  readonly sourceId?: string | undefined;
}

export interface SourceWorkflowBulkDeletionAdmissionInput
  extends KnowledgeSpaceDeletionAdmissionInput {
  readonly sourceIds: readonly string[];
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
      readonly kind: "retrieval";
    }
  | {
      readonly kind: "source_workflow";
      readonly sourceIds: readonly string[];
    };

export interface DocumentWriteDeletionScopeQuery {
  readonly knowledgeSpaceParameter: string;
  readonly params: DatabaseQueryValue[];
  readonly scopeSql: string;
  readonly tenantParameter: string;
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
 * Serializes retrieval admission with deletion request creation. Target-scoped deletions publish
 * their lifecycle fence while holding the same space-row lock, so retrieval can continue and rely
 * on the normal visibility predicates to exclude those targets. Only whole-space deletion fences
 * every retrieval path.
 */
export async function lockKnowledgeSpaceForRetrievalAdmission(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: KnowledgeSpaceDeletionAdmissionInput,
): Promise<boolean> {
  return lockForDeletionAdmission(database, executor, input, { kind: "retrieval" });
}

/**
 * Admits mutations of space-owned state that has no child-resource overlap. A child deletion must
 * not turn settings, manifests, connections, or sessions into a space-wide outage.
 */
export async function lockKnowledgeSpaceForWholeSpaceDeletionAdmission(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: KnowledgeSpaceDeletionAdmissionInput,
): Promise<boolean> {
  return lockForDeletionAdmission(database, executor, input, { kind: "retrieval" });
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
    sourceIds: input.sourceId ? [input.sourceId] : [],
  });
}

/**
 * Performs one scoped locking read for a frozen bulk Source selection. The caller must pass only
 * Sources whose workflow can mutate rows; skipped items do not need a deletion fence.
 */
export async function lockKnowledgeSpaceForSourceWorkflowBulkAdmission(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: SourceWorkflowBulkDeletionAdmissionInput,
): Promise<boolean> {
  return lockForDeletionAdmission(database, executor, input, {
    kind: "source_workflow",
    sourceIds: input.sourceIds,
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

  let activeDeletionParams: DatabaseQueryValue[] = [input.tenantId, input.knowledgeSpaceId];
  let tenantParameter = p(1);
  let knowledgeSpaceParameter = p(2);
  let deletionScope = "";
  if (scope?.kind === "source_workflow") {
    const query = deletionAdmissionScopeQuery(database, input, scope.sourceIds);
    activeDeletionParams = query.params;
    tenantParameter = query.tenantParameter;
    knowledgeSpaceParameter = query.knowledgeSpaceParameter;
    deletionScope = query.scopeSql;
  } else if (scope?.kind === "retrieval") {
    const query = deletionAdmissionScopeQuery(database, input, []);
    activeDeletionParams = query.params;
    tenantParameter = query.tenantParameter;
    knowledgeSpaceParameter = query.knowledgeSpaceParameter;
    deletionScope = query.scopeSql;
  } else if (scope?.kind === "document_write") {
    const query = documentWriteDeletionScopeQuery(database, scope.value);
    activeDeletionParams = query.params;
    tenantParameter = query.tenantParameter;
    knowledgeSpaceParameter = query.knowledgeSpaceParameter;
    deletionScope = query.scopeSql;
  }
  const activeDeletion = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: activeDeletionParams,
    // Keep this a current locking read. In TiDB repeatable-read mode the transaction snapshot can
    // predate a deletion transaction that the space-row lock just waited for.
    sql: `SELECT active_deletion.${q("id")} FROM ${q("deletion_jobs")} active_deletion WHERE active_deletion.${q("tenant_id")} = ${tenantParameter} AND active_deletion.${q("knowledge_space_id")} = ${knowledgeSpaceParameter} AND active_deletion.${q("active_slot")} = 1${deletionScope} LIMIT 1 FOR UPDATE;`,
    tableName: "deletion_jobs",
  });
  return activeDeletion.rows.length === 0;
}

export function documentWriteDeletionScopeQuery(
  database: DatabaseAdapter,
  input: DocumentWriteDeletionAdmissionInput,
): DocumentWriteDeletionScopeQuery {
  return deletionAdmissionScopeQuery(database, input, input.sourceId ? [input.sourceId] : []);
}

function deletionAdmissionScopeQuery(
  database: DatabaseAdapter,
  input: KnowledgeSpaceDeletionAdmissionInput & {
    readonly documentAssetId?: string | undefined;
    readonly documentId?: string | undefined;
  },
  sourceIds: readonly string[],
): DocumentWriteDeletionScopeQuery {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const params: DatabaseQueryValue[] = [];
  const tenant = createReusableDatabaseParameter(database, params, input.tenantId);
  const knowledgeSpace = createReusableDatabaseParameter(database, params, input.knowledgeSpaceId);
  // Render the outer predicates first so TiDB's anonymous parameters remain in lexical order.
  const tenantParameter = tenant();
  const knowledgeSpaceParameter = knowledgeSpace();
  const targetType = `active_deletion.${q("target_type")}`;
  const targetId = `active_deletion.${q("target_id")}`;
  const conditions = [`(${targetType} = 'knowledge_space' AND ${targetId} = ${knowledgeSpace()})`];

  if (sourceIds.length > 0) {
    const sources = sourceIds.map((sourceId) =>
      createReusableDatabaseParameter(database, params, sourceId),
    );
    const sourceList = () => sources.map((source) => source()).join(", ");
    conditions.push(`(${targetType} = 'source' AND ${targetId} IN (${sourceList()}))`);
    conditions.push(
      `(${targetType} = 'logical_document' AND EXISTS (SELECT 1 FROM ${q("logical_documents")} admission_document WHERE admission_document.${q("tenant_id")} = ${tenant()} AND admission_document.${q("knowledge_space_id")} = ${knowledgeSpace()} AND admission_document.${q("id")} = ${targetId} AND admission_document.${q("source_id")} IN (${sourceList()})))`,
    );
    conditions.push(
      `(${targetType} = 'document_asset' AND EXISTS (SELECT 1 FROM ${q("document_assets")} admission_asset WHERE admission_asset.${q("knowledge_space_id")} = ${knowledgeSpace()} AND admission_asset.${q("id")} = ${targetId} AND admission_asset.${q("source_id")} IN (${sourceList()})))`,
    );
  }
  if (input.documentId) {
    const document = createReusableDatabaseParameter(database, params, input.documentId);
    conditions.push(`(${targetType} = 'logical_document' AND ${targetId} = ${document()})`);
    conditions.push(
      `(${targetType} = 'source' AND EXISTS (SELECT 1 FROM ${q("logical_documents")} admission_document WHERE admission_document.${q("tenant_id")} = ${tenant()} AND admission_document.${q("knowledge_space_id")} = ${knowledgeSpace()} AND admission_document.${q("id")} = ${document()} AND admission_document.${q("source_id")} = ${targetId}))`,
    );
    conditions.push(
      `(${targetType} = 'document_asset' AND EXISTS (SELECT 1 FROM ${q("document_revisions")} admission_revision WHERE admission_revision.${q("tenant_id")} = ${tenant()} AND admission_revision.${q("knowledge_space_id")} = ${knowledgeSpace()} AND admission_revision.${q("document_id")} = ${document()} AND admission_revision.${q("document_asset_id")} = ${targetId}))`,
    );
  }
  if (input.documentAssetId) {
    const asset = createReusableDatabaseParameter(database, params, input.documentAssetId);
    conditions.push(`(${targetType} = 'document_asset' AND ${targetId} = ${asset()})`);
    conditions.push(
      `(${targetType} = 'source' AND EXISTS (SELECT 1 FROM ${q("document_assets")} admission_asset WHERE admission_asset.${q("knowledge_space_id")} = ${knowledgeSpace()} AND admission_asset.${q("id")} = ${asset()} AND admission_asset.${q("source_id")} = ${targetId}))`,
    );
    conditions.push(
      `(${targetType} = 'logical_document' AND EXISTS (SELECT 1 FROM ${q("document_revisions")} admission_revision WHERE admission_revision.${q("tenant_id")} = ${tenant()} AND admission_revision.${q("knowledge_space_id")} = ${knowledgeSpace()} AND admission_revision.${q("document_asset_id")} = ${asset()} AND admission_revision.${q("document_id")} = ${targetId}))`,
    );
  }
  return {
    knowledgeSpaceParameter,
    params,
    scopeSql: ` AND (${conditions.join(" OR ")})`,
    tenantParameter,
  };
}
