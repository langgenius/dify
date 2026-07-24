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
