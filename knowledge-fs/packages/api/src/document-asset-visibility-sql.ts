import type { DatabaseAdapter } from "@knowledge/core";

import { qualifiedDatabaseIdentifier, quoteDatabaseIdentifier } from "./database-sql-utils";

/**
 * Closes every public document read over its optional parent Source.
 *
 * A Source deletion fence is authoritative even if a pre-fence writer inserts its child after
 * the request transaction bulk-marked the children that already existed. Non-deleting operational
 * states (`syncing`, `error`, and `disabled`) remain readable; only the internal deletion state is
 * excluded.
 */
export function readableDocumentParentSourcePredicateSql(
  database: Pick<DatabaseAdapter, "dialect">,
  documentAlias: string,
  sourceAlias: string,
): string {
  const document = (column: string) => qualifiedDatabaseIdentifier(database, documentAlias, column);
  const source = (column: string) => qualifiedDatabaseIdentifier(database, sourceAlias, column);

  return `(${document("source_id")} IS NULL OR EXISTS (SELECT 1 FROM ${quoteDatabaseIdentifier(
    database,
    "sources",
  )} ${sourceAlias} WHERE ${source("id")} = ${document("source_id")} AND ${source(
    "knowledge_space_id",
  )} = ${document("knowledge_space_id")} AND ${source(
    "status",
  )} <> 'deleting' AND ${source("deletion_job_id")} IS NULL))`;
}

/**
 * Closes a public read over the document asset's complete deletion visibility fence.
 *
 * Keep this predicate in the database query (and therefore before LIMIT) so a deleting asset or
 * an asset whose parent Source is deleting cannot consume a page slot and then disappear during
 * handler-level authorization.
 */
export function readableDocumentAssetPredicateSql(
  database: Pick<DatabaseAdapter, "dialect">,
  documentAlias: string,
  sourceAlias: string,
): string {
  const document = (column: string) => qualifiedDatabaseIdentifier(database, documentAlias, column);

  return `${document("lifecycle_state")} = 'active' AND ${document(
    "deletion_job_id",
  )} IS NULL AND ${readableDocumentParentSourcePredicateSql(database, documentAlias, sourceAlias)}`;
}
