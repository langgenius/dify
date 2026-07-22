import type { DatabaseAdapter, DatabaseExecutor, DatabaseQueryValue } from "@knowledge/core";

import { stringColumn } from "./database-row-utils";
import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";

export interface HistoricalPublicationDeletionScope {
  readonly documentAssetIds: readonly string[];
  readonly knowledgeSpaceId: string;
  readonly maxDocumentAssetIds: number;
  readonly tenantId: string;
}

export interface DeleteHistoricalPublicationResiduePageInput
  extends HistoricalPublicationDeletionScope {
  readonly limit: number;
}

/**
 * Deletes immutable publication ledgers as a unit. Target-bearing publications are never edited
 * in place: their worker/audit references and members are removed in the same transaction before
 * the publication parent. The current head is locked and excluded from the candidate set.
 */
export async function deleteHistoricalPublicationResiduePage(
  database: DatabaseAdapter,
  input: DeleteHistoricalPublicationResiduePageInput,
): Promise<number> {
  return database.transaction((transaction) =>
    deleteHistoricalPublicationResiduePageWithExecutor(database, transaction, input),
  );
}

/**
 * Executor form used by the durable-deletion processor. The caller must run this inside the same
 * transaction as its lease/attempt fence so a stale worker cannot commit a cleanup page.
 */
export async function deleteHistoricalPublicationResiduePageWithExecutor(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: DeleteHistoricalPublicationResiduePageInput,
): Promise<number> {
  validateScope(input);
  validateLimit(input.limit);
  await lockPublicationHead(database, executor, input);
  const candidates = await selectHistoricalPublicationIds(database, executor, input);
  if (candidates.length === 0) return 0;

  await deletePublicationReferences(database, executor, input, candidates);
  await deleteScopedIds(
    database,
    executor,
    "projection_set_publication_members",
    "publication_id",
    input,
    candidates,
  );
  await deleteScopedIds(
    database,
    executor,
    "projection_set_publications",
    "id",
    input,
    candidates,
    ` AND NOT EXISTS (SELECT 1 FROM ${quoteDatabaseIdentifier(
      database,
      "projection_set_publication_heads",
    )} deletion_head WHERE deletion_head.${quoteDatabaseIdentifier(
      database,
      "tenant_id",
    )} = ${quoteDatabaseIdentifier(database, "projection_set_publications")}.${quoteDatabaseIdentifier(
      database,
      "tenant_id",
    )} AND deletion_head.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = ${quoteDatabaseIdentifier(
      database,
      "projection_set_publications",
    )}.${quoteDatabaseIdentifier(database, "knowledge_space_id")} AND deletion_head.${quoteDatabaseIdentifier(
      database,
      "publication_id",
    )} = ${quoteDatabaseIdentifier(database, "projection_set_publications")}.${quoteDatabaseIdentifier(
      database,
      "id",
    )})`,
  );
  return candidates.length;
}

export async function hasHistoricalPublicationResidue(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: HistoricalPublicationDeletionScope,
): Promise<boolean> {
  validateScope(input);
  const query = historicalPublicationQuery(database, input, false);
  const publications = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: query.params,
    sql: `${query.sql} LIMIT 1;`,
    tableName: "projection_set_publications",
  });
  return publications.rows.length > 0;
}

async function lockPublicationHead(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: HistoricalPublicationDeletionScope,
): Promise<void> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [input.tenantId, input.knowledgeSpaceId],
    sql: `SELECT ${q("publication_id")} FROM ${q("projection_set_publication_heads")} WHERE ${q(
      "tenant_id",
    )} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} FOR UPDATE;`,
    tableName: "projection_set_publication_heads",
  });
}

async function selectHistoricalPublicationIds(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: DeleteHistoricalPublicationResiduePageInput,
): Promise<readonly string[]> {
  const query = historicalPublicationQuery(database, input, true);
  const result = await executor.execute({
    maxRows: input.limit,
    operation: "select",
    params: query.params,
    sql: `${query.sql} ORDER BY target_publication.${quoteDatabaseIdentifier(
      database,
      "id",
    )} ASC LIMIT ${databasePlaceholder(database, query.params.length)} FOR UPDATE;`,
    tableName: "projection_set_publications",
  });
  return result.rows.map((row) => stringColumn(row, "id"));
}

