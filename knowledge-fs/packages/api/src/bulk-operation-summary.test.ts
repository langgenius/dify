import { describe, expect, it } from "vitest";

import type { BulkOperation } from "./bulk-operation";
import { summarizeBulkOperation } from "./bulk-operation-summary";
import type {
  DocumentCompilationJob,
  DocumentCompilationJobStage,
  DocumentCompilationJobStateMachine,
} from "./document-compilation-job";

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
      completedItems: 2,
      createdAt: CREATED_AT,
      failedItemIds: [],
      failedItems: 0,
      id: operation.id,
      knowledgeSpaceId: operation.knowledgeSpaceId,
      status: "running",
      totalItems: 3,
      type: "document_reindex",
      updatedAt: UPDATED_AT,
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
      completedItems: 1,
      failedItemIds: ["doc-2"],
      failedItems: 1,
      status: "failed",
      totalItems: 2,
    });
  });
});

function bulkOperation({
  items,
}: {
  readonly items: BulkOperation["items"];
}): BulkOperation {
  return {
    createdAt: CREATED_AT,
    id: "bulk-1",
    items,
    knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
    tenantId: "tenant-1",
    type: "document_reindex",
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
