import {
  candidatePermissionScopeAllows,
  candidatePermissionScopeSnapshot,
} from "./candidate-content-authorization";
import {
  numberColumn,
  optionalNumberColumn,
  optionalStringColumn,
  stringColumn,
} from "./database-row-utils";
import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";
import { jsonObjectColumn } from "./json-utils";
import {
  KNOWLEDGE_SPACE_ACCESS_CHANNELS,
  KnowledgeSpaceAccessError,
  assertDatabaseKnowledgeSpacePermissionFence,
} from "./knowledge-space-access-control";
import type {
  KnowledgeSpaceAccessChannel,
  KnowledgeSpacePermissionSnapshot,
} from "./knowledge-space-access-control";
import { lockKnowledgeSpaceForDeletionAdmission } from "./knowledge-space-deletion-admission";

import type { DatabaseAdapter, DatabaseExecutor } from "@knowledge/core";

export class DocumentCandidateAdmissionError extends Error {
  readonly code = "DOCUMENT_CANDIDATE_ADMISSION_DENIED";

  constructor() {
    super("Document candidate admission denied");
    this.name = "DocumentCandidateAdmissionError";
  }
}

export interface DatabaseDocumentCandidateAdmissionInput {
  readonly compilationAttemptId: string;
  readonly documentId: string;
  readonly documentRevision: number;
  readonly knowledgeSpaceId: string;
  readonly now: string;
  readonly requestedBySubjectId?: string | undefined;
  readonly tenantId: string;
  /** Explicit server-only path for attempts intentionally persisted without caller provenance. */
  readonly trustedInternal?: true | undefined;
}

/**
 * Final candidate-write fence shared by settings and chunk mutations. The compilation attempt is
 * The knowledge-space deletion fence is locked first, matching publication and deletion request
 * lock order. The attempt and every mutable resource/ACL row are then locked and revalidated
 * before the caller inserts any candidate row.
 */
