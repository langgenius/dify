import { describe, expect, it } from "vitest";

import {
  bulkBackgroundTask,
  decodeBackgroundTaskCursor,
  documentBackgroundTask,
  encodeBackgroundTaskCursor,
  sourceBackgroundTask,
} from "./background-task";
import type { BulkOperation } from "./bulk-operation";
import type { BulkOperationSummary } from "./bulk-operation-summary";
import type { DocumentProcessingTask } from "./document-processing-task-repository";
import type { SourceWorkflowRun } from "./source-product-workflow";

const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40";
const CREATED_AT = "2026-07-23T12:00:00.000Z";
const UPDATED_AT = "2026-07-23T12:01:00.000Z";

describe("background task DTOs", () => {
  it("maps document terminal states to retry and cancel controls", () => {
    expect(
      documentBackgroundTask(
        documentTask({
          completedAt: UPDATED_AT,
          errorCode: "PARSER_FAILED",
          errorMessage: "Parser failed",
          progressPercent: 20,
          state: "failed",
        }),
      ),
    ).toMatchObject({
      canCancel: false,
      canRetry: true,
      errorCode: "PARSER_FAILED",
      operation: "document_processing",
      progressFailed: 1,
      state: "failed",
      taskKind: "document",
    });

    expect(documentBackgroundTask(documentTask({ state: "retry_wait" }))).toMatchObject({
      canCancel: true,
      canRetry: false,
      state: "queued",
    });
  });

  it.each([
    ["succeeded", "completed", 1, false, false],
    ["canceled", "canceled", 0, false, true],
    ["superseded", "canceled", 0, false, true],
    ["running", "running", 0, true, false],
  ] as const)(
    "maps document state %s to public state %s",
    (state, publicState, progressCompleted, canCancel, canRetry) => {
      expect(documentBackgroundTask(documentTask({ state }))).toMatchObject({
        canCancel,
        canRetry,
        progressCompleted,
        state: publicState,
      });
    },
  );

  it("maps bulk and source task progress without treating canceled work as failed", () => {
    const operation: BulkOperation = {
      capabilityGrantId: "11111111-1111-4111-8111-111111111111",
      createdAt: CREATED_AT,
      id: "22222222-2222-4222-8222-222222222222",
      items: [],
      knowledgeSpaceId: SPACE_ID,
      tenantId: "tenant-1",
      type: "document_reindex",
      updatedAt: UPDATED_AT,
    };
    const summary: BulkOperationSummary = {
      canceledItems: 1,
      completedItems: 2,
      createdAt: CREATED_AT,
      failedItemIds: [],
      failedItems: 0,
      id: operation.id,
      knowledgeSpaceId: SPACE_ID,
      status: "canceled",
      totalItems: 3,
      type: operation.type,
      updatedAt: UPDATED_AT,
    };
    expect(bulkBackgroundTask(operation, summary)).toMatchObject({
      canCancel: false,
      canRetry: true,
      progressCompleted: 2,
      progressFailed: 0,
      progressPercent: 100,
      state: "canceled",
      taskKind: "document_bulk",
    });

    expect(
      sourceBackgroundTask(
        sourceRun({
          progressCompleted: 4,
          progressFailed: 1,
          progressSkipped: 1,
          progressTotal: 8,
          state: "syncing",
        }),
      ),
    ).toMatchObject({
      canCancel: true,
      canRetry: false,
      operation: "source_sync",
      progressCompleted: 4,
      progressFailed: 1,
      progressPercent: 75,
      progressTotal: 8,
      state: "running",
      taskKind: "source",
    });
  });

  it("maps empty bulk operations and every source terminal state", () => {
    const operation: BulkOperation = {
      createdAt: CREATED_AT,
      id: "22222222-2222-4222-8222-222222222222",
      items: [],
      knowledgeSpaceId: SPACE_ID,
      permissionSnapshot: {
        accessChannel: "interactive",
        id: "11111111-1111-4111-8111-111111111111",
        revision: 2,
      },
      requestedBySubjectId: "member-a",
      tenantId: "tenant-1",
      type: "document_upload",
      updatedAt: UPDATED_AT,
    };
    expect(
      bulkBackgroundTask(operation, {
        canceledItems: 0,
        completedItems: 0,
        createdAt: CREATED_AT,
        failedItemIds: [],
        failedItems: 0,
        id: operation.id,
        knowledgeSpaceId: SPACE_ID,
        status: "completed",
        totalItems: 0,
        type: operation.type,
        updatedAt: UPDATED_AT,
      }),
    ).toMatchObject({
      canCancel: false,
      canRetry: false,
      completedAt: UPDATED_AT,
      operation: "document_upload",
      progressPercent: 100,
      state: "completed",
    });

    expect(
      sourceBackgroundTask(
        sourceRun({
          kind: "crawl-import",
          lastErrorCode: "SOURCE_FAILED",
          lastErrorMessage: "Source failed",
          progressTotal: 0,
          sourceId: undefined,
          state: "failed",
        }),
      ),
    ).toMatchObject({
      canRetry: true,
      errorCode: "SOURCE_FAILED",
      errorMessage: "Source failed",
      operation: "source_crawl_import",
      progressPercent: 100,
      state: "failed",
    });
    expect(
      sourceBackgroundTask(
        sourceRun({ kind: "crawl-preview", progressTotal: 2, state: "completed" }),
      ),
    ).toMatchObject({
      operation: "source_crawl_preview",
      progressCompleted: 2,
      state: "completed",
    });
    expect(
      sourceBackgroundTask(sourceRun({ kind: "online-document-import", state: "zero_results" })),
    ).toMatchObject({
      operation: "source_online_document_import",
      state: "completed",
    });
    expect(
      sourceBackgroundTask(sourceRun({ kind: "online-drive-import", state: "preview_ready" })),
    ).toMatchObject({
      operation: "source_online_drive_import",
      state: "completed",
    });
    expect(sourceBackgroundTask(sourceRun({ kind: "bulk", state: "canceled" }))).toMatchObject({
      canRetry: true,
      operation: "source_bulk",
      state: "canceled",
    });
    expect(sourceBackgroundTask(sourceRun({ state: "queued" }))).toMatchObject({
      canCancel: true,
      state: "queued",
    });
  });

  it("round-trips opaque composite cursors and rejects malformed values", () => {
    const cursor = {
      bulk: { createdAt: CREATED_AT, id: "bulk-1" },
      document: { createdAt: UPDATED_AT, id: "document-1" },
      version: 1 as const,
    };
    expect(decodeBackgroundTaskCursor(encodeBackgroundTaskCursor(cursor))).toEqual(cursor);
    expect(() => decodeBackgroundTaskCursor("not-a-cursor")).toThrow(
      "Invalid background task cursor",
    );
    expect(() =>
      decodeBackgroundTaskCursor(
        Buffer.from(
          JSON.stringify({ document: { createdAt: "bad", id: "x" }, version: 1 }),
        ).toString("base64url"),
      ),
    ).toThrow("Invalid background task cursor");
  });

  it("validates every cursor component and preserves a source-only cursor", () => {
    const sourceOnly = {
      source: { createdAt: CREATED_AT, id: "source-1" },
      version: 1 as const,
    };
    expect(decodeBackgroundTaskCursor(encodeBackgroundTaskCursor(sourceOnly))).toEqual(sourceOnly);

    for (const value of [
      null,
      [],
      { version: 2 },
      { document: null, version: 1 },
      { bulk: [], version: 1 },
      { source: { createdAt: CREATED_AT, extra: true, id: "source-1" }, version: 1 },
      { source: { createdAt: 1, id: "source-1" }, version: 1 },
      { source: { createdAt: "not-a-date", id: "source-1" }, version: 1 },
      { source: { createdAt: CREATED_AT, id: 1 }, version: 1 },
      { source: { createdAt: CREATED_AT, id: "" }, version: 1 },
    ]) {
      expect(() =>
        decodeBackgroundTaskCursor(Buffer.from(JSON.stringify(value)).toString("base64url")),
      ).toThrow("Invalid background task cursor");
    }
  });
});

function documentTask(patch: Partial<DocumentProcessingTask> = {}): DocumentProcessingTask {
  return {
    createdAt: CREATED_AT,
    documentId: "33333333-3333-4333-8333-333333333333",
    documentRevision: 2,
    id: "44444444-4444-4444-8444-444444444444",
    knowledgeSpaceId: SPACE_ID,
    progressPercent: 0,
    stage: "queued",
    state: "queued",
    updatedAt: UPDATED_AT,
    ...patch,
  };
}

function sourceRun(patch: Partial<SourceWorkflowRun> = {}): SourceWorkflowRun {
  return {
    checkpoint: "queued",
    createdAt: CREATED_AT,
    executionAttempts: 1,
    id: "55555555-5555-4555-8555-555555555555",
    idempotencyKey: "sync-1",
    knowledgeSpaceId: SPACE_ID,
    kind: "sync",
    maxExecutionAttempts: 5,
    payload: {},
    progressCompleted: 0,
    progressFailed: 0,
    progressSkipped: 0,
    rowVersion: 1,
    sourceId: "66666666-6666-4666-8666-666666666666",
    state: "queued",
    tenantId: "tenant-1",
    updatedAt: UPDATED_AT,
    ...patch,
  };
}
