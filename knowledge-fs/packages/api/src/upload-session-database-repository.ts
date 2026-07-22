import type {
  CompletedMultipartObjectPart,
  DatabaseAdapter,
  DatabaseExecutor,
  DatabaseQueryValue,
  DatabaseRow,
} from "@knowledge/core";

import {
  numberColumn,
  optionalNumberColumn,
  optionalStringColumn,
  stringColumn,
} from "./database-row-utils";
import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";
import { jsonArrayColumn } from "./json-utils";
import { StorageQuotaExceededError } from "./storage-quota";
import {
  type UploadSession,
  UploadSessionConflictError,
  type UploadSessionMode,
  type UploadSessionRepository,
  type UploadSessionStatus,
} from "./upload-session";

const uploadSessionTable = "upload_sessions";
const knowledgeSpaceTable = "knowledge_spaces";
const documentAssetTable = "document_assets";
const uploadSessionModes = new Set<UploadSessionMode>(["multipart", "single", "small_fallback"]);
const uploadSessionStatuses = new Set<UploadSessionStatus>([
  "creating",
  "ready",
  "completing",
  "completed",
  "aborting",
  "aborted",
  "expired",
  "failed",
]);

export function createDatabaseUploadSessionRepository({
  database,
}: {
  readonly database: DatabaseAdapter;
}): UploadSessionRepository {
  return {
    claimExpired: async ({ limit, now, staleBefore }) =>
      database.transaction(async (transaction) => {
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
          throw new Error("Upload session cleanup limit must be between 1 and 1000");
        }
        const result = await transaction.execute({
          maxRows: limit,
          operation: "select",
          params: [now, staleBefore, limit],
          sql: `SELECT * FROM ${q(database, uploadSessionTable)} WHERE ((${q(
            database,
            "status",
          )} IN ('creating', 'ready') AND ${q(database, "expires_at")} <= ${p(
            database,
            1,
          )}) OR (${q(database, "status")} = 'aborting' AND ${q(
            database,
            "updated_at",
          )} <= ${p(database, 2)})) ORDER BY ${q(database, "expires_at")}, ${q(
            database,
            "id",
          )} LIMIT ${p(database, 3)} FOR UPDATE SKIP LOCKED`,
          tableName: uploadSessionTable,
        });
        const claimed: UploadSession[] = [];
        for (const row of result.rows) {
          const current = uploadSessionFromRow(row);
          const next: UploadSession = {
            ...current,
            rowVersion: current.rowVersion + 1,
            status: "aborting",
            updatedAt: now,
          };
          const updated = await updateUploadSession(
            database,
            transaction,
            current.rowVersion,
            next,
          );
          if (!updated) throw new Error("Upload session cleanup lost its locked-row CAS");
          claimed.push(updated);
        }
        return claimed;
      }),
    create: async ({ maxRawDocumentBytes, session }) =>
      database.transaction(async (transaction) => {
        const existing = await findByIdempotencyKey(database, transaction, session, true);
        if (existing) {
          assertCreateReplay(existing, session);
          return { created: false, session: existing };
        }
        await lockKnowledgeSpace(database, transaction, session);
        if (maxRawDocumentBytes !== null) {
          const usage = await readReservedUsage(database, transaction, session);
          if (
            usage.rawDocumentBytes >
            maxRawDocumentBytes - usage.reservedBytes - session.reservedBytes
          ) {
            throw new StorageQuotaExceededError();
          }
        }
        await insertUploadSession(database, transaction, session);
        return { created: true, session: cloneUploadSession(session) };
      }),
    get: async ({ id, tenantId }) => {
      const result = await database.execute({
        maxRows: 1,
        operation: "select",
        params: [tenantId, id],
        sql: `SELECT * FROM ${q(database, uploadSessionTable)} WHERE ${q(
          database,
          "tenant_id",
        )} = ${p(database, 1)} AND ${q(database, "id")} = ${p(database, 2)} LIMIT 1`,
        tableName: uploadSessionTable,
      });
      return result.rows[0] ? uploadSessionFromRow(result.rows[0]) : null;
    },
    update: async ({ expectedRowVersion, session }) => {
      return updateUploadSession(database, database, expectedRowVersion, session);
    },
  };
}

