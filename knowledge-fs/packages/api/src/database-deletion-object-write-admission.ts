import { type DatabaseAdapter, TenantIdSchema, UuidSchema } from "@knowledge/core";

import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";
import {
  type DeletionObjectWriteAdmission,
  DeletionObjectWriteAdmissionError,
} from "./deletion-object-write-admission";

/**
 * Holds a lock on the active knowledge-space row across the complete external write. PostgreSQL
 * can use a shared row lock; TiDB 8.5 implements `LOCK IN SHARE MODE` only as an optional no-op, so
 * its safe fallback is `FOR UPDATE`. Durable deletion requests lock that same row FOR UPDATE before
 * creating an active job, giving a strict order: either the write commits first and inventory
 * observes it, or deletion commits first and this admission rejects without invoking the write.
 */
export function createDatabaseDeletionObjectWriteAdmission(
  database: DatabaseAdapter,
): DeletionObjectWriteAdmission {
  return {
    withSpaceWriteAdmission: async (rawScope, write) => {
      const scope = {
        knowledgeSpaceId: UuidSchema.parse(rawScope.knowledgeSpaceId),
        tenantId: TenantIdSchema.parse(rawScope.tenantId),
      };
      return database.transaction(async (transaction) => {
        const q = (value: string) => quoteDatabaseIdentifier(database, value);
        const p = (position: number) => databasePlaceholder(database, position);
        const admissionLock = database.dialect === "postgres" ? "FOR SHARE" : "FOR UPDATE";
        // Lock by identity before evaluating lifecycle predicates. TiDB can otherwise evaluate a
        // predicate-bearing locking read from the pre-update snapshot and skip waiting on a row
        // whose uncommitted deletion transition no longer matches that predicate.
        const space = await transaction.execute({
          maxRows: 1,
          operation: "select",
          params: [scope.tenantId, scope.knowledgeSpaceId],
          sql: `SELECT ${q("id")}, ${q("lifecycle_state")}, ${q("deletion_job_id")} FROM ${q("knowledge_spaces")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("id")} = ${p(2)} LIMIT 1 ${admissionLock};`,
          tableName: "knowledge_spaces",
        });
        const row = space.rows[0];
        if (!row || row.lifecycle_state !== "active" || row.deletion_job_id != null) {
          throw new DeletionObjectWriteAdmissionError();
        }
        const activeDeletion = await transaction.execute({
          maxRows: 1,
          operation: "select",
          params: [scope.tenantId, scope.knowledgeSpaceId],
          // Keep this a current locking read too: a TiDB repeatable-read snapshot may predate the
          // deletion transaction that the space-row lock just waited for.
          sql: `SELECT ${q("id")} FROM ${q("deletion_jobs")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("active_slot")} = 1 LIMIT 1 ${admissionLock};`,
          tableName: "deletion_jobs",
        });
        if (activeDeletion.rows.length > 0) throw new DeletionObjectWriteAdmissionError();
        return write();
      });
    },
  };
}
