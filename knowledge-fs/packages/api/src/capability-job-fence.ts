import type { DatabaseAdapter, DatabaseExecutor } from "@knowledge/core";

import {
  CapabilityPublicationFencedError,
  validateCapabilityGrantScope,
} from "./capability-grant-provenance";
import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";
import { jsonStringArrayColumn } from "./json-utils";

export interface CapabilityJobScope {
  readonly capabilityGrantId: string;
  readonly expectedBinding?:
    | {
        readonly action: string;
        readonly resource: {
          readonly id: string;
          readonly parentId: string | null;
          readonly type: string;
        };
      }
    | undefined;
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;
}

export interface CapabilityJobPublicationGrant {
  readonly contentScopeIds: readonly string[];
  readonly subjectId: string;
}

/**
 * Re-checks durable Capability state using the caller's transaction. Keeping the authorization
 * read beside the job-state CAS closes the revoke/publication race without persisting a bearer or
 * reconstructing Dify membership inside KnowledgeFS.
 */
export async function assertCapabilityJobPublicationAllowed(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  scope: CapabilityJobScope,
): Promise<void> {
  validateCapabilityGrantScope({
    grantId: scope.capabilityGrantId,
    knowledgeSpaceId: scope.knowledgeSpaceId,
    tenantId: scope.tenantId,
  });
  await lockActiveCapabilityGrant(database, executor, scope, ["grant_id"]);
}

/** Resolves the admitted content scope under the same revoke/tombstone row lock as publication. */
export async function resolveCapabilityJobPublicationGrant(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  scope: CapabilityJobScope,
): Promise<CapabilityJobPublicationGrant> {
  validateCapabilityGrantScope({
    grantId: scope.capabilityGrantId,
    knowledgeSpaceId: scope.knowledgeSpaceId,
    tenantId: scope.tenantId,
  });
  const row = await lockActiveCapabilityGrant(database, executor, scope, [
    "content_scope_ids",
    "subject_id",
  ]);
  const subjectId = row.subject_id;
  if (typeof subjectId !== "string" || !subjectId) throw new CapabilityPublicationFencedError();
  return { contentScopeIds: jsonStringArrayColumn(row, "content_scope_ids"), subjectId };
}

async function lockActiveCapabilityGrant(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  scope: CapabilityJobScope,
  columns: readonly string[],
) {
  const q = (identifier: string) => quoteDatabaseIdentifier(database, identifier);
  const p = (index: number) => databasePlaceholder(database, index);
  const bindingColumns = scope.expectedBinding
    ? ["action", "resource_type", "resource_id", "resource_parent_id"]
    : [];
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [scope.tenantId, scope.knowledgeSpaceId, scope.capabilityGrantId],
    sql: `SELECT ${[...columns, ...bindingColumns]
      .map((column) => `grant_row.${q(column)}`)
      .join(", ")}, (SELECT space_fence.${q(
      "tombstoned",
    )} FROM ${q("capability_space_fences")} space_fence WHERE space_fence.${q(
      "tenant_id",
    )} = grant_row.${q("tenant_id")} AND space_fence.${q("knowledge_space_id")} = grant_row.${q(
      "knowledge_space_id",
    )} LIMIT 1 FOR UPDATE) AS ${q("space_tombstoned")} FROM ${q(
      "capability_grants",
    )} grant_row WHERE grant_row.${q("tenant_id")} = ${p(1)} AND grant_row.${q(
      "knowledge_space_id",
    )} = ${p(2)} AND grant_row.${q("grant_id")} = ${p(3)} AND grant_row.${q(
      "state",
    )} = 'active' LIMIT 1 FOR UPDATE`,
    tableName: "capability_grants",
  });
  const row = result.rows[0];
  if (!row) throw new CapabilityPublicationFencedError();
  if (
    row.space_tombstoned !== undefined &&
    row.space_tombstoned !== null &&
    row.space_tombstoned !== false &&
    row.space_tombstoned !== 0
  ) {
    throw new CapabilityPublicationFencedError();
  }
  if (
    scope.expectedBinding &&
    (row.action !== scope.expectedBinding.action ||
      row.resource_type !== scope.expectedBinding.resource.type ||
      row.resource_id !== scope.expectedBinding.resource.id ||
      (row.resource_parent_id ?? null) !== scope.expectedBinding.resource.parentId)
  ) {
    throw new CapabilityPublicationFencedError();
  }
  return row;
}
