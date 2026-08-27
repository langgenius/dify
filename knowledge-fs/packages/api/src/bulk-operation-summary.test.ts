import { describe, expect, it } from "vitest";

import type { BulkOperation } from "./bulk-operation";
import { summarizeBulkOperation } from "./bulk-operation-summary";
import type {
  DocumentCompilationJob,
  DocumentCompilationJobStage,
  DocumentCompilationJobStateMachine,
} from "./document-compilation-job";
import type { DurableDeletionJob } from "./durable-deletion-repository";

const CREATED_AT = "2026-05-15T00:00:00.000Z";
const UPDATED_AT = "2026-05-15T00:01:00.000Z";
const JOB_CREATED_AT = Date.parse(CREATED_AT);
const JOB_UPDATED_AT = Date.parse(UPDATED_AT);

describe("summarizeBulkOperation", () => {
  it("derives completed progress from item and compilation job states", async () => {
    const operation = bulkOperation({
      items: [
        { documentId: "doc-1", status: "completed" },
        { compilationJobId: "job-1", documentId: "doc-2", status: "queued" },
        { compilationJobId: "job-2", documentId: "doc-3", status: "queued" },
      ],
    });
    const jobs = {
      getMany: async (ids: readonly string[]) => {
        expect(ids).toEqual(["job-1", "job-2"]);

        return [compilationJob("job-1", "published"), compilationJob("job-2", "parsed")];
      },
    } as unknown as DocumentCompilationJobStateMachine;

    await expect(summarizeBulkOperation(operation, jobs)).resolves.toEqual({
      canceledItems: 0,
      completedItems: 2,
      createdAt: CREATED_AT,
      failedItemIds: [],
      failedItems: 0,
      id: operation.id,
      knowledgeSpaceId: operation.knowledgeSpaceId,
      progressPercent: 67,
      status: "running",
      totalItems: 3,
      type: "document_reindex",
      updatedAt: UPDATED_AT,
    });
  });

  it("reports durable deletion checkpoint progress before an item becomes terminal", async () => {
    const deletionJobId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c55";
    const operation = bulkOperation({
      items: [{ deletionJobId, documentId: "doc-1", status: "queued" }],
      type: "document_delete",
    });
    const deletionJob = {
      checkpoint: "quiescing",
      id: deletionJobId,
      runState: "retry_wait",
      updatedAt: UPDATED_AT,
    } as DurableDeletionJob;

    await expect(
      summarizeBulkOperation(operation, undefined, {
        getJob: async () => deletionJob,
      }),
    ).resolves.toMatchObject({
      progressPercent: 10,
      status: "running",
      totalItems: 1,
    });
  });

  it("marks the operation failed only when all remaining items are terminal failures", async () => {
    const operation = bulkOperation({
      items: [
        { documentId: "doc-1", status: "completed" },
        { compilationJobId: "job-1", documentId: "doc-2", status: "queued" },
      ],
    });
    const jobs = {
      getMany: async () => [compilationJob("job-1", "failed")],
    } as unknown as DocumentCompilationJobStateMachine;

    await expect(summarizeBulkOperation(operation, jobs)).resolves.toMatchObject({
      canceledItems: 0,
      completedItems: 1,
      failedItemIds: ["doc-2"],
      failedItems: 1,
      status: "failed",
      totalItems: 2,
    });
  });

  it("reports a fully interrupted operation as canceled and retryable", async () => {
    const operation = bulkOperation({
      items: [{ compilationJobId: "job-1", documentId: "doc-1", status: "queued" }],
    });
    const jobs = {
      getMany: async () => [compilationJob("job-1", "canceled")],
    } as unknown as DocumentCompilationJobStateMachine;

    await expect(summarizeBulkOperation(operation, jobs)).resolves.toMatchObject({
      canceledItems: 1,
      completedItems: 0,
      failedItems: 0,
      status: "canceled",
      totalItems: 1,
    });
  });
});

function bulkOperation({
  items,
  type = "document_reindex",
}: {
  readonly items: BulkOperation["items"];
  readonly type?: BulkOperation["type"] | undefined;
}): BulkOperation {
  return {
    createdAt: CREATED_AT,
    id: "bulk-1",
    items,
    knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
    tenantId: "tenant-1",
    type,
    updatedAt: UPDATED_AT,
  };
}

function compilationJob(id: string, stage: DocumentCompilationJobStage): DocumentCompilationJob {
  return {
    createdAt: JOB_CREATED_AT,
    documentAssetId: `asset-${id}`,
    id,
    knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
    queueJobId: `queue-${id}`,
    stage,
    tenantId: "tenant-1",
    updatedAt: JOB_UPDATED_AT,
    version: 1,
  };
}
