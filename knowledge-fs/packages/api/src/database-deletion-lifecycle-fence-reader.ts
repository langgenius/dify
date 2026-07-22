import type { DatabaseAdapter, DatabaseQueryValue, DatabaseRow } from "@knowledge/core";

import { stringColumn } from "./database-row-utils";
import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";
import type {
  ActiveDeletionLifecycleFence,
  DeletionLifecycleFenceReader,
  DeletionLifecycleFenceScope,
  DeletionLifecycleTargetType,
} from "./deletion-lifecycle-fence";

const tombstoneTable = "deletion_tombstones";

/**
 * Reads active space-wide deletion admission fences plus the permanent target tombstone hierarchy.
 *
 * Any active deletion blocks new mutations across the space so cleanup and primary proof cannot
 * race a sibling writer. Completed tombstones remain irreversible target-specific write fences.
 */
export function createDatabaseDeletionLifecycleFenceReader(
  database: DatabaseAdapter,
): DeletionLifecycleFenceReader {
  return {
    async getActiveFence(rawScope) {
      const scope = normalizeScope(rawScope);
      const params = [
        scope.tenantId,
        scope.knowledgeSpaceId,
        scope.sourceId ?? null,
        scope.documentAssetId ?? null,
      ] satisfies readonly DatabaseQueryValue[];
      const result = await database.execute({
        maxRows: 1,
        operation: "select",
        params,
        sql: tombstoneHierarchySql(database),
        tableName: tombstoneTable,
      });
      return result.rows[0] ? mapFence(result.rows[0]) : null;
    },
  };
}

function tombstoneHierarchySql(database: DatabaseAdapter): string {
  const q = (identifier: string) => quoteDatabaseIdentifier(database, identifier);
  const p = (position: number) => databasePlaceholder(database, position);
  const columns = ["id", "tenant_id", "knowledge_space_id", "target_type", "target_id"];
  const selected = columns.map(q).join(", ");
  return `SELECT ${selected} FROM (SELECT ${selected}, 0 AS ${q("fence_priority")} FROM ${q("deletion_jobs")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("active_slot")} = 1 UNION ALL SELECT ${selected}, 1 AS ${q("fence_priority")} FROM ${q(tombstoneTable)} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ((${q("target_type")} = 'knowledge_space' AND ${q("target_id")} = ${p(2)}) OR (${q("target_type")} = 'source' AND ((${p(3)} IS NOT NULL AND ${q("target_id")} = ${p(3)}) OR (${p(4)} IS NOT NULL AND ${q("target_id")} IN (SELECT source_document.${q("source_id")} FROM ${q("document_assets")} source_document WHERE source_document.${q("knowledge_space_id")} = ${p(2)} AND source_document.${q("id")} = ${p(4)} AND source_document.${q("source_id")} IS NOT NULL)))) OR (${p(4)} IS NOT NULL AND ${q("target_type")} = 'document_asset' AND ${q("target_id")} = ${p(4)}) OR (${p(4)} IS NOT NULL AND ${q("target_type")} = 'logical_document' AND ${q("target_id")} IN (SELECT logical_revision.${q("document_id")} FROM ${q("document_revisions")} logical_revision WHERE logical_revision.${q("tenant_id")} = ${p(1)} AND logical_revision.${q("knowledge_space_id")} = ${p(2)} AND logical_revision.${q("document_asset_id")} = ${p(4)}))) AS lifecycle_fence ORDER BY ${q("fence_priority")} ASC, CASE ${q("target_type")} WHEN 'knowledge_space' THEN 0 WHEN 'source' THEN 1 ELSE 2 END ASC LIMIT 1;`;
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
