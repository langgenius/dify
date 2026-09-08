import type { DatabaseAdapter, DatabaseExecutor } from "@knowledge/core";

import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";
import { KnowledgeFsError } from "./knowledge-fs-errors";

/** Caller must hold the space admission lock, shared with compilation admission/publication. */
export async function assertKnowledgeSpaceCompilationsIdle(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  scope: { readonly tenantId: string; readonly knowledgeSpaceId: string },
): Promise<void> {
  const q = (name: string) => quoteDatabaseIdentifier(database, name);
  const p = (position: number) => databasePlaceholder(database, position);
  const active = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params: [scope.tenantId, scope.knowledgeSpaceId],
    sql: `SELECT ${q("id")} FROM ${q("document_compilation_attempts")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("active_slot")} = 1 LIMIT 1 FOR UPDATE;`,
    tableName: "document_compilation_attempts",
  });
  if (active.rows[0]) {
    throw new KnowledgeFsError("Model settings cannot change during document processing", {
      code: "KNOWLEDGE_SPACE_SETTINGS_COMPILATION_IN_PROGRESS",
    });
  }
}