export async function assertDatabaseDocumentCandidateAdmission(input: {
  readonly database: DatabaseAdapter;
  readonly executor: DatabaseExecutor;
  readonly admission: DatabaseDocumentCandidateAdmissionInput;
}): Promise<KnowledgeSpacePermissionSnapshot | null> {
  const { admission, database, executor } = input;
  if (!(await lockKnowledgeSpaceForDeletionAdmission(database, executor, admission))) denied();

  const attemptResult = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [admission.compilationAttemptId, admission.tenantId, admission.knowledgeSpaceId],
    sql: `SELECT ${[
      "document_asset_id",
      "document_version",
      "requested_by_subject_id",
      "permission_snapshot_id",
      "permission_snapshot_revision",
      "access_channel",
    ]
      .map((column) => q(database, column))
      .join(
        ", ",
      )} FROM ${q(database, "document_compilation_attempts")} WHERE ${q(database, "id")} = ${p(database, 1)} AND ${q(database, "tenant_id")} = ${p(database, 2)} AND ${q(database, "knowledge_space_id")} = ${p(database, 3)} AND ${q(database, "active_slot")} = 1 LIMIT 1 FOR UPDATE;`,
    tableName: "document_compilation_attempts",
  });
  const attempt = attemptResult.rows[0];
  if (!attempt) denied();

  const documentAssetId = stringColumn(attempt, "document_asset_id");
  const documentAssetVersion = numberColumn(attempt, "document_version");
  const assetResult = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [admission.knowledgeSpaceId, documentAssetId, documentAssetVersion],
    sql: `SELECT ${q(database, "metadata")}, ${q(database, "source_id")} FROM ${q(database, "document_assets")} WHERE ${q(database, "knowledge_space_id")} = ${p(database, 1)} AND ${q(database, "id")} = ${p(database, 2)} AND ${q(database, "version")} = ${p(database, 3)} AND ${q(database, "lifecycle_state")} = 'active' AND ${q(database, "deletion_job_id")} IS NULL LIMIT 1 FOR UPDATE;`,
    tableName: "document_assets",
  });
  const asset = assetResult.rows[0];
  if (!asset) denied();

  const sourceId = optionalStringColumn(asset, "source_id");
  if (sourceId) {
    const source = await executor.execute({
      maxRows: 1,
      operation: "select",
      params: [admission.knowledgeSpaceId, sourceId],
      sql: `SELECT ${q(database, "id")} FROM ${q(database, "sources")} WHERE ${q(database, "knowledge_space_id")} = ${p(database, 1)} AND ${q(database, "id")} = ${p(database, 2)} AND ${q(database, "status")} <> 'deleting' AND ${q(database, "deletion_job_id")} IS NULL LIMIT 1 FOR UPDATE;`,
      tableName: "sources",
    });
    if (!source.rows[0]) denied();
  }

  const document = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [
      admission.tenantId,
      admission.knowledgeSpaceId,
      admission.documentId,
      admission.documentRevision,
    ],
    sql: `SELECT ${q(database, "id")} FROM ${q(database, "logical_documents")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "id")} = ${p(database, 3)} AND ${q(database, "active_revision")} = ${p(database, 4)} AND ${q(database, "status")} = 'ready' AND ${q(database, "deletion_job_id")} IS NULL LIMIT 1 FOR UPDATE;`,
    tableName: "logical_documents",
  });
  if (!document.rows[0]) denied();

  const revision = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [
      admission.tenantId,
      admission.knowledgeSpaceId,
      admission.documentId,
      admission.documentRevision,
      documentAssetId,
      documentAssetVersion,
    ],
    sql: `SELECT ${q(database, "revision")} FROM ${q(database, "document_revisions")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "document_id")} = ${p(database, 3)} AND ${q(database, "revision")} = ${p(database, 4)} AND ${q(database, "document_asset_id")} = ${p(database, 5)} AND ${q(database, "document_asset_version")} = ${p(database, 6)} AND ${q(database, "state")} = 'active' LIMIT 1 FOR UPDATE;`,
    tableName: "document_revisions",
  });
  if (!revision.rows[0]) denied();

  const requestedBySubjectId = optionalStringColumn(attempt, "requested_by_subject_id");
  const permissionSnapshotId = optionalStringColumn(attempt, "permission_snapshot_id");
  const permissionSnapshotRevision = optionalNumberColumn(attempt, "permission_snapshot_revision");
  const accessChannel = optionalStringColumn(attempt, "access_channel");
  const binding = [
    requestedBySubjectId,
    permissionSnapshotId,
    permissionSnapshotRevision,
    accessChannel,
  ];
  const present = binding.filter((value) => value !== undefined).length;
  if (present === 0) {
    if (admission.trustedInternal !== true) denied();
    return null;
  }
  if (
    present !== binding.length ||
    admission.trustedInternal === true ||
    !admission.requestedBySubjectId ||
    admission.requestedBySubjectId !== requestedBySubjectId ||
    !KNOWLEDGE_SPACE_ACCESS_CHANNELS.includes(accessChannel as KnowledgeSpaceAccessChannel)
  ) {
    denied();
  }

  let permission: KnowledgeSpacePermissionSnapshot;
  try {
    permission = await assertDatabaseKnowledgeSpacePermissionFence({
      database,
      executor,
      fence: {
        accessChannel: accessChannel as KnowledgeSpaceAccessChannel,
        knowledgeSpaceId: admission.knowledgeSpaceId,
        permissionSnapshotId: permissionSnapshotId as string,
        permissionSnapshotRevision: permissionSnapshotRevision as number,
        requestedBySubjectId: requestedBySubjectId as string,
        tenantId: admission.tenantId,
      },
      now: admission.now,
      requiredAccess: "write",
    });
  } catch (error) {
    if (error instanceof KnowledgeSpaceAccessError) denied();
    throw error;
  }

  const requiredScope = candidatePermissionScopeSnapshot(
    jsonObjectColumn(asset, "metadata").permissionScope,
  );
  if (
    !requiredScope ||
    !candidatePermissionScopeAllows(requiredScope, permission.permissionScopes)
  ) {
    denied();
  }
  return permission;
}

function denied(): never {
  throw new DocumentCandidateAdmissionError();
}

function q(database: Pick<DatabaseAdapter, "dialect">, value: string): string {
  return quoteDatabaseIdentifier(database, value);
}

function p(database: Pick<DatabaseAdapter, "dialect">, position: number): string {
  return databasePlaceholder(database, position);
}