function historicalPublicationQuery(
  database: DatabaseAdapter,
  input: HistoricalPublicationDeletionScope & { readonly limit?: number | undefined },
  includeLimit: boolean,
): { readonly params: readonly DatabaseQueryValue[]; readonly sql: string } {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const documentIds = JSON.stringify(input.documentAssetIds);
  const params: DatabaseQueryValue[] =
    database.dialect === "postgres"
      ? [input.tenantId, input.knowledgeSpaceId, documentIds]
      : [documentIds, input.tenantId, input.knowledgeSpaceId];
  if (includeLimit) params.push(input.limit ?? 1);
  const tenantParameter = database.dialect === "postgres" ? p(1) : p(2);
  const spaceParameter = database.dialect === "postgres" ? p(2) : p(3);
  const documentParameter = database.dialect === "postgres" ? p(3) : p(1);
  const targetDocuments =
    database.dialect === "postgres"
      ? `SELECT value AS document_asset_id FROM jsonb_array_elements_text(${documentParameter}::jsonb) AS target_document(value)`
      : `SELECT document_asset_id FROM JSON_TABLE(CAST(${documentParameter} AS JSON), '$[*]' COLUMNS (document_asset_id VARCHAR(36) PATH '$')) AS target_document`;
  const memberDocument =
    database.dialect === "postgres"
      ? `CAST(target_member.${q("document_asset_id")} AS TEXT)`
      : `CAST(target_member.${q("document_asset_id")} AS CHAR(36))`;
  const snapshots = snapshotPredicates(database, "target_publication");
  return {
    params,
    sql: `WITH target_documents AS (${targetDocuments}) SELECT target_publication.${q(
      "id",
    )} FROM ${q("projection_set_publications")} AS target_publication WHERE target_publication.${q(
      "tenant_id",
    )} = ${tenantParameter} AND target_publication.${q(
      "knowledge_space_id",
    )} = ${spaceParameter} AND NOT EXISTS (SELECT 1 FROM ${q(
      "projection_set_publication_heads",
    )} AS current_head WHERE current_head.${q("tenant_id")} = target_publication.${q(
      "tenant_id",
    )} AND current_head.${q("knowledge_space_id")} = target_publication.${q(
      "knowledge_space_id",
    )} AND current_head.${q("publication_id")} = target_publication.${q(
      "id",
    )}) AND (EXISTS (SELECT 1 FROM ${q(
      "projection_set_publication_members",
    )} AS target_member INNER JOIN target_documents ON target_documents.document_asset_id = ${memberDocument} WHERE target_member.${q(
      "tenant_id",
    )} = target_publication.${q("tenant_id")} AND target_member.${q(
      "knowledge_space_id",
    )} = target_publication.${q("knowledge_space_id")} AND target_member.${q(
      "publication_id",
    )} = target_publication.${q("id")}) OR ${snapshots})`,
  };
}

function snapshotPredicates(database: DatabaseAdapter, publicationAlias: string): string {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const metadata = `${publicationAlias}.${q("metadata")}`;
  const paths = ["projectionSetFingerprintMaterial", "fingerprintMaterial", undefined] as const;
  return paths
    .map((path, index) => {
      if (database.dialect === "postgres") {
        const value = path
          ? `${metadata} -> '${path}' -> 'sourceSnapshots'`
          : `${metadata} -> 'sourceSnapshots'`;
        return `EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(${value}) = 'array' THEN ${value} ELSE '[]'::jsonb END) AS source_snapshot_${index}(value) INNER JOIN target_documents ON target_documents.document_asset_id = source_snapshot_${index}.value ->> 'documentAssetId')`;
      }
      const jsonPath = path ? `$.${path}.sourceSnapshots[*]` : "$.sourceSnapshots[*]";
      return `EXISTS (SELECT 1 FROM JSON_TABLE(${metadata}, '${jsonPath}' COLUMNS (document_asset_id VARCHAR(36) PATH '$.documentAssetId')) AS source_snapshot_${index} INNER JOIN target_documents ON target_documents.document_asset_id = source_snapshot_${index}.document_asset_id)`;
    })
    .join(" OR ");
}

async function deletePublicationReferences(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: HistoricalPublicationDeletionScope,
  publicationIds: readonly string[],
): Promise<void> {
  for (const [table, column] of [
    ["knowledge_space_profile_publication_bindings", "publication_id"],
    ["document_compilation_attempts", "candidate_publication_id"],
    ["legacy_space_publication_bootstraps", "published_publication_id"],
    ["page_index_upgrade_backfills", "publication_id"],
  ] as const) {
    await deleteScopedIds(database, executor, table, column, input, publicationIds);
  }
}

async function deleteScopedIds(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  table: string,
  column: string,
  input: Pick<HistoricalPublicationDeletionScope, "knowledgeSpaceId" | "tenantId">,
  ids: readonly string[],
  suffix = "",
): Promise<void> {
  if (ids.length === 0) return;
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
      column,
    )} IN (${placeholders.join(", ")})${suffix};`,
    tableName: table,
  });
}

function validateScope(input: HistoricalPublicationDeletionScope): void {
  if (!input.tenantId.trim() || !input.knowledgeSpaceId.trim()) {
    throw new Error("Historical publication cleanup scope is required");
  }
  if (!Number.isSafeInteger(input.maxDocumentAssetIds) || input.maxDocumentAssetIds < 1) {
    throw new Error("Historical publication cleanup maxDocumentAssetIds must be at least 1");
  }
  if (
    input.documentAssetIds.length < 1 ||
    input.documentAssetIds.length > input.maxDocumentAssetIds ||
    input.documentAssetIds.some((id) => !id.trim())
  ) {
    throw new Error("Historical publication cleanup documentAssetIds are invalid or unbounded");
  }
}

function validateLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
    throw new Error("Historical publication cleanup limit must be between 1 and 10000");
  }
}
