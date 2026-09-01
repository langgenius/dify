import type { DatabaseAdapter } from "@knowledge/core";

import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";

export interface ResearchTaskDeletionVisibilityScope {
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;
}

/** Public Research history remains visible during subresource deletion; evidence reads separately
 * project deleted document references to content-free unavailable tombstones. Only deletion of the
 * owning knowledge space hides the complete history. */
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
        )} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("target_type")} = 'knowledge_space' AND ${q("active_slot")} = 1 LIMIT 1;`,
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