async function updateUploadSession(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  expectedRowVersion: number,
  session: UploadSession,
): Promise<UploadSession | null> {
  if (session.rowVersion !== expectedRowVersion + 1) {
    throw new Error("Upload session database update must increment rowVersion by one");
  }
  const params: DatabaseQueryValue[] = [
    session.completionGrantId ?? null,
    session.multipartUploadId ?? null,
    session.status,
    session.reservedBytes,
    JSON.stringify(session.completionParts ?? []),
    session.documentAssetId ?? null,
    session.compilationJobId ?? null,
    session.errorCode ?? null,
    session.abortedAt ?? null,
    session.completedAt ?? null,
    session.rowVersion,
    session.updatedAt,
    session.tenantId,
    session.id,
    expectedRowVersion,
  ];
  const result = await executor.execute({
    maxRows: 0,
    operation: "update",
    params,
    sql: `UPDATE ${q(database, uploadSessionTable)} SET ${q(
      database,
      "completion_grant_id",
    )} = ${p(database, 1)}, ${q(
      database,
      "multipart_upload_id",
    )} = ${p(database, 2)}, ${q(database, "status")} = ${p(database, 3)}, ${q(
      database,
      "reserved_bytes",
    )} = ${p(database, 4)}, ${q(database, "completion_parts")} = ${jsonP(
      database,
      5,
    )}, ${q(database, "document_asset_id")} = ${p(database, 6)}, ${q(
      database,
      "compilation_job_id",
    )} = ${p(database, 7)}, ${q(database, "error_code")} = ${p(database, 8)}, ${q(
      database,
      "aborted_at",
    )} = ${p(database, 9)}, ${q(database, "completed_at")} = ${p(database, 10)}, ${q(
      database,
      "row_version",
    )} = ${p(database, 11)}, ${q(database, "updated_at")} = ${p(
      database,
      12,
    )} WHERE ${q(database, "tenant_id")} = ${p(database, 13)} AND ${q(
      database,
      "id",
    )} = ${p(database, 14)} AND ${q(database, "row_version")} = ${p(database, 15)}`,
    tableName: uploadSessionTable,
  });
  return result.rowsAffected === 1 ? cloneUploadSession(session) : null;
}

async function findByIdempotencyKey(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  session: UploadSession,
  lock: boolean,
): Promise<UploadSession | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [session.tenantId, session.knowledgeSpaceId, session.idempotencyKey],
    sql: `SELECT * FROM ${q(database, uploadSessionTable)} WHERE ${q(
      database,
      "tenant_id",
    )} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(
      database,
      2,
    )} AND ${q(database, "idempotency_key")} = ${p(database, 3)} LIMIT 1${
      lock ? " FOR UPDATE" : ""
    }`,
    tableName: uploadSessionTable,
  });
  return result.rows[0] ? uploadSessionFromRow(result.rows[0]) : null;
}

async function lockKnowledgeSpace(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  session: UploadSession,
): Promise<void> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [session.tenantId, session.knowledgeSpaceId],
    sql: `SELECT ${q(database, "id")} FROM ${q(database, knowledgeSpaceTable)} WHERE ${q(
      database,
      "tenant_id",
    )} = ${p(database, 1)} AND ${q(database, "id")} = ${p(database, 2)} FOR UPDATE`,
    tableName: knowledgeSpaceTable,
  });
  if (result.rows.length !== 1) {
    throw new UploadSessionConflictError("Upload session knowledge space is unavailable");
  }
}

