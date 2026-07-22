import type { DatabaseAdapter, DatabaseExecutor } from "@knowledge/core";

import {
  CapabilityPublicationFencedError,
  validateCapabilityGrantScope,
} from "./capability-grant-provenance";
import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";
import { jsonStringArrayColumn } from "./json-utils";

export interface CapabilityJobScope {
  readonly capabilityGrantId: string;
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
  const q = (identifier: string) => quoteDatabaseIdentifier(database, identifier);
  const p = (index: number) => databasePlaceholder(database, index);
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [scope.tenantId, scope.knowledgeSpaceId, scope.capabilityGrantId],
    sql: `SELECT grant_row.${q("grant_id")}, COALESCE(space_fence.${q(
      "highest_revoke_sequence",
    )}, 0) AS ${q("space_revoke_watermark")} FROM ${q(
      "capability_grants",
    )} grant_row LEFT JOIN ${q("capability_space_fences")} space_fence ON space_fence.${q(
      "tenant_id",
    )} = grant_row.${q("tenant_id")} AND space_fence.${q(
      "knowledge_space_id",
    )} = grant_row.${q("knowledge_space_id")} WHERE grant_row.${q("tenant_id")} = ${p(
      1,
    )} AND grant_row.${q("knowledge_space_id")} = ${p(2)} AND grant_row.${q(
      "grant_id",
    )} = ${p(3)} AND grant_row.${q(
      "state",
    )} = 'active' AND (space_fence.${q("tombstoned")} IS NULL OR space_fence.${q(
      "tombstoned",
    )} = FALSE) LIMIT 1 FOR UPDATE`,
    tableName: "capability_grants",
  });
  if (result.rows.length !== 1) {
    throw new CapabilityPublicationFencedError();
  }
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
  const q = (identifier: string) => quoteDatabaseIdentifier(database, identifier);
  const p = (index: number) => databasePlaceholder(database, index);
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [scope.tenantId, scope.knowledgeSpaceId, scope.capabilityGrantId],
    sql: `SELECT grant_row.${q("content_scope_ids")}, grant_row.${q("subject_id")} FROM ${q("capability_grants")} grant_row LEFT JOIN ${q("capability_space_fences")} space_fence ON space_fence.${q("tenant_id")} = grant_row.${q("tenant_id")} AND space_fence.${q("knowledge_space_id")} = grant_row.${q("knowledge_space_id")} WHERE grant_row.${q("tenant_id")} = ${p(1)} AND grant_row.${q("knowledge_space_id")} = ${p(2)} AND grant_row.${q("grant_id")} = ${p(3)} AND grant_row.${q("state")} = 'active' AND (space_fence.${q("tombstoned")} IS NULL OR space_fence.${q("tombstoned")} = FALSE) LIMIT 1 FOR UPDATE`,
    tableName: "capability_grants",
  });
  const row = result.rows[0];
  if (!row) throw new CapabilityPublicationFencedError();
  const subjectId = row.subject_id;
  if (typeof subjectId !== "string" || !subjectId) throw new CapabilityPublicationFencedError();
  return { contentScopeIds: jsonStringArrayColumn(row, "content_scope_ids"), subjectId };
}
