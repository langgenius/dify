import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type {
  DatabaseAdapter,
  DatabaseExecuteInput,
  DatabaseExecuteResult,
  DatabaseExecutor,
  DatabaseRow,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { StorageQuotaExceededError } from "./storage-quota";
import type { UploadSession } from "./upload-session";
import { createDatabaseUploadSessionRepository } from "./upload-session-database-repository";

const SESSION_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01";
const GRANT_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d02";
const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d03";
const TENANT_ID = "tenant-1";

interface ScriptStep {
  readonly operation: DatabaseExecuteInput["operation"];
  readonly rows: readonly DatabaseRow[];
  readonly rowsAffected?: number;
  readonly tableName: string;
}

describe.each(["postgres", "tidb"] as const)("database upload sessions (%s)", (dialect) => {
  it("locks the space, atomically counts persisted usage plus reservations, and inserts", async () => {
    const script = scriptedDatabase(dialect, [
      step("upload_sessions", "select", []),
      step("knowledge_spaces", "select", [{ id: SPACE_ID }]),
      step("upload_sessions", "select", [{ raw_document_bytes: 100, reserved_bytes: 200 }]),
      step("upload_sessions", "insert", []),
    ]);
    const repository = createDatabaseUploadSessionRepository({ database: script.database });

    await expect(
      repository.create({
        currentRawDocumentBytes: 999_999,
        maxRawDocumentBytes: 1_000,
        session: uploadSession(),
      }),
    ).resolves.toEqual({ created: true, session: uploadSession() });

    expect(script.calls[0]?.sql).toContain("FOR UPDATE");
    expect(script.calls[1]?.sql).toContain("FOR UPDATE");
    expect(script.calls[2]?.sql).toContain("document_assets");
    expect(script.calls[2]?.sql).toContain("reserved_bytes");
    expect(script.calls[3]?.sql).toContain(dialect === "postgres" ? "::jsonb" : " AS JSON");
    expect(script.calls[3]?.sql.toLowerCase()).not.toContain("token");
    script.expectDone();
  });

  it("replays an identical idempotency row and rejects database-authoritative over-quota state", async () => {
    const replay = scriptedDatabase(dialect, [
      step("upload_sessions", "select", [uploadSessionRow()]),
    ]);
    await expect(
      createDatabaseUploadSessionRepository({ database: replay.database }).create({
        currentRawDocumentBytes: 0,
        maxRawDocumentBytes: 1_000,
        session: uploadSession(),
      }),
    ).resolves.toEqual({ created: false, session: uploadSession() });
    replay.expectDone();

    const overQuota = scriptedDatabase(dialect, [
      step("upload_sessions", "select", []),
      step("knowledge_spaces", "select", [{ id: SPACE_ID }]),
      step("upload_sessions", "select", [{ raw_document_bytes: 600, reserved_bytes: 400 }]),
    ]);
    await expect(
      createDatabaseUploadSessionRepository({ database: overQuota.database }).create({
        currentRawDocumentBytes: 0,
        maxRawDocumentBytes: 1_000,
        session: uploadSession(),
      }),
    ).rejects.toThrow(StorageQuotaExceededError);
    overQuota.expectDone();
  });

  it("scopes reads by tenant and updates the complete row with a row-version CAS", async () => {
    const read = scriptedDatabase(dialect, [
      step("upload_sessions", "select", [uploadSessionRow()]),
    ]);
    await expect(
      createDatabaseUploadSessionRepository({ database: read.database }).get({
        id: SESSION_ID,
        tenantId: TENANT_ID,
      }),
    ).resolves.toEqual(uploadSession());
    expect(read.calls[0]?.params).toEqual([TENANT_ID, SESSION_ID]);
    read.expectDone();

    const ready: UploadSession = {
      ...uploadSession(),
      rowVersion: 2,
      status: "ready",
      updatedAt: 2_000_001,
    };
    const update = scriptedDatabase(dialect, [step("upload_sessions", "update", [])]);
    await expect(
      createDatabaseUploadSessionRepository({ database: update.database }).update({
        expectedRowVersion: 1,
        session: ready,
      }),
    ).resolves.toEqual(ready);
    expect(update.calls[0]?.sql).toContain("row_version");
    expect(update.calls[0]?.sql).toContain("tenant_id");
    expect(update.calls[0]?.params).toContain(JSON.stringify([]));
    update.expectDone();
  });

  it("returns null when a CAS loses and rejects malformed persisted state", async () => {
    const lost = scriptedDatabase(dialect, [step("upload_sessions", "update", [], 0)]);
    await expect(
      createDatabaseUploadSessionRepository({ database: lost.database }).update({
        expectedRowVersion: 1,
        session: { ...uploadSession(), rowVersion: 2, status: "ready" },
      }),
    ).resolves.toBeNull();

    const corrupt = scriptedDatabase(dialect, [
      step("upload_sessions", "select", [uploadSessionRow({ status: "unknown" })]),
    ]);
    await expect(
      createDatabaseUploadSessionRepository({ database: corrupt.database }).get({
        id: SESSION_ID,
        tenantId: TENANT_ID,
      }),
    ).rejects.toThrow("status is invalid");
  });

  it("claims expired or stale-cleanup rows with a bounded skip-locked CAS", async () => {
    const script = scriptedDatabase(dialect, [
      step("upload_sessions", "select", [uploadSessionRow({ status: "ready" })]),
      step("upload_sessions", "update", []),
    ]);

    await expect(
      createDatabaseUploadSessionRepository({ database: script.database }).claimExpired({
        limit: 10,
        now: 3_000_000,
        staleBefore: 2_500_000,
      }),
    ).resolves.toEqual([
      {
        ...uploadSession(),
        rowVersion: 2,
        status: "aborting",
        updatedAt: 3_000_000,
      },
    ]);
    expect(script.calls[0]?.sql).toContain("SKIP LOCKED");
    expect(script.calls[0]?.params).toEqual([3_000_000, 2_500_000, 10]);
    expect(script.calls[1]?.sql).toContain("row_version");
    script.expectDone();
  });
});

function uploadSession(): UploadSession {
  return {
    checksumSha256Base64: "checksum-base64",
    contentType: "application/pdf",
    createdAt: 2_000_000,
    expectedSizeBytes: 500,
    expiresAt: 2_900_000,
    fileName: "report.pdf",
    grantId: GRANT_ID,
    id: SESSION_ID,
    idempotencyKey: "upload-intent-1",
    knowledgeSpaceId: SPACE_ID,
    mode: "single",
    objectKey: `namespaces/${TENANT_ID}/spaces/${SPACE_ID}/uploads/${SESSION_ID}/source`,
    reservedBytes: 500,
    rowVersion: 1,
    status: "creating",
    tenantId: TENANT_ID,
    updatedAt: 2_000_000,
  };
}

function uploadSessionRow(overrides: Partial<DatabaseRow> = {}): DatabaseRow {
  const session = uploadSession();
  return {
    aborted_at: null,
    checksum_sha256_base64: session.checksumSha256Base64,
    compilation_job_id: null,
    completed_at: null,
    completion_parts: [],
    completion_grant_id: session.completionGrantId ?? null,
    content_type: session.contentType,
    created_at: session.createdAt,
    document_asset_id: null,
    error_code: null,
    expected_size_bytes: session.expectedSizeBytes,
    expires_at: session.expiresAt,
    file_name: session.fileName,
    grant_id: session.grantId,
    id: session.id,
    idempotency_key: session.idempotencyKey,
    knowledge_space_id: session.knowledgeSpaceId,
    mode: session.mode,
    multipart_part_count: null,
    multipart_part_size_bytes: null,
    multipart_upload_id: null,
    object_key: session.objectKey,
    reserved_bytes: session.reservedBytes,
    row_version: session.rowVersion,
    status: session.status,
    tenant_id: session.tenantId,
    updated_at: session.updatedAt,
    ...overrides,
  };
}

function scriptedDatabase(
  dialect: DatabaseAdapter["dialect"],
  steps: readonly ScriptStep[],
): {
  readonly calls: readonly DatabaseExecuteInput[];
  readonly database: DatabaseAdapter;
  expectDone(): void;
} {
  let cursor = 0;
  const calls: DatabaseExecuteInput[] = [];
  const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    calls.push(input);
    const expected = steps[cursor];
    if (!expected) throw new Error(`Unexpected SQL call ${input.operation} ${input.tableName}`);
    cursor += 1;
    expect(input).toMatchObject({ operation: expected.operation, tableName: expected.tableName });
    return {
      rows: expected.rows,
      rowsAffected: expected.rowsAffected ?? (input.operation === "select" ? 0 : 1),
    };
  };
  const transaction = async <T>(callback: (executor: DatabaseExecutor) => Promise<T>): Promise<T> =>
    callback({ execute });
  return {
    calls,
    database: createSchemaDatabaseAdapter({ executor: execute, kind: dialect, transaction }),
    expectDone: () => expect(cursor).toBe(steps.length),
  };
}

function step(
  tableName: string,
  operation: DatabaseExecuteInput["operation"],
  rows: readonly DatabaseRow[],
  rowsAffected?: number,
): ScriptStep {
  return { operation, rows, ...(rowsAffected === undefined ? {} : { rowsAffected }), tableName };
}