async function readReservedUsage(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  session: UploadSession,
): Promise<{ readonly rawDocumentBytes: number; readonly reservedBytes: number }> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [session.knowledgeSpaceId, session.tenantId],
    sql: `SELECT COALESCE((SELECT SUM(asset.${q(
      database,
      "size_bytes",
    )}) FROM ${q(database, documentAssetTable)} asset WHERE asset.${q(
      database,
      "knowledge_space_id",
    )} = ${p(database, 1)}), 0) AS ${q(
      database,
      "raw_document_bytes",
    )}, COALESCE((SELECT SUM(active.${q(database, "reserved_bytes")}) FROM ${q(
      database,
      uploadSessionTable,
    )} active WHERE active.${q(database, "tenant_id")} = ${p(
      database,
      2,
    )} AND active.${q(database, "knowledge_space_id")} = ${p(
      database,
      1,
    )} AND active.${q(database, "reserved_bytes")} > 0), 0) AS ${q(database, "reserved_bytes")}`,
    tableName: uploadSessionTable,
  });
  const row = result.rows[0];
  if (!row) throw new Error("Upload session quota query returned no row");
  return {
    rawDocumentBytes: nonNegativeIntegerColumn(row, "raw_document_bytes"),
    reservedBytes: nonNegativeIntegerColumn(row, "reserved_bytes"),
  };
}

async function insertUploadSession(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  session: UploadSession,
): Promise<void> {
  const columns = [
    "id",
    "tenant_id",
    "knowledge_space_id",
    "grant_id",
    "completion_grant_id",
    "idempotency_key",
    "object_key",
    "file_name",
    "content_type",
    "checksum_sha256_base64",
    "expected_size_bytes",
    "reserved_bytes",
    "mode",
    "multipart_upload_id",
    "multipart_part_size_bytes",
    "multipart_part_count",
    "status",
    "completion_parts",
    "document_asset_id",
    "compilation_job_id",
    "error_code",
    "expires_at",
    "aborted_at",
    "completed_at",
    "row_version",
    "created_at",
    "updated_at",
  ] as const;
  const params: DatabaseQueryValue[] = [
    session.id,
    session.tenantId,
    session.knowledgeSpaceId,
    session.grantId,
    session.completionGrantId ?? null,
    session.idempotencyKey,
    session.objectKey,
    session.fileName,
    session.contentType,
    session.checksumSha256Base64,
    session.expectedSizeBytes,
    session.reservedBytes,
    session.mode,
    session.multipartUploadId ?? null,
    session.multipartPartSizeBytes ?? null,
    session.multipartPartCount ?? null,
    session.status,
    JSON.stringify(session.completionParts ?? []),
    session.documentAssetId ?? null,
    session.compilationJobId ?? null,
    session.errorCode ?? null,
    session.expiresAt,
    session.abortedAt ?? null,
    session.completedAt ?? null,
    session.rowVersion,
    session.createdAt,
    session.updatedAt,
  ];
  await executor.execute({
    maxRows: 0,
    operation: "insert",
    params,
    sql: `INSERT INTO ${q(database, uploadSessionTable)} (${columns
      .map((column) => q(database, column))
      .join(", ")}) VALUES (${columns
      .map((column, index) =>
        column === "completion_parts" ? jsonP(database, index + 1) : p(database, index + 1),
      )
      .join(", ")})`,
    tableName: uploadSessionTable,
  });
}

