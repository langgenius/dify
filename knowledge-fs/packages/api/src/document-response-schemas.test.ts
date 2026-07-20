import { describe, expect, it } from "vitest";

import {
  BulkDocumentDeleteResponseSchema,
  BulkDocumentReindexResponseSchema,
  BulkDocumentUploadAcceptedResponseSchema,
  DocumentCompilationJobResponseSchema,
  DocumentUploadAcceptedResponseSchema,
} from "./document-response-schemas";

const DOCUMENT_ID = "00000000-0000-4000-8000-000000000001";

describe("document-response-schemas", () => {
  it.each(["revision_conflict", "document_not_found", "invalid_target"] as const)(
    "accepts the public targeted bulk exclusion reason %s",
    (reason) => {
      expect(
        BulkDocumentUploadAcceptedResponseSchema.parse({
          accepted: 0,
          bulkJobId: "bulk-targeted-1",
          excluded: 1,
          items: [
            {
              filename: "target.md",
              index: 0,
              mimeType: "text/markdown",
              reason,
              sizeBytes: 12,
              status: "excluded",
            },
          ],
          total: 1,
        }),
      ).toMatchObject({ items: [{ reason }] });
    },
  );

  it("accepts upload and reindex response payloads", () => {
    const accepted = DocumentUploadAcceptedResponseSchema.parse({
      asset: {
        createdAt: "2026-05-14T00:00:00.000Z",
        filename: "file.md",
        id: DOCUMENT_ID,
        knowledgeSpaceId: DOCUMENT_ID,
        metadata: {},
        mimeType: "text/markdown",
        objectKey: "tenant/spaces/space/documents/doc/file.md",
        parserStatus: "pending",
        sha256: "a".repeat(64),
        sizeBytes: 12,
        updatedAt: "2026-05-14T00:00:00.000Z",
        version: 1,
      },
      assetStatusUrl: "/knowledge-spaces/space/assets/asset",
      compilationJob: { id: "job-1", stage: "queued" },
      documentRevision: 2,
      logicalDocument: { id: DOCUMENT_ID, revision: 2 },
      logicalDocumentId: DOCUMENT_ID,
      statusUrl: `/knowledge-spaces/space/documents/${DOCUMENT_ID}/tasks/job-1`,
    });

    expect(accepted.logicalDocument).toEqual({ id: DOCUMENT_ID, revision: 2 });
    expect(accepted).toMatchObject({ documentRevision: 2, logicalDocumentId: DOCUMENT_ID });

    expect(
      BulkDocumentReindexResponseSchema.parse({
        bulkJobId: "bulk-1",
        items: [
          {
            asset: accepted.asset,
            compilationJob: accepted.compilationJob,
            status: "queued",
            statusUrl: accepted.statusUrl,
          },
        ],
        total: 1,
      }),
    ).toMatchObject({ total: 1 });
  });

  it("accepts delete and compilation job responses with bounded enum states", () => {
    expect(
      BulkDocumentDeleteResponseSchema.parse({
        bulkJobId: "bulk-1",
        items: [
          {
            artifactsDeleted: 1,
            documentId: DOCUMENT_ID,
            nodesDeleted: 2,
            objectDeleted: true,
            projectionsDeleted: 3,
            status: "deleted",
          },
        ],
        total: 1,
      }),
    ).toMatchObject({ total: 1 });

    expect(
      DocumentCompilationJobResponseSchema.parse({
        createdAt: 1,
        documentAssetId: DOCUMENT_ID,
        id: "job-1",
        knowledgeSpaceId: DOCUMENT_ID,
        queueJobId: "queue-1",
        stage: "published",
        tenantId: "tenant-a",
        updatedAt: 2,
        version: 1,
      }),
    ).toMatchObject({ stage: "published" });

    const dispatchPendingJob = DocumentCompilationJobResponseSchema.parse({
      baseHeadRevision: 0,
      createdAt: 1,
      documentAssetId: DOCUMENT_ID,
      executionAttempts: 0,
      id: "00000000-0000-4000-8000-000000000002",
      knowledgeSpaceId: DOCUMENT_ID,
      maxExecutionAttempts: 5,
      publicationGenerationId: "00000000-0000-4000-8000-000000000003",
      runState: "dispatch_pending",
      stage: "queued",
      tenantId: "tenant-a",
      updatedAt: 1,
      version: 1,
    });

    expect(dispatchPendingJob).toMatchObject({ runState: "dispatch_pending" });
    expect(dispatchPendingJob).not.toHaveProperty("queueJobId");
  });
});
