import type { DatabaseAdapter, DatabaseQueryValue, DatabaseRow } from "@knowledge/core";

import { stringColumn } from "./database-row-utils";
import { createReusableDatabaseParameter, quoteDatabaseIdentifier } from "./database-sql-utils";
import type {
  ActiveDeletionLifecycleFence,
  DeletionLifecycleFenceReader,
  DeletionLifecycleFenceScope,
  DeletionLifecycleTargetType,
} from "./deletion-lifecycle-fence";

const tombstoneTable = "deletion_tombstones";

/**
 * Reads active deletion admission fences plus the permanent target tombstone hierarchy.
 *
 * Target-scoped writers may overlap deletion of unrelated Sources and documents. A whole-space
 * deletion always wins; matching ancestors, descendants, and completed target tombstones remain
 * irreversible target-specific write fences.
 */
export function createDatabaseDeletionLifecycleFenceReader(
  database: DatabaseAdapter,
): DeletionLifecycleFenceReader {
  return {
    async getActiveFence(rawScope) {
      const scope = normalizeScope(rawScope);
      const query = tombstoneHierarchyQuery(database, scope);
      const result = await database.execute({
        maxRows: 1,
        operation: "select",
        params: query.params,
        sql: query.sql,
        tableName: tombstoneTable,
      });
      return result.rows[0] ? mapFence(result.rows[0]) : null;
    },
  };
}

function tombstoneHierarchyQuery(
  database: DatabaseAdapter,
  scope: DeletionLifecycleFenceScope,
): { readonly params: readonly DatabaseQueryValue[]; readonly sql: string } {
  const q = (identifier: string) => quoteDatabaseIdentifier(database, identifier);
  const params: DatabaseQueryValue[] = [];
  const tenant = createReusableDatabaseParameter(database, params, scope.tenantId);
  const knowledgeSpace = createReusableDatabaseParameter(database, params, scope.knowledgeSpaceId);
  const source = createReusableDatabaseParameter(database, params, scope.sourceId ?? null);
  const document = createReusableDatabaseParameter(database, params, scope.documentId ?? null);
  const documentAsset = createReusableDatabaseParameter(
    database,
    params,
    scope.documentAssetId ?? null,
  );
  const idParam = (parameter: () => string) =>
    database.dialect === "postgres" ? `${parameter()}::uuid` : parameter();
  const sourceId = () => idParam(source);
  const documentId = () => idParam(document);
  const documentAssetId = () => idParam(documentAsset);
  const columns = ["id", "tenant_id", "knowledge_space_id", "target_type", "target_id"];
  const selected = columns.map(q).join(", ");
  const hierarchy = (alias: string) => {
    const targetType = `${alias}.${q("target_type")}`;
    const targetId = `${alias}.${q("target_id")}`;
    return `((${targetType} = 'knowledge_space' AND ${targetId} = ${knowledgeSpace()}) OR (${targetType} = 'source' AND ((${sourceId()} IS NOT NULL AND ${targetId} = ${sourceId()}) OR (${documentId()} IS NOT NULL AND ${targetId} IN (SELECT source_document.${q("source_id")} FROM ${q("logical_documents")} source_document WHERE source_document.${q("tenant_id")} = ${tenant()} AND source_document.${q("knowledge_space_id")} = ${knowledgeSpace()} AND source_document.${q("id")} = ${documentId()} AND source_document.${q("source_id")} IS NOT NULL)) OR (${documentAssetId()} IS NOT NULL AND ${targetId} IN (SELECT source_asset.${q("source_id")} FROM ${q("document_assets")} source_asset WHERE source_asset.${q("knowledge_space_id")} = ${knowledgeSpace()} AND source_asset.${q("id")} = ${documentAssetId()} AND source_asset.${q("source_id")} IS NOT NULL)))) OR (${targetType} = 'logical_document' AND ((${documentId()} IS NOT NULL AND ${targetId} = ${documentId()}) OR (${documentAssetId()} IS NOT NULL AND ${targetId} IN (SELECT logical_revision.${q("document_id")} FROM ${q("document_revisions")} logical_revision WHERE logical_revision.${q("tenant_id")} = ${tenant()} AND logical_revision.${q("knowledge_space_id")} = ${knowledgeSpace()} AND logical_revision.${q("document_asset_id")} = ${documentAssetId()})))) OR (${targetType} = 'document_asset' AND ((${documentAssetId()} IS NOT NULL AND ${targetId} = ${documentAssetId()}) OR (${documentId()} IS NOT NULL AND ${targetId} IN (SELECT document_revision.${q("document_asset_id")} FROM ${q("document_revisions")} document_revision WHERE document_revision.${q("tenant_id")} = ${tenant()} AND document_revision.${q("knowledge_space_id")} = ${knowledgeSpace()} AND document_revision.${q("document_id")} = ${documentId()})))))`;
  };
  const selectedFor = (alias: string) =>
    columns.map((column) => `${alias}.${q(column)}`).join(", ");
  const sql = `SELECT ${selected} FROM (SELECT ${selectedFor("active_deletion")}, 0 AS ${q("fence_priority")} FROM ${q("deletion_jobs")} active_deletion WHERE active_deletion.${q("tenant_id")} = ${tenant()} AND active_deletion.${q("knowledge_space_id")} = ${knowledgeSpace()} AND active_deletion.${q("active_slot")} = 1 AND ${hierarchy("active_deletion")} UNION ALL SELECT ${selectedFor("target_tombstone")}, 1 AS ${q("fence_priority")} FROM ${q(tombstoneTable)} target_tombstone WHERE target_tombstone.${q("tenant_id")} = ${tenant()} AND target_tombstone.${q("knowledge_space_id")} = ${knowledgeSpace()} AND ${hierarchy("target_tombstone")}) AS lifecycle_fence ORDER BY ${q("fence_priority")} ASC, CASE ${q("target_type")} WHEN 'knowledge_space' THEN 0 WHEN 'source' THEN 1 ELSE 2 END ASC LIMIT 1;`;
  return { params, sql };
}

function mapFence(row: DatabaseRow): ActiveDeletionLifecycleFence {
  const durableTargetType = stringColumn(row, "target_type");
  const targetType = durableTargetToLifecycleTarget(durableTargetType);
  return {
    id: stringColumn(row, "id"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    targetId: stringColumn(row, "target_id"),
    targetType,
    tenantId: stringColumn(row, "tenant_id"),
  };
}

function durableTargetToLifecycleTarget(value: string): DeletionLifecycleTargetType {
  switch (value) {
    case "knowledge_space":
      return "space";
    case "source":
      return "source";
    case "document_asset":
    case "logical_document":
      return "document";
    default:
      throw new Error(`Deletion lifecycle tombstone target_type=${value} is invalid`);
  }
}

function normalizeScope(scope: DeletionLifecycleFenceScope): DeletionLifecycleFenceScope {
  return {
    ...(scope.documentAssetId
      ? { documentAssetId: requiredId(scope.documentAssetId, "documentAssetId") }
      : {}),
    ...(scope.documentId ? { documentId: requiredId(scope.documentId, "documentId") } : {}),
    knowledgeSpaceId: requiredId(scope.knowledgeSpaceId, "knowledgeSpaceId"),
    ...(scope.sourceId ? { sourceId: requiredId(scope.sourceId, "sourceId") } : {}),
    tenantId: requiredId(scope.tenantId, "tenantId"),
  };
}

function requiredId(value: string, field: string): string {
  if (typeof value !== "string" || !value || value !== value.trim() || value.length > 512) {
    throw new Error(`Deletion lifecycle ${field} is invalid`);
  }
  return value;
}