function uploadSessionFromRow(row: DatabaseRow): UploadSession {
  const mode = stringColumn(row, "mode");
  if (!uploadSessionModes.has(mode as UploadSessionMode)) {
    throw new Error("Upload session mode is invalid");
  }
  const status = stringColumn(row, "status");
  if (!uploadSessionStatuses.has(status as UploadSessionStatus)) {
    throw new Error("Upload session status is invalid");
  }
  const completionParts = completionPartsFromRow(row);
  return {
    ...(optionalNumberColumn(row, "aborted_at") === undefined
      ? {}
      : { abortedAt: optionalNumberColumn(row, "aborted_at") }),
    checksumSha256Base64: stringColumn(row, "checksum_sha256_base64"),
    ...(optionalStringColumn(row, "completion_grant_id")
      ? { completionGrantId: optionalStringColumn(row, "completion_grant_id") }
      : {}),
    ...(optionalStringColumn(row, "compilation_job_id")
      ? { compilationJobId: optionalStringColumn(row, "compilation_job_id") }
      : {}),
    ...(optionalNumberColumn(row, "completed_at") === undefined
      ? {}
      : { completedAt: optionalNumberColumn(row, "completed_at") }),
    ...(completionParts.length > 0 ? { completionParts } : {}),
    contentType: stringColumn(row, "content_type"),
    createdAt: numberColumn(row, "created_at"),
    ...(optionalStringColumn(row, "document_asset_id")
      ? { documentAssetId: optionalStringColumn(row, "document_asset_id") }
      : {}),
    ...(optionalStringColumn(row, "error_code")
      ? { errorCode: optionalStringColumn(row, "error_code") }
      : {}),
    expectedSizeBytes: nonNegativeIntegerColumn(row, "expected_size_bytes"),
    expiresAt: numberColumn(row, "expires_at"),
    fileName: stringColumn(row, "file_name"),
    grantId: stringColumn(row, "grant_id"),
    id: stringColumn(row, "id"),
    idempotencyKey: stringColumn(row, "idempotency_key"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    mode: mode as UploadSessionMode,
    ...(optionalNumberColumn(row, "multipart_part_count") === undefined
      ? {}
      : { multipartPartCount: optionalNumberColumn(row, "multipart_part_count") }),
    ...(optionalNumberColumn(row, "multipart_part_size_bytes") === undefined
      ? {}
      : { multipartPartSizeBytes: optionalNumberColumn(row, "multipart_part_size_bytes") }),
    ...(optionalStringColumn(row, "multipart_upload_id")
      ? { multipartUploadId: optionalStringColumn(row, "multipart_upload_id") }
      : {}),
    objectKey: stringColumn(row, "object_key"),
    reservedBytes: nonNegativeIntegerColumn(row, "reserved_bytes"),
    rowVersion: numberColumn(row, "row_version"),
    status: status as UploadSessionStatus,
    tenantId: stringColumn(row, "tenant_id"),
    updatedAt: numberColumn(row, "updated_at"),
  };
}

function completionPartsFromRow(row: DatabaseRow): readonly CompletedMultipartObjectPart[] {
  return jsonArrayColumn(row, "completion_parts").map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Upload session completion part is invalid");
    }
    const part = value as Record<string, unknown>;
    if (
      typeof part.etag !== "string" ||
      typeof part.partNumber !== "number" ||
      (part.checksumSha256Base64 !== undefined && typeof part.checksumSha256Base64 !== "string")
    ) {
      throw new Error("Upload session completion part is invalid");
    }
    return {
      ...(part.checksumSha256Base64 ? { checksumSha256Base64: part.checksumSha256Base64 } : {}),
      etag: part.etag,
      partNumber: part.partNumber,
    };
  });
}

function assertCreateReplay(existing: UploadSession, requested: UploadSession): void {
  if (
    existing.tenantId !== requested.tenantId ||
    existing.knowledgeSpaceId !== requested.knowledgeSpaceId ||
    existing.grantId !== requested.grantId ||
    existing.fileName !== requested.fileName ||
    existing.contentType !== requested.contentType ||
    existing.expectedSizeBytes !== requested.expectedSizeBytes ||
    existing.checksumSha256Base64 !== requested.checksumSha256Base64 ||
    existing.mode !== requested.mode
  ) {
    throw new UploadSessionConflictError(
      "Upload idempotency key was reused with different request data",
    );
  }
}

function nonNegativeIntegerColumn(row: DatabaseRow, column: string): number {
  const raw = row[column];
  const value = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : raw;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Database row column ${column} must be a non-negative safe integer`);
  }
  return value;
}

function cloneUploadSession(session: UploadSession): UploadSession {
  return {
    ...session,
    ...(session.completionParts
      ? { completionParts: session.completionParts.map((part) => ({ ...part })) }
      : {}),
  };
}

function q(database: DatabaseAdapter, identifier: string): string {
  return quoteDatabaseIdentifier(database, identifier);
}

function p(database: DatabaseAdapter, position: number): string {
  return databasePlaceholder(database, position);
}

function jsonP(database: DatabaseAdapter, position: number): string {
  const placeholder = p(database, position);
  return database.dialect === "postgres" ? `${placeholder}::jsonb` : `CAST(${placeholder} AS JSON)`;
}
