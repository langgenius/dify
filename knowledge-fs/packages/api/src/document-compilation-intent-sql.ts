import type { DatabaseAdapter } from "@knowledge/core";
import { qualifiedDatabaseIdentifier, quoteDatabaseIdentifier } from "./database-sql-utils";

/** An asset tuple alone is insufficient: only an explicitly bound product intent owns a task. */
export function documentCompilationRevisionBindingSql(
  database: Pick<DatabaseAdapter, "dialect">,
  attemptAlias: string,
  revisionAlias: string,
): string {
  const a = (column: string) => qualifiedDatabaseIdentifier(database, attemptAlias, column);
  const r = (column: string) => qualifiedDatabaseIdentifier(database, revisionAlias, column);
  const bound = (table: string, alias: string) => {
    const i = (column: string) => qualifiedDatabaseIdentifier(database, alias, column);
    return `EXISTS (SELECT 1 FROM ${quoteDatabaseIdentifier(database, table)} ${alias} WHERE ${i("tenant_id")} = ${a("tenant_id")} AND ${i("knowledge_space_id")} = ${a("knowledge_space_id")} AND ${i("compilation_attempt_id")} = ${a("id")} AND ${i("document_id")} = ${r("document_id")} AND ${i("document_revision")} = ${r("revision")})`;
  };
  return `(${r("compilation_attempt_id")} = ${a("id")} OR ${bound("document_reindex_attempts", "reindex_intent")} OR ${bound("document_chunk_state_changes", "chunk_intent")})`;
}
