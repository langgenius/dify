import type { DatabaseAdapter } from "@knowledge/core";

import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";

export interface ResearchTaskDeletionVisibilityScope {
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;
}

/** Public Research views are conservative because stored query/progress/bundle metadata can name
 * any document or source. Any active durable deletion in the space hides the complete history
 * until the deletion processor has physically invalidated it. */
export interface ResearchTaskDeletionVisibility {
  isSpaceReadable(scope: ResearchTaskDeletionVisibilityScope): Promise<boolean>;
}

export function createDatabaseResearchTaskDeletionVisibility(
  database: DatabaseAdapter,
): ResearchTaskDeletionVisibility {
  return {
    async isSpaceReadable(scope) {
      validateScope(scope);
      const q = (identifier: string) => quoteDatabaseIdentifier(database, identifier);
      const p = (position: number) => databasePlaceholder(database, position);
      const result = await database.execute({
        maxRows: 1,
        operation: "select",
        params: [scope.tenantId, scope.knowledgeSpaceId],
        sql: `SELECT ${q("id")} FROM ${q("deletion_jobs")} WHERE ${q(
          "tenant_id",
        )} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("active_slot")} = 1 LIMIT 1;`,
        tableName: "deletion_jobs",
      });
      return result.rows.length === 0;
    },
  };
}

function validateScope(scope: ResearchTaskDeletionVisibilityScope): void {
  if (
    !scope.tenantId ||
    scope.tenantId !== scope.tenantId.trim() ||
    !scope.knowledgeSpaceId ||
    scope.knowledgeSpaceId !== scope.knowledgeSpaceId.trim()
  ) {
    throw new Error("Research task deletion visibility scope is invalid");
  }
}
